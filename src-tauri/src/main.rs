// Velocità: parte Rust dell'app.
// Qui ci sono i "comandi" che la finestra (ui/app.js) può chiamare.

// su Windows non apre la finestra nera del terminale
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use motore::rilevamento::{Impostazioni, Riquadro};
use motore::video::{self, Esito};

// diventa true quando l'utente preme "Interrompi"
static ANNULLA: AtomicBool = AtomicBool::new(false);

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

fn impostazioni(forza: u32, margine: f32, debug: bool) -> Impostazioni {
    Impostazioni {
        blocco_pixel: forza.clamp(4, 40),
        margine: margine.clamp(0.0, 0.5),
        debug,
    }
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
    zona: Option<Zona>,
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
async fn anteprima(percorso: String, posizione: f64, forza: u32, margine: f32) -> Result<RispostaAnteprima, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let imp = impostazioni(forza, margine, false);
        let a = video::anteprima(&percorso_ffmpeg(), Path::new(&percorso), posizione, &imp)?;
        let (larghezza, altezza) = (a.foto.larghezza, a.foto.altezza);

        // immagine più piccola per la finestra (più veloce da mostrare)
        let img = image::RgbImage::from_raw(larghezza as u32, altezza as u32, a.foto.dati)
            .ok_or("Errore interno con l'anteprima.")?;
        let img = image::DynamicImage::ImageRgb8(img);
        let img = if larghezza > 960 { img.thumbnail(960, 960) } else { img };
        let mut jpg: Vec<u8> = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut jpg), image::ImageFormat::Jpeg)
            .map_err(|e| e.to_string())?;
        let immagine = format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&jpg)
        );

        let zona = a.zona_coperta.map(|r| in_percentuale(r, larghezza, altezza));
        Ok(RispostaAnteprima { immagine, zona })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ==========================================
// ELABORAZIONE
// ==========================================

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
) -> Result<Risultato, String> {
    ANNULLA.store(false, Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let entrata = PathBuf::from(&percorso);
        let cartella_uscita = match cartella {
            Some(c) if !c.is_empty() => PathBuf::from(c),
            _ => entrata.parent().map(|p| p.to_path_buf()).unwrap_or_default(),
        };
        let uscita = nome_uscita(&entrata, &cartella_uscita);
        let imp = impostazioni(forza, margine, debug);
        let inizio = Instant::now();

        if video::e_immagine(&entrata) {
            let trovato = video::elabora_foto(&entrata, &uscita, &imp)?;
            if !trovato {
                let _ = std::fs::remove_file(&uscita);
                return Err("Non trovo il cruscotto arancione in questa foto.".to_string());
            }
            return Ok(Risultato {
                uscita: uscita.to_string_lossy().to_string(),
                interrotto: false,
                secondi: inizio.elapsed().as_secs_f64(),
                trovato: true,
            });
        }

        let worker = video::calcola_numero_worker(uso_cpu, video::cpu_totali());
        let mut ultimo_invio = Instant::now();
        let esito = video::elabora_video(
            &percorso_ffmpeg(),
            &entrata,
            &uscita,
            &imp,
            worker,
            &ANNULLA,
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
        .invoke_handler(tauri::generate_handler![info_file, anteprima, elabora, interrompi, cpu_totali])
        .run(tauri::generate_context!())
        .expect("errore all'avvio di Velocità");
}
