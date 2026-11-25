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

// ---------- colori e 10 bit ----------

use motore::rilevamento::{copri_grezzo, Stile};
use motore::video::{argomenti_codifica, leggi_formato_colori, Hardware, InfoVideo};

#[test]
fn legge_i_colori_del_video() {
    // video HLG a 10 bit (come l'Osmo Nano)
    let (bit_10, colori) = leggi_formato_colori(
        "hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67, progressive), 3840x2160, 60 fps",
    );
    let colori = colori.unwrap();
    assert!(bit_10);
    assert_eq!((colori.spazio.as_str(), colori.primari.as_str(), colori.trasferimento.as_str()), ("bt2020nc", "bt2020", "arib-std-b67"));
    assert_eq!(colori.gamma, "tv");

    // video HD normale
    let (bit_10, colori) = leggi_formato_colori("h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 1920x1080");
    assert!(!bit_10);
    assert_eq!(colori.unwrap().spazio, "bt709");

    // video senza informazioni sui colori
    let (bit_10, colori) = leggi_formato_colori("h264 (High), yuv420p(progressive), 1280x720, 30 fps");
    assert!(!bit_10);
    assert!(colori.is_none());
}

fn info_prova(testo: &str) -> InfoVideo {
    let (bit_10, colori) = leggi_formato_colori(testo);
    InfoVideo {
        larghezza: 1920,
        altezza: 1080,
        fps_testo: "30".into(),
        fps: 30.0,
        durata: 10.0,
        fotogrammi_totali: 300,
        audio: None,
        bit_10,
        colori,
    }
}

#[test]
fn il_video_esce_con_gli_stessi_colori() {
    let a = argomenti_codifica(None, &info_prova("h264, yuv420p(tv, bt709), 1920x1080")).join(" ");
    assert!(a.contains("out_color_matrix=bt709"), "{a}");
    assert!(a.contains("-colorspace bt709") && a.contains("-color_trc bt709"), "{a}");
    assert!(a.contains("libx264"), "{a}");
}

#[test]
fn il_video_a_10_bit_resta_a_10_bit() {
    let info = info_prova("hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160");
    let lento = argomenti_codifica(None, &info).join(" ");
    assert!(lento.contains("libx265") && lento.contains("yuv420p10le") && lento.contains("-color_trc arib-std-b67"), "{lento}");
    let veloce = argomenti_codifica(Some(Hardware::Mac), &info).join(" ");
    assert!(veloce.contains("hevc_videotoolbox") && veloce.contains("main10") && veloce.contains("p010le"), "{veloce}");
}

// ---------- stili di copertura ----------

#[test]
fn gli_stili_coprono_solo_la_zona() {
    // fotogramma 100x100 tutto bianco, a 8 e a 16 bit
    let display = Riquadro { x: 30, y: 60, w: 40, h: 20 };
    for byte_per_canale in [1, 2] {
        for stile in [Stile::Pixel, Stile::Sfocatura, Stile::Nero, Stile::TintaUnita] {
            let mut dati = vec![255u8; 100 * 100 * 3 * byte_per_canale];
            let mut imp = Impostazioni::default();
            imp.stile = stile;
            if stile == Stile::Nero {
                copri_grezzo(&mut dati, 100, 100, byte_per_canale, Some(display), &imp);
                // il centro del display è nero, l'angolo dell'immagine no
                let centro = ((70 * 100 + 50) * 3) * byte_per_canale;
                assert_eq!(dati[centro], 0, "{stile:?} {byte_per_canale}");
                assert_eq!(dati[0], 255);
            } else {
                // su un'immagine tutta bianca gli altri stili non cambiano niente
                copri_grezzo(&mut dati, 100, 100, byte_per_canale, Some(display), &imp);
                assert!(dati.iter().all(|&v| v == 255), "{stile:?} {byte_per_canale}");
            }
        }
    }
}

// ---------- zone fisse (disegnate a mano per un pezzo del video) ----------

#[test]
fn la_zona_fissa_vale_solo_nel_suo_pezzo() {
    use motore::rilevamento::{zona_fissa_a, ZonaFissa};
    let prima = ZonaFissa { inizio: 10.0, fine: 20.0, x: 0.1, y: 0.5, w: 0.2, h: 0.1, segui: false };
    let dopo = ZonaFissa { inizio: 15.0, fine: 30.0, x: 0.3, y: 0.6, w: 0.2, h: 0.1, segui: false };
    let zone = [prima, dopo];
    assert_eq!(zona_fissa_a(&zone, 5.0), None);
    assert_eq!(zona_fissa_a(&zone, 12.0), Some(prima));
    // dove si sovrappongono vince l'ultima aggiunta
    assert_eq!(zona_fissa_a(&zone, 16.0), Some(dopo));
    assert_eq!(zona_fissa_a(&zone, 31.0), None);
    // da percentuale a pixel
    assert_eq!(prima.in_pixel(1000, 500), Riquadro { x: 100, y: 250, w: 200, h: 50 });
}

#[test]
fn la_zona_fissa_copre_esattamente_il_rettangolo() {
    use motore::rilevamento::copri_zona_grezzo;
    let mut imp = Impostazioni::default();
    imp.stile = Stile::Nero;
    let mut dati = vec![255u8; 100 * 100 * 3];
    copri_zona_grezzo(&mut dati, 100, 100, 1, Riquadro { x: 10, y: 20, w: 30, h: 10 }, &imp);
    let pixel = |x: usize, y: usize| dati[(y * 100 + x) * 3];
    assert_eq!(pixel(10, 20), 0); // primo angolo dentro
    assert_eq!(pixel(39, 29), 0); // ultimo angolo dentro
    assert_eq!(pixel(40, 29), 255); // subito fuori a destra
    assert_eq!(pixel(10, 30), 255); // subito fuori sotto
}

#[test]
fn le_schede_video_di_windows_hanno_il_formato_giusto() {
    let normale = info_prova("h264, yuv420p(tv, bt709), 1920x1080");
    let nvidia = argomenti_codifica(Some(Hardware::Nvidia), &normale).join(" ");
    assert!(nvidia.contains("h264_nvenc") && nvidia.contains("format=yuv420p"), "{nvidia}");
    let intel = argomenti_codifica(Some(Hardware::Intel), &normale).join(" ");
    assert!(intel.contains("h264_qsv") && intel.contains("format=nv12"), "{intel}");
    let dieci = info_prova("hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160");
    let amd = argomenti_codifica(Some(Hardware::Amd), &dieci).join(" ");
    assert!(amd.contains("hevc_amf") && amd.contains("main10") && amd.contains("p010le") && amd.contains("hvc1"), "{amd}");
}

// ---------- segui e copri (per esempio una targa) ----------

/// Un fotogramma grigio scuro con un rettangolo "a scacchi" (come una targa
/// con le lettere) nella posizione e grandezza date.
fn fotogramma_con_oggetto(x: i32, y: i32, w: i32, h: i32) -> motore::Fotogramma {
    let (larghezza, altezza) = (320usize, 240usize);
    let mut dati = vec![40u8; larghezza * altezza * 3];
    for yy in 0..h {
        for xx in 0..w {
            // righe e colonne chiare e scure, come lettere su una targa
            let chiaro = ((xx * 6 / w.max(1)) + (yy * 3 / h.max(1))) % 2 == 0;
            let valore = if chiaro { 230 } else { 20 };
            let (px, py) = ((x + xx) as usize, (y + yy) as usize);
            if px < larghezza && py < altezza {
                for c in 0..3 {
                    dati[(py * larghezza + px) * 3 + c] = valore;
                }
            }
        }
    }
    motore::Fotogramma { larghezza, altezza, dati }
}

#[test]
fn segue_un_oggetto_che_si_muove_e_cresce() {
    use motore::segui::Oggetto;
    let primo = fotogramma_con_oggetto(40, 100, 60, 20);
    let mut oggetto = Oggetto::nuovo(&primo, Riquadro { x: 40, y: 100, w: 60, h: 20 }).unwrap();
    // 40 fotogrammi: va a destra di 3 pixel e in giù di 1, e cresce un pochino
    let mut ultimo = None;
    for i in 1..=40 {
        let w = 60 + i / 2;
        let h = 20 + i / 6;
        let foto = fotogramma_con_oggetto(40 + i * 3, 100 + i, w, h);
        ultimo = oggetto.segui(&foto);
        assert!(ultimo.is_some(), "perso al fotogramma {i}");
    }
    let r = ultimo.unwrap();
    // alla fine l'oggetto sta a x=160, y=140 (60+20 = 80 di larghezza)
    let centro_x = r.x + r.w / 2;
    let centro_y = r.y + r.h / 2;
    assert!((centro_x - (160 + 40)).abs() <= 6, "{r:?}");
    assert!((centro_y - (140 + 13)).abs() <= 4, "{r:?}");
}

#[test]
fn si_ferma_quando_l_oggetto_sparisce() {
    use motore::segui::Oggetto;
    let primo = fotogramma_con_oggetto(40, 100, 60, 20);
    let mut oggetto = Oggetto::nuovo(&primo, Riquadro { x: 40, y: 100, w: 60, h: 20 }).unwrap();
    let vuoto = motore::Fotogramma { larghezza: 320, altezza: 240, dati: vec![40u8; 320 * 240 * 3] };
    let mut fermato = false;
    for _ in 0..20 {
        if oggetto.segui(&vuoto).is_none() {
            fermato = true;
            break;
        }
    }
    assert!(fermato);
}

// ---------- volti ----------

#[test]
fn nei_fotogrammi_della_moto_non_vede_facce() {
    // nei video della moto di notte non ci sono persone:
    // se trovasse "facce" coprirebbe pezzi a caso
    let cartella = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fotogrammi");
    for (nome, ..) in DISPLAY_GIUSTI {
        let foto = apri_immagine(&cartella.join(nome)).unwrap();
        let volti = motore::volti::trova_volti(&foto);
        assert!(volti.is_empty(), "{nome}: {volti:?}");
    }
}
