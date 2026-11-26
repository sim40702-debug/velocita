// Velocità: parte Rust dell'app.
// Qui ci sono i "comandi" che la finestra (ui/app.js) può chiamare.

// su Windows non apre la finestra nera del terminale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use motore::rilevamento::{
    copri_zona, ColoreDisplay, Fotogramma, Impostazioni, Momento, Regolazione, Riquadro, Stile, ZonaFissa,
};
use motore::video::{self, Esito};

// diventa true quando l'utente preme "Interrompi"
static ANNULLA: AtomicBool = AtomicBool::new(false);

// l'analisi per la striscia colorata in corso (per poterla fermare)
static ANALISI_IN_CORSO: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

// dove sta di solito il display in ogni video (lo trova l'analisi):
// (percorso del video, scelte del display, posizione)
static CASE: Mutex<Vec<(String, String, Riquadro)>> = Mutex::new(Vec::new());

// ==========================================
// FFMPEG INCLUSO NELL'APP
// ==========================================

/// ffmpeg sta accanto al programma (lo mette Tauri). Se non c'è, usa quello installato.
fn percorso_ffmpeg() -> PathBuf {
    let nome = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    if let Ok(programma) = std::env::current_exe() {
        if let Some(cartella) = programma.parent() {
            let vicino = cartella.join(nome);
            if vicino.exists() {
                return vicino;
            }
        }
    }
    PathBuf::from(nome)
}

/// Le scelte del display che arrivano dalla finestra.
#[derive(Deserialize)]
struct SceltaDisplay {
    /// "auto", "giorno" o "notte"
    momento: String,
    /// "arancione", "rosso", "giallo", "verde", "blu", "bianco" o "video"
    colore: String,
    /// il colore preso dal video (solo con "video")
    rgb: [u8; 3],
    /// "basso" o "ovunque": dove cercare il display
    posizione: String,
    /// zona spostata o ingrandita a mano (manca = nessuna regolazione)
    regolazione: Option<RegolazioneFinestra>,
    /// come coprire: "pixel", "sfocatura", "nero" o "tinta" (manca = pixel)
    stile: Option<String>,
    /// true = copre anche le facce (manca = no)
    volti: Option<bool>,
}

/// La regolazione della zona come arriva dalla finestra.
#[derive(Deserialize)]
struct RegolazioneFinestra {
    dx: f32,
    dy: f32,
    larghezza: f32,
    altezza: f32,
}

/// Una zona disegnata a mano per un pezzo del video, come arriva dalla finestra
/// (secondi e percentuali da 0 a 1).
#[derive(Deserialize)]
struct ZonaFissaFinestra {
    inizio: f64,
    fine: f64,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    /// true = segue l'oggetto che si muove (manca = zona ferma)
    segui: Option<bool>,
}

fn zone_fisse(lista: Option<Vec<ZonaFissaFinestra>>) -> Vec<ZonaFissa> {
    let mut zone = Vec::new();
    for z in lista.unwrap_or_default() {
        let segui = z.segui.unwrap_or(false);
        zone.push(ZonaFissa { inizio: z.inizio, fine: z.fine, x: z.x, y: z.y, w: z.w, h: z.h, segui });
    }
    zone
}

fn impostazioni(forza: u32, margine: f32, debug: bool, display: &SceltaDisplay) -> Impostazioni {
    Impostazioni {
        blocco_pixel: forza.clamp(4, 40),
        margine: margine.clamp(0.0, 0.5),
        debug,
        momento: Momento::da_nome(&display.momento),
        colore: ColoreDisplay::da_nome(&display.colore, display.rgb),
        ovunque: display.posizione == "ovunque",
        stile: Stile::da_nome(display.stile.as_deref().unwrap_or("pixel")),
        volti: display.volti.unwrap_or(false),
        regolazione: match &display.regolazione {
            Some(r) => Regolazione { dx: r.dx, dy: r.dy, larghezza: r.larghezza, altezza: r.altezza },
            None => Regolazione::nessuna(),
        },
        casa: None,
    }
}

// ==========================================
// DOVE STA DI SOLITO IL DISPLAY
// ==========================================

/// Le scelte che cambiano dove viene trovato il display (colore, posizione,
/// giorno/notte): se cambiano, la posizione abituale va ricalcolata.
fn chiave_display(display: &SceltaDisplay) -> String {
    format!("{} {} {:?} {}", display.colore, display.posizione, display.rgb, display.momento)
}

/// Si segna dove sta di solito il display in questo video.
fn salva_casa(percorso: &str, display: &SceltaDisplay, casa: Option<Riquadro>) {
    if let Ok(mut case) = CASE.lock() {
        // toglie quella vecchia di questo video
        case.retain(|(p, _, _)| p != percorso);
        if let Some(casa) = casa {
            case.push((percorso.to_string(), chiave_display(display), casa));
        }
    }
}

/// Dove sta di solito il display in questo video (None = non si sa ancora).
fn casa_di(percorso: &str, display: &SceltaDisplay) -> Option<Riquadro> {
    let chiave = chiave_display(display);
    let case = CASE.lock().ok()?;
    for (p, k, casa) in case.iter() {
        if p == percorso && *k == chiave {
            return Some(*casa);
        }
    }
    None
}

// ==========================================
// INFORMAZIONI SUL FILE
// ==========================================

#[derive(Serialize)]
struct InfoFile {
    nome: String,
    cartella: String,
    foto: bool,
    durata: f64,
}

#[tauri::command]
async fn info_file(percorso: String) -> Result<InfoFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = Path::new(&percorso);
        let nome = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let cartella = p.parent().map(|c| c.to_string_lossy().to_string()).unwrap_or_default();
        if video::e_immagine(p) {
            return Ok(InfoFile { nome, cartella, foto: true, durata: 0.0 });
        }
        let info = video::leggi_info(&percorso_ffmpeg(), p)?;
        Ok(InfoFile { nome, cartella, foto: false, durata: info.durata })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==========================================
// ANTEPRIMA
// ==========================================

/// Un riquadro in percentuale (da 0 a 1), così la finestra lo disegna
/// sopra l'immagine qualunque sia la sua dimensione.
#[derive(Serialize)]
struct Zona {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Serialize)]
struct RispostaAnteprima {
    immagine: String,
    /// la stessa immagine già coperta (per il bottone "Risultato")
    risultato: String,
    /// la zona che verrà coperta (con la regolazione)
    zona: Option<Zona>,
    /// la zona automatica, senza regolazione (serve per regolarla)
    zona_base: Option<Zona>,
    /// "giorno" o "notte": quello usato per questo fotogramma
    momento: String,
    /// true se qui vale una zona disegnata a mano
    fissa: bool,
    /// le altre zone coperte: facce e oggetti da seguire
    altre: Vec<Zona>,
}

/// Fotogramma -> immagine JPEG per la finestra ("data:image/jpeg;base64,...").
/// La rimpicciolisce se è più grande di `massimo` pixel (più veloce da mostrare).
fn in_jpeg(foto: Fotogramma, massimo: u32) -> Result<String, String> {
    let (larghezza, altezza) = (foto.larghezza as u32, foto.altezza as u32);
    let img = image::RgbImage::from_raw(larghezza, altezza, foto.dati).ok_or("Errore interno con l'anteprima.")?;
    let img = image::DynamicImage::ImageRgb8(img);
    let img = if larghezza > massimo || altezza > massimo { img.thumbnail(massimo, massimo) } else { img };
    let mut jpg: Vec<u8> = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&jpg)))
}

/// Mini anteprima animata: circa 3 secondi del risultato, come immagini JPEG.
#[tauri::command]
async fn anteprima_animata(
    percorso: String,
    posizione: f64,
    forza: u32,
    margine: f32,
    display: SceltaDisplay,
    fisse: Option<Vec<ZonaFissaFinestra>>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut imp = impostazioni(forza, margine, false, &display);
        imp.casa = casa_di(&percorso, &display);
        let zone = zone_fisse(fisse);
        let fotogrammi = video::anteprima_animata(&percorso_ffmpeg(), Path::new(&percorso), posizione, &imp, &zone)?;
        let mut immagini = Vec::new();
        for foto in fotogrammi {
            immagini.push(in_jpeg(foto, 720)?);
        }
        Ok(immagini)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Miniature per la linea del tempo e per la lista (immagini JPEG piccole).
#[tauri::command]
async fn miniature(percorso: String, quante: usize, altezza: usize) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let fotogrammi = video::miniature(&percorso_ffmpeg(), Path::new(&percorso), quante, altezza)?;
        let mut immagini = Vec::new();
        for foto in fotogrammi {
            immagini.push(in_jpeg(foto, 10_000)?);
        }
        Ok(immagini)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Da file e cartelle a una lista di file: le cartelle diventano i video e le
/// foto che contengono (in ordine di nome). I file già coperti (_speed_blur) si saltano.
#[tauri::command]
fn espandi_percorsi(percorsi: Vec<String>) -> Vec<String> {
    let mut risultato = Vec::new();
    for percorso in percorsi {
        let p = PathBuf::from(&percorso);
        if p.is_dir() {
            let mut dentro: Vec<PathBuf> = match std::fs::read_dir(&p) {
                Ok(voci) => voci.filter_map(|v| v.ok()).map(|v| v.path()).collect(),
                Err(_) => Vec::new(),
            };
            dentro.sort();
            for f in dentro {
                let nome = f.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                if f.is_file() && video::e_supportato(&f) && !nome.contains("_speed_blur") && !nome.starts_with('.') {
                    risultato.push(f.to_string_lossy().to_string());
                }
            }
        } else {
            risultato.push(percorso);
        }
    }
    risultato
}

/// CARTELLA SORVEGLIATA: i video della cartella che non sono ancora stati coperti.
/// - si saltano i file appena cambiati (forse si stanno ancora copiando)
/// - un video è già fatto se nella cartella di uscita c'è "nome_speed_blur..."
#[tauri::command]
fn da_fare_in_cartella(cartella: String, uscita: Option<String>) -> Vec<String> {
    let cartella_uscita = match uscita {
        Some(u) if !u.is_empty() => PathBuf::from(u),
        _ => PathBuf::from(&cartella),
    };
    // i nomi dei file già finiti (per controllare velocemente)
    let finiti: Vec<String> = match std::fs::read_dir(&cartella_uscita) {
        Ok(voci) => voci.filter_map(|v| v.ok()).map(|v| v.file_name().to_string_lossy().to_string()).collect(),
        Err(_) => Vec::new(),
    };
    let mut da_fare = Vec::new();
    for percorso in espandi_percorsi(vec![cartella]) {
        let p = Path::new(&percorso);
        let nome = p.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let gia_fatto = finiti.iter().any(|f| f.starts_with(&format!("{nome}_speed_blur")));
        // cambiato negli ultimi 10 secondi: forse si sta ancora copiando
        let fermo = match std::fs::metadata(p).and_then(|m| m.modified()) {
            Ok(data) => data.elapsed().map(|t| t.as_secs() >= 10).unwrap_or(false),
            Err(_) => false,
        };
        if !gia_fatto && fermo {
            da_fare.push(percorso);
        }
    }
    da_fare
}

fn in_percentuale(r: Riquadro, larghezza: usize, altezza: usize) -> Zona {
    Zona {
        x: r.x as f64 / larghezza as f64,
        y: r.y as f64 / altezza as f64,
        w: r.w as f64 / larghezza as f64,
        h: r.h as f64 / altezza as f64,
    }
}

#[tauri::command]
async fn anteprima(
    percorso: String,
    posizione: f64,
    forza: u32,
    margine: f32,
    display: SceltaDisplay,
    fisse: Option<Vec<ZonaFissaFinestra>>,
) -> Result<RispostaAnteprima, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut imp = impostazioni(forza, margine, false, &display);
        imp.casa = casa_di(&percorso, &display);
        let zone = zone_fisse(fisse);
        let a = video::anteprima(&percorso_ffmpeg(), Path::new(&percorso), posizione, &imp, &zone)?;
        let (larghezza, altezza) = (a.foto.larghezza, a.foto.altezza);

        // una copia coperta, come sarà nel video finito
        let mut coperta = Fotogramma { larghezza, altezza, dati: a.foto.dati.clone() };
        if let Some(zona) = a.zona_coperta {
            copri_zona(&mut coperta, zona, &imp);
        }
        for zona in &a.altre {
            copri_zona(&mut coperta, *zona, &imp);
        }
        let altre: Vec<Zona> = a.altre.iter().map(|r| in_percentuale(*r, larghezza, altezza)).collect();
        let risultato = in_jpeg(coperta, 960)?;
        let immagine = in_jpeg(a.foto, 960)?;

        let zona = a.zona_coperta.map(|r| in_percentuale(r, larghezza, altezza));
        let zona_base = a.zona_base.map(|r| in_percentuale(r, larghezza, altezza));
        let momento = if a.momento == Momento::Giorno { "giorno" } else { "notte" };
        Ok(RispostaAnteprima { immagine, risultato, zona, zona_base, momento: momento.to_string(), fissa: a.fissa, altre })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==========================================
// ELABORAZIONE
// ==========================================

// ==========================================
// ANALISI PER LA STRISCIA COLORATA
// ==========================================

#[derive(Serialize, Clone)]
struct Copertura {
    /// il video analizzato (la finestra ignora i risultati di altri video)
    percorso: String,
    /// un numero per punto: 0 rosso, 1 arancione, 2 verde
    stati: Vec<u8>,
    /// quanti punti avrà alla fine
    totali: usize,
    finito: bool,
}

/// Ferma l'analisi in corso, se c'è.
fn ferma_analisi() {
    if let Ok(mut in_corso) = ANALISI_IN_CORSO.lock() {
        if let Some(annulla) = in_corso.take() {
            annulla.store(true, Ordering::Relaxed);
        }
    }
}

/// Controlla velocemente il video in sottofondo e manda alla finestra
/// i risultati mano a mano (evento "copertura").
#[tauri::command]
async fn analizza(app: AppHandle, percorso: String, display: SceltaDisplay) -> Result<(), String> {
    // ferma quella di prima e si segna come quella in corso
    ferma_analisi();
    let annulla = Arc::new(AtomicBool::new(false));
    if let Ok(mut in_corso) = ANALISI_IN_CORSO.lock() {
        *in_corso = Some(annulla.clone());
    }

    tauri::async_runtime::spawn_blocking(move || {
        let imp = impostazioni(10, 0.15, false, &display);
        // usa metà del processore: l'app resta veloce mentre analizza
        let worker = video::calcola_numero_worker(0.5, video::cpu_totali());
        let mut ultimo_invio = Instant::now();
        let risultato = video::analizza_copertura(
            &percorso_ffmpeg(),
            Path::new(&percorso),
            &imp,
            worker,
            &annulla,
            |stati, totali| {
                // al massimo 5 volte al secondo
                if ultimo_invio.elapsed().as_millis() < 200 {
                    return;
                }
                ultimo_invio = Instant::now();
                let _ = app.emit(
                    "copertura",
                    Copertura { percorso: percorso.clone(), stati: stati.to_vec(), totali, finito: false },
                );
            },
        );
        match risultato {
            Ok((stati, casa)) => {
                salva_casa(&percorso, &display, casa);
                let totali = stati.len();
                let _ = app.emit("copertura", Copertura { percorso: percorso.clone(), stati, totali, finito: true });
                Ok(())
            }
            // fermata perché è partita un'altra analisi: non è un errore
            Err(_) if annulla.load(Ordering::Relaxed) => Ok(()),
            Err(e) => Err(e),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==========================================
// TIENI SVEGLIO IL COMPUTER
// ==========================================

/// Finché esiste, il computer non va in stop (lo schermo invece può spegnersi).
/// Quando sparisce (alla fine dell'esportazione) tutto torna normale.
struct Sveglio {
    // sul Mac: il programma "caffeinate" che tiene sveglio il Mac
    caffeinate: Option<std::process::Child>,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(stato: u32) -> u32;
}

impl Sveglio {
    fn nuovo() -> Sveglio {
        #[cfg(windows)]
        unsafe {
            // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
            SetThreadExecutionState(0x8000_0000 | 0x0000_0001);
        }
        Sveglio { caffeinate: avvia_caffeinate() }
    }
}

/// Sul Mac: avvia "caffeinate".
/// -i = niente stop, -w = si ferma da solo se Velocità si chiude
#[cfg(target_os = "macos")]
fn avvia_caffeinate() -> Option<std::process::Child> {
    let pid = std::process::id().to_string();
    std::process::Command::new("caffeinate").args(["-i", "-w", &pid]).spawn().ok()
}

/// Su Windows e Linux "caffeinate" non c'è.
#[cfg(not(target_os = "macos"))]
fn avvia_caffeinate() -> Option<std::process::Child> {
    None
}

impl Drop for Sveglio {
    fn drop(&mut self) {
        if let Some(figlio) = self.caffeinate.as_mut() {
            let _ = figlio.kill();
            let _ = figlio.wait();
        }
        #[cfg(windows)]
        unsafe {
            SetThreadExecutionState(0x8000_0000); // torna normale
        }
    }
}

/// Il file finito prende la data del file originale
/// (così in DaVinci e in Foto i video restano in ordine).
fn copia_data(entrata: &Path, uscita: &Path) {
    let data = match std::fs::metadata(entrata).and_then(|m| m.modified()) {
        Ok(d) => d,
        Err(_) => return,
    };
    if let Ok(file) = std::fs::OpenOptions::new().write(true).open(uscita) {
        let _ = file.set_modified(data);
    }
}

#[derive(Serialize, Clone)]
struct Avanzamento {
    fatti: u64,
    totali: u64,
    secondi_mancanti: f64,
}

#[derive(Serialize)]
struct Risultato {
    uscita: String,
    interrotto: bool,
    secondi: f64,
    /// false se il cruscotto non è mai stato trovato
    trovato: bool,
}

/// Nome del file finale: moto_speed_blur.mp4, senza sovrascrivere file già esistenti.
fn nome_uscita(entrata: &Path, cartella: &Path) -> PathBuf {
    let nome = entrata.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or("video".into());
    let estensione = if video::e_immagine(entrata) {
        entrata.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or("png".into())
    } else {
        "mp4".to_string()
    };
    let mut percorso = cartella.join(format!("{nome}_speed_blur.{estensione}"));
    let mut numero = 2;
    while percorso.exists() {
        percorso = cartella.join(format!("{nome}_speed_blur ({numero}).{estensione}"));
        numero += 1;
    }
    percorso
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn elabora(
    app: AppHandle,
    percorso: String,
    cartella: Option<String>,
    uso_cpu: f32,
    forza: u32,
    margine: f32,
    debug: bool,
    display: SceltaDisplay,
    taglio: Option<[f64; 2]>,
    fisse: Option<Vec<ZonaFissaFinestra>>,
) -> Result<Risultato, String> {
    ANNULLA.store(false, Ordering::Relaxed);
    ferma_analisi(); // il processore serve tutto all'esportazione
    tauri::async_runtime::spawn_blocking(move || {
        let entrata = PathBuf::from(&percorso);
        let cartella_uscita = match cartella {
            Some(c) if !c.is_empty() => PathBuf::from(c),
            _ => entrata.parent().map(|p| p.to_path_buf()).unwrap_or_default(),
        };
        let uscita = nome_uscita(&entrata, &cartella_uscita);
        let mut imp = impostazioni(forza, margine, debug, &display);
        imp.casa = casa_di(&percorso, &display);
        let zone = zone_fisse(fisse);
        let inizio = Instant::now();
        // il computer resta sveglio finché questa funzione non finisce
        let _sveglio = Sveglio::nuovo();

        if video::e_immagine(&entrata) {
            let trovato = video::elabora_foto(&entrata, &uscita, &imp)?;
            if !trovato {
                let _ = std::fs::remove_file(&uscita);
                return Err("Non trovo il display in questa foto.".to_string());
            }
            copia_data(&entrata, &uscita);
            return Ok(Risultato {
                uscita: uscita.to_string_lossy().to_string(),
                interrotto: false,
                secondi: inizio.elapsed().as_secs_f64(),
                trovato: true,
            });
        }

        let worker = video::calcola_numero_worker(uso_cpu, video::cpu_totali());

        // video mai analizzato: prima un controllo veloce per sapere
        // dove sta di solito il display (così un lampione non lo "ruba")
        if imp.casa.is_none() {
            if let Ok((_stati, casa)) =
                video::analizza_copertura(&percorso_ffmpeg(), &entrata, &imp, worker, &ANNULLA, |_, _| {})
            {
                salva_casa(&percorso, &display, casa);
                imp.casa = casa;
            }
        }

        let mut ultimo_invio = Instant::now();
        let esito = video::elabora_video(
            &percorso_ffmpeg(),
            &entrata,
            &uscita,
            &imp,
            worker,
            &ANNULLA,
            taglio.map(|t| (t[0], t[1])),
            &zone,
            |fatti, totali| {
                // aggiorna la barra al massimo 10 volte al secondo
                if ultimo_invio.elapsed().as_millis() < 100 && fatti < totali {
                    return;
                }
                ultimo_invio = Instant::now();
                let passati = inizio.elapsed().as_secs_f64();
                let secondi_mancanti = if fatti > 0 {
                    passati / fatti as f64 * (totali - fatti) as f64
                } else {
                    0.0
                };
                let _ = app.emit("avanzamento", Avanzamento { fatti, totali, secondi_mancanti });
            },
        )?;

        let (interrotto, trovato) = match esito {
            Esito::Finito { coperti } => (false, coperti > 0),
            Esito::Interrotto => (true, true),
        };
        if !interrotto {
            copia_data(&entrata, &uscita);
        }
        Ok(Risultato {
            uscita: uscita.to_string_lossy().to_string(),
            interrotto,
            secondi: inizio.elapsed().as_secs_f64(),
            trovato,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn interrompi() {
    ANNULLA.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn cpu_totali() -> usize {
    video::cpu_totali()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            info_file,
            anteprima,
            anteprima_animata,
            elabora,
            interrompi,
            cpu_totali,
            analizza,
            espandi_percorsi,
            da_fare_in_cartella,
            miniature
        ])
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Velocità");
}
