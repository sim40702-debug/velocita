// Lettura e scrittura dei video con ffmpeg (incluso nell'app).
// ffmpeg legge il video e ci passa i fotogrammi uno dopo l'altro,
// Rust li copre, e un secondo ffmpeg li scrive nel video finale
// insieme all'audio originale.

use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use rayon::prelude::*;

use crate::rilevamento::{
    copri, copri_grezzo, momento_usato, regione_centrale, trova_display, trova_display_con_sicurezza, vicini, zona_da_coprire,
    Fotogramma, Impostazioni, Inseguitore, Momento, Riquadro,
};

// Estensioni trattate come foto (tutte le altre vengono aperte come video)
pub const ESTENSIONI_IMMAGINI: [&str; 4] = ["jpg", "jpeg", "png", "webp"];
pub const ESTENSIONI_VIDEO: [&str; 5] = ["mp4", "mov", "avi", "mkv", "m4v"];

/// Video o foto che Velocità sa aprire (guarda l'estensione).
pub fn e_supportato(percorso: &Path) -> bool {
    let estensione = percorso
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    ESTENSIONI_IMMAGINI.contains(&estensione.as_str()) || ESTENSIONI_VIDEO.contains(&estensione.as_str())
}

// ==========================================
// GESTIONE AUTOMATICA DEI CORE CPU
// ==========================================

// Tetto massimo assoluto di core usati, qualunque sia la percentuale scelta.
pub const MAX_WORKER_ASSOLUTO: usize = 16;

/// Traduce una percentuale (es. 0.5 = 50%) nel numero di core da usare,
/// arrotondando in modo "classico" (0.5 sempre per eccesso), sempre almeno 1
/// e mai più dei core reali né di MAX_WORKER_ASSOLUTO.
/// Esempio: 12 core disponibili, percentuale 0.5 -> 6 worker.
pub fn calcola_numero_worker(percentuale: f32, cpu_totali: usize) -> usize {
    let grezzo = cpu_totali as f32 * percentuale;
    let mut worker = (grezzo + 0.5) as usize;
    worker = worker.max(1);
    worker = worker.min(cpu_totali);
    worker = worker.min(MAX_WORKER_ASSOLUTO);
    worker
}

/// Numero di core/thread del computer.
pub fn cpu_totali() -> usize {
    thread::available_parallelism().map(|n| n.get()).unwrap_or(4)
}

// ==========================================
// INFORMAZIONI SUL VIDEO
// ==========================================

#[derive(Clone, Debug)]
pub struct InfoVideo {
    pub larghezza: usize,
    pub altezza: usize,
    /// fotogrammi al secondo, scritto come lo vuole ffmpeg (es. "30000/1001")
    pub fps_testo: String,
    pub fps: f64,
    pub durata: f64,
    pub fotogrammi_totali: u64,
    /// nome del codec audio (es. "aac"), None se il video non ha audio
    pub audio: Option<String>,
    /// true per i video a 10 bit (o più): vanno elaborati a 16 bit per non perdere colori
    pub bit_10: bool,
    /// le informazioni sui colori scritte nel video (None = non ci sono)
    pub colori: Option<ColoriVideo>,
}

/// Le informazioni sui colori di un video, con i nomi che usa ffmpeg.
/// Esempio video HD: spazio "bt709", primari "bt709", trasferimento "bt709", gamma "tv".
/// Esempio HLG a 10 bit: "bt2020nc", "bt2020", "arib-std-b67".
#[derive(Clone, Debug, PartialEq)]
pub struct ColoriVideo {
    pub spazio: String,
    pub primari: String,
    pub trasferimento: String,
    /// "tv" (normale) o "pc" (gamma completa)
    pub gamma: String,
}

/// Crea il comando ffmpeg senza aprire la finestra nera su Windows.
fn comando_ffmpeg(ffmpeg: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(ffmpeg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

/// Chiede a ffmpeg le informazioni del video (dimensioni, fps, durata, audio).
pub fn leggi_info(ffmpeg: &Path, percorso: &Path) -> Result<InfoVideo, String> {
    let uscita = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(percorso)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;
    let testo = String::from_utf8_lossy(&uscita.stderr).to_string();

    let mut info = InfoVideo {
        larghezza: 0,
        altezza: 0,
        fps_testo: "30".to_string(),
        fps: 30.0,
        durata: 0.0,
        fotogrammi_totali: 0,
        audio: None,
        bit_10: false,
        colori: None,
    };
    let mut rotazione = 0;

    for riga in testo.lines() {
        let riga = riga.trim();

        // Duration: 00:03:24.12, start: ...
        if let Some(resto) = riga.strip_prefix("Duration: ") {
            let tempo = resto.split(',').next().unwrap_or("");
            info.durata = leggi_tempo(tempo);
        }

        // Stream #0:0[0x1](und): Video: h264 ..., 1920x1080 [SAR 1:1 DAR 16:9], ..., 29.97 fps, ...
        if riga.starts_with("Stream #") && riga.contains(": Video: ") && info.larghezza == 0 {
            if let Some(descrizione) = riga.split(": Video: ").nth(1) {
                let (bit_10, colori) = leggi_formato_colori(descrizione);
                info.bit_10 = bit_10;
                info.colori = colori;
            }
            for pezzo in riga.split([',', ' ']) {
                if let Some((a, b)) = pezzo.split_once('x') {
                    if let (Ok(w), Ok(h)) = (a.parse::<usize>(), b.parse::<usize>()) {
                        if w > 0 && h > 0 {
                            info.larghezza = w;
                            info.altezza = h;
                            break;
                        }
                    }
                }
            }
            let parole: Vec<&str> = riga.split(' ').collect();
            for i in 1..parole.len() {
                let unita = parole[i].trim_end_matches(',');
                if unita == "fps" || (unita == "tbr" && info.fps_testo == "30") {
                    if let Ok(valore) = parole[i - 1].parse::<f64>() {
                        info.fps = valore;
                        info.fps_testo = fps_preciso(valore);
                        if unita == "fps" {
                            break;
                        }
                    }
                }
            }
        }

        // Stream #0:1(und): Audio: aac (LC) ...
        if riga.starts_with("Stream #") && riga.contains(": Audio: ") && info.audio.is_none() {
            if let Some(dopo) = riga.split(": Audio: ").nth(1) {
                let codec = dopo.split([' ', ',']).next().unwrap_or("").to_string();
                info.audio = Some(codec);
            }
        }

        // displaymatrix: rotation of -90.00 degrees (video girato in verticale)
        if let Some(dopo) = riga.split("rotation of ").nth(1) {
            if let Ok(gradi) = dopo.split(' ').next().unwrap_or("0").parse::<f64>() {
                rotazione = gradi.round() as i32;
            }
        }
    }

    if info.larghezza == 0 {
        return Err("Questo file non sembra un video che riesco ad aprire.".to_string());
    }

    // ffmpeg gira da solo i video verticali: scambio larghezza e altezza
    if rotazione.abs() == 90 || rotazione.abs() == 270 {
        std::mem::swap(&mut info.larghezza, &mut info.altezza);
    }

    info.fotogrammi_totali = (info.durata * info.fps).round().max(1.0) as u64;
    Ok(info)
}

/// Dalla descrizione del video di ffmpeg, per esempio
/// "hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, ..."
/// capisce se è a 10 bit e quali colori usa.
pub fn leggi_formato_colori(descrizione: &str) -> (bool, Option<ColoriVideo>) {
    for pezzo in dividi_fuori_parentesi(descrizione) {
        let nome = pezzo.split('(').next().unwrap_or("").trim();
        // il formato dei pixel: yuv420p, yuv420p10le, nv12, p010le, ...
        let e_formato = nome.starts_with("yuv") || nome.starts_with("nv") || nome.starts_with("p01") || nome.starts_with("gbr");
        if !e_formato {
            continue;
        }
        let bit_10 = nome.contains("10") || nome.contains("12") || nome.contains("16");

        // tra parentesi: "tv, bt709" oppure "tv, bt2020nc/bt2020/arib-std-b67, progressive"
        let mut gamma = String::new();
        let mut colori: Option<ColoriVideo> = None;
        if let Some(dentro) = pezzo.split_once('(').map(|(_, d)| d.trim_end_matches(')')) {
            for voce in dentro.split(',') {
                let voce = voce.trim();
                if voce == "tv" || voce == "pc" {
                    gamma = voce.to_string();
                } else if voce.contains('/') {
                    let parti: Vec<&str> = voce.split('/').collect();
                    if parti.len() == 3 {
                        colori = Some(ColoriVideo {
                            spazio: parti[0].to_string(),
                            primari: parti[1].to_string(),
                            trasferimento: parti[2].to_string(),
                            gamma: String::new(),
                        });
                    }
                } else if voce.starts_with("bt") || voce.starts_with("smpte") {
                    // un nome solo = spazio, primari e trasferimento uguali
                    colori = Some(ColoriVideo {
                        spazio: voce.to_string(),
                        primari: voce.to_string(),
                        trasferimento: voce.to_string(),
                        gamma: String::new(),
                    });
                }
            }
        }
        if let Some(c) = colori.as_mut() {
            c.gamma = if gamma.is_empty() { "tv".to_string() } else { gamma };
        }
        return (bit_10, colori);
    }
    (false, None)
}

/// Divide "a, b(c, d), e" in ["a", "b(c, d)", "e"]: le virgole tra parentesi non contano.
fn dividi_fuori_parentesi(testo: &str) -> Vec<String> {
    let mut pezzi = Vec::new();
    let mut attuale = String::new();
    let mut profondita = 0;
    for carattere in testo.chars() {
        match carattere {
            '(' => profondita += 1,
            ')' => profondita -= 1,
            ',' if profondita == 0 => {
                pezzi.push(attuale.trim().to_string());
                attuale.clear();
                continue;
            }
            _ => {}
        }
        attuale.push(carattere);
    }
    pezzi.push(attuale.trim().to_string());
    pezzi
}

/// La "matrice" per passare da RGB ai colori del video, con il nome che usa
/// il filtro scale di ffmpeg. None = il video non dice niente (si lascia com'è).
fn matrice_colori(info: &InfoVideo) -> Option<&'static str> {
    let colori = info.colori.as_ref()?;
    match colori.spazio.as_str() {
        "bt709" => Some("bt709"),
        "bt2020nc" | "bt2020c" => Some("bt2020"),
        "smpte170m" | "bt470bg" => Some("bt601"),
        "smpte240m" => Some("smpte240m"),
        _ => None,
    }
}

/// "00:03:24.12" -> 204.12 secondi
fn leggi_tempo(testo: &str) -> f64 {
    let parti: Vec<&str> = testo.trim().split(':').collect();
    if parti.len() != 3 {
        return 0.0;
    }
    let ore: f64 = parti[0].parse().unwrap_or(0.0);
    let minuti: f64 = parti[1].parse().unwrap_or(0.0);
    let secondi: f64 = parti[2].parse().unwrap_or(0.0);
    ore * 3600.0 + minuti * 60.0 + secondi
}

/// 29.97 -> "30000/1001", così il video finale resta sincronizzato con l'audio.
fn fps_preciso(fps: f64) -> String {
    for base in [24.0, 30.0, 60.0, 120.0] {
        let ntsc = base * 1000.0 / 1001.0;
        if (fps - ntsc).abs() < 0.01 {
            return format!("{}/1001", (base * 1000.0) as u64);
        }
    }
    format!("{fps}")
}

// ==========================================
// ANTEPRIMA (UN FOTOGRAMMA)
// ==========================================

/// Risultato dell'anteprima: il fotogramma e le zone trovate.
pub struct Anteprima {
    pub foto: Fotogramma,
    pub display: Option<Riquadro>,
    pub zona_coperta: Option<Riquadro>,
    /// la zona automatica, senza la regolazione fatta a mano
    /// (serve alla finestra per regolarla)
    pub zona_base: Option<Riquadro>,
    /// giorno o notte, quello usato per questo fotogramma
    pub momento: Momento,
}

/// Legge un solo fotogramma al secondo indicato.
pub fn leggi_fotogramma(ffmpeg: &Path, percorso: &Path, info: &InfoVideo, secondi: f64) -> Result<Fotogramma, String> {
    let uscita = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{secondi:.3}"), "-i"])
        .arg(percorso)
        .args(["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;
    let dimensione = info.larghezza * info.altezza * 3;
    if uscita.stdout.len() < dimensione {
        return Err("Non riesco a leggere questo punto del video.".to_string());
    }
    let mut foto = Fotogramma::nuovo(info.larghezza, info.altezza);
    foto.dati.copy_from_slice(&uscita.stdout[..dimensione]);
    Ok(foto)
}

/// Anteprima di un video o di una foto: trova il display senza coprirlo.
pub fn anteprima(ffmpeg: &Path, percorso: &Path, posizione: f64, imp: &Impostazioni) -> Result<Anteprima, String> {
    let foto = if e_immagine(percorso) {
        apri_immagine(percorso)?
    } else {
        let info = leggi_info(ffmpeg, percorso)?;
        let secondi = (info.durata * posizione.clamp(0.0, 1.0)).min((info.durata - 0.1).max(0.0));
        leggi_fotogramma(ffmpeg, percorso, &info, secondi)?
    };
    let display = trova_display(&foto, imp);
    let zona_coperta = display.map(|r| zona_da_coprire(r, foto.larghezza, foto.altezza, imp));
    let zona_base = display.map(|r| regione_centrale(r, foto.larghezza, foto.altezza));
    let momento = momento_usato(&foto, imp);
    Ok(Anteprima { foto, display, zona_coperta, zona_base, momento })
}

// ==========================================
// FOTO
// ==========================================

pub fn e_immagine(percorso: &Path) -> bool {
    let estensione = percorso
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    ESTENSIONI_IMMAGINI.contains(&estensione.as_str())
}

pub fn apri_immagine(percorso: &Path) -> Result<Fotogramma, String> {
    let img = image::open(percorso).map_err(|e| format!("Non riesco ad aprire la foto: {e}"))?;
    let rgb = img.to_rgb8();
    Ok(Fotogramma {
        larghezza: rgb.width() as usize,
        altezza: rgb.height() as usize,
        dati: rgb.into_raw(),
    })
}

/// Copre il numero in una foto e la salva. Ritorna true se ha trovato il display.
pub fn elabora_foto(entrata: &Path, uscita: &Path, imp: &Impostazioni) -> Result<bool, String> {
    let mut foto = apri_immagine(entrata)?;
    let display = trova_display(&foto, imp);
    copri(&mut foto, display, imp);
    let img = image::RgbImage::from_raw(foto.larghezza as u32, foto.altezza as u32, foto.dati)
        .ok_or("Errore interno con la foto.")?;
    img.save(uscita).map_err(|e| format!("Non riesco a salvare la foto: {e}"))?;
    Ok(display.is_some())
}

// ==========================================
// VIDEO
// ==========================================

/// Come è andata l'elaborazione.
pub enum Esito {
    /// finito: quanti fotogrammi hanno avuto il numero coperto
    Finito { coperti: u64 },
    Interrotto,
}

/// Elabora tutto il video. `avanzamento(fatti, totali)` viene chiamata
/// ogni tanto per aggiornare la barra. Se `annulla` diventa true si ferma.
/// Taglio: (inizio, fine) in secondi. None = tutto il video.
#[allow(clippy::too_many_arguments)]
pub fn elabora_video(
    ffmpeg: &Path,
    entrata: &Path,
    uscita: &Path,
    imp: &Impostazioni,
    worker: usize,
    annulla: &AtomicBool,
    taglio: Option<(f64, f64)>,
    mut avanzamento: impl FnMut(u64, u64),
) -> Result<Esito, String> {
    let info = leggi_info(ffmpeg, entrata)?;
    // sul Mac prova prima con il chip del Mac (molto più veloce);
    // se non va, rifà tutto nel modo di sempre (libx264 o libx265)
    if cfg!(target_os = "macos") && videotoolbox_funziona(ffmpeg, info.bit_10) {
        let risultato =
            elabora_video_con(ffmpeg, entrata, uscita, imp, worker, annulla, taglio, &mut avanzamento, true);
        if risultato.is_ok() {
            return risultato;
        }
    }
    elabora_video_con(ffmpeg, entrata, uscita, imp, worker, annulla, taglio, &mut avanzamento, false)
}

/// Prova veloce: comprime un solo fotogramma nero con il chip del Mac.
/// Se ffmpeg ci riesce, VideoToolbox funziona su questo computer.
fn videotoolbox_funziona(ffmpeg: &Path, bit_10: bool) -> bool {
    // per i video a 10 bit serve l'HEVC a 10 bit (main10)
    let codec: &[&str] = if bit_10 {
        &["-vf", "format=p010le", "-c:v", "hevc_videotoolbox", "-profile:v", "main10"]
    } else {
        &["-c:v", "h264_videotoolbox"]
    };
    let prova = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=128x128"])
        .args(["-frames:v", "1"])
        .args(codec)
        .args(["-f", "null", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    match prova {
        Ok(stato) => stato.success(),
        Err(_) => false,
    }
}

/// Come comprimere il video, con gli stessi colori dell'originale.
/// - veloce = true: usa il chip del Mac (VideoToolbox), con un bitrate alto
///   per avere una qualità quasi uguale all'originale
/// - veloce = false: libx264 (o libx265 per i 10 bit), crf 18
/// - video a 10 bit: escono in HEVC a 10 bit, come li fa la videocamera
pub fn argomenti_codifica(veloce: bool, info: &InfoVideo) -> Vec<String> {
    let mut argomenti: Vec<String> = Vec::new();
    let mut aggiungi = |pezzi: &[&str]| {
        for p in pezzi {
            argomenti.push(p.to_string());
        }
    };

    // 1) da RGB ai colori del video, con la stessa matrice dell'originale
    //    (senza, i programmi come DaVinci mostrano i colori spostati)
    let formato = match (info.bit_10, veloce) {
        (true, true) => "p010le",
        (true, false) => "yuv420p10le",
        _ => "yuv420p",
    };
    let filtro = match (matrice_colori(info), info.colori.as_ref()) {
        (Some(matrice), Some(colori)) => {
            format!("scale=out_color_matrix={matrice}:out_range={},format={formato}", colori.gamma)
        }
        _ => format!("format={formato}"),
    };
    aggiungi(&["-vf", &filtro]);

    // 2) il codec
    // circa 0.2 bit per pixel: 1080x1920 a 30 fps = circa 12 Mbit/s
    let kbit = (info.larghezza as f64 * info.altezza as f64 * info.fps.max(1.0) * 0.2 / 1000.0) as u64;
    let bitrate = format!("{}k", kbit.max(4000));
    match (info.bit_10, veloce) {
        (true, true) => aggiungi(&["-c:v", "hevc_videotoolbox", "-profile:v", "main10", "-b:v", &bitrate, "-tag:v", "hvc1"]),
        (true, false) => aggiungi(&[
            "-c:v", "libx265", "-preset", "fast", "-crf", "18", "-x265-params", "log-level=error", "-tag:v", "hvc1",
        ]),
        (false, true) => aggiungi(&["-c:v", "h264_videotoolbox", "-b:v", &bitrate]),
        (false, false) => aggiungi(&["-c:v", "libx264", "-preset", "veryfast", "-crf", "18"]),
    }

    // 3) scrive nel file quali colori usa (come l'originale)
    if let Some(colori) = &info.colori {
        aggiungi(&[
            "-colorspace", &colori.spazio,
            "-color_primaries", &colori.primari,
            "-color_trc", &colori.trasferimento,
            "-color_range", &colori.gamma,
        ]);
    }
    argomenti
}

#[allow(clippy::too_many_arguments)]
fn elabora_video_con(
    ffmpeg: &Path,
    entrata: &Path,
    uscita: &Path,
    imp: &Impostazioni,
    worker: usize,
    annulla: &AtomicBool,
    taglio: Option<(f64, f64)>,
    avanzamento: &mut impl FnMut(u64, u64),
    veloce: bool,
) -> Result<Esito, String> {
    let mut info = leggi_info(ffmpeg, entrata)?;
    // video a 10 bit: 2 byte per canale (rgb48le), così non si perdono colori
    let byte_per_canale = if info.bit_10 { 2 } else { 1 };
    let formato_grezzo = if info.bit_10 { "rgb48le" } else { "rgb24" };
    let dimensione = info.larghezza * info.altezza * 3;

    // solo un pezzo del video: si dice a ffmpeg da dove partire e quanto leggere
    let mut pezzo: Vec<String> = Vec::new();
    if let Some((inizio, fine)) = taglio {
        let inizio = inizio.clamp(0.0, info.durata);
        let durata = (fine.min(info.durata) - inizio).max(0.1);
        pezzo = vec!["-ss".into(), format!("{inizio:.3}"), "-t".into(), format!("{durata:.3}")];
        info.fotogrammi_totali = (durata * info.fps).round().max(1.0) as u64;
    }

    // core da usare per il rilevamento (scelta "Uso CPU")
    let gruppo_core = rayon::ThreadPoolBuilder::new()
        .num_threads(worker)
        .build()
        .map_err(|e| e.to_string())?;

    // 1) ffmpeg che legge: ci dà i fotogrammi grezzi (RGB)
    let mut lettore = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error"])
        .args(&pezzo)
        .arg("-i")
        .arg(entrata)
        .args(["-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", formato_grezzo, "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;

    // 2) ffmpeg che scrive: riceve i fotogrammi coperti e aggiunge l'audio
    let mut argomenti: Vec<String> = vec![
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", formato_grezzo,
    ]
    .into_iter()
    .map(String::from)
    .collect();
    argomenti.push("-s".into());
    argomenti.push(format!("{}x{}", info.larghezza, info.altezza));
    argomenti.push("-r".into());
    argomenti.push(info.fps_testo.clone());
    argomenti.push("-i".into());
    argomenti.push("-".into());
    // l'audio dal file originale (dallo stesso punto, se c'è un taglio)
    argomenti.extend(pezzo.iter().cloned());
    argomenti.push("-i".into());
    argomenti.push(entrata.to_string_lossy().to_string());
    for a in ["-map", "0:v:0", "-map", "1:a?", "-map_metadata", "1"] {
        argomenti.push(a.into());
    }
    // come comprimere il video (chip del Mac o libx264)
    argomenti.extend(argomenti_codifica(veloce, &info));
    // l'audio si copia così com'è se l'mp4 lo accetta, altrimenti diventa AAC
    let audio_copiabile = matches!(info.audio.as_deref(), Some("aac") | Some("mp3") | Some("alac") | Some("ac3"));
    if audio_copiabile {
        argomenti.push("-c:a".into());
        argomenti.push("copy".into());
    } else {
        for a in ["-c:a", "aac", "-b:a", "192k"] {
            argomenti.push(a.into());
        }
    }
    argomenti.push("-movflags".into());
    argomenti.push("+faststart".into());
    argomenti.push(uscita.to_string_lossy().to_string());

    let mut scrittore = comando_ffmpeg(ffmpeg)
        .args(&argomenti)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;

    // legge gli errori dello scrittore in un thread a parte (se no si blocca)
    let mut errori_scrittore = scrittore.stderr.take().unwrap();
    let thread_errori = thread::spawn(move || {
        let mut testo = String::new();
        let _ = errori_scrittore.read_to_string(&mut testo);
        testo
    });

    let mut entrata_video = lettore.stdout.take().unwrap();
    let mut uscita_video = scrittore.stdin.take().unwrap();

    // lavora a gruppi di fotogrammi: il rilevamento di un gruppo si fa
    // su più core insieme, poi si copre in ordine
    let fotogrammi_per_gruppo = (worker * 4).max(4);
    let mut inseguitore = Inseguitore::nuovo();
    let mut fatti: u64 = 0;
    let mut coperti: u64 = 0;
    let mut interrotto = false;
    let mut errore: Option<String> = None;

    loop {
        if annulla.load(Ordering::Relaxed) {
            interrotto = true;
            break;
        }

        // 1) legge un gruppo di fotogrammi
        //    - video a 8 bit: direttamente come Fotogramma
        //    - video a 10 bit: i byte a 16 bit (grezzi_16) + una copia a 8 bit per il rilevamento
        let mut gruppo: Vec<Fotogramma> = Vec::new();
        let mut grezzi_16: Vec<Vec<u8>> = Vec::new();
        while gruppo.len() + grezzi_16.len() < fotogrammi_per_gruppo {
            let mut dati = vec![0u8; dimensione * byte_per_canale];
            if leggi_tutto(&mut entrata_video, &mut dati).is_err() {
                break; // fine del video
            }
            if info.bit_10 {
                grezzi_16.push(dati);
            } else {
                gruppo.push(Fotogramma { larghezza: info.larghezza, altezza: info.altezza, dati });
            }
        }
        if gruppo.is_empty() && grezzi_16.is_empty() {
            break;
        }
        if info.bit_10 {
            gruppo = gruppo_core.install(|| {
                grezzi_16.par_iter().map(|g| a_8_bit(g, info.larghezza, info.altezza)).collect()
            });
        }

        // 2) cerca il display in tutti i fotogrammi del gruppo, in parallelo
        let trovati: Vec<Option<Riquadro>> =
            gruppo_core.install(|| gruppo.par_iter().map(|f| trova_display(f, imp)).collect());

        // 3) in ordine: decide il riquadro da usare (persistenza) e copre
        let mut da_usare = Vec::new();
        for t in trovati {
            let r = inseguitore.aggiorna(t);
            if r.is_some() {
                coperti += 1;
            }
            da_usare.push(r);
        }
        let (larghezza, altezza) = (info.larghezza, info.altezza);
        gruppo_core.install(|| {
            if info.bit_10 {
                grezzi_16
                    .par_iter_mut()
                    .zip(da_usare.par_iter())
                    .for_each(|(g, r)| copri_grezzo(g, larghezza, altezza, 2, *r, imp));
            } else {
                gruppo.par_iter_mut().zip(da_usare.par_iter()).for_each(|(f, r)| copri(f, *r, imp));
            }
        });

        // 4) manda i fotogrammi allo scrittore
        let da_scrivere: Vec<&[u8]> = if info.bit_10 {
            grezzi_16.iter().map(|g| g.as_slice()).collect()
        } else {
            gruppo.iter().map(|f| f.dati.as_slice()).collect()
        };
        for dati in da_scrivere {
            if uscita_video.write_all(dati).is_err() {
                errore = Some("ffmpeg si è fermato mentre scriveva il video.".to_string());
                break;
            }
        }
        if errore.is_some() {
            break;
        }

        fatti += gruppo.len() as u64;
        avanzamento(fatti.min(info.fotogrammi_totali), info.fotogrammi_totali.max(fatti));
    }

    // chiude tutto
    drop(uscita_video);
    let _ = lettore.kill();
    let _ = lettore.wait();

    if interrotto {
        let _ = scrittore.kill();
        let _ = scrittore.wait();
        let _ = thread_errori.join();
        let _ = std::fs::remove_file(uscita); // niente file a metà
        return Ok(Esito::Interrotto);
    }

    let stato = scrittore.wait().map_err(|e| e.to_string())?;
    let testo_errori = thread_errori.join().unwrap_or_default();
    if errore.is_some() || !stato.success() {
        let _ = std::fs::remove_file(uscita);
        let dettaglio = testo_errori.lines().last().unwrap_or("").to_string();
        return Err(format!(
            "{} {}",
            errore.unwrap_or("ffmpeg non è riuscito a creare il video.".to_string()),
            dettaglio
        ));
    }
    if fatti == 0 {
        let _ = std::fs::remove_file(uscita);
        return Err("Non sono riuscito a leggere nessun fotogramma dal video.".to_string());
    }

    avanzamento(fatti, fatti);
    Ok(Esito::Finito { coperti })
}

/// Legge esattamente buffer.len() byte (un fotogramma intero).
fn leggi_tutto(sorgente: &mut impl Read, buffer: &mut [u8]) -> Result<(), ()> {
    let mut letti = 0;
    while letti < buffer.len() {
        match sorgente.read(&mut buffer[letti..]) {
            Ok(0) => return Err(()),
            Ok(n) => letti += n,
            Err(_) => return Err(()),
        }
    }
    Ok(())
}

// ==========================================
// ANALISI VELOCE PER LA STRISCIA COLORATA
// ==========================================

/// Quanti punti al secondo controlla l'analisi.
pub const PUNTI_AL_SECONDO: f64 = 2.0;

/// Com'è andato il rilevamento in un punto del video.
pub const NON_TROVATO: u8 = 0; // rosso: il numero potrebbe vedersi
pub const INCERTO: u8 = 1; // arancione: meglio dare un'occhiata
pub const TROVATO: u8 = 2; // verde: coperto

/// Sotto questa sicurezza il punto è "incerto" (c'è un rivale quasi uguale).
pub const SICUREZZA_MINIMA: f32 = 0.3;

/// Controlla velocemente tutto il video e dice, punto per punto (2 al secondo),
/// se il display viene trovato. Per essere veloce legge solo i fotogrammi
/// chiave, quelli che ffmpeg decodifica subito.
/// avanzamento(stati finora, punti totali) viene chiamato mentre lavora.
pub fn analizza_copertura(
    ffmpeg: &Path,
    percorso: &Path,
    imp: &Impostazioni,
    worker: usize,
    annulla: &AtomicBool,
    mut avanzamento: impl FnMut(&[u8], usize),
) -> Result<Vec<u8>, String> {
    let info = leggi_info(ffmpeg, percorso)?;
    let totali = ((info.durata * PUNTI_AL_SECONDO).ceil() as usize).max(1);
    let dimensione = info.larghezza * info.altezza * 3;

    let gruppo_core = rayon::ThreadPoolBuilder::new()
        .num_threads(worker.max(1))
        .build()
        .map_err(|e| e.to_string())?;

    // ffmpeg: solo fotogrammi chiave, ripetuti per averne 2 al secondo
    let filtro = format!("fps={PUNTI_AL_SECONDO}");
    let mut lettore = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-skip_frame", "nokey", "-i"])
        .arg(percorso)
        .args(["-map", "0:v:0", "-vf", &filtro, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;
    let mut entrata = lettore.stdout.take().unwrap();

    // (riquadro, sicurezza) di ogni punto
    let mut trovati: Vec<Option<(Riquadro, f32)>> = Vec::new();
    let mut stati: Vec<u8> = Vec::new();
    let per_gruppo = (worker * 2).max(4);

    loop {
        if annulla.load(Ordering::Relaxed) {
            let _ = lettore.kill();
            let _ = lettore.wait();
            return Err("Analisi interrotta.".to_string());
        }

        // legge un gruppo di fotogrammi
        let mut gruppo: Vec<Fotogramma> = Vec::new();
        while gruppo.len() < per_gruppo {
            let mut foto = Fotogramma::nuovo(info.larghezza, info.altezza);
            if leggi_tutto(&mut entrata, &mut foto.dati[..dimensione]).is_err() {
                break; // fine del video
            }
            gruppo.push(foto);
        }
        if gruppo.is_empty() {
            break;
        }

        // i fotogrammi chiave ripetuti sono uguali al precedente: non serve rifare il rilevamento
        let mut uguale_al_precedente = vec![false; gruppo.len()];
        for i in 1..gruppo.len() {
            uguale_al_precedente[i] = gruppo[i].dati == gruppo[i - 1].dati;
        }
        let risultati: Vec<Option<(Riquadro, f32)>> = gruppo_core.install(|| {
            gruppo
                .par_iter()
                .enumerate()
                .map(|(i, f)| if uguale_al_precedente[i] { None } else { trova_display_con_sicurezza(f, imp) })
                .collect()
        });
        for (i, r) in risultati.into_iter().enumerate() {
            if uguale_al_precedente[i] {
                let precedente = *trovati.last().unwrap();
                trovati.push(precedente);
            } else {
                trovati.push(r);
            }
        }

        stati = stati_copertura(&trovati);
        avanzamento(&stati, totali.max(stati.len()));
    }
    let _ = lettore.wait();

    if trovati.is_empty() {
        return Err("Non riesco a leggere il video per l'analisi.".to_string());
    }
    Ok(stati)
}

/// Da (riquadro, sicurezza) a verde / arancione / rosso.
/// Un punto è arancione anche se il display "salta" lontano rispetto
/// ai punti prima e dopo (probabile riflesso).
pub fn stati_copertura(trovati: &[Option<(Riquadro, f32)>]) -> Vec<u8> {
    let mut stati = Vec::new();
    for i in 0..trovati.len() {
        let Some((riquadro, sicurezza)) = trovati[i] else {
            stati.push(NON_TROVATO);
            continue;
        };
        let mut stato = if sicurezza < SICUREZZA_MINIMA { INCERTO } else { TROVATO };

        // salto: lontano sia dal punto prima sia da quello dopo
        let prima = if i > 0 { trovati[i - 1] } else { None };
        let dopo = trovati.get(i + 1).copied().flatten();
        if let (Some((a, _)), Some((b, _))) = (prima, dopo) {
            if !vicini(a, riquadro) && !vicini(b, riquadro) {
                stato = INCERTO;
            }
        }
        stati.push(stato);
    }
    stati
}

/// Da rgb48le (2 byte per canale) a un Fotogramma a 8 bit, per il rilevamento:
/// di ogni canale tiene il byte "alto".
fn a_8_bit(grezzo: &[u8], larghezza: usize, altezza: usize) -> Fotogramma {
    let dati: Vec<u8> = grezzo.chunks_exact(2).map(|coppia| coppia[1]).collect();
    Fotogramma { larghezza, altezza, dati }
}

// ==========================================
// MINI ANTEPRIMA ANIMATA
// ==========================================

/// Quanti secondi dura l'anteprima animata, e quanti fotogrammi al secondo.
pub const SECONDI_ANIMAZIONE: f64 = 3.0;
pub const FOTOGRAMMI_ANIMAZIONE: f64 = 10.0;

/// Circa 3 secondi del risultato (già coperto), a partire da `posizione` (da 0 a 1).
/// Usa lo stesso rilevamento, la stessa regolazione e lo stesso stile dell'esportazione.
pub fn anteprima_animata(
    ffmpeg: &Path,
    percorso: &Path,
    posizione: f64,
    imp: &Impostazioni,
) -> Result<Vec<Fotogramma>, String> {
    let info = leggi_info(ffmpeg, percorso)?;
    let durata = SECONDI_ANIMAZIONE.min(info.durata);
    let inizio = (info.durata * posizione.clamp(0.0, 1.0)).min(info.durata - durata).max(0.0);
    let dimensione = info.larghezza * info.altezza * 3;

    let filtro = format!("fps={FOTOGRAMMI_ANIMAZIONE}");
    let uscita = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{inizio:.3}"), "-t", &format!("{durata:.3}"), "-i"])
        .arg(percorso)
        .args(["-map", "0:v:0", "-vf", &filtro, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;

    let mut fotogrammi: Vec<Fotogramma> = uscita
        .stdout
        .chunks_exact(dimensione)
        .map(|dati| Fotogramma { larghezza: info.larghezza, altezza: info.altezza, dati: dati.to_vec() })
        .collect();
    if fotogrammi.is_empty() {
        return Err("Non riesco a leggere questo punto del video.".to_string());
    }

    // cerca il display (in parallelo), poi copre in ordine come nell'esportazione
    let trovati: Vec<Option<Riquadro>> = fotogrammi.par_iter().map(|f| trova_display(f, imp)).collect();
    let mut inseguitore = Inseguitore::nuovo();
    for (foto, trovato) in fotogrammi.iter_mut().zip(trovati) {
        let riquadro = inseguitore.aggiorna(trovato);
        copri(foto, riquadro, imp);
    }
    Ok(fotogrammi)
}
