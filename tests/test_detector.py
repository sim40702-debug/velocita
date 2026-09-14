import cv2
import numpy as np
from conftest import make_synthetic_frame
from detector import SpeedometerDetector


def test_detects_orange_trapezoid():
    frame = make_synthetic_frame()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    bbox = detector.detect(frame)
    assert bbox is not None
    assert bbox.confidence > 0.3
    # deve stare grosso modo dove è stato disegnato il trapezio
    assert 150 < bbox.x1 < 250
    assert bbox.w > 100


def test_no_detection_on_flat_background():
    # sfondo uniforme senza bordi: niente da rilevare (né per colore né per densità di bordi)
    frame = np.full((480, 640, 3), 60, dtype=np.uint8)
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    bbox = detector.detect(frame)
    assert bbox is None


def _make_dark_dashboard_frame(width=1280, height=720, x=460, y=280, w=360, h=130):
    """Simula un cruscotto digitale scuro (nero/blu) con testo ad alto
    contrasto, come i display moto moderni non arancioni/LCD classici.
    """
    frame = np.full((height, width, 3), 90, dtype=np.uint8)
    cv2.rectangle(frame, (x, y), (x + w, y + h), (20, 20, 20), -1)
    cv2.rectangle(frame, (x, y), (x + w, y + h), (60, 60, 60), 3)
    cv2.putText(frame, "135", (x + 40, y + 90), cv2.FONT_HERSHEY_SIMPLEX, 2.2, (255, 255, 255), 4)
    cv2.putText(frame, "12", (x + 230, y + 70), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 200, 255), 3)
    for i in range(8):
        cv2.line(frame, (x + 20 + i * 40, y + 100), (x + 20 + i * 40, y + 115), (100, 220, 255), 2)
    return frame


def test_detects_dark_digital_dashboard_without_orange_color():
    """Il rilevamento non deve dipendere dal colore: un cruscotto scuro con
    testo bianco/blu (non arancione) deve comunque essere trovato via
    densità di bordi. Regressione per il caso reale segnalato dall'utente.
    """
    frame = _make_dark_dashboard_frame()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    bbox = detector.detect(frame)
    assert bbox is not None
    # deve centrarsi sul rettangolo del cruscotto disegnato (460,280,360,130)
    assert 380 < bbox.x1 < 500
    assert 220 < bbox.y1 < 320
    assert bbox.w > 250
    assert bbox.h > 80


def _make_windshield_distractor_frame(width=1280, height=720):
    """Simula la scena onboard reale segnalata dall'utente: un parabrezza
    largo con bordi curvi ma quasi vuoto dentro (pochi bordi interni, solo
    riflessi/linee sottili) a sinistra, e il vero display piccolo/scuro con
    testo denso a destra. Prima del fix il parabrezza (area maggiore, tanti
    bordi sul contorno) veniva scelto al posto del display reale.
    """
    frame = np.full((height, width, 3), 110, dtype=np.uint8)
    cv2.ellipse(frame, (350, 200), (280, 140), 0, 180, 360, (60, 60, 60), 3)
    cv2.ellipse(frame, (350, 200), (260, 120), 0, 180, 360, (90, 90, 90), 2)
    cv2.line(frame, (150, 150), (550, 130), (140, 140, 140), 1)
    cv2.line(frame, (150, 170), (550, 150), (140, 140, 140), 1)

    dx, dy, dw, dh = 780, 150, 220, 90
    cv2.rectangle(frame, (dx, dy), (dx + dw, dy + dh), (20, 20, 20), -1)
    cv2.rectangle(frame, (dx, dy), (dx + dw, dy + dh), (70, 70, 70), 2)
    cv2.putText(frame, "155", (dx + 15, dy + 60), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (255, 255, 255), 3)
    cv2.putText(frame, "mph", (dx + 140, dy + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 180, 255), 1)
    for i in range(6):
        cv2.line(frame, (dx + 15 + i * 30, dy + 70), (dx + 15 + i * 30, dy + 82), (100, 200, 255), 2)
    return frame, (dx + dw // 2, dy + dh // 2)


def test_prefers_textured_display_over_windshield_distractor():
    """Regressione per il bug segnalato: il detector deve scegliere il
    display vero (poco appariscente ma con testo denso) e non un blob più
    grande/appariscente ma "vuoto" come un parabrezza o un serbatoio.
    """
    frame, display_center = _make_windshield_distractor_frame()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    bbox = detector.detect(frame)
    assert bbox is not None
    cx, cy = bbox.center
    dist_to_display = ((cx - display_center[0]) ** 2 + (cy - display_center[1]) ** 2) ** 0.5
    assert dist_to_display < 150  # deve stare sul display vero, non sul parabrezza


def test_detect_with_roi_offsets_result():
    from common import BBox
    frame = make_synthetic_frame()
    detector = SpeedometerDetector(model_path="models/__nonexistent__.pt")
    full = detector.detect(frame)
    roi = BBox(150, 0, 640, 200)
    within_roi = detector.detect(frame, roi=roi)
    assert within_roi is not None
    # coordinate devono restare nel sistema di riferimento del frame intero
    assert abs(within_roi.x1 - full.x1) < 20
