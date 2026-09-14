"""Orchestrazione: legge il video frame-by-frame, applica detection+tracking+
masking, scrive l'output, rimuxa l'audio originale con ffmpeg se disponibile.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable

import cv2

from common import BBox
from detector import SpeedometerDetector
from masking import apply_pixelate
from speed_reader import OCR_AVAILABLE, read_speed
from tracker import SpeedometerTracker

try:
    from tqdm import tqdm
except ImportError:
    tqdm = None


class ProcessingError(RuntimeError):
    pass


class CancelledError(ProcessingError):
    """Sollevata quando l'elaborazione è stata interrotta dall'utente (cancel_event)."""


def _select_manual_roi(video_path: str) -> BBox:
    cap = cv2.VideoCapture(video_path)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ProcessingError("Impossibile leggere il primo frame per la selezione manuale.")

    window = "Seleziona il tachimetro (ENTER/SPAZIO per confermare, C per annullare)"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    try:
        # Porta la finestra in primo piano: senza, su Windows può aprirsi
        # dietro la finestra della GUI e sembrare che l'app non abbia fatto nulla.
        cv2.setWindowProperty(window, cv2.WND_PROP_TOPMOST, 1)
    except cv2.error:
        pass
    x, y, w, h = cv2.selectROI(window, frame, showCrosshair=True)
    cv2.destroyWindow(window)
    if w == 0 or h == 0:
        raise ProcessingError("Nessuna area selezionata: modalità manuale annullata.")
    return BBox.from_xywh(x, y, w, h)


def _open_writer(path: str, fourcc_str: str, fps: float, size: tuple[int, int]):
    fourcc = cv2.VideoWriter_fourcc(*fourcc_str)
    writer = cv2.VideoWriter(path, fourcc, fps, size)
    if not writer.isOpened():
        # fallback su mp4v, il codec più ampiamente disponibile senza codec pack extra
        writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    return writer


def _mux_audio(temp_video: str, original_source: str, final_out: str, quiet: bool) -> None:
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        if not quiet:
            print(
                "[!] ffmpeg non trovato: output senza audio. "
                "Installa ffmpeg e aggiungilo al PATH per preservare l'audio.",
                file=sys.stderr,
            )
        shutil.move(temp_video, final_out)
        return

    cmd = [
        ffmpeg_bin, "-y",
        "-i", temp_video,
        "-i", original_source,
        "-c:v", "copy",
        "-c:a", "aac",
        "-map", "0:v:0",
        "-map", "1:a:0?",
        "-shortest",
        final_out,
    ]
    result = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if result.returncode != 0 or not os.path.exists(final_out):
        if not quiet:
            print(
                f"[!] Muxing audio fallito ({result.stderr.decode(errors='ignore')[:200]}), "
                "salvo il video senza audio.",
                file=sys.stderr,
            )
        shutil.move(temp_video, final_out)
        return
    os.remove(temp_video)


def process_video(
    input_path: str,
    output_path: str,
    mode: str = "auto",
    pixelate_block: int = 12,
    mask_padding: int = 10,
    detect_interval: int = 1,
    track_fail_streak: int = 3,
    smoothing_alpha: float = 0.3,
    tracker_kind: str = "kcf",
    persistence_frames: int = 6,
    detect_scale: float = 0.5,
    yolo_conf: float = 0.5,
    model_path: str = "models/tachometer.pt",
    hue_range: tuple[int, int] = (0, 30),
    preview_seconds: float = 0.0,
    min_speed_kmh: int = 0,
    speed_check_interval: int = 3,
    quiet: bool = False,
    cancel_event: threading.Event | None = None,
    on_status: Callable[[str], None] | None = None,
) -> str:
    """Elabora `input_path` e scrive il risultato in `output_path`.

    `cancel_event`: se impostato (es. da un pulsante "Interrompi" nella GUI),
    l'elaborazione si ferma al frame in corso e viene sollevata CancelledError;
    il file video parziale/temporaneo viene ripulito, niente output a metà.

    `on_status`: callback opzionale invocata con una breve descrizione della
    fase corrente (apertura video, selezione ROI, ogni N% di avanzamento,
    muxing audio finale...), utile per mostrare un log leggibile in una GUI.
    """
    def status(msg: str) -> None:
        if on_status is not None:
            on_status(msg)

    def check_cancelled() -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise CancelledError("Elaborazione interrotta dall'utente.")

    if not os.path.exists(input_path):
        raise ProcessingError(f"File di input non trovato: {input_path}")
    if mode not in ("auto", "manual"):
        raise ProcessingError(f"Modalità non valida: {mode}")
    if min_speed_kmh > 0 and not OCR_AVAILABLE:
        raise ProcessingError(
            "--min-speed richiede pytesseract + il binario Tesseract OCR installati. "
            "Vedi il README per le istruzioni, oppure ometti --min-speed per oscurare sempre."
        )

    # --- Apertura del video sorgente e lettura dei suoi metadati (fps, risoluzione,
    # numero di frame) per poter creare un writer di output compatibile. ---
    status(f"Apertura video: {os.path.basename(input_path)}")
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ProcessingError(f"Impossibile aprire il video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # --preview N: elabora solo i primi N secondi invece dell'intero video.
    if preview_seconds > 0:
        total_frames = min(total_frames or int(preview_seconds * fps), int(preview_seconds * fps))

    # --mode manual: mostra il primo frame in una finestra OpenCV e lascia
    # all'utente disegnare col mouse il rettangolo del tachimetro; da lì in
    # poi il tracker parte direttamente da quel bbox, saltando il detector.
    manual_bbox: BBox | None = None
    if mode == "manual":
        status("In attesa della selezione manuale del tachimetro...")
        cap.release()
        manual_bbox = _select_manual_roi(input_path)
        cap = cv2.VideoCapture(input_path)

    # Detector: rilevamento per bordi/forma (o YOLO se presente un modello in
    # models/). In modalità auto gira ad ogni frame su un frame ridotto
    # (detect_scale) invece di appoggiarsi a un tracker OpenCV lento: più
    # veloce e più robusto ai movimenti bruschi (curve, vibrazioni). In
    # modalità manuale invece il bbox iniziale è scelto dall'utente, quindi
    # serve un vero tracker per seguirlo (il detector euristico non lo
    # "riconoscerebbe" necessariamente). Entrambe le modalità coprono
    # l'ultima posizione nota per `persistence_frames` se il rilevamento
    # fallisce per un istante, invece di lasciare scoperto il tachimetro.
    detector = SpeedometerDetector(
        hue_range=hue_range, yolo_conf=yolo_conf, model_path=model_path, detect_scale=detect_scale
    )
    tracker = SpeedometerTracker(
        detector,
        tracker_kind=tracker_kind,
        detect_interval=detect_interval,
        track_fail_streak=track_fail_streak,
        smoothing_alpha=smoothing_alpha,
        persistence_frames=persistence_frames,
    )
    if mode == "auto":
        tracker.init_auto()

    # Si scrive prima su un file temporaneo (solo video, senza audio) e alla
    # fine lo si rimuxa con l'audio originale via ffmpeg: evita di dover
    # riaprire/ricodificare tutto se il muxing fallisse a metà.
    os.makedirs(os.path.dirname(os.path.abspath(output_path)) or ".", exist_ok=True)
    tmp_fd, temp_video = tempfile.mkstemp(suffix=".mp4", dir=os.path.dirname(os.path.abspath(output_path)) or ".")
    os.close(tmp_fd)
    writer = _open_writer(temp_video, "mp4v", fps, (frame_w, frame_h))
    if not writer.isOpened():
        cap.release()
        raise ProcessingError("Impossibile creare il file video di output (codec non disponibile).")

    progress = None
    if not quiet and tqdm is not None and total_frames > 0:
        progress = tqdm(total=total_frames, unit="frame", desc="Elaborazione")

    status(f"Elaborazione di {total_frames or '?'} frame in corso...")

    def _format_eta(seconds: float) -> str:
        seconds = int(seconds)
        if seconds < 60:
            return f"{seconds}s"
        minutes, seconds = divmod(seconds, 60)
        if minutes < 60:
            return f"{minutes}m {seconds}s"
        hours, minutes = divmod(minutes, 60)
        return f"{hours}h {minutes}m"

    processing_start = time.perf_counter()
    frame_idx = 0
    detections_lost_streak = 0
    # fail-safe: finché non si legge un valore valido, si presume sopra soglia (oscura).
    last_known_speed: int | None = None
    cancelled = False
    try:
        while True:
            # Permette di interrompere l'elaborazione dal pulsante "Interrompi"
            # della GUI (o da Ctrl+C in CLI): si esce puliti dal loop invece di
            # lasciare un file temporaneo a metà scrittura indefinitamente.
            check_cancelled()

            if total_frames > 0 and frame_idx >= total_frames:
                break
            ok, frame = cap.read()
            if not ok:
                break

            # Frame 0 in modalità manuale: aggancia subito il tracker al
            # rettangolo scelto dall'utente invece di passare dal detector.
            if frame_idx == 0 and manual_bbox is not None:
                tracker.init_with_bbox(frame, manual_bbox)
                bbox = manual_bbox
            else:
                bbox = tracker.update(frame)

            if bbox is not None:
                detections_lost_streak = 0
                should_mask = True
                # Gate opzionale sulla velocità: legge il numero sul display via
                # OCR ogni `speed_check_interval` frame (costoso, non ad ogni
                # frame) e oscura solo se l'ultimo valore letto è >= soglia.
                # Se l'OCR non ha ancora letto nulla di valido, si oscura
                # comunque per sicurezza (fail-safe: in dubbio, si nasconde).
                if min_speed_kmh > 0:
                    if frame_idx % max(1, speed_check_interval) == 0:
                        read = read_speed(frame, bbox)
                        if read is not None:
                            last_known_speed = read
                    should_mask = last_known_speed is None or last_known_speed >= min_speed_kmh
                if should_mask:
                    apply_pixelate(frame, bbox, padding=mask_padding, block_size=pixelate_block)
            else:
                # Tachimetro non rilevato in questo frame: viene scritto senza
                # maschera (si preferisce non nascondere zone a caso del video).
                detections_lost_streak += 1

            writer.write(frame)
            frame_idx += 1

            if progress is not None:
                progress.update(1)
            elif not quiet and total_frames > 0 and frame_idx % max(1, total_frames // 10) == 0:
                pct = int(frame_idx / total_frames * 100)
                print(f"[+] {pct}% ({frame_idx}/{total_frames} frame)")
            if total_frames > 0 and frame_idx % max(1, total_frames // 20) == 0:
                # Stima il tempo rimanente dal ritmo (fps) osservato finora,
                # non da un valore fisso: si adatta all'hardware e a quanto
                # il video è "difficile" da tracciare (ri-detection frequenti
                # costano di più di semplice tracking).
                elapsed = time.perf_counter() - processing_start
                fps_actual = frame_idx / elapsed if elapsed > 0 else 0
                remaining_frames = total_frames - frame_idx
                eta = _format_eta(remaining_frames / fps_actual) if fps_actual > 0 else "?"
                pct = int(frame_idx / total_frames * 100)
                status(f"{pct}% ({frame_idx}/{total_frames} frame, {fps_actual:.1f} fps) - restano circa {eta}")
    except CancelledError:
        cancelled = True
    finally:
        if progress is not None:
            progress.close()
        cap.release()
        writer.release()

    if cancelled:
        # Scarta il video parziale: meglio nessun output che un file a metà
        # senza avviso, che l'utente potrebbe scambiare per completo.
        status("Interrotto: rimozione del file temporaneo parziale...")
        if os.path.exists(temp_video):
            os.remove(temp_video)
        raise CancelledError("Elaborazione interrotta dall'utente.")

    if not quiet and detections_lost_streak > 0 and frame_idx > 0 and detections_lost_streak == frame_idx:
        print(
            "[!] Il tachimetro non è mai stato rilevato in questo video. "
            "Prova --mode manual per selezionarlo a mano.",
            file=sys.stderr,
        )

    status("Sincronizzazione audio con il video originale...")
    _mux_audio(temp_video, input_path, output_path, quiet)
    status("Completato.")
    return output_path
