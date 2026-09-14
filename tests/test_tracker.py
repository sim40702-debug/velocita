import numpy as np
from conftest import make_synthetic_frame
from detector import SpeedometerDetector
from tracker import SpeedometerTracker


def _moving_frames(n=10, dx=4):
    return [make_synthetic_frame(box_x=200 + i * dx) for i in range(n)]


def test_auto_mode_detects_every_frame():
    """Modalità auto (default): nessun bbox iniziale, rilevamento diretto ad
    ogni frame su tutto il video in movimento."""
    frames = _moving_frames()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    tr = SpeedometerTracker(detector)
    tr.init_auto()

    last_cx = None
    for frame in frames:
        bbox = tr.update(frame)
        assert bbox is not None
        cx = bbox.center[0]
        if last_cx is not None:
            assert cx >= last_cx - 2  # segue lo spostamento verso destra
        last_cx = cx


def test_auto_mode_persists_last_position_on_momentary_failure():
    """Se il rilevamento fallisce per un frame, deve continuare a coprire
    l'ultima posizione nota invece di scoprire subito il tachimetro."""
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    tr = SpeedometerTracker(detector, persistence_frames=3)
    tr.init_auto()

    frame_ok = make_synthetic_frame(box_x=200)
    bbox = tr.update(frame_ok)
    assert bbox is not None

    blank = np.full_like(frame_ok, 60)  # nessun target: rilevamento fallisce
    persisted = tr.update(blank)
    assert persisted is not None  # coperto dalla persistenza, non None
    assert abs(persisted.center[0] - bbox.center[0]) < 5  # stessa posizione di prima


def test_auto_mode_gives_up_after_persistence_exhausted():
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    tr = SpeedometerTracker(detector, persistence_frames=2)
    tr.init_auto()

    frame_ok = make_synthetic_frame(box_x=200)
    tr.update(frame_ok)

    blank = np.full_like(frame_ok, 60)
    for _ in range(2):
        assert tr.update(blank) is not None  # ancora dentro la finestra di persistenza
    assert tr.update(blank) is None  # persistenza esaurita: si arrende


def _frame_with_distractor(width=1000, height=480, tacho_x=100, distractor_x=650):
    """Frame col vero tachimetro (arancione, in alto) + un blob "distrattore"
    ad alta densità di bordi, distinto e più lontano (simula un cambio di
    scena: altro veicolo, testo su cartello) che senza bias di prossimità
    vincerebbe il confronto per area/confidenza — verificato sperimentalmente
    che con questi parametri il detector sceglie il distrattore quando
    `near=None` e torna al tachimetro quando `near` punta lì.
    """
    import cv2
    frame = make_synthetic_frame(width=width, height=height, box_x=tacho_x, box_y=40, box_w=180, box_h=60)
    dy, dw, dh = 40, 260, 90
    for i in range(0, dh, 6):
        color = (10, 10, 10) if (i // 6) % 2 == 0 else (220, 220, 220)
        cv2.rectangle(frame, (distractor_x, dy + i), (distractor_x + dw, dy + i + 4), color, -1)
    return frame


def test_auto_mode_resists_distractor_via_proximity_bias():
    """Riproduce il bug segnalato: il tachimetro viene rilevato bene nei
    primi frame, poi un distrattore più "convincente" appare nel frame — il
    tracking non deve saltarci sopra e restarci per il resto del video.
    """
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    tr = SpeedometerTracker(detector, persistence_frames=10)
    tr.init_auto()

    # Primi frame: solo il tachimetro, si aggancia correttamente.
    clean_frame = make_synthetic_frame(width=1000, box_x=100)
    for _ in range(3):
        bbox = tr.update(clean_frame)
        assert bbox is not None
        tacho_cx = bbox.center[0]

    # Ora appare anche il distrattore: senza il bias di prossimità verso
    # l'ultima posizione nota, il detector sceglierebbe lui (verificato sopra).
    distractor_frame = _frame_with_distractor(tacho_x=100, distractor_x=650)
    for _ in range(5):
        bbox = tr.update(distractor_frame)
        assert bbox is not None
        # deve restare vicino alla posizione del tachimetro, non saltare al distrattore
        assert abs(bbox.center[0] - tacho_cx) < 100


def test_tracker_follows_moving_object():
    frames = _moving_frames()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    initial = detector.detect(frames[0])
    assert initial is not None

    tr = SpeedometerTracker(detector, detect_interval=100)  # forza uso del solo tracker
    tr.init_with_bbox(frames[0], initial)

    last_cx = initial.center[0]
    for frame in frames[1:]:
        bbox = tr.update(frame)
        assert bbox is not None
        cx = bbox.center[0]
        assert cx >= last_cx - 2  # deve seguire lo spostamento verso destra
        last_cx = cx


def test_tracker_redetects_when_lost():
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    tr = SpeedometerTracker(detector, detect_interval=2, track_fail_streak=1)

    frame0 = make_synthetic_frame(box_x=200)
    bbox0 = detector.detect(frame0)
    tr.init_with_bbox(frame0, bbox0)

    # frame senza il target: il tracker deve degradare senza esplodere
    import numpy as np
    blank = np.full_like(frame0, 60)
    result = tr.update(blank)
    # può essere None (oggetto perso) ma non deve sollevare eccezioni
    assert result is None or result.is_valid(blank.shape[1], blank.shape[0])

    # riappare: deve poter ri-agganciare
    frame_back = make_synthetic_frame(box_x=205)
    result2 = tr.update(frame_back)
    assert result2 is not None
