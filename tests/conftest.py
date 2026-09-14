import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pytest


def make_synthetic_frame(width=640, height=480, box_x=200, box_y=40, box_w=180, box_h=60):
    """Frame grigio con un trapezio arancione (simula il display tachimetro)."""
    frame = np.full((height, width, 3), 60, dtype=np.uint8)  # sfondo grigio scuro
    import cv2
    # colore arancione in BGR (OpenCV usa BGR)
    orange_bgr = (20, 120, 230)
    pts = np.array([
        [box_x + 15, box_y],
        [box_x + box_w - 15, box_y],
        [box_x + box_w, box_y + box_h],
        [box_x, box_y + box_h],
    ], dtype=np.int32)
    cv2.fillPoly(frame, [pts], orange_bgr)
    return frame


@pytest.fixture
def synthetic_frame():
    return make_synthetic_frame()
