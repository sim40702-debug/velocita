"""Tipi condivisi tra detector/tracker/masking/video_processor."""
from dataclasses import dataclass


@dataclass
class BBox:
    """Bounding box in coordinate immagine (xyxy), pixel interi."""
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float = 1.0

    @property
    def w(self) -> int:
        return self.x2 - self.x1

    @property
    def h(self) -> int:
        return self.y2 - self.y1

    @property
    def center(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    def to_xywh(self) -> tuple[int, int, int, int]:
        return (self.x1, self.y1, self.w, self.h)

    @classmethod
    def from_xywh(cls, x: int, y: int, w: int, h: int, confidence: float = 1.0) -> "BBox":
        return cls(int(x), int(y), int(x + w), int(y + h), confidence)

    def padded(self, pad: int, frame_w: int, frame_h: int) -> "BBox":
        """Ritorna il bbox allargato di `pad` px per lato, clampato ai bordi del frame."""
        return BBox(
            max(0, self.x1 - pad),
            max(0, self.y1 - pad),
            min(frame_w, self.x2 + pad),
            min(frame_h, self.y2 + pad),
            self.confidence,
        )

    def is_valid(self, frame_w: int, frame_h: int, min_size: int = 8) -> bool:
        return (
            self.w >= min_size
            and self.h >= min_size
            and 0 <= self.x1 < frame_w
            and 0 <= self.y1 < frame_h
            and self.x2 <= frame_w
            and self.y2 <= frame_h
        )


class EMASmoother:
    """Exponential moving average su centro + size del bbox, per eliminare tremolii."""

    def __init__(self, alpha: float = 0.3):
        self.alpha = alpha
        self._state: tuple[float, float, float, float] | None = None  # cx, cy, w, h

    def reset(self) -> None:
        self._state = None

    def update(self, bbox: BBox) -> BBox:
        cx, cy = bbox.center
        w, h = bbox.w, bbox.h
        if self._state is None:
            self._state = (cx, cy, w, h)
        else:
            a = self.alpha
            pcx, pcy, pw, ph = self._state
            self._state = (
                a * cx + (1 - a) * pcx,
                a * cy + (1 - a) * pcy,
                a * w + (1 - a) * pw,
                a * h + (1 - a) * ph,
            )
        scx, scy, sw, sh = self._state
        return BBox.from_xywh(
            int(scx - sw / 2), int(scy - sh / 2), int(sw), int(sh), bbox.confidence
        )
