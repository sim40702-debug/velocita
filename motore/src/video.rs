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

use crate::rilevamento::{copri, regione_centrale, trova_display, Fotogramma, Impostazioni, Inseguitore, Riquadro};

// Estensioni trattate come foto (tutte le altre vengono aperte come video)
pub const ESTENSIONI_IMMAGINI: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

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
    let zona_coperta = display.map(|r| regione_centrale(r, foto.larghezza, foto.altezza));
    Ok(Anteprima { foto, display, zona_coperta })
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
pub fn elabora_video(
    ffmpeg: &Path,
    entrata: &Path,
    uscita: &Path,
    imp: &Impostazioni,
    worker: usize,
    annulla: &AtomicBool,
    mut avanzamento: impl FnMut(u64, u64),
) -> Result<Esito, String> {
    let info = leggi_info(ffmpeg, entrata)?;
    let dimensione = info.larghezza * info.altezza * 3;

    // core da usare per il rilevamento (scelta "Uso CPU")
    let gruppo_core = rayon::ThreadPoolBuilder::new()
        .num_threads(worker)
        .build()
        .map_err(|e| e.to_string())?;

    // 1) ffmpeg che legge: ci dà i fotogrammi grezzi (RGB)
    let mut lettore = comando_ffmpeg(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(entrata)
        .args(["-map", "0:v:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Non riesco ad avviare ffmpeg: {e}"))?;

    // 2) ffmpeg che scrive: riceve i fotogrammi coperti e aggiunge l'audio
    let mut argomenti: Vec<String> = vec![
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "rawvideo", "-pix_fmt", "rgb24",
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
    argomenti.push("-i".into());
    argomenti.push(entrata.to_string_lossy().to_string());
    for a in ["-map", "0:v:0", "-map", "1:a?", "-map_metadata", "1"] {
        argomenti.push(a.into());
    }
    // qualità quasi uguale all'originale
    for a in ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"] {
        argomenti.push(a.into());
    }
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
        let mut gruppo: Vec<Fotogramma> = Vec::new();
        while gruppo.len() < fotogrammi_per_gruppo {
            let mut foto = Fotogramma::nuovo(info.larghezza, info.altezza);
            if leggi_tutto(&mut entrata_video, &mut foto.dati[..dimensione]).is_err() {
                break; // fine del video
            }
            gruppo.push(foto);
        }
        if gruppo.is_empty() {
            break;
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
        gruppo_core.install(|| {
            gruppo
                .par_iter_mut()
                .zip(da_usare.par_iter())
                .for_each(|(f, r)| copri(f, *r, imp));
        });

        // 4) manda i fotogrammi allo scrittore
        for f in &gruppo {
            if uscita_video.write_all(&f.dati).is_err() {
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
