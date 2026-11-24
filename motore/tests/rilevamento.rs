// Test automatici del rilevamento del display.
//
// Si lanciano con:  cargo test -p motore
// GitHub Actions li fa girare prima di ogni release: se uno fallisce,
// la release non viene creata.
//
// Le immagini in tests/fotogrammi sono fotogrammi dei video della moto
// dove il programma, prima, sbagliava zona (lampioni, muri, strada
// illuminata, strisce della moto, riflessi...).

use motore::rilevamento::{momento_usato, trova_display, ColoreDisplay, Impostazioni, Inseguitore, Momento, Riquadro};
use motore::video::apri_immagine;
use std::path::Path;

/// Dove sta davvero il display in ogni fotogramma: (file, x, y, larghezza, altezza)
const DISPLAY_GIUSTI: [(&str, i32, i32, i32, i32); 9] = [
    ("notte_display_diviso.jpg", 576, 1102, 210, 110),
    ("notte_finestra_accesa.jpg", 488, 897, 140, 80),
    ("notte_lampione_in_fondo.jpg", 505, 843, 98, 78),
    ("notte_muro_illuminato.jpg", 483, 748, 170, 108),
    ("notte_pezzi_vicini.jpg", 467, 776, 166, 124),
    ("notte_riflesso_in_basso.jpg", 476, 798, 156, 74),
    ("notte_strada_illuminata_1.jpg", 454, 871, 110, 80),
    ("notte_strada_illuminata_2.jpg", 441, 852, 150, 72),
    ("notte_strisce_moto.jpg", 502, 759, 162, 64),
];

fn apri(nome: &str) -> motore::rilevamento::Fotogramma {
    let percorso = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fotogrammi").join(nome);
    apri_immagine(&percorso).expect("immagine di test non trovata")
}

#[test]
fn trova_il_display_giusto() {
    let mut sbagliati = Vec::new();

    for (nome, x, y, w, h) in DISPLAY_GIUSTI {
        let foto = apri(nome);
        let trovato = trova_display(&foto, &Impostazioni::default());

        let Some(r) = trovato else {
            sbagliati.push(format!("{nome}: display non trovato"));
            continue;
        };

        // il centro del riquadro trovato deve stare sul display giusto
        let centro_x = r.x + r.w / 2;
        let centro_y = r.y + r.h / 2;
        let centro_giusto = centro_x >= x && centro_x <= x + w && centro_y >= y && centro_y <= y + h;

        // e il riquadro non deve essere molto più grande del display
        let non_troppo_grande = r.w * r.h <= w * h * 5 / 2;

        if !centro_giusto || !non_troppo_grande {
            sbagliati.push(format!("{nome}: trovato {r:?}, il display è a x {x} y {y} w {w} h {h}"));
        }
    }

    assert!(sbagliati.is_empty(), "Il rilevamento sbaglia:\n{}", sbagliati.join("\n"));
}

#[test]
fn con_il_colore_sbagliato_non_trova_niente() {
    // il display della moto è arancione: cercando un display blu
    // non deve trovare niente
    let mut imp = Impostazioni::default();
    imp.colore = ColoreDisplay::da_nome("blu", [0, 0, 0]);
    for (nome, ..) in DISPLAY_GIUSTI {
        let foto = apri(nome);
        assert_eq!(trova_display(&foto, &imp), None, "{nome}: ha trovato un display blu");
    }
}

#[test]
fn automatico_capisce_che_e_notte() {
    // tutti i fotogrammi di esempio sono di notte
    for (nome, ..) in DISPLAY_GIUSTI {
        let foto = apri(nome);
        assert_eq!(momento_usato(&foto, &Impostazioni::default()), Momento::Notte, "{nome}");
    }
}

// ---------- il riquadro che segue il display ----------

fn riquadro(x: i32, y: i32) -> Riquadro {
    Riquadro { x, y, w: 100, h: 50 }
}

#[test]
fn resta_fermo_se_il_display_sparisce_per_poco() {
    let mut inseguitore = Inseguitore::nuovo();
    inseguitore.aggiorna(Some(riquadro(500, 800)));

    // per 15 fotogrammi senza display continua a coprire
    for _ in 0..15 {
        assert_eq!(inseguitore.aggiorna(None), Some(riquadro(500, 800)));
    }
    // poi smette
    assert_eq!(inseguitore.aggiorna(None), None);
}

#[test]
fn copre_sempre_tutto_il_display_quando_si_muove() {
    let mut inseguitore = Inseguitore::nuovo();
    inseguitore.aggiorna(Some(riquadro(500, 800)));

    // il display si sposta un po' a ogni fotogramma
    for passo in 1..20 {
        let display = riquadro(500 + passo * 10, 800 + passo * 5);
        let usato = inseguitore.aggiorna(Some(display)).unwrap();
        // il riquadro usato contiene tutto il display
        assert!(usato.x <= display.x && usato.y <= display.y);
        assert!(usato.x + usato.w >= display.x + display.w);
        assert!(usato.y + usato.h >= display.y + display.h);
    }
}

#[test]
fn non_salta_lontano_per_un_solo_riflesso() {
    let mut inseguitore = Inseguitore::nuovo();
    inseguitore.aggiorna(Some(riquadro(500, 800)));

    // un fotogramma con un "display" lontano (es. riflesso): resta dov'era
    assert_eq!(inseguitore.aggiorna(Some(riquadro(100, 200))), Some(riquadro(500, 800)));
    // il fotogramma dopo il display è di nuovo al suo posto
    assert_eq!(inseguitore.aggiorna(Some(riquadro(500, 800))), Some(riquadro(500, 800)));
}

#[test]
fn salta_lontano_se_lo_trova_due_volte() {
    let mut inseguitore = Inseguitore::nuovo();
    inseguitore.aggiorna(Some(riquadro(500, 800)));

    // trovato lontano due volte di fila (es. taglio nel video): ci va
    inseguitore.aggiorna(Some(riquadro(100, 200)));
    assert_eq!(inseguitore.aggiorna(Some(riquadro(100, 200))), Some(riquadro(100, 200)));
}

// ---------- la striscia colorata ----------

use motore::rilevamento::{applica_regolazione, Regolazione};
use motore::video::{stati_copertura, INCERTO, NON_TROVATO, TROVATO};

#[test]
fn striscia_verde_rossa_e_arancione() {
    let qui = Some((riquadro(500, 800), 1.0));
    let lontano = Some((riquadro(100, 200), 1.0));
    let con_rivale = Some((riquadro(500, 800), 0.1));
    let trovati = [qui, qui, None, qui, lontano, qui, con_rivale];
    assert_eq!(
        stati_copertura(&trovati),
        vec![TROVATO, TROVATO, NON_TROVATO, TROVATO, INCERTO, TROVATO, INCERTO]
    );
}

// ---------- la zona regolata a mano ----------

#[test]
fn senza_regolazione_la_zona_non_cambia() {
    let zona = Riquadro { x: 100, y: 200, w: 60, h: 30 };
    assert_eq!(applica_regolazione(zona, Regolazione::nessuna(), 1080, 1920), zona);
}

#[test]
fn la_regolazione_sposta_e_ingrandisce() {
    let zona = Riquadro { x: 100, y: 200, w: 60, h: 30 };
    // centro spostato di mezza zona a destra (130 -> 160), più larga del 50%, alta il doppio
    let reg = Regolazione { dx: 0.5, dy: 0.0, larghezza: 1.5, altezza: 2.0 };
    assert_eq!(applica_regolazione(zona, reg, 1080, 1920), Riquadro { x: 115, y: 185, w: 90, h: 60 });
}

#[test]
fn la_zona_regolata_resta_dentro_l_immagine() {
    let zona = Riquadro { x: 1040, y: 1900, w: 40, h: 20 };
    let reg = Regolazione { dx: 1.0, dy: 1.0, larghezza: 2.0, altezza: 2.0 };
    let r = applica_regolazione(zona, reg, 1080, 1920);
    assert!(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1080 && r.y + r.h <= 1920);
}
