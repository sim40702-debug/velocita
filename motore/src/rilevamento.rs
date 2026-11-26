// Rilevamento del display (arancione o del colore scelto) e pixelatura del numero.
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

// Se per qualche frame il rilevamento fallisce (es. sfocatura, curva,
// riflesso), continua a coprire l'ultima posizione nota per questi frame.
// 15 frame = mezzo secondo a 30 fps.
pub const PERSISTENZA_FRAME: u32 = 15;

// Quanto il riquadro si avvicina alla posizione nuova a ogni fotogramma:
// 0.5 = fa metà strada. Più basso = si muove più dolcemente.
pub const MORBIDEZZA: f32 = 0.5;

// Il display sta sempre nella parte bassa dell'immagine (sopra il manubrio).
// Le zone arancioni con il centro più in alto (lampioni, finestre, muri
// illuminati) non vengono considerate. 0.5 = metà dell'immagine.
pub const ALTEZZA_MINIMA_DISPLAY: f32 = 0.5;

// Le soglie per riconoscere il display, di notte e di giorno (valori da 0 a 255).
// - saturazione_minima: quanto deve essere colorato un pixel per contare
// - luminosita_accesa e saturazione_accesa: un pixel è "acceso" come il
//   display se è abbastanza luminoso e di un colore carico. Di notte muri e
//   strade illuminati dai lampioni sono luminosi ma sbiaditi.
//   Di giorno, al sole, anche il display sembra più sbiadito.
pub struct Soglie {
    pub saturazione_minima: f32,
    pub luminosita_accesa: f32,
    pub saturazione_accesa: f32,
}

pub const SOGLIE_NOTTE: Soglie = Soglie {
    saturazione_minima: 100.0,
    luminosita_accesa: 150.0,
    saturazione_accesa: 160.0,
};

pub const SOGLIE_GIORNO: Soglie = Soglie {
    saturazione_minima: 80.0,
    luminosita_accesa: 170.0,
    saturazione_accesa: 110.0,
};

// Con "Automatico": se la luminosità media del fotogramma (da 0 a 255)
// è sotto questo valore è notte, altrimenti è giorno.
pub const LUMINOSITA_NOTTE: f32 = 90.0;

// Valori di partenza delle impostazioni (le cambia l'utente nell'app)
pub const BLOCCO_PIXEL_NORMALE: u32 = 10;
pub const MARGINE_NORMALE: f32 = 0.15;

/// Quando è stato girato il video.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Momento {
    /// lo capisce da solo per ogni fotogramma
    Automatico,
    Giorno,
    Notte,
}

impl Momento {
    /// Dal testo che manda la finestra ("auto", "giorno", "notte").
    pub fn da_nome(nome: &str) -> Momento {
        match nome {
            "giorno" => Momento::Giorno,
            "notte" => Momento::Notte,
            _ => Momento::Automatico,
        }
    }
}

/// Il colore del display da cercare.
#[derive(Clone, Copy, Debug)]
pub struct ColoreDisplay {
    /// Tinta come in OpenCV, da 0 a 180:
    /// 0 rosso, 12 arancione, 30 giallo, 60 verde, 110 blu
    pub tinta: f32,
    /// Quanto la tinta di un pixel si può allontanare da questa
    pub ampiezza: f32,
    /// true per un display bianco (senza colore)
    pub bianco: bool,
}

impl ColoreDisplay {
    /// Dal nome scelto nelle impostazioni. Con "video" usa il colore `rgb`
    /// preso cliccando sul display nell'anteprima.
    pub fn da_nome(nome: &str, rgb: [u8; 3]) -> ColoreDisplay {
        let colore = |tinta, ampiezza| ColoreDisplay { tinta, ampiezza, bianco: false };
        match nome {
            "rosso" => colore(0.0, 10.0),
            "giallo" => colore(30.0, 8.0),
            "verde" => colore(60.0, 20.0),
            "blu" => colore(110.0, 20.0),
            "bianco" => ColoreDisplay { tinta: 0.0, ampiezza: 0.0, bianco: true },
            "video" => {
                let (h, s, _v) = hsv(rgb[0] as f32, rgb[1] as f32, rgb[2] as f32);
                if s < 60.0 {
                    // quasi senza colore: è un display bianco
                    ColoreDisplay { tinta: 0.0, ampiezza: 0.0, bianco: true }
                } else {
                    colore(h, 15.0)
                }
            }
            // arancione: tinta da 0 a 25, come la versione Python
            _ => colore(12.5, 12.5),
        }
    }
}

/// Regolazione fatta a mano nell'anteprima: sposta e ingrandisce la zona coperta.
/// I valori sono in proporzione alla zona: dx = 0.1 vuol dire spostata a destra
/// di un decimo della sua larghezza, larghezza = 1.2 vuol dire più larga del 20%.
/// Così vale in tutti i fotogrammi, anche quando il display si muove.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Regolazione {
    pub dx: f32,
    pub dy: f32,
    pub larghezza: f32,
    pub altezza: f32,
}

impl Regolazione {
    /// Nessuna regolazione: la zona resta quella automatica.
    pub fn nessuna() -> Regolazione {
        Regolazione { dx: 0.0, dy: 0.0, larghezza: 1.0, altezza: 1.0 }
    }
}

/// Come viene coperto il numero.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Stile {
    /// quadratoni (la grandezza è la "forza")
    Pixel,
    /// sfocato (più forza = più sfocato)
    Sfocatura,
    /// rettangolo nero
    Nero,
    /// rettangolo del colore medio della zona: si nota poco
    TintaUnita,
}

impl Stile {
    /// Dal testo che manda la finestra ("pixel", "sfocatura", "nero", "tinta").
    pub fn da_nome(nome: &str) -> Stile {
        match nome {
            "sfocatura" => Stile::Sfocatura,
            "nero" => Stile::Nero,
            "tinta" => Stile::TintaUnita,
            _ => Stile::Pixel,
        }
    }
}

/// Le scelte dell'utente che cambiano la copertura.
#[derive(Clone, Copy, Debug)]
pub struct Impostazioni {
    /// Dimensione dei "blocchi" della pixelatura: più alto = più illeggibile
    pub blocco_pixel: u32,
    /// Margine di sicurezza attorno alla zona del display (0.15 = 15%)
    pub margine: f32,
    /// Modalità prova: disegna i riquadri invece di pixelare
    pub debug: bool,
    /// Giorno, notte o automatico
    pub momento: Momento,
    /// Il colore del display
    pub colore: ColoreDisplay,
    /// false = cerca il display solo nella metà bassa (consigliato),
    /// true = lo cerca in tutta l'immagine (videocamera messa altrove)
    pub ovunque: bool,
    /// Zona spostata o ingrandita a mano (per tutto il video)
    pub regolazione: Regolazione,
    /// Pixel, sfocatura, nero o tinta unita
    pub stile: Stile,
    /// Copre anche le facce delle persone
    pub volti: bool,
    /// Dove sta di solito il display in questo video (la calcola l'analisi).
    /// None = non si sa ancora: vince la zona più simile al display.
    pub casa: Option<Riquadro>,
}

impl Default for Impostazioni {
    fn default() -> Self {
        Impostazioni {
            blocco_pixel: BLOCCO_PIXEL_NORMALE,
            margine: MARGINE_NORMALE,
            debug: false,
            momento: Momento::Automatico,
            colore: ColoreDisplay::da_nome("arancione", [0, 0, 0]),
            ovunque: false,
            regolazione: Regolazione::nessuna(),
            stile: Stile::Pixel,
            volti: false,
            casa: None,
        }
    }
}

/// Un pezzo del video dove la zona da coprire l'hai disegnata tu:
/// da `inizio` a `fine` (in secondi) si copre questo rettangolo e basta,
/// senza cercare il display. Serve per i tratti rossi della striscia.
/// x, y, w, h sono in percentuale dell'immagine (da 0 a 1).
/// Con `segui` = true invece la zona parte da lì (al secondo `inizio`) e
/// segue l'oggetto che si muove (per esempio una targa), oltre al display.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ZonaFissa {
    pub inizio: f64,
    pub fine: f64,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub segui: bool,
}

impl ZonaFissa {
    /// Il rettangolo in pixel per un fotogramma grande larghezza x altezza.
    pub fn in_pixel(&self, larghezza: usize, altezza: usize) -> Riquadro {
        let x = (self.x.clamp(0.0, 1.0) * larghezza as f32).round() as i32;
        let y = (self.y.clamp(0.0, 1.0) * altezza as f32).round() as i32;
        let w = (self.w.clamp(0.0, 1.0) * larghezza as f32).round() as i32;
        let h = (self.h.clamp(0.0, 1.0) * altezza as f32).round() as i32;
        Riquadro { x, y, w: w.max(1), h: h.max(1) }
    }
}

/// La zona fissa che vale in quel secondo del video (None = nessuna).
/// Se due zone si sovrappongono vince l'ultima (quella aggiunta dopo).
/// (Le zone che seguono un oggetto non contano: quelle si aggiungono al display.)
pub fn zona_fissa_a(zone: &[ZonaFissa], secondi: f64) -> Option<ZonaFissa> {
    zone.iter().rev().find(|z| !z.segui && secondi >= z.inizio && secondi <= z.fine).copied()
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
// 1. TROVA IL DISPLAY
// ==========================================

/// Converte un pixel RGB in HSV come fa OpenCV:
/// tinta (H) da 0 a 180, saturazione (S) e luminosità (V) da 0 a 255.
fn hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let v = r.max(g).max(b);
    let minimo = r.min(g).min(b);
    let differenza = v - minimo;

    let s = if v > 0.0 { 255.0 * differenza / v } else { 0.0 };
    if differenza == 0.0 {
        return (0.0, s.round(), v.round()); // grigio: la tinta non conta
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
    ((h / 2.0).round(), s.round(), v.round())
}

/// Distanza tra due tinte. Il cerchio dei colori si chiude:
/// 178 (rosso) e 2 (rosso) sono vicine.
fn distanza_tinta(a: f32, b: f32) -> f32 {
    let d = (a - b).abs();
    d.min(180.0 - d)
}

/// Dice se un pixel ha il colore del display (prima cosa)
/// e se è "acceso" come il display (seconda cosa).
fn e_del_colore(h: f32, s: f32, v: f32, colore: &ColoreDisplay, soglie: &Soglie) -> (bool, bool) {
    if colore.bianco {
        // bianco: niente colore, solo molto luminoso
        let del_colore = v >= 180.0 && s <= 60.0;
        let acceso = v >= 230.0 && s <= 40.0;
        return (del_colore, acceso);
    }
    let del_colore = v >= 100.0
        && s >= soglie.saturazione_minima
        && distanza_tinta(h, colore.tinta) <= colore.ampiezza;
    let acceso = del_colore && v >= soglie.luminosita_accesa && s >= soglie.saturazione_accesa;
    (del_colore, acceso)
}

/// Crea la maschera del colore del display sul fotogramma rimpicciolito a metà.
/// Ritorna (maschera, luminosi, larghezza, altezza, momento): nella maschera
/// 1 = del colore, in luminosi 1 = acceso, luminoso e carico (come il display).
/// momento = giorno o notte, quello usato davvero (anche con Automatico).
fn maschera_colore(foto: &Fotogramma, imp: &Impostazioni) -> (Vec<u8>, Vec<u8>, usize, usize, Momento) {
    // stessa dimensione che usa OpenCV con fx = fy = 0.5
    let pw = ((foto.larghezza as f32) * SCALA_RILEVAMENTO).round() as usize;
    let ph = ((foto.altezza as f32) * SCALA_RILEVAMENTO).round() as usize;
    let mut maschera = vec![0u8; pw * ph];
    let mut luminosi = vec![0u8; pw * ph];

    // 1) rimpicciolisce il fotogramma e calcola la luminosità media
    let mut piccola = vec![(0.0f32, 0.0f32, 0.0f32); pw * ph]; // (h, s, v) di ogni pixel
    let mut somma_luminosita = 0.0;
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

            let (h, s, v) = hsv(r, g, b);
            piccola[y * pw + x] = (h, s, v);
            somma_luminosita += v;
        }
    }

    // 2) sceglie le soglie: giorno o notte
    let momento = if imp.momento == Momento::Automatico {
        let media = somma_luminosita / (pw * ph).max(1) as f32;
        if media < LUMINOSITA_NOTTE {
            Momento::Notte
        } else {
            Momento::Giorno
        }
    } else {
        imp.momento
    };
    let soglie = if momento == Momento::Notte { &SOGLIE_NOTTE } else { &SOGLIE_GIORNO };

    // 3) segna i pixel del colore del display e quelli accesi
    for i in 0..pw * ph {
        let (h, s, v) = piccola[i];
        let (del_colore, acceso) = e_del_colore(h, s, v, &imp.colore, soglie);
        if del_colore {
            maschera[i] = 1;
        }
        if acceso {
            luminosi[i] = 1;
        }
    }
    (maschera, luminosi, pw, ph, momento)
}

/// Giorno o notte: quello che il rilevamento usa davvero per questo
/// fotogramma (con Automatico lo decide dalla luminosità).
/// Serve per la scritta nell'anteprima.
pub fn momento_usato(foto: &Fotogramma, imp: &Impostazioni) -> Momento {
    if foto.larghezza < 2 || foto.altezza < 2 {
        return imp.momento;
    }
    let (_, _, _, _, momento) = maschera_colore(foto, imp);
    momento
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

/// Una zona arancione unita: area (come cv2.contourArea), quanti pixel
/// molto luminosi ha e rettangolo.
struct Zona {
    area: f32,
    luminosi: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Trova le zone arancioni unite (pixel che si toccano anche in diagonale,
/// come i contorni esterni di OpenCV) e calcola area e rettangolo.
fn trova_zone(maschera: &[u8], luminosi: &[u8], w: usize, h: usize) -> Vec<Zona> {
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

        // 3) conta i pixel molto luminosi della zona
        let mut quanti_luminosi = 0;
        for &i in &pixel_zona {
            if luminosi[i] == 1 {
                quanti_luminosi += 1;
            }
        }

        zone.push(Zona {
            area,
            luminosi: quanti_luminosi,
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

/// Quanto una zona assomiglia al display acceso:
/// pixel luminosi × quanto della zona è luminosa.
/// Il display è piccolo ma luminoso quasi tutto: punteggio alto.
/// Un muro o la strada illuminati sono grandi ma con poca luce forte: punteggio basso.
fn punteggio_display(z: &Zona) -> f32 {
    let luminosi = z.luminosi as f32;
    let quanto_luminosa = luminosi / z.area.max(1.0);
    luminosi * quanto_luminosa
}

/// Cerca il display arancione nel fotogramma. Ritorna il riquadro con il
/// margine di sicurezza, oppure None se non lo trova.
pub fn trova_display(foto: &Fotogramma, imp: &Impostazioni) -> Option<Riquadro> {
    trova_display_con_sicurezza(foto, imp).map(|(riquadro, _sicurezza)| riquadro)
}

/// Come trova_display, ma dice anche quanto è sicuro il rilevamento (da 0 a 1):
/// - 1 = nessun'altra zona assomiglia al display
/// - vicino a 0 = da un'altra parte c'è una zona quasi uguale (un "rivale"),
///   quindi l'app potrebbe aver scelto quella sbagliata
/// Se si sa dove sta di solito il display (imp.casa), sceglie la zona lì.
pub fn trova_display_con_sicurezza(foto: &Fotogramma, imp: &Impostazioni) -> Option<(Riquadro, f32)> {
    let candidati = trova_candidati(foto, imp);
    scegli_display(&candidati, imp.casa)
}

/// Quante zone tiene per ogni fotogramma (le più simili al display).
pub const MASSIMO_CANDIDATI: usize = 4;

/// Una zona che potrebbe essere il display: il riquadro (già con il
/// margine, nella grandezza vera del video) e quanto assomiglia al display.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidato {
    pub riquadro: Riquadro,
    pub punteggio: f32,
}

/// Le zone che potrebbero essere il display, dalla più probabile alla meno
/// (al massimo MASSIMO_CANDIDATI). Vuota se non trova niente.
pub fn trova_candidati(foto: &Fotogramma, imp: &Impostazioni) -> Vec<Candidato> {
    let mut risultato = Vec::new();
    if foto.larghezza < 2 || foto.altezza < 2 {
        return risultato;
    }
    let (maschera, luminosi, pw, ph, _momento) = maschera_colore(foto, imp);

    // chiusura (riempie i buchetti) e apertura (toglie i puntini)
    let maschera = dilata_o_erodi(&maschera, pw, ph, true);
    let maschera = dilata_o_erodi(&maschera, pw, ph, false);
    let maschera = dilata_o_erodi(&maschera, pw, ph, false);
    let maschera = dilata_o_erodi(&maschera, pw, ph, true);

    // le zone arancioni che possono essere il display:
    // - non troppo piccole e nella parte bassa dell'immagine
    // - più larghe che alte
    let area_minima = 500.0 * SCALA_RILEVAMENTO * SCALA_RILEVAMENTO; // proporzionata alla scala ridotta
    let zone = trova_zone(&maschera, &luminosi, pw, ph);
    let mut candidate: Vec<&Zona> = Vec::new();
    for z in &zone {
        if z.area <= area_minima || z.luminosi == 0 {
            continue;
        }
        let centro_y = (z.y as f32 + z.h as f32 / 2.0) / ph as f32;
        if !imp.ovunque && centro_y < ALTEZZA_MINIMA_DISPLAY {
            continue;
        }
        // il display è più largo che alto: così scarta le strisce
        // colorate della moto e i riflessi in verticale
        if z.w < z.h {
            continue;
        }
        candidate.push(z);
    }

    // dalla più simile al display alla meno
    candidate.sort_by(|a, b| punteggio_display(b).total_cmp(&punteggio_display(a)));

    for z in candidate.iter().take(MASSIMO_CANDIDATI) {
        // a volte il display è diviso in più pezzi (le cifre scure lo tagliano):
        // unisce al pezzo scelto i pezzi vicini accesi almeno la metà di lui
        let vicino = z.h;
        let punteggio_minimo = punteggio_display(z) / 2.0;
        let (mut x1, mut y1, mut x2, mut y2) = (z.x, z.y, z.x + z.w, z.y + z.h);
        for altra in &zone {
            if altra.luminosi == 0 || punteggio_display(altra) < punteggio_minimo {
                continue;
            }
            let tocca = altra.x < z.x + z.w + vicino
                && altra.x + altra.w > z.x - vicino
                && altra.y < z.y + z.h + vicino
                && altra.y + altra.h > z.y - vicino;
            if tocca {
                x1 = x1.min(altra.x);
                y1 = y1.min(altra.y);
                x2 = x2.max(altra.x + altra.w);
                y2 = y2.max(altra.y + altra.h);
            }
        }

        // riporta le coordinate alla risoluzione originale
        let inv = 1.0 / SCALA_RILEVAMENTO;
        let x = (x1 as f32 * inv) as i32;
        let y = (y1 as f32 * inv) as i32;
        let w = ((x2 - x1) as f32 * inv) as i32;
        let h = ((y2 - y1) as f32 * inv) as i32;

        // aggiunge il margine di sicurezza, senza uscire dal fotogramma
        let pad_x = (w as f32 * imp.margine) as i32;
        let pad_y = (h as f32 * imp.margine) as i32;
        let fine_x = (foto.larghezza as i32).min(x + w + pad_x);
        let fine_y = (foto.altezza as i32).min(y + h + pad_y);
        let x = 0.max(x - pad_x);
        let y = 0.max(y - pad_y);

        let riquadro = Riquadro { x, y, w: fine_x - x, h: fine_y - y };
        // un pezzo già unito a una zona migliore non si ripete
        if risultato.iter().any(|c: &Candidato| c.riquadro == riquadro) {
            continue;
        }
        risultato.push(Candidato { riquadro, punteggio: punteggio_display(z) });
    }
    risultato
}

/// Sceglie il display tra i candidati (in ordine, dal migliore) e dice
/// quanto è sicuro (da 0 a 1).
/// - senza `casa`: vince il migliore
/// - con `casa` (dove sta di solito il display in questo video): vince il
///   migliore vicino alla casa, anche se da un'altra parte c'è qualcosa di
///   molto più luminoso (un lampione al sodio può esserlo 50 volte di più).
///   Se vicino alla casa non c'è niente, prende il migliore ma con
///   sicurezza 0, così nella striscia diventa arancione.
pub fn scegli_display(candidati: &[Candidato], casa: Option<Riquadro>) -> Option<(Riquadro, f32)> {
    let migliore = *candidati.first()?;
    let mut scelto = migliore;
    let mut a_casa = false;
    let mut lontano_da_casa = false;

    if let Some(casa) = casa {
        // il primo vicino alla casa è il migliore lì (sono in ordine)
        let vicino_a_casa = candidati.iter().find(|c| vicini(casa, c.riquadro));
        match vicino_a_casa {
            Some(c) => {
                scelto = *c;
                a_casa = true;
            }
            None => {
                lontano_da_casa = true;
            }
        }
    }

    // sicurezza: c'è un rivale lontano dal display scelto?
    let mut rivale = 0.0;
    for altro in candidati {
        if !vicini(scelto.riquadro, altro.riquadro) && !vicini(altro.riquadro, scelto.riquadro) {
            rivale = f32::max(rivale, altro.punteggio);
        }
    }
    let mut sicurezza = (1.0 - rivale / scelto.punteggio.max(0.001)).clamp(0.0, 1.0);
    if a_casa {
        // è dove sta sempre: un lampione da un'altra parte non lo rende dubbio
        sicurezza = sicurezza.max(0.5);
    }
    if lontano_da_casa {
        // non è dove sta di solito: meglio dare un'occhiata
        sicurezza = 0.0;
    }
    Some((scelto.riquadro, sicurezza))
}

/// Dove sta di solito il display in un video: la posizione "di mezzo"
/// (mediana) dei riquadri trovati. Un lampione che passa per qualche
/// secondo non la sposta. None se i riquadri sono meno di 3.
pub fn posizione_abituale(riquadri: &[Riquadro]) -> Option<Riquadro> {
    if riquadri.len() < 3 {
        return None;
    }
    // il valore di mezzo di una lista di numeri
    fn di_mezzo(mut valori: Vec<i32>) -> i32 {
        valori.sort();
        valori[valori.len() / 2]
    }
    let centri_x: Vec<i32> = riquadri.iter().map(|r| r.x + r.w / 2).collect();
    let centri_y: Vec<i32> = riquadri.iter().map(|r| r.y + r.h / 2).collect();
    let larghezze: Vec<i32> = riquadri.iter().map(|r| r.w).collect();
    let altezze: Vec<i32> = riquadri.iter().map(|r| r.h).collect();
    let w = di_mezzo(larghezze);
    let h = di_mezzo(altezze);
    Some(Riquadro { x: di_mezzo(centri_x) - w / 2, y: di_mezzo(centri_y) - h / 2, w, h })
}

// ==========================================
// 2. LA ZONA DA COPRIRE (DOVE STA IL NUMERO)
// ==========================================

/// Dal riquadro arancione prende solo la parte centrale, un po' più in basso.
/// La zona che viene davvero coperta: quella automatica (regione_centrale)
/// con la regolazione fatta a mano.
pub fn zona_da_coprire(display: Riquadro, larghezza: usize, altezza: usize, imp: &Impostazioni) -> Riquadro {
    let base = regione_centrale(display, larghezza, altezza);
    applica_regolazione(base, imp.regolazione, larghezza, altezza)
}

/// Sposta e ingrandisce il riquadro, senza farlo uscire dal fotogramma.
pub fn applica_regolazione(base: Riquadro, reg: Regolazione, larghezza: usize, altezza: usize) -> Riquadro {
    if reg == Regolazione::nessuna() {
        return base;
    }
    // centro spostato e grandezza nuova
    let centro_x = base.x as f32 + base.w as f32 / 2.0 + reg.dx * base.w as f32;
    let centro_y = base.y as f32 + base.h as f32 / 2.0 + reg.dy * base.h as f32;
    let w = (base.w as f32 * reg.larghezza.clamp(0.2, 10.0)).max(2.0);
    let h = (base.h as f32 * reg.altezza.clamp(0.2, 10.0)).max(2.0);

    // dentro il fotogramma
    let x1 = (centro_x - w / 2.0).round().max(0.0) as i32;
    let y1 = (centro_y - h / 2.0).round().max(0.0) as i32;
    let x2 = ((centro_x + w / 2.0).round() as i32).min(larghezza as i32);
    let y2 = ((centro_y + h / 2.0).round() as i32).min(altezza as i32);
    if x2 - x1 < 2 || y2 - y1 < 2 {
        return base; // finita fuori dall'immagine: meglio quella automatica
    }
    Riquadro { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

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


/// Per il ridimensionamento lineare: i due pixel da mescolare e quanto.
fn posizione_lineare(indice: usize, scala: f32, massimo: usize) -> (usize, usize, f32) {
    let sorgente = (indice as f32 + 0.5) * scala - 0.5;
    let sorgente = sorgente.max(0.0);
    let a = (sorgente.floor() as usize).min(massimo - 1);
    let b = (a + 1).min(massimo - 1);
    let frazione = sorgente - a as f32;
    (a, b, frazione.clamp(0.0, 1.0))
}


// ==========================================
// 4. SEGUE IL DISPLAY FOTOGRAMMA DOPO FOTOGRAMMA
// ==========================================

/// Ricorda l'ultimo riquadro trovato:
/// - se il rilevamento fallisce per pochi fotogrammi, continua a coprire
///   l'ultima posizione (PERSISTENZA_FRAME)
/// - il riquadro si muove dolcemente, senza tremolare (MORBIDEZZA)
/// - se il display sembra saltare lontano per un solo fotogramma
///   (es. un riflesso), non ci crede finché non lo trova lì due volte
pub struct Inseguitore {
    ultimo_box: Option<Riquadro>,
    persistenza_rimasta: u32,
    /// riquadro trovato lontano dall'ultimo, in attesa di conferma
    salto: Option<Riquadro>,
}

impl Inseguitore {
    pub fn nuovo() -> Inseguitore {
        Inseguitore {
            ultimo_box: None,
            persistenza_rimasta: 0,
            salto: None,
        }
    }

    /// Riceve il risultato del rilevamento di questo fotogramma e dice
    /// quale riquadro usare.
    pub fn aggiorna(&mut self, trovato: Option<Riquadro>) -> Option<Riquadro> {
        let Some(nuovo) = trovato else {
            // niente display in questo fotogramma
            self.salto = None;
            self.manca_il_display();
            return self.ultimo_box;
        };

        let Some(vecchio) = self.ultimo_box else {
            // primo riquadro trovato
            self.usa(nuovo);
            return self.ultimo_box;
        };

        if vicini(vecchio, nuovo) {
            // il display si è mosso poco: il riquadro lo segue dolcemente,
            // ma copre sempre tutto il display trovato
            self.salto = None;
            let morbido = unisci(nuovo, a_meta_strada(vecchio, nuovo));
            self.usa(morbido);
        } else if self.salto.is_some() && vicini(self.salto.unwrap(), nuovo) {
            // trovato lontano per la seconda volta di fila: è davvero lì
            self.salto = None;
            self.usa(nuovo);
        } else {
            // trovato lontano una volta sola: forse è un riflesso,
            // per ora resta dov'era
            self.salto = Some(nuovo);
            self.manca_il_display();
        }
        self.ultimo_box
    }

    fn usa(&mut self, riquadro: Riquadro) {
        self.ultimo_box = Some(riquadro);
        self.persistenza_rimasta = PERSISTENZA_FRAME;
    }

    fn manca_il_display(&mut self) {
        if self.persistenza_rimasta > 0 {
            self.persistenza_rimasta -= 1;
            // tiene ultimo_box così com'è per qualche frame in più
        } else {
            self.ultimo_box = None;
        }
    }
}

/// Due riquadri sono vicini se i loro centri distano meno della
/// grandezza del primo.
pub fn vicini(a: Riquadro, b: Riquadro) -> bool {
    let dx = (a.x + a.w / 2) - (b.x + b.w / 2);
    let dy = (a.y + a.h / 2) - (b.y + b.h / 2);
    let distanza = ((dx * dx + dy * dy) as f32).sqrt();
    distanza <= a.w.max(a.h) as f32
}

/// Il riquadro a metà strada (secondo MORBIDEZZA) tra a e b.
fn a_meta_strada(a: Riquadro, b: Riquadro) -> Riquadro {
    let passo = |da: i32, verso: i32| da + ((verso - da) as f32 * MORBIDEZZA).round() as i32;
    Riquadro {
        x: passo(a.x, b.x),
        y: passo(a.y, b.y),
        w: passo(a.w, b.w),
        h: passo(a.h, b.h),
    }
}

/// Il riquadro più piccolo che contiene sia a sia b.
fn unisci(a: Riquadro, b: Riquadro) -> Riquadro {
    let x1 = a.x.min(b.x);
    let y1 = a.y.min(b.y);
    let x2 = (a.x + a.w).max(b.x + b.w);
    let y2 = (a.y + a.h).max(b.y + b.h);
    Riquadro { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

/// Copre il numero in un fotogramma a 8 bit.
pub fn copri(foto: &mut Fotogramma, box_display: Option<Riquadro>, imp: &Impostazioni) {
    let (larghezza, altezza) = (foto.larghezza, foto.altezza);
    copri_grezzo(&mut foto.dati, larghezza, altezza, 1, box_display, imp);
}

/// Copre il numero nei byte grezzi di un fotogramma RGB.
/// byte_per_canale: 1 = video a 8 bit (rgb24), 2 = video a 10 bit (rgb48le).
/// Lavora su un ritaglio della zona a 16 bit, così lo stesso codice va bene
/// per tutti e due i tipi di video.
pub fn copri_grezzo(
    dati: &mut [u8],
    larghezza: usize,
    altezza: usize,
    byte_per_canale: usize,
    box_display: Option<Riquadro>,
    imp: &Impostazioni,
) {
    let Some(r) = box_display else { return };
    let zona = zona_da_coprire(r, larghezza, altezza, imp);

    if imp.debug {
        // modalità prova: verde = display trovato, rosso = zona coperta
        disegna_bordo(dati, larghezza, altezza, byte_per_canale, r, [0, 65535, 0]);
        disegna_bordo(dati, larghezza, altezza, byte_per_canale, zona, [65535, 0, 0]);
        return;
    }
    copri_zona_grezzo(dati, larghezza, altezza, byte_per_canale, zona, imp);
}

/// Copre una zona già decisa (per esempio una zona fissa disegnata a mano).
pub fn copri_zona(foto: &mut Fotogramma, zona: Riquadro, imp: &Impostazioni) {
    let (larghezza, altezza) = (foto.larghezza, foto.altezza);
    copri_zona_grezzo(&mut foto.dati, larghezza, altezza, 1, zona, imp);
}

/// Copre esattamente la zona data, con lo stile scelto.
pub fn copri_zona_grezzo(
    dati: &mut [u8],
    larghezza: usize,
    altezza: usize,
    byte_per_canale: usize,
    zona: Riquadro,
    imp: &Impostazioni,
) {
    if imp.debug {
        // modalità prova: blu = zona fissa (o zona già decisa)
        disegna_bordo(dati, larghezza, altezza, byte_per_canale, zona, [0, 0, 65535]);
        return;
    }

    // la zona, tagliata ai bordi del fotogramma
    let x0 = zona.x.max(0) as usize;
    let y0 = zona.y.max(0) as usize;
    let x1 = ((zona.x + zona.w).max(0) as usize).min(larghezza);
    let y1 = ((zona.y + zona.h).max(0) as usize).min(altezza);
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    let w = x1 - x0;
    let h = y1 - y0;

    // 1) ritaglia la zona (valori da 0 a 65535)
    let mut pixel = vec![0u16; w * h * 3];
    for yy in 0..h {
        for xx in 0..w {
            for c in 0..3 {
                let canale = ((y0 + yy) * larghezza + x0 + xx) * 3 + c;
                pixel[(yy * w + xx) * 3 + c] = leggi_canale(dati, canale, byte_per_canale);
            }
        }
    }

    // 2) applica lo stile
    match imp.stile {
        Stile::Pixel => pixela(&mut pixel, w, h, imp.blocco_pixel),
        Stile::Sfocatura => sfoca(&mut pixel, w, h, imp.blocco_pixel),
        Stile::Nero => pixel.fill(0),
        Stile::TintaUnita => tinta_unita(&mut pixel, w, h),
    }

    // 3) rimette la zona nel fotogramma
    for yy in 0..h {
        for xx in 0..w {
            for c in 0..3 {
                let canale = ((y0 + yy) * larghezza + x0 + xx) * 3 + c;
                scrivi_canale(dati, canale, byte_per_canale, pixel[(yy * w + xx) * 3 + c]);
            }
        }
    }
}

/// Legge un canale (rosso, verde o blu) come valore da 0 a 65535.
fn leggi_canale(dati: &[u8], canale: usize, byte_per_canale: usize) -> u16 {
    if byte_per_canale == 1 {
        let v = dati[canale] as u16;
        (v << 8) | v // 255 -> 65535
    } else {
        u16::from_le_bytes([dati[canale * 2], dati[canale * 2 + 1]])
    }
}

/// Scrive un canale da un valore da 0 a 65535.
fn scrivi_canale(dati: &mut [u8], canale: usize, byte_per_canale: usize, valore: u16) {
    if byte_per_canale == 1 {
        dati[canale] = (valore >> 8) as u8;
    } else {
        let [a, b] = valore.to_le_bytes();
        dati[canale * 2] = a;
        dati[canale * 2 + 1] = b;
    }
}

/// Pixel: rimpicciolisce la zona e la ringrandisce a blocchi
/// (come la versione Python con OpenCV).
fn pixela(pixel: &mut [u16], w: usize, h: usize, blocco_pixel: u32) {
    let fattore = 1.max(w.min(h) / blocco_pixel.max(1) as usize);
    let sw = 1.max(w / fattore);
    let sh = 1.max(h / fattore);

    // 1) versione piccola (come cv2.resize lineare)
    let scala_x = w as f32 / sw as f32;
    let scala_y = h as f32 / sh as f32;
    let mut piccola = vec![0u16; sw * sh * 3];
    for py in 0..sh {
        let (ya, yb, fy) = posizione_lineare(py, scala_y, h);
        for px in 0..sw {
            let (xa, xb, fx) = posizione_lineare(px, scala_x, w);
            for c in 0..3 {
                let p = |xx: usize, yy: usize| pixel[(yy * w + xx) * 3 + c] as f32;
                let sopra = p(xa, ya) * (1.0 - fx) + p(xb, ya) * fx;
                let sotto = p(xa, yb) * (1.0 - fx) + p(xb, yb) * fx;
                let valore = sopra * (1.0 - fy) + sotto * fy;
                piccola[(py * sw + px) * 3 + c] = valore.round().clamp(0.0, 65535.0) as u16;
            }
        }
    }

    // 2) la ringrandisce a blocchi (come cv2.INTER_NEAREST)
    for yy in 0..h {
        let py = ((yy * sh) / h).min(sh - 1);
        for xx in 0..w {
            let px = ((xx * sw) / w).min(sw - 1);
            for c in 0..3 {
                pixel[(yy * w + xx) * 3 + c] = piccola[(py * sw + px) * 3 + c];
            }
        }
    }
}

/// Sfocatura: tre passate di "media dei vicini" in orizzontale e in verticale
/// (assomiglia a una sfocatura gaussiana). Il raggio cresce con la forza.
fn sfoca(pixel: &mut [u16], w: usize, h: usize, forza: u32) {
    let raggio = ((forza as f32 * 1.5) as usize).max(2);
    for _ in 0..3 {
        media_in_riga(pixel, w, h, raggio, true);
        media_in_riga(pixel, w, h, raggio, false);
    }
}

/// Ogni pixel diventa la media dei vicini sulla stessa riga (orizzontale = true)
/// o sulla stessa colonna. Ai bordi usa il pixel del bordo.
fn media_in_riga(pixel: &mut [u16], w: usize, h: usize, raggio: usize, orizzontale: bool) {
    let (lunghezza, righe) = if orizzontale { (w, h) } else { (h, w) };
    let indice = |riga: usize, i: usize| if orizzontale { (riga * w + i) * 3 } else { (i * w + riga) * 3 };
    let mut copia = vec![0u16; lunghezza * 3];
    let n = (2 * raggio + 1) as u64;
    for riga in 0..righe {
        for i in 0..lunghezza {
            let j = indice(riga, i);
            copia[i * 3..i * 3 + 3].copy_from_slice(&pixel[j..j + 3]);
        }
        for c in 0..3 {
            let valore = |i: isize| copia[i.clamp(0, lunghezza as isize - 1) as usize * 3 + c] as u64;
            // somma della prima finestra, poi la fa "scorrere"
            let mut somma: u64 = (-(raggio as isize)..=raggio as isize).map(valore).sum();
            for i in 0..lunghezza {
                pixel[indice(riga, i) + c] = (somma / n) as u16;
                somma += valore(i as isize + raggio as isize + 1);
                somma -= valore(i as isize - raggio as isize);
            }
        }
    }
}

/// Tinta unita: tutta la zona del colore medio.
fn tinta_unita(pixel: &mut [u16], w: usize, h: usize) {
    let mut somma = [0u64; 3];
    for i in 0..w * h {
        for c in 0..3 {
            somma[c] += pixel[i * 3 + c] as u64;
        }
    }
    let quanti = (w * h).max(1) as u64;
    for i in 0..w * h {
        for c in 0..3 {
            pixel[i * 3 + c] = (somma[c] / quanti) as u16;
        }
    }
}

/// Disegna il bordo di un riquadro (modalità prova), spesso 2 pixel.
fn disegna_bordo(dati: &mut [u8], larghezza: usize, altezza: usize, byte_per_canale: usize, r: Riquadro, colore: [u16; 3]) {
    let mut metti = |x: i32, y: i32| {
        if x >= 0 && y >= 0 && x < larghezza as i32 && y < altezza as i32 {
            for c in 0..3 {
                let canale = (y as usize * larghezza + x as usize) * 3 + c;
                scrivi_canale(dati, canale, byte_per_canale, colore[c]);
            }
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
