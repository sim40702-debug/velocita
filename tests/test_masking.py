import numpy as np

from common import BBox
from masking import apply_pixelate


def _pattern_frame():
    # pattern con variazione (non tinta unita) cosi' la pixelizzazione produce un cambiamento misurabile
    frame = np.zeros((200, 200, 3), dtype=np.uint8)
    frame[::2, :] = 255  # righe alternate bianco/nero dentro la ROI
    return frame


def test_pixelate_changes_only_roi():
    frame = _pattern_frame()
    bbox = BBox(50, 50, 120, 120)
    outside_before = frame[0:10, 0:10].copy()

    out = apply_pixelate(frame.copy(), bbox, padding=0, block_size=10)

    outside_after = out[0:10, 0:10]
    assert np.array_equal(outside_before, outside_after)

    roi_before = frame[50:120, 50:120]
    roi_after = out[50:120, 50:120]
    assert not np.array_equal(roi_before, roi_after)


def test_pixelate_reduces_detail():
    frame = _pattern_frame()
    bbox = BBox(50, 50, 120, 120)
    out = apply_pixelate(frame.copy(), bbox, padding=0, block_size=10)
    roi_after = out[50:120, 50:120]
    # dentro ogni blocco i pixel devono essere uniformi (niente più righe alternate)
    block = roi_after[0:10, 0:10]
    assert np.all(block == block[0, 0])


def test_pixelate_ignores_degenerate_bbox():
    frame = np.zeros((10, 10, 3), dtype=np.uint8)
    bbox = BBox(5, 5, 5, 5)  # area zero
    out = apply_pixelate(frame.copy(), bbox)
    assert np.array_equal(out, frame)
