"""Lettura OCR del valore numerico mostrato nel display, per l'opzione
--min-speed (oscura solo sopra una soglia km/h). Dipendenza opzionale
(pytesseract + binario Tesseract): se non installata, min-speed non è
utilizzabile e viene segnalato con un errore chiaro invece di un ImportError
grezzo.
"""
from __future__ import annotations

import os
import re
import shutil
import sys

import cv2
import numpy as np

from common import BBox


def _find_tesseract_cmd() -> str | None:
    """Cerca prima un Tesseract bundlato dentro l'exe (PyInstaller estrae le
    risorse --add-data in sys._MEIPASS a runtime), altrimenti quello di sistema.
    """
    bundled_root = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))
    bundled_exe = os.path.join(bundled_root, "tesseract_bundle", "tesseract.exe")
    if os.path.exists(bundled_exe):
        return bundled_exe
    return shutil.which("tesseract")


try:
    import pytesseract
    _TESSERACT_CMD = _find_tesseract_cmd()
    if _TESSERACT_CMD:
        pytesseract.pytesseract.tesseract_cmd = _TESSERACT_CMD
        tessdata_dir = os.path.join(os.path.dirname(_TESSERACT_CMD), "tessdata")
        if os.path.isdir(tessdata_dir):
            os.environ["TESSDATA_PREFIX"] = tessdata_dir
    OCR_AVAILABLE = _TESSERACT_CMD is not None
except ImportError:
    pytesseract = None
    OCR_AVAILABLE = False

_DIGITS_RE = re.compile(r"\d+")


def _preprocess(roi: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    # Otsu: si adatta da solo al contrasto del display, robusto a luminosità variabile.
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return thresh


def read_speed(frame: np.ndarray, bbox: BBox) -> int | None:
    """Prova a leggere il numero (km/h) mostrato nel bbox. Ritorna None se
    l'OCR non è disponibile o non riesce a leggere un numero plausibile.
    """
    if not OCR_AVAILABLE:
        return None
    x1, y1, x2, y2 = max(0, bbox.x1), max(0, bbox.y1), bbox.x2, bbox.y2
    roi = frame[y1:y2, x1:x2]
    if roi.size == 0:
        return None

    processed = _preprocess(roi)
    config = "--psm 7 -c tessedit_char_whitelist=0123456789"
    try:
        text = pytesseract.image_to_string(processed, config=config)
    except Exception:
        return None

    match = _DIGITS_RE.search(text)
    if not match:
        return None
    value = int(match.group())
    if value > 400:  # oltre la velocità massima plausibile di una moto: lettura spuria
        return None
    return value
