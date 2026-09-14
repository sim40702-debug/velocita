"""Rilevamento del display tachimetro nel frame.

Due backend:
- euristico (default, sempre disponibile): tre segnali indipendenti dal
  colore del display (arancione LCD, nero/blu digitale, bianco analogico...):
    1. densità di bordi (edge density): un cruscotto pieno di numeri/icone ha
       molti più bordi ravvicinati dell'asfalto/cielo/serbatoio attorno,
       indipendentemente dal colore. Usato per TROVARE i blob candidati.
    2. texture interna: dentro ogni blob candidato, quanto è denso di bordi
       "grezzi" (pre-dilatazione). Un display con testo ne ha molti (i
       caratteri); un blob di forma simile ma "vuoto" — parabrezza,
       serbatoio, componenti metallici lisci — ne ha pochi. Discrimina i
       falsi positivi più comuni su scene onboard reali (molti oggetti
       hanno un contorno netto ma poco dettaglio dentro).
    3. color-match opzionale (arancione/ambra di default) come booster: se
       il colore combacia, la confidenza sale, ma non è più l'unico criterio.
  Più i vincoli geometrici comuni (aspect ratio, area massima, posizione
  nella metà alta del frame, dove sta il cruscotto sopra il manubrio) e,
  quando c'è un'ultima posizione nota, un bias di prossimità (vedi `near` in
  `detect()`).
- YOLO opzionale: se esiste models/tachometer.pt e ultralytics è installato,
  viene usato al posto dell'euristica. Import lazy: nessuna dipendenza
  obbligatoria per chi non lo usa.
"""
from __future__ import annotations

import os

import cv2
import numpy as np

from common import BBox

# ponytail: range HSV arancione/ambra usato solo come booster opzionale di
# confidenza (non più unico criterio) — utile sui display LCD ambra classici.
DEFAULT_HUE_RANGE = (0, 30)
DEFAULT_SAT_MIN = 90
DEFAULT_VAL_MIN = 90

_YOLO_CACHE: dict[str, object | None] = {}  # model_path -> modello caricato (o None se fallito)


def _try_load_yolo(model_path: str):
    if model_path in _YOLO_CACHE:
        return _YOLO_CACHE[model_path]
    model = None
    if os.path.exists(model_path):
        try:
            from ultralytics import YOLO  # lazy import, dipendenza opzionale
            model = YOLO(model_path)
        except ImportError:
            model = None
        except Exception:
            model = None
    _YOLO_CACHE[model_path] = model
    return model


class SpeedometerDetector:
    def __init__(
        self,
        hue_range: tuple[int, int] = DEFAULT_HUE_RANGE,
        sat_min: int = DEFAULT_SAT_MIN,
        val_min: int = DEFAULT_VAL_MIN,
        model_path: str = "models/tachometer.pt",
        yolo_conf: float = 0.5,
        search_top_fraction: float = 0.75,
        detect_scale: float = 0.5,
    ):
        self.hue_range = hue_range
        self.sat_min = sat_min
        self.val_min = val_min
        self.yolo_conf = yolo_conf
        self.search_top_fraction = search_top_fraction
        # Il rilevamento euristico lavora su un frame ridotto di questo
        # fattore (0.5 = metà risoluzione): Canny/morfologia scalano con
        # l'area del frame, quindi dimezzare i lati è ~4x più veloce.
        # Abbastanza economico da girare ad OGNI frame invece che ogni tot
        # con un tracker costoso in mezzo — più robusto ai movimenti bruschi
        # (curve, vibrazioni) perché non "insegue" mai una posizione vecchia.
        self.detect_scale = detect_scale
        self._yolo = _try_load_yolo(model_path)

    @property
    def using_yolo(self) -> bool:
        return self._yolo is not None

    def detect(self, frame: np.ndarray, roi: BBox | None = None, near: BBox | None = None) -> BBox | None:
        """Cerca il tachimetro nell'intero frame, o solo dentro `roi` se dato
        (usato per limitare la ricerca attorno all'ultima posizione nota).

        `near`: se dato (tipicamente l'ultimo bbox noto), i candidati vicini a
        questa posizione vengono preferiti a un candidato "migliore" ma
        lontano — altrimenti un blob più convincente comparso altrove nel
        frame (cambio di scena, altro veicolo, testo su cartello) fa
        "saltare" il rilevamento via dal tachimetro reale per il resto del
        video, perché vince di nuovo ad ogni frame successivo.
        """
        if roi is not None:
            sub = frame[roi.y1:roi.y2, roi.x1:roi.x2]
            if sub.size == 0:
                sub = frame
                offset = (0, 0)
            else:
                offset = (roi.x1, roi.y1)
        else:
            sub = frame
            offset = (0, 0)

        near_in_sub = None
        if near is not None:
            near_in_sub = BBox(near.x1 - offset[0], near.y1 - offset[1], near.x2 - offset[0], near.y2 - offset[1])

        if self._yolo is not None:
            result = self._detect_yolo(sub)
        else:
            result = self._detect_heuristic(sub, near=near_in_sub)

        if result is None:
            return None
        result.x1 += offset[0]
        result.x2 += offset[0]
        result.y1 += offset[1]
        result.y2 += offset[1]
        return result

    def _detect_yolo(self, frame: np.ndarray) -> BBox | None:
        preds = self._yolo.predict(frame, verbose=False, conf=self.yolo_conf)
        if not preds or len(preds[0].boxes) == 0:
            return None
        boxes = preds[0].boxes
        best = max(range(len(boxes)), key=lambda i: float(boxes.conf[i]))
        x1, y1, x2, y2 = boxes.xyxy[best].tolist()
        return BBox(int(x1), int(y1), int(x2), int(y2), float(boxes.conf[best]))

    def _detect_heuristic(self, frame: np.ndarray, near: BBox | None = None) -> BBox | None:
        h_full, w_full = frame.shape[:2]

        # Lavora su una versione ridotta: Canny/morfologia costano in base
        # all'area del frame, quindi questo rende il rilevamento abbastanza
        # economico da girare ad ogni frame (vedi commento in __init__).
        scale = self.detect_scale
        small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR) if scale != 1.0 else frame
        h, w = small.shape[:2]
        search_h = int(h * self.search_top_fraction)

        near_small = None
        if near is not None and scale != 1.0:
            near_small = BBox(int(near.x1 * scale), int(near.y1 * scale), int(near.x2 * scale), int(near.y2 * scale))
        elif near is not None:
            near_small = near

        # --- Segnale 1: densità di bordi. Un display pieno di numeri/icone
        # produce molti bordi Canny ravvicinati; li si "addensa" con una
        # dilatazione così l'area del cruscotto diventa un blob unico invece
        # di tanti contorni sottili sparsi (funziona su QUALSIASI colore).
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 60, 160)
        edges[search_h:, :] = 0  # il cruscotto sta nella metà/terzo alto del frame
        density_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 8))
        edge_mask = cv2.dilate(edges, density_kernel, iterations=2)
        edge_mask = cv2.morphologyEx(edge_mask, cv2.MORPH_CLOSE, density_kernel)

        # --- Segnale 2 (booster opzionale): color-match arancione/ambra,
        # utile sui display LCD ambra classici ma non più obbligatorio.
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        lower = np.array([self.hue_range[0], self.sat_min, self.val_min])
        upper = np.array([self.hue_range[1], 255, 255])
        color_mask = cv2.inRange(hsv, lower, upper)
        color_mask[search_h:, :] = 0

        contours, _ = cv2.findContours(edge_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        min_area = (w * h) * 0.004  # scarta rumore troppo piccolo
        max_area = (w * h) * 0.25   # scarta blob molto grandi (parabrezza, serbatoio, sfondo)
        candidates = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < min_area or area > max_area:
                continue
            x, y, cw, ch = cv2.boundingRect(c)
            if ch == 0:
                continue
            aspect = cw / ch
            # Il display tachimetro è tipicamente largo e basso (trapezoidale
            # o rettangolare); scarta forme troppo strette o troppo quadrate.
            if not (1.1 <= aspect <= 6.0):
                continue

            fill_ratio = area / max(cw * ch, 1)
            # Bonus di confidenza se dentro il bbox c'è anche colore arancione:
            # non richiesto, ma alza la priorità quando presente.
            color_overlap = cv2.countNonZero(color_mask[y:y + ch, x:x + cw]) / max(cw * ch, 1)
            # Densità di bordi GREZZI (pre-dilatazione) dentro il bbox: un
            # display con testo/numeri ha molti bordi interni ravvicinati
            # (i caratteri); un blob "vuoto" di forma simile — parabrezza,
            # serbatoio, componenti metallici lisci — ne ha pochi, la sua
            # area diventa un blob solo dopo la dilatazione. Fattore additivo
            # (non uno scarto secco): un display a tinta piena senza testo
            # visibile resta comunque un candidato valido, solo con priorità
            # più bassa di uno che ha davvero texture interna.
            interior_edge_density = cv2.countNonZero(edges[y:y + ch, x:x + cw]) / max(cw * ch, 1)
            texture_score = min(1.0, interior_edge_density * 6)
            confidence = min(1.0, 0.45 * fill_ratio + 0.25 * texture_score + 0.3 * min(1.0, color_overlap * 3))
            candidates.append((confidence * area, confidence, BBox(x, y, x + cw, y + ch)))

        if not candidates:
            return None

        if near_small is not None:
            # Preferisce il candidato più vicino all'ultima posizione nota
            # invece del "migliore assoluto": penalizza in base alla distanza
            # tra i centri (normalizzata sulla dimensione del frame), così un
            # blob comparso altrove nel frame non fa saltare via il tracking
            # dal tachimetro reale.
            near_cx, near_cy = near_small.center
            diag = max(1.0, (w ** 2 + h ** 2) ** 0.5)
            scored = []
            for score, confidence, bbox in candidates:
                cx, cy = bbox.center
                dist = ((cx - near_cx) ** 2 + (cy - near_cy) ** 2) ** 0.5
                proximity = max(0.0, 1.0 - dist / (diag * 0.5))
                scored.append((score * (0.4 + 0.6 * proximity), confidence, bbox))
            candidates = scored

        _, confidence, bbox = max(candidates, key=lambda t: t[0])
        if scale != 1.0:
            inv = 1.0 / scale
            bbox = BBox(
                int(bbox.x1 * inv), int(bbox.y1 * inv),
                int(bbox.x2 * inv), int(bbox.y2 * inv),
            )
        bbox.confidence = float(confidence)
        return bbox
