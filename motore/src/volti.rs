// VOLTI: trova le facce delle persone (viste di fronte) per coprirle.
//
// Usa SeetaFace (libreria rustface, licenza BSD: vedi modelli/LICENZA_seeta_fd.txt).
// Il "modello" è un file che contiene quello che il programma ha imparato
// guardando migliaia di facce: è dentro l'app, non serve internet.

use std::cell::RefCell;
use std::io::Cursor;
use std::sync::OnceLock;

use rustface::{Detector, ImageData, Model};

use crate::rilevamento::{Fotogramma, Riquadro};

/// Il file del modello, messo dentro il programma quando si compila.
const FILE_MODELLO: &[u8] = include_bytes!("../modelli/seeta_fd_frontal_v1.0.bin");

/// Si cerca su un'immagine più piccola (il lato più lungo al massimo così):
/// è molto più veloce e le facce si trovano lo stesso.
const LATO_MASSIMO: usize = 960;

/// La faccia più piccola che si cerca (in pixel dell'immagine piccola).
const VOLTO_MINIMO: u32 = 20;

/// Quanto deve essere "sicuro" per dire che è una faccia (più alto = meno errori,
/// ma qualche faccia in meno).
const SICUREZZA_MINIMA: f64 = 2.0;

/// Per quanti fotogrammi una faccia resta coperta dopo l'ultima volta che si è vista
/// (così la copertura non "lampeggia" quando per un attimo non la trova).
const FOTOGRAMMI_MEMORIA: u32 = 8;

// il modello si legge una volta sola, la prima volta che serve
static MODELLO: OnceLock<Option<Model>> = OnceLock::new();

fn modello() -> Option<&'static Model> {
    MODELLO
        .get_or_init(|| rustface::read_model(Cursor::new(FILE_MODELLO)).ok())
        .as_ref()
}

// ogni core del processore ha il suo "rivelatore" (non si possono condividere)
thread_local! {
    static RIVELATORE: RefCell<Option<Box<dyn Detector>>> = const { RefCell::new(None) };
}

/// Trova le facce in un fotogramma. Restituisce i riquadri in pixel.
pub fn trova_volti(foto: &Fotogramma) -> Vec<Riquadro> {
    let Some(m) = modello() else {
        return Vec::new();
    };

    // 1) immagine grigia e più piccola (un pixel ogni "passo")
    let lato = foto.larghezza.max(foto.altezza);
    let passo = lato.div_ceil(LATO_MASSIMO).max(1);
    let w = foto.larghezza / passo;
    let h = foto.altezza / passo;
    if w < 40 || h < 40 {
        return Vec::new();
    }
    let mut grigio = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * passo) * foto.larghezza + x * passo) * 3;
            let (r, g, b) = (foto.dati[i] as u32, foto.dati[i + 1] as u32, foto.dati[i + 2] as u32);
            grigio[y * w + x] = ((r * 299 + g * 587 + b * 114) / 1000) as u8;
        }
    }

    // 2) cerca le facce
    RIVELATORE.with(|cella| {
        let mut rivelatore = cella.borrow_mut();
        if rivelatore.is_none() {
            let mut nuovo = rustface::create_detector_with_model(m.clone());
            nuovo.set_min_face_size(VOLTO_MINIMO);
            nuovo.set_score_thresh(SICUREZZA_MINIMA);
            nuovo.set_pyramid_scale_factor(0.8);
            nuovo.set_slide_window_step(4, 4);
            *rivelatore = Some(nuovo);
        }
        let immagine = ImageData::new(&grigio, w as u32, h as u32);
        let trovate = rivelatore.as_mut().unwrap().detect(&immagine);

        // 3) dai pixel dell'immagine piccola a quelli veri
        let p = passo as i32;
        trovate
            .iter()
            .map(|f| {
                let b = f.bbox();
                Riquadro { x: b.x() * p, y: b.y() * p, w: b.width() as i32 * p, h: b.height() as i32 * p }
            })
            .collect()
    })
}

/// La zona da coprire per una faccia: un po' più grande (capelli, mento, orecchie).
pub fn zona_volto(volto: Riquadro, larghezza: usize, altezza: usize) -> Riquadro {
    let in_piu_x = volto.w / 4;
    let in_piu_y = volto.h / 3;
    let x1 = (volto.x - in_piu_x).max(0);
    let y1 = (volto.y - in_piu_y).max(0);
    let x2 = (volto.x + volto.w + in_piu_x).min(larghezza as i32);
    let y2 = (volto.y + volto.h + in_piu_y / 2).min(altezza as i32);
    Riquadro { x: x1, y: y1, w: (x2 - x1).max(1), h: (y2 - y1).max(1) }
}

/// Si ricorda le facce viste negli ultimi fotogrammi (vedi FOTOGRAMMI_MEMORIA).
pub struct MemoriaVolti {
    /// (zona da coprire, da quanti fotogrammi non si vede)
    volti: Vec<(Riquadro, u32)>,
}

impl MemoriaVolti {
    pub fn nuova() -> MemoriaVolti {
        MemoriaVolti { volti: Vec::new() }
    }

    /// Aggiunge le facce di questo fotogramma e dice quali zone coprire.
    pub fn aggiorna(&mut self, nuovi: &[Riquadro]) -> Vec<Riquadro> {
        // quelle vecchie invecchiano di un fotogramma
        for v in self.volti.iter_mut() {
            v.1 += 1;
        }
        self.volti.retain(|v| v.1 <= FOTOGRAMMI_MEMORIA);
        for n in nuovi {
            self.volti.push((*n, 0));
        }
        self.volti.iter().map(|v| v.0).collect()
    }
}
