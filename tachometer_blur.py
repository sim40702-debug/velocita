#!/usr/bin/env python3
"""CLI: pixelizza automaticamente il tachimetro in video di moto.

Esempi:
    python tachometer_blur.py input.mp4 output.mp4 --mode auto
    python tachometer_blur.py input.mp4 output.mp4 --mode manual
    python tachometer_blur.py input.mp4 preview.mp4 --preview 10
"""
from __future__ import annotations

import argparse
import sys

from video_processor import ProcessingError, process_video

SUPPORTED_EXTENSIONS = (".mp4", ".mov", ".mkv")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="tachometer_blur.py",
        description="Pixelizza automaticamente il tachimetro nei video moto (MP4/MOV/MKV).",
    )
    p.add_argument("input", help="Video di input (.mp4, .mov, .mkv)")
    p.add_argument("output", help="Video di output")

    p.add_argument("--mode", choices=["auto", "manual"], default="auto",
                    help="auto = rilevamento automatico ad ogni frame; "
                         "manual = disegni tu il rettangolo iniziale col mouse, poi viene tracciato "
                         "(usalo se auto non trova il display) (default: auto)")

    p.add_argument("--pixelate-block", type=int, default=12,
                    help="Dimensione blocco per la pixelizzazione, più alto = meno leggibile (default: 12)")
    p.add_argument("--mask-padding", type=int, default=10,
                    help="Pixel di margine aggiunti attorno al bbox rilevato (default: 10)")

    p.add_argument("--detect-scale", type=float, default=0.5,
                    help="Fattore di scala del frame per il rilevamento (0.4-1.0): più basso = più "
                         "veloce, meno preciso su display piccoli (default: 0.5)")
    p.add_argument("--persistence-frames", type=int, default=6,
                    help="Per quanti frame continuare a coprire l'ultima posizione nota se il "
                         "rilevamento fallisce momentaneamente (default: 6)")
    p.add_argument("--detect-interval", type=int, default=1,
                    help="Solo --mode manual: ogni quanti frame forzare una nuova detection di "
                         "fallback quando il tracker fallisce (default: 1)")
    p.add_argument("--track-fail-streak", type=int, default=3,
                    help="Solo --mode manual: fallimenti di tracking consecutivi prima di ri-rilevare (default: 3)")
    p.add_argument("--smoothing-alpha", type=float, default=0.3,
                    help="Alpha dello smoothing EMA, 0-1: più basso = più stabile ma più lag (default: 0.3)")
    p.add_argument("--tracker", choices=["csrt", "kcf"], default="kcf",
                    help="Solo --mode manual: algoritmo di tracking OpenCV: kcf è ~3x più veloce "
                         "(default), csrt è più preciso ma molto più lento")

    p.add_argument("--hue-min", type=int, default=0, help="Hue HSV minimo per il booster di colore (default: 0)")
    p.add_argument("--hue-max", type=int, default=30, help="Hue HSV massimo per il booster di colore (default: 30)")
    p.add_argument("--yolo-conf", type=float, default=0.5,
                    help="Soglia di confidenza se è presente un modello YOLO in models/ (default: 0.5)")
    p.add_argument("--model", default="models/tachometer.pt",
                    help="Percorso di un modello YOLO opzionale (default: models/tachometer.pt, se assente si usa l'euristica)")

    p.add_argument("--preview", type=float, default=0,
                    help="Elabora solo i primi N secondi (0 = intero video)")
    p.add_argument("--min-speed", type=int, default=0,
                    help="Oscura solo quando la velocità letta via OCR è >= questa soglia km/h "
                         "(0 = oscura sempre, default). Richiede pytesseract + Tesseract OCR installati. "
                         "Se la lettura fallisce, oscura comunque per sicurezza.")
    p.add_argument("--speed-check-interval", type=int, default=3,
                    help="Ogni quanti frame ri-leggere la velocità con OCR (default: 3, solo con --min-speed)")
    p.add_argument("--quiet", action="store_true", help="Disabilita la barra di progresso")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if not args.input.lower().endswith(SUPPORTED_EXTENSIONS):
        print(f"[!] Formato non supportato: {args.input} (attesi: {SUPPORTED_EXTENSIONS})", file=sys.stderr)
        return 1

    try:
        out = process_video(
            input_path=args.input,
            output_path=args.output,
            mode=args.mode,
            pixelate_block=args.pixelate_block,
            mask_padding=args.mask_padding,
            detect_scale=args.detect_scale,
            persistence_frames=args.persistence_frames,
            detect_interval=args.detect_interval,
            track_fail_streak=args.track_fail_streak,
            smoothing_alpha=args.smoothing_alpha,
            tracker_kind=args.tracker,
            yolo_conf=args.yolo_conf,
            model_path=args.model,
            hue_range=(args.hue_min, args.hue_max),
            preview_seconds=args.preview,
            min_speed_kmh=args.min_speed,
            speed_check_interval=args.speed_check_interval,
            quiet=args.quiet,
        )
    except ProcessingError as e:
        print(f"[ERRORE] {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\n[!] Interrotto dall'utente.", file=sys.stderr)
        return 130
    except Exception as e:  # errori imprevisti (OpenCV, I/O, ffmpeg) -> messaggio pulito invece di un traceback grezzo
        print(f"[ERRORE] {e}", file=sys.stderr)
        return 1

    print(f"[OK] Completato: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
