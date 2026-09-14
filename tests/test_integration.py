import os
import threading
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from conftest import make_synthetic_frame

import video_processor
from video_processor import CancelledError, ProcessingError, process_video


@pytest.fixture
def synthetic_video(tmp_path):
    path = str(tmp_path / "synthetic_input.mp4")
    fps, seconds, w, h = 10, 3, 320, 240
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    for i in range(fps * seconds):
        frame = make_synthetic_frame(width=w, height=h, box_x=40 + i, box_y=20, box_w=120, box_h=50)
        writer.write(frame)
    writer.release()
    return path, fps, seconds, w, h


def test_end_to_end_auto_pixelate(synthetic_video, tmp_path):
    in_path, fps, seconds, w, h = synthetic_video
    out_path = str(tmp_path / "out.mp4")

    process_video(in_path, out_path, mode="auto", quiet=True)

    assert os.path.exists(out_path)
    cap = cv2.VideoCapture(out_path)
    assert cap.isOpened()
    out_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    assert out_frame_count > 0

    ok, first_frame = cap.read()
    cap.release()
    assert ok
    assert first_frame.shape[:2] == (h, w)


def test_preview_truncates_output(synthetic_video, tmp_path):
    in_path, fps, seconds, w, h = synthetic_video
    out_path = str(tmp_path / "preview.mp4")

    process_video(in_path, out_path, mode="auto", preview_seconds=1, quiet=True)

    cap = cv2.VideoCapture(out_path)
    out_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    cap.release()
    # ~1 secondo a `fps` frame/sec, con un po' di tolleranza sul conteggio del writer
    assert 0 < out_frame_count <= fps + 2


def test_cancel_event_stops_processing_and_cleans_up(synthetic_video, tmp_path):
    in_path, *_ = synthetic_video
    out_path = str(tmp_path / "out.mp4")
    cancel_event = threading.Event()
    cancel_event.set()  # già impostato: deve fermarsi al primissimo frame

    with pytest.raises(CancelledError):
        process_video(in_path, out_path, quiet=True, cancel_event=cancel_event)

    # nessun output (né finale né temporaneo) deve restare sul disco
    assert not os.path.exists(out_path)
    leftovers = [f for f in os.listdir(tmp_path) if f != os.path.basename(in_path)]
    assert leftovers == []


def test_on_status_callback_receives_updates(synthetic_video, tmp_path):
    in_path, *_ = synthetic_video
    out_path = str(tmp_path / "out.mp4")
    messages = []

    process_video(in_path, out_path, quiet=True, on_status=messages.append)

    assert any("Apertura video" in m for m in messages)
    assert any("Completato" in m for m in messages)


def test_min_speed_requires_ocr_available(synthetic_video, tmp_path):
    in_path, *_ = synthetic_video
    out_path = str(tmp_path / "out.mp4")
    with patch.object(video_processor, "OCR_AVAILABLE", False):
        with pytest.raises(ProcessingError):
            process_video(in_path, out_path, min_speed_kmh=50, quiet=True)


def _frame_at(path: str, index: int):
    cap = cv2.VideoCapture(path)
    frame = None
    for i in range(index + 1):
        ok, frame = cap.read()
        if not ok:
            frame = None
            break
    cap.release()
    return frame


def test_min_speed_threshold_controls_pixelation(synthetic_video, tmp_path):
    """Confronta l'output con soglia superata vs non superata sullo stesso
    frame: solo sopra soglia la ROI del tachimetro deve risultare alterata
    (pixelizzata) dal resto del frame, che è identico in entrambi i casi
    (stesso video sorgente, stessa compressione mp4v)."""
    in_path, fps, seconds, w, h = synthetic_video

    out_below = str(tmp_path / "below.mp4")
    with patch.object(video_processor, "OCR_AVAILABLE", True), \
         patch.object(video_processor, "read_speed", return_value=10):  # sempre sotto la soglia 50
        process_video(in_path, out_below, mode="auto", min_speed_kmh=50, quiet=True)

    out_above = str(tmp_path / "above.mp4")
    with patch.object(video_processor, "OCR_AVAILABLE", True), \
         patch.object(video_processor, "read_speed", return_value=120):  # sempre sopra la soglia 50
        process_video(in_path, out_above, mode="auto", min_speed_kmh=50, quiet=True)

    frame_below = _frame_at(out_below, 2)
    frame_above = _frame_at(out_above, 2)
    assert frame_below is not None and frame_above is not None
    # sopra soglia il frame è stato pixelizzato nella zona del tachimetro,
    # sotto soglia no: i due output devono differire in modo sostanziale
    diff = np.abs(frame_below.astype(int) - frame_above.astype(int))
    assert diff.max() > 20
