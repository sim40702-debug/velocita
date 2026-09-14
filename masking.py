"""Oscuramento del tachimetro: pixelizzazione, stile "censura YouTube".
Opera su una copia della ROI, mai sull'intero frame, per restare economico
su video lunghi.
"""
from __future__ import annotations

import cv2
import numpy as np

from common import BBox


def apply_pixelate(frame: np.ndarray, bbox: BBox, padding: int = 10, block_size: int = 12) -> np.ndarray:
    h, w = frame.shape[:2]
    padded = bbox.padded(padding, w, h)
    if padded.w <= 0 or padded.h <= 0:
        return frame
    x1, y1, x2, y2 = padded.x1, padded.y1, padded.x2, padded.y2

    roi = frame[y1:y2, x1:x2]
    roi_h, roi_w = roi.shape[:2]
    small_w = max(1, roi_w // max(1, block_size))
    small_h = max(1, roi_h // max(1, block_size))
    small = cv2.resize(roi, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
    frame[y1:y2, x1:x2] = cv2.resize(small, (roi_w, roi_h), interpolation=cv2.INTER_NEAREST)
    return frame
