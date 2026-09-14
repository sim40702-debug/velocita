from unittest.mock import patch

import numpy as np

import speed_reader
from common import BBox


def test_read_speed_returns_none_if_ocr_unavailable():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = BBox(10, 10, 60, 40)
    with patch.object(speed_reader, "OCR_AVAILABLE", False):
        assert speed_reader.read_speed(frame, bbox) is None


def test_read_speed_parses_digits_from_ocr_output():
    frame = np.full((100, 100, 3), 200, dtype=np.uint8)
    bbox = BBox(10, 10, 60, 40)
    with patch.object(speed_reader, "OCR_AVAILABLE", True), \
         patch.object(speed_reader.pytesseract, "image_to_string", return_value=" 87 km/h\n", create=True):
        assert speed_reader.read_speed(frame, bbox) == 87


def test_read_speed_rejects_implausible_value():
    frame = np.full((100, 100, 3), 200, dtype=np.uint8)
    bbox = BBox(10, 10, 60, 40)
    with patch.object(speed_reader, "OCR_AVAILABLE", True), \
         patch.object(speed_reader.pytesseract, "image_to_string", return_value="9999", create=True):
        assert speed_reader.read_speed(frame, bbox) is None


def test_read_speed_returns_none_on_empty_bbox():
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    bbox = BBox(90, 90, 90, 90)  # bbox degenere, area zero
    with patch.object(speed_reader, "OCR_AVAILABLE", True):
        assert speed_reader.read_speed(frame, bbox) is None
