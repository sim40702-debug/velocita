// SEGUI E COPRI: una zona disegnata a mano (per esempio su una targa)
// che segue l'oggetto mentre si muove nel video.
//
// Come funziona: si ricorda com'è fatto l'oggetto (un piccolo "stampo" in
// grigio) e in ogni fotogramma lo cerca lì vicino a dove era prima.
// Prova anche un po' più grande e un po' più piccolo, perché avvicinandosi
// l'oggetto cresce. Se per qualche fotogramma non lo trova più, si ferma.

use crate::rilevamento::{Fotogramma, Riquadro};

/// Lo stampo è grande al massimo così (in "celle"): più piccolo = più veloce.
const CELLE_MASSIME: usize = 40;

/// Quanto deve somigliare (da -1 a 1) per dire "è lui".
const SOMIGLIANZA_MINIMA: f32 = 0.45;

/// Per quanti fotogrammi di fila può non trovarlo prima di fermarsi
/// (intanto copre dove l'aveva visto l'ultima volta).
const FOTOGRAMMI_PERSO: u32 = 6;

/// Quanto del nuovo aspetto entra nello stampo a ogni fotogramma
/// (così si adatta se l'oggetto cambia un po', per esempio la luce).
const AGGIORNAMENTO: f32 = 0.1;

/// Le grandezze provate in ogni fotogramma (1.0 = come prima).
const SCALE: [f32; 3] = [0.96, 1.0, 1.04];

pub struct Oggetto {
    /// lo stampo: luminosità di ogni cella, già "normalizzata"
    stampo: Vec<f32>,
    /// quante celle in larghezza e in altezza
    colonne: usize,
    righe: usize,
    /// dove sta adesso, in pixel (può avere decimali)
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    /// da quanti fotogrammi non lo trova
    persi: u32,
}

/// Luminosità di un pixel (da 0 a 255), 0 se fuori dal fotogramma.
fn grigio(foto: &Fotogramma, x: i32, y: i32) -> f32 {
    if x < 0 || y < 0 || x >= foto.larghezza as i32 || y >= foto.altezza as i32 {
        return 0.0;
    }
    let i = (y as usize * foto.larghezza + x as usize) * 3;
    (foto.dati[i] as f32 * 0.299) + (foto.dati[i + 1] as f32 * 0.587) + (foto.dati[i + 2] as f32 * 0.114)
}

/// Legge il riquadro (x, y, w, h) come una griglia di colonne x righe celle
/// e la "normalizza": media 0 e lunghezza 1. Così il confronto non dipende
/// dalla luce (più chiaro o più scuro va bene lo stesso).
/// None se il riquadro è tutto uguale (niente da riconoscere).
fn leggi_celle(foto: &Fotogramma, x: f32, y: f32, w: f32, h: f32, colonne: usize, righe: usize) -> Option<Vec<f32>> {
    let mut celle = Vec::with_capacity(colonne * righe);
    for r in 0..righe {
        for c in 0..colonne {
            // il centro della cella
            let px = x + (c as f32 + 0.5) * w / colonne as f32;
            let py = y + (r as f32 + 0.5) * h / righe as f32;
            celle.push(grigio(foto, px as i32, py as i32));
        }
    }
    let media = celle.iter().sum::<f32>() / celle.len() as f32;
    let mut somma_quadrati = 0.0;
    for v in celle.iter_mut() {
        *v -= media;
        somma_quadrati += *v * *v;
    }
    let lunghezza = somma_quadrati.sqrt();
    if lunghezza < 1.0 {
        return None;
    }
    for v in celle.iter_mut() {
        *v /= lunghezza;
    }
    Some(celle)
}

/// Quanto si somigliano due griglie normalizzate (1 = uguali, 0 = per niente).
fn somiglianza(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

impl Oggetto {
    /// Si ricorda l'oggetto che sta nel riquadro, in questo fotogramma.
    pub fn nuovo(foto: &Fotogramma, r: Riquadro) -> Option<Oggetto> {
        let (w, h) = (r.w.max(4) as f32, r.h.max(4) as f32);
        // le celle: il lato lungo ha CELLE_MASSIME celle (o meno, se è piccolo)
        let lato = w.max(h);
        let dimensione_cella = (lato / CELLE_MASSIME as f32).max(1.0);
        let colonne = ((w / dimensione_cella).round() as usize).max(4);
        let righe = ((h / dimensione_cella).round() as usize).max(4);
        let stampo = leggi_celle(foto, r.x as f32, r.y as f32, w, h, colonne, righe)?;
        Some(Oggetto { stampo, colonne, righe, x: r.x as f32, y: r.y as f32, w, h, persi: 0 })
    }

    /// Dove sta adesso.
    pub fn riquadro(&self) -> Riquadro {
        Riquadro { x: self.x.round() as i32, y: self.y.round() as i32, w: self.w.round() as i32, h: self.h.round() as i32 }
    }

    /// Lo cerca nel fotogramma nuovo. Restituisce dove coprire,
    /// oppure None se l'ha perso (allora non serve più chiamarla).
    pub fn segui(&mut self, foto: &Fotogramma) -> Option<Riquadro> {
        if self.persi > FOTOGRAMMI_PERSO {
            return None;
        }
        // si cerca fino a mezzo oggetto più in là (in ogni direzione)
        let cella = (self.w / self.colonne as f32).max(1.0);
        let raggio = (self.colonne.max(self.righe) / 2) as i32;
        let centro_x = self.x + self.w / 2.0;
        let centro_y = self.y + self.h / 2.0;

        let mut migliore = (-1.0f32, self.x, self.y, self.w, self.h);
        for scala in SCALE {
            let w = self.w * scala;
            let h = self.h * scala;
            for dy in -raggio..=raggio {
                for dx in -raggio..=raggio {
                    let x = centro_x + dx as f32 * cella - w / 2.0;
                    let y = centro_y + dy as f32 * cella - h / 2.0;
                    if let Some(celle) = leggi_celle(foto, x, y, w, h, self.colonne, self.righe) {
                        let s = somiglianza(&self.stampo, &celle);
                        if s > migliore.0 {
                            migliore = (s, x, y, w, h);
                        }
                    }
                }
            }
        }

        let (punteggio, x, y, w, h) = migliore;
        if punteggio < SOMIGLIANZA_MINIMA {
            // non lo trova: copre dove era, per qualche fotogramma
            self.persi += 1;
            if self.persi > FOTOGRAMMI_PERSO {
                return None;
            }
            return Some(self.riquadro());
        }
        self.persi = 0;
        self.x = x;
        self.y = y;
        self.w = w;
        self.h = h;
        // lo stampo si adatta un pochino al nuovo aspetto
        if let Some(nuove) = leggi_celle(foto, x, y, w, h, self.colonne, self.righe) {
            let mut somma_quadrati = 0.0;
            for (s, n) in self.stampo.iter_mut().zip(nuove) {
                *s = *s * (1.0 - AGGIORNAMENTO) + n * AGGIORNAMENTO;
                somma_quadrati += *s * *s;
            }
            let lunghezza = somma_quadrati.sqrt().max(0.0001);
            for s in self.stampo.iter_mut() {
                *s /= lunghezza;
            }
        }
        Some(self.riquadro())
    }
}
