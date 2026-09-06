"""Geometry primitives for the card grader.

Everything here works in *image space* (original card pixels).  Lines are
stored as two control points but are treated as being of infinite length --
the control points are only handles, they never bound the line.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

EPS = 1e-9


def vec(x, y) -> np.ndarray:
    return np.array([float(x), float(y)], dtype=float)


def norm(v: np.ndarray) -> float:
    return float(math.hypot(v[0], v[1]))


def unit(v: np.ndarray) -> np.ndarray:
    n = norm(v)
    if n < EPS:
        return vec(1.0, 0.0)
    return v / n


def lerp(a: np.ndarray, b: np.ndarray, t: float) -> np.ndarray:
    return a + (b - a) * float(t)


@dataclass
class Line:
    """An infinite line defined by two control points."""

    p1: np.ndarray
    p2: np.ndarray

    @staticmethod
    def from_points(x1, y1, x2, y2) -> "Line":
        return Line(vec(x1, y1), vec(x2, y2))

    def copy(self) -> "Line":
        return Line(self.p1.copy(), self.p2.copy())

    # --- basic properties -------------------------------------------------
    def direction(self) -> np.ndarray:
        return unit(self.p2 - self.p1)

    def normal(self) -> np.ndarray:
        d = self.direction()
        return vec(-d[1], d[0])

    def midpoint(self) -> np.ndarray:
        return (self.p1 + self.p2) * 0.5

    def angle_deg(self) -> float:
        d = self.p2 - self.p1
        return math.degrees(math.atan2(d[1], d[0]))

    # --- edits ------------------------------------------------------------
    def translate(self, delta: np.ndarray) -> None:
        self.p1 = self.p1 + delta
        self.p2 = self.p2 + delta

    def translate_perpendicular(self, delta: np.ndarray) -> None:
        """Slide the line along its own normal only; angle is preserved."""
        n = self.normal()
        self.translate(n * float(np.dot(delta, n)))

    def set_control(self, index: int, p: np.ndarray) -> None:
        if index == 0:
            self.p1 = np.asarray(p, dtype=float).copy()
        else:
            self.p2 = np.asarray(p, dtype=float).copy()
        # Never let the two handles collapse onto each other.
        if norm(self.p2 - self.p1) < 1.0:
            d = self.direction()
            if index == 0:
                self.p2 = self.p1 + d
            else:
                self.p1 = self.p2 - d


def intersect(a: Line, b: Line):
    """Intersection of two infinite lines, or None when (near) parallel."""
    r = a.p2 - a.p1
    s = b.p2 - b.p1
    denom = r[0] * s[1] - r[1] * s[0]
    if abs(denom) < 1e-7:
        return None
    q = b.p1 - a.p1
    t = (q[0] * s[1] - q[1] * s[0]) / denom
    return a.p1 + r * t


def clip_line_to_rect(line: Line, x0: float, y0: float, x1: float, y1: float):
    """Clip an infinite line to an axis-aligned rect (Liang-Barsky on a ray).

    Returns (pa, pb) in the same space as the line, or None if it misses.
    """
    p = line.p1
    d = line.p2 - line.p1
    if norm(d) < EPS:
        return None
    t_min, t_max = -1e18, 1e18
    for num, den in (
        (x0 - p[0], d[0]),
        (p[0] - x1, -d[0]),
        (y0 - p[1], d[1]),
        (p[1] - y1, -d[1]),
    ):
        if abs(den) < EPS:
            if num > 0:
                return None
            continue
        t = num / den
        if den > 0:
            t_min = max(t_min, t)
        else:
            t_max = min(t_max, t)
    if t_min > t_max:
        return None
    return p + d * t_min, p + d * t_max
