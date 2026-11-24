// Rilevamento del display arancione e pixelatura del numero.
// Ogni funzione corrisponde a un pezzo della classe SpeedDisplayProcessor
// della versione Python.

// ==========================================
// CONFIGURAZIONE ZONA DA SFUOCARE
// ==========================================

// Del riquadro arancione rilevato, sfuoca solo la parte centrale (dove sta
// il numero della velocità), non l'intero display (giri motore, spie, ecc.).
pub const CENTRO_LARGHEZZA: f32 = 0.55;
pub const CENTRO_ALTEZZA: f32 = 0.80;

// Sposta il riquadro verso il basso: frazione dell'altezza del riquadro
// arancione di cui scendere (0 = resta centrato, 0.2 = scende del 20%).
pub const OFFSET_VERTICALE: f32 = 0.18;

// Il rilevamento lavora sul fotogramma rimpicciolito a metà (più veloce).
// In Rust la riduzione è fissa a metà: ogni 2x2 pixel diventano 1.
pub const SCALA_RILEVAMENTO: f32 = 0.5;

// Se per qualche frame il rilevamento fallisce (es. sfocatura), continua
// a coprire l'ultima posizione nota per questi frame.
pub const PERSISTENZA_FRAME: u32 = 6;

// Valori di partenza delle impostazioni (le cambia l'utente nell'app)
pub const BLOCCO_PIXEL_NORMALE: u32 = 10;
pub const MARGINE_NORMALE: f32 = 0.15;

/// Le scelte dell'utente che cambiano la copertura.
#[derive(Clone, Copy, Debug)]
pub struct Impostazioni {
    /// Dimensione dei "blocchi" della pixelatura: più alto = più illeggibile
    pub blocco_pixel: u32,
    /// Margine di sicurezza attorno alla zona arancione (0.15 = 15%)
    pub margine: f32,
    /// Modalità prova: disegna i riquadri invece di pixelare
    pub debug: bool,
}

impl Default for Impostazioni {
    fn default() -> Self {
        Impostazioni {
            blocco_pixel: BLOCCO_PIXEL_NORMALE,
            margine: MARGINE_NORMALE,
            debug: false,
        }
    }
}

/// Un rettangolo: angolo in alto a sinistra (x, y), larghezza e altezza.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Riquadro {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Un'immagine a colori: 3 byte per pixel (rosso, verde, blu), riga per riga.
#[derive(Clone)]
pub struct Fotogramma {
    pub larghezza: usize,
    pub altezza: usize,
    pub dati: Vec<u8>,
}

impl Fotogramma {
    pub fn nuovo(larghezza: usize, altezza: usize) -> Fotogramma {
        Fotogramma {
            larghezza,
            altezza,
            dati: vec![0; larghezza * altezza * 3],
        }
    }
}

// ==========================================
// 1. TROVA IL DISPLAY ARANCIONE
// ==========================================

/// Converte un pixel RGB in HSV come fa OpenCV (H da 0 a 180, S e V da 0 a 255)
/// e dice se è arancione: H tra 0 e 25, S e V almeno 100.
fn e_arancione(r: f32, g: f32, b: f32) -> bool {
    let v = r.max(g).max(b);
    let minimo = r.min(g).min(b);
    let differenza = v - minimo;

    if v.round() < 100.0 {
        return false;
    }
    let s = if v > 0.0 { 255.0 * differenza / v } else { 0.0 };
    if s.round() < 100.0 {
        return false;
    }

    let mut h = if v == r {
        60.0 * (g - b) / differenza
    } else if v == g {
        120.0 + 60.0 * (b - r) / differenza
    } else {
        240.0 + 60.0 * (r - g) / differenza
    };
    if h < 0.0 {
        h += 360.0;
    }
    let h = (h / 2.0).round();
    h <= 25.0
}

/// Crea la maschera degli arancioni sul fotogramma rimpicciolito a metà.
/// Ritorna (maschera, larghezza, altezza): 1 = arancione, 0 = no.
fn maschera_arancione(foto: &Fotogramma) -> (Vec<u8>, usize, usize) {
    // stessa dimensione che usa OpenCV con fx = fy = 0.5
    let pw = ((foto.larghezza as f32) * SCALA_RILEVAMENTO).round() as usize;
    let ph = ((foto.altezza as f32) * SCALA_RILEVAMENTO).round() as usize;
    let mut maschera = vec![0u8; pw * ph];

    for y in 0..ph {
        // le due righe del fotogramma grande che finiscono in questa riga
        let y1 = (y * 2).min(foto.altezza - 1);
        let y2 = (y * 2 + 1).min(foto.altezza - 1);
        for x in 0..pw {
            let x1 = (x * 2).min(foto.larghezza - 1);
            let x2 = (x * 2 + 1).min(foto.larghezza - 1);

            // media dei 4 pixel (come cv2.resize lineare a metà)
            let mut somma = [0u32; 3];
            for (xx, yy) in [(x1, y1), (x2, y1), (x1, y2), (x2, y2)] {
                let i = (yy * foto.larghezza + xx) * 3;
                somma[0] += foto.dati[i] as u32;
                somma[1] += foto.dati[i + 1] as u32;
                somma[2] += foto.dati[i + 2] as u32;
            }
            // arrotonda come OpenCV
            let r = ((somma[0] + 2) / 4) as f32;
            let g = ((somma[1] + 2) / 4) as f32;
            let b = ((somma[2] + 2) / 4) as f32;

            if e_arancione(r, g, b) {
                maschera[y * pw + x] = 1;
            }
        }
    }
    (maschera, pw, ph)
}

/// Allarga (dilata) o restringe (erode) la maschera con un quadrato 5x5.
/// Fuori dal bordo non conta (come OpenCV).
fn dilata_o_erodi(maschera: &[u8], w: usize, h: usize, dilata: bool) -> Vec<u8> {
    // prima in orizzontale, poi in verticale (il quadrato 5x5 si può dividere)
    let mut temporanea = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let da = x.saturating_sub(2);
            let a = (x + 2).min(w - 1);
            let mut valore = if dilata { 0 } else { 1 };
            for xx in da..=a {
                let m = maschera[y * w + xx];
                if dilata && m == 1 {
                    valore = 1;
                    break;
                }
                if !dilata && m == 0 {
                    valore = 0;
                    break;
                }
            }
            temporanea[y * w + x] = valore;
        }
    }

    let mut risultato = vec![0u8; w * h];
    for y in 0..h {
        let da = y.saturating_sub(2);
        let a = (y + 2).min(h - 1);
        for x in 0..w {
            let mut valore = if dilata { 0 } else { 1 };
            for yy in da..=a {
                let m = temporanea[yy * w + x];
                if dilata && m == 1 {
                    valore = 1;
                    break;
                }
                if !dilata && m == 0 {
                    valore = 0;
                    break;
                }
            }
            risultato[y * w + x] = valore;
        }
    }
    risultato
}

/// Una zona arancione unita: area (come cv2.contourArea) e rettangolo.
struct Zona {
    area: f32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Trova le zone arancioni unite (pixel che si toccano anche in diagonale,
/// come i contorni esterni di OpenCV) e calcola area e rettangolo.
fn trova_zone(maschera: &[u8], w: usize, h: usize) -> Vec<Zona> {
    let mut visto = vec![false; w * h];
    let mut zone = Vec::new();
    let mut pila: Vec<usize> = Vec::new();

    for partenza in 0..w * h {
        if maschera[partenza] == 0 || visto[partenza] {
            continue;
        }

        // 1) raccoglie tutti i pixel della zona
        let mut pixel_zona: Vec<usize> = Vec::new();
        visto[partenza] = true;
        pila.push(partenza);
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (w, h, 0, 0);
        while let Some(i) = pila.pop() {
            pixel_zona.push(i);
            let x = i % w;
            let y = i / w;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            for dy in -1i32..=1 {
                for dx in -1i32..=1 {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if maschera[j] == 1 && !visto[j] {
                        visto[j] = true;
                        pila.push(j);
                    }
                }
            }
        }

        // 2) area come la calcola OpenCV sul contorno esterno: i buchi dentro
        //    (es. le cifre nere) contano, e il bordo conta solo a metà.
        let area = area_contorno(&pixel_zona, w, min_x, min_y, max_x, max_y);

        zone.push(Zona {
            area,
            x: min_x as i32,
            y: min_y as i32,
            w: (max_x - min_x + 1) as i32,
            h: (max_y - min_y + 1) as i32,
        });
    }
    zone
}

/// Area del contorno esterno di una zona (formula di Pick: area = pixel
/// pieni - pixel di bordo / 2 - 1), con i buchi interni riempiti.
fn area_contorno(pixel_zona: &[usize], w: usize, min_x: usize, min_y: usize, max_x: usize, max_y: usize) -> f32 {
    // piccola griglia attorno alla zona, con 1 pixel vuoto di cornice
    let gw = max_x - min_x + 3;
    let gh = max_y - min_y + 3;
    let mut griglia = vec![0u8; gw * gh]; // 0 = vuoto, 1 = zona, 2 = fuori
    for &i in pixel_zona {
        let x = i % w - min_x + 1;
        let y = i / w - min_y + 1;
        griglia[y * gw + x] = 1;
    }

    // segna tutto il vuoto raggiungibile da fuori (4 direzioni)
    let mut pila = vec![0usize];
    griglia[0] = 2;
    while let Some(i) = pila.pop() {
        let x = i % gw;
        let y = i / gw;
        let vicini = [
            if x > 0 { Some(i - 1) } else { None },
            if x + 1 < gw { Some(i + 1) } else { None },
            if y > 0 { Some(i - gw) } else { None },
            if y + 1 < gh { Some(i + gw) } else { None },
        ];
        for j in vicini.into_iter().flatten() {
            if griglia[j] == 0 {
                griglia[j] = 2;
                pila.push(j);
            }
        }
    }

    let mut pieni = 0;
    let mut bordo = 0;
    for y in 1..gh - 1 {
        for x in 1..gw - 1 {
            let i = y * gw + x;
            if griglia[i] == 2 {
                continue;
            }
            pieni += 1;
            if griglia[i] == 1
                && (griglia[i - 1] == 2 || griglia[i + 1] == 2 || griglia[i - gw] == 2 || griglia[i + gw] == 2)
            {
                bordo += 1;
            }
        }
    }
    if pieni <= 1 {
        return 0.0;
    }
    (pieni as f32 - bordo as f32 / 2.0 - 1.0).max(0.0)
}

/// Cerca il display arancione nel fotogramma. Ritorna il riquadro con il
/// margine di sicurezza, oppure None se non lo trova.
pub fn trova_display(foto: &Fotogramma, imp: &Impostazioni) -> Option<Riquadro> {
    if foto.larghezza < 2 || foto.altezza < 2 {
        return None;
    }
    let (maschera, pw, ph) = maschera_arancione(foto);

    // chiusura (riempie i buchetti) e apertura (toglie i puntini)
    let maschera = dilata_o_erodi(&maschera, pw, ph, true);
    let maschera = dilata_o_erodi(&maschera, pw, ph, false);
    let maschera = dilata_o_erodi(&maschera, pw, ph, false);
    let maschera = dilata_o_erodi(&maschera, pw, ph, true);

    // la zona arancione più grande
    let zone = trova_zone(&maschera, pw, ph);
    let mut migliore: Option<&Zona> = None;
    for z in &zone {
        if migliore.is_none() || z.area > migliore.unwrap().area {
            migliore = Some(z);
        }
    }
    let z = migliore?;

    let area_minima = 500.0 * SCALA_RILEVAMENTO * SCALA_RILEVAMENTO; // proporzionata alla scala ridotta
    if z.area <= area_minima {
        return None;
    }

    // riporta le coordinate alla risoluzione originale
    let inv = 1.0 / SCALA_RILEVAMENTO;
    let x = (z.x as f32 * inv) as i32;
    let y = (z.y as f32 * inv) as i32;
    let w = (z.w as f32 * inv) as i32;
    let h = (z.h as f32 * inv) as i32;

    // aggiunge il margine di sicurezza, senza uscire dal fotogramma
    let pad_x = (w as f32 * imp.margine) as i32;
    let pad_y = (h as f32 * imp.margine) as i32;
    let x2 = (foto.larghezza as i32).min(x + w + pad_x);
    let y2 = (foto.altezza as i32).min(y + h + pad_y);
    let x = 0.max(x - pad_x);
    let y = 0.max(y - pad_y);

    Some(Riquadro { x, y, w: x2 - x, h: y2 - y })
}

// ==========================================
// 2. LA ZONA DA COPRIRE (DOVE STA IL NUMERO)
// ==========================================

/// Dal riquadro arancione prende solo la parte centrale, un po' più in basso.
pub fn regione_centrale(r: Riquadro, larghezza: usize, altezza: usize) -> Riquadro {
    let (w_full, h_full) = (larghezza as i32, altezza as i32);

    // Se il riquadro tocca il bordo, il display è tagliato:
    // per sicurezza si copre quasi tutto.
    let margine_bordo = 3;
    let tocca_bordo = r.x <= margine_bordo
        || r.y <= margine_bordo
        || r.x + r.w >= w_full - margine_bordo
        || r.y + r.h >= h_full - margine_bordo;

    let (larghezza_frac, altezza_frac, offset_vert) = if tocca_bordo {
        (0.95, 0.95, 0.05)
    } else {
        (CENTRO_LARGHEZZA, CENTRO_ALTEZZA, OFFSET_VERTICALE)
    };

    let margin_x = (r.w as f32 * (1.0 - larghezza_frac) / 2.0) as i32;
    let margin_y = (r.h as f32 * (1.0 - altezza_frac) / 2.0) as i32;

    let cw = 1.max(r.w - 2 * margin_x);
    let ch = 1.max(r.h - 2 * margin_y);
    let cx = r.x + margin_x;

    let mut cy = r.y + margin_y + (r.h as f32 * offset_vert) as i32;
    if cy + ch > r.y + r.h {
        cy = r.y.max(r.y + r.h - ch);
    }

    Riquadro { x: cx, y: cy, w: cw, h: ch }
}

// ==========================================
// 3. PIXELATURA
// ==========================================

/// Pixela la zona: la rimpicciolisce (lineare) e la ringrandisce a blocchi.
pub fn pixela(foto: &mut Fotogramma, zona: Riquadro, blocco_pixel: u32) {
    // taglia la zona ai bordi del fotogramma
    let x0 = zona.x.max(0) as usize;
    let y0 = zona.y.max(0) as usize;
    let x1 = ((zona.x + zona.w) as usize).min(foto.larghezza);
    let y1 = ((zona.y + zona.h) as usize).min(foto.altezza);
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    let w = x1 - x0;
    let h = y1 - y0;

    let fattore = 1.max(w.min(h) / blocco_pixel.max(1) as usize);
    let sw = 1.max(w / fattore);
    let sh = 1.max(h / fattore);

    // 1) versione piccola (come cv2.resize lineare)
    let scala_x = w as f32 / sw as f32;
    let scala_y = h as f32 / sh as f32;
    let mut piccola = vec![0u8; sw * sh * 3];
    for py in 0..sh {
        let (ya, yb, fy) = posizione_lineare(py, scala_y, h);
        for px in 0..sw {
            let (xa, xb, fx) = posizione_lineare(px, scala_x, w);
            for c in 0..3 {
                let p = |xx: usize, yy: usize| foto.dati[((y0 + yy) * foto.larghezza + x0 + xx) * 3 + c] as f32;
                let sopra = p(xa, ya) * (1.0 - fx) + p(xb, ya) * fx;
                let sotto = p(xa, yb) * (1.0 - fx) + p(xb, yb) * fx;
                let valore = sopra * (1.0 - fy) + sotto * fy;
                piccola[(py * sw + px) * 3 + c] = valore.round().clamp(0.0, 255.0) as u8;
            }
        }
    }

    // 2) la ringrandisce a blocchi (come cv2.INTER_NEAREST)
    for yy in 0..h {
        let py = ((yy * sh) / h).min(sh - 1);
        for xx in 0..w {
            let px = ((xx * sw) / w).min(sw - 1);
            let i = ((y0 + yy) * foto.larghezza + x0 + xx) * 3;
            let j = (py * sw + px) * 3;
            foto.dati[i] = piccola[j];
            foto.dati[i + 1] = piccola[j + 1];
            foto.dati[i + 2] = piccola[j + 2];
        }
    }
}

/// Per il ridimensionamento lineare: i due pixel da mescolare e quanto.
fn posizione_lineare(indice: usize, scala: f32, massimo: usize) -> (usize, usize, f32) {
    let sorgente = (indice as f32 + 0.5) * scala - 0.5;
    let sorgente = sorgente.max(0.0);
    let a = (sorgente.floor() as usize).min(massimo - 1);
    let b = (a + 1).min(massimo - 1);
    let frazione = sorgente - a as f32;
    (a, b, frazione.clamp(0.0, 1.0))
}

/// Disegna il contorno di un riquadro (spesso 2 pixel), per la modalità prova.
pub fn disegna_riquadro(foto: &mut Fotogramma, r: Riquadro, colore: [u8; 3]) {
    let larghezza = foto.larghezza as i32;
    let altezza = foto.altezza as i32;
    let mut metti = |x: i32, y: i32| {
        if x >= 0 && y >= 0 && x < larghezza && y < altezza {
            let i = (y as usize * foto.larghezza + x as usize) * 3;
            foto.dati[i] = colore[0];
            foto.dati[i + 1] = colore[1];
            foto.dati[i + 2] = colore[2];
        }
    };
    for spessore in 0..2 {
        for x in r.x..=r.x + r.w {
            metti(x, r.y + spessore);
            metti(x, r.y + r.h - spessore);
        }
        for y in r.y..=r.y + r.h {
            metti(r.x + spessore, y);
            metti(r.x + r.w - spessore, y);
        }
    }
}

// ==========================================
// 4. SEGUE IL DISPLAY FOTOGRAMMA DOPO FOTOGRAMMA
// ==========================================

/// Ricorda l'ultimo riquadro trovato: se il rilevamento fallisce per pochi
/// fotogrammi, continua a coprire l'ultima posizione (PERSISTENZA_FRAME).
pub struct Inseguitore {
    ultimo_box: Option<Riquadro>,
    persistenza_rimasta: u32,
}

impl Inseguitore {
    pub fn nuovo() -> Inseguitore {
        Inseguitore {
            ultimo_box: None,
            persistenza_rimasta: 0,
        }
    }

    /// Riceve il risultato del rilevamento di questo fotogramma e dice
    /// quale riquadro usare.
    pub fn aggiorna(&mut self, trovato: Option<Riquadro>) -> Option<Riquadro> {
        if trovato.is_some() {
            self.ultimo_box = trovato;
            self.persistenza_rimasta = PERSISTENZA_FRAME;
        } else if self.persistenza_rimasta > 0 {
            self.persistenza_rimasta -= 1;
            // tiene ultimo_box così com'è per qualche frame in più
        } else {
            self.ultimo_box = None;
        }
        self.ultimo_box
    }
}

/// Applica la copertura (o i riquadri di prova) a un fotogramma, dato il
/// riquadro arancione da usare.
pub fn copri(foto: &mut Fotogramma, box_display: Option<Riquadro>, imp: &Impostazioni) {
    let Some(r) = box_display else { return };
    let centro = regione_centrale(r, foto.larghezza, foto.altezza);
    if imp.debug {
        disegna_riquadro(foto, r, [0, 255, 0]);
        disegna_riquadro(foto, centro, [255, 0, 0]);
    } else {
        pixela(foto, centro, imp.blocco_pixel);
    }
}
