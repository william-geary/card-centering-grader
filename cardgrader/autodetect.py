"""A rough first guess at where the two frames sit.

This only exists to save the user some dragging -- every line it produces is
meant to be corrected by hand in the bulk and precision stages.  The method is
deliberately simple: sum the gradient magnitude along rows and columns and
pick the strongest peak inside a plausible search band.
"""

from __future__ import annotations

import numpy as np
from PIL import Image

MAX_WORK = 900.0   # longest side used for detection, keeps it fast


def _energy(gray: np.ndarray, axis: int) -> np.ndarray:
    """Mean absolute gradient collapsed onto one axis.

    axis=0 -> a profile along x (finds vertical lines)
    axis=1 -> a profile along y (finds horizontal lines)
    """
    if axis == 0:
        d = np.abs(np.diff(gray, axis=1))
        prof = d.mean(axis=0)
    else:
        d = np.abs(np.diff(gray, axis=0))
        prof = d.mean(axis=1)
    if prof.size >= 5:                     # light smoothing
        k = np.ones(3) / 3.0
        prof = np.convolve(prof, k, mode="same")
    return prof


def _peak(prof: np.ndarray, lo: float, hi: float) -> float | None:
    lo_i = max(0, int(round(lo)))
    hi_i = min(prof.size, int(round(hi)))
    if hi_i - lo_i < 2:
        return None
    seg = prof[lo_i:hi_i]
    i = int(np.argmax(seg))
    if seg[i] <= 1e-6:
        return None
    # Parabolic refinement for a sub-pixel peak.
    if 0 < i < seg.size - 1:
        a, b, c = float(seg[i - 1]), float(seg[i]), float(seg[i + 1])
        denom = a - 2 * b + c
        if abs(denom) > 1e-9:
            i = i + 0.5 * (a - c) / denom
    return lo_i + float(i) + 0.5        # +0.5: diff sits between pixels


def detect_frames(image: Image.Image):
    """Return {'outer': (x0,y0,x1,y1), 'inner': (...)} in full-res image px."""
    w, h = image.size
    scale = min(1.0, MAX_WORK / max(w, h))
    sw, sh = max(8, int(w * scale)), max(8, int(h * scale))
    gray = np.asarray(image.convert("L").resize((sw, sh), Image.BILINEAR), dtype=np.float32)

    px = _energy(gray, 0)   # profile along x
    py = _energy(gray, 1)   # profile along y

    # Outer edges: strongest gradient in the outer quarter on each side.
    ox0 = _peak(px, 0, sw * 0.25)
    ox1 = _peak(px, sw * 0.75, sw)
    oy0 = _peak(py, 0, sh * 0.25)
    oy1 = _peak(py, sh * 0.75, sh)
    if None in (ox0, ox1, oy0, oy1) or ox1 - ox0 < sw * 0.4 or oy1 - oy0 < sh * 0.4:
        ox0, oy0, ox1, oy1 = 0.0, 0.0, float(sw), float(sh)

    bw, bh = ox1 - ox0, oy1 - oy0

    # Inner border edge: search a band 3%-22% in from each outer edge.
    ix0 = _peak(px, ox0 + 0.03 * bw, ox0 + 0.22 * bw)
    ix1 = _peak(px, ox1 - 0.22 * bw, ox1 - 0.03 * bw)
    iy0 = _peak(py, oy0 + 0.03 * bh, oy0 + 0.22 * bh)
    iy1 = _peak(py, oy1 - 0.22 * bh, oy1 - 0.03 * bh)
    if ix0 is None or ix1 is None or ix1 <= ix0:
        ix0, ix1 = ox0 + 0.10 * bw, ox1 - 0.10 * bw
    if iy0 is None or iy1 is None or iy1 <= iy0:
        iy0, iy1 = oy0 + 0.09 * bh, oy1 - 0.09 * bh

    k = 1.0 / scale
    return {
        "outer": (ox0 * k, oy0 * k, ox1 * k, oy1 * k),
        "inner": (ix0 * k, iy0 * k, ix1 * k, iy1 * k),
    }
