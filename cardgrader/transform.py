"""Mapping between image space and canvas (view) space.

    view = pan + scale * R(theta) * (p_img - image_center)

R is expressed in screen coordinates (y down), so a positive angle rotates the
card clockwise on screen.  The same transform is handed to PIL as a single
affine so rotation, scaling and panning cost one resample per frame.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from .geometry import vec


@dataclass
class ViewTransform:
    angle: float = 0.0          # degrees, positive = clockwise on screen
    scale: float = 1.0
    pan: np.ndarray = field(default_factory=lambda: vec(0.0, 0.0))   # canvas px
    center: np.ndarray = field(default_factory=lambda: vec(0.0, 0.0))  # image px

    # --- helpers ----------------------------------------------------------
    def _cos_sin(self):
        r = math.radians(self.angle)
        return math.cos(r), math.sin(r)

    def img_to_view(self, p) -> np.ndarray:
        c, s = self._cos_sin()
        d = np.asarray(p, dtype=float) - self.center
        return vec(
            self.pan[0] + self.scale * (c * d[0] - s * d[1]),
            self.pan[1] + self.scale * (s * d[0] + c * d[1]),
        )

    def view_to_img(self, p) -> np.ndarray:
        c, s = self._cos_sin()
        d = np.asarray(p, dtype=float) - self.pan
        return vec(
            self.center[0] + (c * d[0] + s * d[1]) / self.scale,
            self.center[1] + (-s * d[0] + c * d[1]) / self.scale,
        )

    def view_delta_to_img(self, d) -> np.ndarray:
        """Rotate/scale a *delta* (no translation) from view into image space."""
        c, s = self._cos_sin()
        d = np.asarray(d, dtype=float)
        return vec((c * d[0] + s * d[1]) / self.scale, (-s * d[0] + c * d[1]) / self.scale)

    def affine_coeffs(self, scale=None, pan=None):
        """Coefficients for PIL Image.transform(AFFINE): out -> in."""
        sc = self.scale if scale is None else scale
        pn = self.pan if pan is None else np.asarray(pan, dtype=float)
        c, s = self._cos_sin()
        a, b = c / sc, s / sc
        d, e = -s / sc, c / sc
        cc = self.center[0] - (a * pn[0] + b * pn[1])
        ff = self.center[1] - (d * pn[0] + e * pn[1])
        return (a, b, cc, d, e, ff)

    def fit(self, img_size, canvas_size, margin=0.90) -> None:
        iw, ih = img_size
        cw, ch = canvas_size
        self.center = vec(iw / 2.0, ih / 2.0)
        if iw <= 0 or ih <= 0 or cw <= 0 or ch <= 0:
            return
        self.scale = min(cw / iw, ch / ih) * margin
        self.pan = vec(cw / 2.0, ch / 2.0)

    def zoom_about(self, view_point, factor: float, lo=0.02, hi=40.0) -> None:
        """Zoom keeping the image point under `view_point` stationary."""
        anchor = self.view_to_img(view_point)
        self.scale = max(lo, min(hi, self.scale * factor))
        new_view = self.img_to_view(anchor)
        self.pan = self.pan + (np.asarray(view_point, dtype=float) - new_view)

    def rotate_about(self, view_point, delta_deg: float) -> None:
        anchor = self.view_to_img(view_point)
        self.angle = (self.angle + delta_deg + 180.0) % 360.0 - 180.0
        new_view = self.img_to_view(anchor)
        self.pan = self.pan + (np.asarray(view_point, dtype=float) - new_view)
