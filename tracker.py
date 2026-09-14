"""Segue il tachimetro frame per frame.

Due strategie, scelte automaticamente da come parte il tracking:

- **rilevamento diretto** (init_with_detector / bbox iniziale sconosciuto):
  rilancia il detector euristico ad OGNI frame, su una versione ridotta
  (vedi detector.py `detect_scale`) per restare economico. Niente tracker
  OpenCV: più robusto ai movimenti bruschi (curve, vibrazioni) perché non
  "insegue" mai una posizione vecchia, e più veloce (il tracker CSRT/KCF
  era il vero collo di bottiglia misurato sulle clip lunghe). Se il
  rilevamento fallisce per pochi frame di fila, continua a coprire
  l'ultima posizione nota (persistenza) invece di lasciare scoperto il
  tachimetro anche solo per un istante.
- **tracker OpenCV** (init_with_bbox, usato dalla modalità MANUAL): l'utente
  ha scelto un rettangolo a mano che il detector euristico non "conosce"
  (potrebbe non assomigliare per nulla al pattern bordi/colore atteso), quindi
  serve un vero tracker per seguirlo. Se il tracker perde l'aggancio,
  ripiega comunque sul detector euristico come ultima spiaggia.
"""
from __future__ import annotations

import cv2
import numpy as np

from common import BBox, EMASmoother
from detector import SpeedometerDetector

_TRACKER_FACTORIES = {}
for _name, _ctor_name in (("csrt", "TrackerCSRT_create"), ("kcf", "TrackerKCF_create")):
    _ctor = getattr(cv2, _ctor_name, None) or getattr(
        getattr(cv2, "legacy", None), _ctor_name, None
    )
    if _ctor is not None:
        _TRACKER_FACTORIES[_name] = _ctor


def _create_tracker(kind: str):
    factory = _TRACKER_FACTORIES.get(kind)
    if factory is None:
        available = ", ".join(_TRACKER_FACTORIES) or "nessuno"
        raise RuntimeError(
            f"Tracker OpenCV '{kind}' non disponibile in questa build "
            f"(disponibili: {available}). Installa opencv-contrib-python."
        )
    return factory()


class SpeedometerTracker:
    def __init__(
        self,
        detector: SpeedometerDetector,
        tracker_kind: str = "kcf",
        detect_interval: int = 1,
        track_fail_streak: int = 3,
        smoothing_alpha: float = 0.3,
        persistence_frames: int = 6,
        search_pad_fraction: float = 0.6,
        lost_reset_frames: int = 60,
    ):
        self.detector = detector
        self.tracker_kind = tracker_kind
        self.detect_interval = max(1, detect_interval)
        self.track_fail_streak = max(1, track_fail_streak)
        # Se il rilevamento/tracking fallisce, per quanti frame continuare a
        # coprire l'ultima posizione nota invece di lasciare scoperto il
        # tachimetro (es. sfocatura da movimento rapido, breve occlusione).
        self.persistence_frames = max(0, persistence_frames)
        self.search_pad_fraction = search_pad_fraction
        # Se il rilevamento fallisce per così tanti frame consecutivi, molla
        # il bias verso l'ultima posizione nota (vedi detector.detect `near`)
        # e riparte con una ricerca pulita: se il tachimetro è rimasto
        # davvero fuori scena per molto, la vecchia posizione non è più un
        # riferimento utile e continuare a favorirla rallenterebbe solo il
        # riaggancio quando riappare altrove nel frame.
        self.lost_reset_frames = max(1, lost_reset_frames)

        self._mode: str | None = None  # "detect" (auto) oppure "cvtracker" (manual)
        self._cv_tracker = None
        self._last_bbox: BBox | None = None
        self._fail_count = 0
        self._persistence_left = 0
        self._frames_since_detect = 0
        self._frames_without_detection = 0
        self._smoother = EMASmoother(alpha=smoothing_alpha)

    @property
    def has_lock(self) -> bool:
        return self._last_bbox is not None

    def init_auto(self) -> None:
        """Avvia in modalità rilevamento diretto (nessun bbox iniziale noto)."""
        self._mode = "detect"
        self._cv_tracker = None
        self._last_bbox = None
        self._fail_count = 0
        self._persistence_left = 0
        self._frames_since_detect = 0
        self._frames_without_detection = 0
        self._smoother.reset()

    def init_with_bbox(self, frame: np.ndarray, bbox: BBox) -> None:
        """Avvia il tracking da un bbox scelto dall'utente (modalità manuale)."""
        self._mode = "cvtracker"
        self._cv_tracker = _create_tracker(self.tracker_kind)
        self._cv_tracker.init(frame, bbox.to_xywh())
        self._last_bbox = bbox
        self._fail_count = 0
        self._persistence_left = self.persistence_frames
        self._frames_since_detect = 0
        self._smoother.reset()

    def _search_roi(self, frame: np.ndarray) -> BBox | None:
        if self._last_bbox is None:
            return None
        h, w = frame.shape[:2]
        pad = int(max(self._last_bbox.w, self._last_bbox.h) * self.search_pad_fraction)
        return self._last_bbox.padded(pad, w, h)

    def update(self, frame: np.ndarray) -> BBox | None:
        """Aggiorna per un frame. Ritorna il bbox smoothed, o None se il
        tachimetro non è (più) rilevabile (nemmeno dalla persistenza).
        """
        if self._mode == "detect":
            return self._update_detect(frame)
        return self._update_cvtracker(frame)

    def _update_detect(self, frame: np.ndarray) -> BBox | None:
        # `near`: se c'è un'ultima posizione nota (recente o entro il limite
        # lost_reset_frames), il detector preferisce un candidato vicino ad
        # essa invece del "migliore assoluto" nel frame — altrimenti un blob
        # più convincente comparso altrove (cambio di scena, altro veicolo)
        # fa saltare via il rilevamento dal tachimetro reale e non ci torna
        # più, perché vince di nuovo ad ogni frame successivo.
        near = self._last_bbox if self._frames_without_detection < self.lost_reset_frames else None
        detected = self.detector.detect(frame, near=near)

        if detected is not None:
            self._last_bbox = detected
            self._persistence_left = self.persistence_frames
            self._frames_without_detection = 0
            return self._smoother.update(detected)

        self._frames_without_detection += 1
        if self._frames_without_detection >= self.lost_reset_frames:
            # Fuori scena da troppo tempo: la vecchia posizione non è più un
            # riferimento utile, molla il bias (i prossimi tentativi cercano
            # "alla cieca" come al primo frame) ma continua comunque a provare.
            self._last_bbox = None

        # Rilevamento fallito questo frame: continua a coprire l'ultima
        # posizione nota per qualche frame invece di scoprire subito il
        # tachimetro (es. sfocatura momentanea, riflesso, mano davanti).
        if self._persistence_left > 0 and self._last_bbox is not None:
            self._persistence_left -= 1
            return self._smoother.update(self._last_bbox)
        return None

    def _update_cvtracker(self, frame: np.ndarray) -> BBox | None:
        h, w = frame.shape[:2]
        self._frames_since_detect += 1

        raw_bbox: BBox | None = None

        if self._cv_tracker is not None:
            ok, box = self._cv_tracker.update(frame)
            if ok:
                cand = BBox.from_xywh(*box)
                if cand.is_valid(w, h):
                    raw_bbox = cand
                    self._fail_count = 0
                else:
                    self._fail_count += 1
            else:
                self._fail_count += 1

        need_redetect = (
            raw_bbox is None
            or self._fail_count >= self.track_fail_streak
            or self._frames_since_detect >= self.detect_interval
        )

        if need_redetect:
            search_roi = self._search_roi(frame) if raw_bbox is not None else None
            detected = self.detector.detect(frame, roi=search_roi)
            if detected is None and search_roi is not None:
                detected = self.detector.detect(frame, roi=None)
            if detected is not None:
                raw_bbox = detected
                self._cv_tracker = _create_tracker(self.tracker_kind)
                self._cv_tracker.init(frame, raw_bbox.to_xywh())
                self._fail_count = 0
            self._frames_since_detect = 0

        if raw_bbox is None:
            # Il tracker manuale ha perso tutto: usa la persistenza prima di
            # arrenderti, stessa logica della modalità auto.
            if self._last_bbox is not None and self._persistence_left > 0:
                self._persistence_left -= 1
                return self._smoother.update(self._last_bbox)
            self._cv_tracker = None
            self._last_bbox = None
            return None

        self._persistence_left = self.persistence_frames
        self._last_bbox = raw_bbox
        return self._smoother.update(raw_bbox)
