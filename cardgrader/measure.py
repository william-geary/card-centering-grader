"""Multi-point centering measurement.

The eight boundary lines form an outer frame (the card edge) and an inner
frame (the inside edge of the printed border).  Rather than measuring one
margin per side, we take N samples per axis and average them.  That cancels
out small misjudgements and correctly handles a card whose inner frame is
rotated relative to the card edge -- the classic mis-cut / tilted-art case.

Sampling for the left/right axis:

    inner corners            TL ---------------- TR
                              |                  |
      sample t=0.0 ...       A(t) ---scan---- B(t)
                              |                  |
                             BL ---------------- BR

    A(t) = lerp(TL, BL, t)     lies on the inner-left line
    B(t) = lerp(TR, BR, t)     lies on the inner-right line

The scan line through A(t) and B(t) is intersected with the outer-left and
outer-right lines.  The left margin runs from the outer-left intersection to
A(t), measured along the scan direction; the right margin runs from B(t) to
the outer-right intersection.  With N=3 the samples land on the two inner
corner intersections and the midpoint between them.

The top/bottom axis is the same construction rotated 90 degrees.

All distances are in image pixels, so the resulting ratios are invariant to
the display rotation and zoom chosen in stage 1.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .geometry import Line, intersect, lerp, unit

SIDES = ("outer_left", "outer_right", "outer_top", "outer_bottom",
         "inner_left", "inner_right", "inner_top", "inner_bottom")


@dataclass
class AxisResult:
    """One measurement axis: left/right or top/bottom."""

    name: str
    low_label: str
    high_label: str
    low_margins: list = field(default_factory=list)    # per sample, image px
    high_margins: list = field(default_factory=list)
    sample_points: list = field(default_factory=list)  # (outerA, innerA, innerB, outerB)
    valid: bool = False

    @property
    def low(self) -> float:
        return float(np.mean(self.low_margins)) if self.low_margins else 0.0

    @property
    def high(self) -> float:
        return float(np.mean(self.high_margins)) if self.high_margins else 0.0

    @property
    def total(self) -> float:
        return self.low + self.high

    @property
    def low_pct(self) -> float:
        t = self.total
        return 100.0 * self.low / t if t > 1e-9 else 50.0

    @property
    def high_pct(self) -> float:
        return 100.0 - self.low_pct

    def sample_pcts(self) -> list:
        out = []
        for lo, hi in zip(self.low_margins, self.high_margins):
            t = lo + hi
            out.append(100.0 * lo / t if t > 1e-9 else 50.0)
        return out

    @property
    def crossed(self) -> bool:
        """True when a margin came out negative, i.e. an outer line has been
        dragged inside its inner counterpart.  The percentages are still
        reported, but they are meaningless until the lines are fixed."""
        return any(v < 0 for v in self.low_margins + self.high_margins)

    @property
    def spread(self) -> float:
        """Max minus min of the per-sample percentages.  A large spread means
        the inner and outer frames are not parallel."""
        pcts = self.sample_pcts()
        return (max(pcts) - min(pcts)) if pcts else 0.0

    def text(self) -> str:
        if not self.valid:
            return "--"
        return "{:.1f} / {:.1f}".format(self.low_pct, self.high_pct)


@dataclass
class Measurement:
    lr: AxisResult
    tb: AxisResult
    n_samples: int = 3

    @property
    def valid(self) -> bool:
        return self.lr.valid and self.tb.valid

    @property
    def crossed(self) -> bool:
        return self.lr.crossed or self.tb.crossed

    def worst_pct(self) -> float:
        """The largest of the four percentages: how far off-centre the card is
        on its worst side."""
        if not self.valid:
            return 50.0
        return max(self.lr.low_pct, self.lr.high_pct,
                   self.tb.low_pct, self.tb.high_pct)


def _sample_axis(name, low_label, high_label,
                 inner_a0, inner_a1, inner_b0, inner_b1,
                 outer_low: Line, outer_high: Line, n: int) -> AxisResult:
    """inner_a0/a1 span the low-side inner line, inner_b0/b1 the high side."""
    res = AxisResult(name, low_label, high_label)
    if any(p is None for p in (inner_a0, inner_a1, inner_b0, inner_b1)):
        return res
    for i in range(n):
        t = 0.5 if n == 1 else i / (n - 1)
        a = lerp(inner_a0, inner_a1, t)   # point on the low inner line
        b = lerp(inner_b0, inner_b1, t)   # point on the high inner line
        scan = Line(a.copy(), b.copy())
        pa = intersect(scan, outer_low)
        pb = intersect(scan, outer_high)
        if pa is None or pb is None:
            return AxisResult(name, low_label, high_label)
        u = unit(b - a)                   # scan direction, low -> high
        res.low_margins.append(float(np.dot(a - pa, u)))
        res.high_margins.append(float(np.dot(pb - b, u)))
        res.sample_points.append((pa, a, b, pb))
    res.valid = True
    return res


def measure(lines: dict, n_samples: int = 3) -> Measurement:
    """Compute both centering axes from the eight boundary lines."""
    n = max(1, int(n_samples))
    il, ir = lines["inner_left"], lines["inner_right"]
    it, ib = lines["inner_top"], lines["inner_bottom"]

    tl, tr = intersect(it, il), intersect(it, ir)
    bl, br = intersect(ib, il), intersect(ib, ir)

    lr = _sample_axis("Left / Right", "L", "R",
                      tl, bl, tr, br,
                      lines["outer_left"], lines["outer_right"], n)
    tb = _sample_axis("Top / Bottom", "T", "B",
                      tl, tr, bl, br,
                      lines["outer_top"], lines["outer_bottom"], n)
    return Measurement(lr=lr, tb=tb, n_samples=n)
