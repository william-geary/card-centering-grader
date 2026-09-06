"""Document state: the card image, the view transform and the eight lines."""

from __future__ import annotations

import copy
import os
from datetime import datetime

import numpy as np
from PIL import Image

from . import autodetect
from .geometry import Line, intersect, lerp, unit, vec
from . import grades
from .measure import SIDES, measure
from .transform import ViewTransform

HANDLE_INSET = 0.09   # how far handles sit in from the corners

OUTER = ("outer_left", "outer_right", "outer_top", "outer_bottom")
INNER = ("inner_left", "inner_right", "inner_top", "inner_bottom")

# Which two lines a given line meets at its handle points.
PARTNERS = {
    "outer_top": ("outer_left", "outer_right"),
    "outer_bottom": ("outer_left", "outer_right"),
    "outer_left": ("outer_top", "outer_bottom"),
    "outer_right": ("outer_top", "outer_bottom"),
    "inner_top": ("inner_left", "inner_right"),
    "inner_bottom": ("inner_left", "inner_right"),
    "inner_left": ("inner_top", "inner_bottom"),
    "inner_right": ("inner_top", "inner_bottom"),
}

PRETTY = {
    "outer_left": "Outer left", "outer_right": "Outer right",
    "outer_top": "Outer top", "outer_bottom": "Outer bottom",
    "inner_left": "Inner left", "inner_right": "Inner right",
    "inner_top": "Inner top", "inner_bottom": "Inner bottom",
}


def _rect_corners(rect):
    """(x0, y0, x1, y1) -> (tl, tr, br, bl)."""
    x0, y0, x1, y1 = rect
    return [vec(x0, y0), vec(x1, y0), vec(x1, y1), vec(x0, y1)]


def _as_corners(spec):
    if len(spec) == 4 and np.isscalar(spec[0]):
        return _rect_corners(spec)
    return [np.asarray(p, dtype=float) for p in spec]


class CardModel:
    """Holds everything a grading session needs; the UI renders from this."""

    def __init__(self):
        self.image: Image.Image | None = None
        self.path: str | None = None
        self.transform = ViewTransform()
        self.lines: dict[str, Line] = {}
        self.n_samples = 3
        self._undo: list = []
        self._redo: list = []

    # --- loading ----------------------------------------------------------
    def load(self, path: str, canvas_size=(900, 700), auto=True) -> None:
        img = Image.open(path)
        img = img.convert("RGB")
        self.image = img
        self.path = path
        self.transform = ViewTransform()
        self.transform.fit(img.size, canvas_size)
        self._undo.clear()
        self._redo.clear()
        self.reset_lines(auto=auto)

    @property
    def loaded(self) -> bool:
        return self.image is not None

    @property
    def size(self):
        return self.image.size if self.image else (0, 0)

    # --- line setup -------------------------------------------------------
    def _straight_space(self):
        """The image as stage 1 leaves it looking, plus a mapper back.

        Line placement has to happen in the frame the user is actually looking
        at: once the scan has been rotated straight, a rectangle that is
        axis-aligned on screen is a tilted one in raw image pixels.  This
        returns an upright copy of the card and a transform whose view_to_img
        converts points in that copy back to real image coordinates.
        """
        t = self.transform
        if abs(t.angle) < 0.005:
            return self.image, None
        # PIL rotates counter-clockwise; our positive angle is clockwise.
        rimg = self.image.rotate(-t.angle, resample=Image.BICUBIC, expand=True)
        mapper = ViewTransform(
            angle=t.angle, scale=1.0,
            pan=vec(rimg.width / 2.0, rimg.height / 2.0),
            center=vec(self.image.width / 2.0, self.image.height / 2.0))
        return rimg, mapper

    def reset_lines(self, auto=True) -> None:
        if not self.loaded:
            return
        src, mapper = self._straight_space()
        w, h = src.size
        box = None
        if auto:
            try:
                box = autodetect.detect_frames(src)
            except Exception:
                box = None
        if box is None:
            ox0, oy0 = 0.03 * w, 0.03 * h
            ox1, oy1 = 0.97 * w, 0.97 * h
            bw, bh = ox1 - ox0, oy1 - oy0
            box = {
                "outer": (ox0, oy0, ox1, oy1),
                "inner": (ox0 + 0.10 * bw, oy0 + 0.09 * bh,
                          ox1 - 0.10 * bw, oy1 - 0.09 * bh),
            }
        outer = _rect_corners(box["outer"])
        inner = _rect_corners(box["inner"])
        if mapper is not None:
            outer = [mapper.view_to_img(p) for p in outer]
            inner = [mapper.view_to_img(p) for p in inner]
        self.set_frames(outer, inner)

    def set_frames(self, outer, inner) -> None:
        """Build the eight lines from two corner quads, each (tl, tr, br, bl).

        A plain (x0, y0, x1, y1) rectangle is accepted too.
        """
        otl, otr, obr, obl = _as_corners(outer)
        itl, itr, ibr, ibl = _as_corners(inner)
        self.lines = {
            "outer_left": Line(otl.copy(), obl.copy()),
            "outer_right": Line(otr.copy(), obr.copy()),
            "outer_top": Line(otl.copy(), otr.copy()),
            "outer_bottom": Line(obl.copy(), obr.copy()),
            "inner_left": Line(itl.copy(), ibl.copy()),
            "inner_right": Line(itr.copy(), ibr.copy()),
            "inner_top": Line(itl.copy(), itr.copy()),
            "inner_bottom": Line(ibl.copy(), ibr.copy()),
        }

    def corner(self, a: str, b: str):
        return intersect(self.lines[a], self.lines[b])

    def outer_corners(self):
        """The four corners of the outer frame, or None if it is degenerate."""
        pts = [self.corner("outer_top", "outer_left"),
               self.corner("outer_top", "outer_right"),
               self.corner("outer_bottom", "outer_right"),
               self.corner("outer_bottom", "outer_left")]
        return None if any(p is None for p in pts) else pts

    def outer_center(self):
        pts = self.outer_corners()
        return None if pts is None else np.mean(np.array(pts, dtype=float), axis=0)

    def segment(self, key: str):
        """The finite span of a line between its two partner lines, used for
        drawing the rectangle edges and for placing the bulk-stage handle."""
        line = self.lines[key]
        pa, pb = (intersect(line, self.lines[k]) for k in PARTNERS[key])
        if pa is None or pb is None:
            return line.p1, line.p2
        return pa, pb

    def place_handles(self, keys=None, inset=HANDLE_INSET) -> None:
        """Park each line's two control points near its corner intersections.

        They are pulled `inset` of the way in from the exact corners on
        purpose: two perpendicular lines meet at a single point, so handles
        sitting exactly on a corner would coincide and the hit test could not
        tell them apart.  The small offset also matches the paired dots in the
        precision mock-up.
        """
        keys = keys or list(self.lines)
        spans = {k: self.segment(k) for k in keys}
        for k in keys:
            pa, pb = (np.asarray(v, dtype=float) for v in spans[k])
            self.lines[k] = Line(lerp(pa, pb, inset), lerp(pa, pb, 1.0 - inset))

    # Older name kept so callers reading as "snap to corners" still work.
    snap_handles_to_corners = place_handles

    def straighten(self, keys=None) -> None:
        """Re-align lines to the screen axes, keeping their current position.

        After stage 1 the screen axes are what the user cares about, so this
        squares lines to the view rather than to raw image pixels.
        """
        t = self.transform
        dir_h = unit(t.view_delta_to_img(vec(1.0, 0.0)))
        dir_v = unit(t.view_delta_to_img(vec(0.0, 1.0)))
        for k in (keys or list(self.lines)):
            mid = self.lines[k].midpoint()
            d = dir_h if (k.endswith("top") or k.endswith("bottom")) else dir_v
            self.lines[k] = Line(mid - d * 100.0, mid + d * 100.0)
        self.place_handles()

    def move_frame(self, group: str, delta) -> None:
        for k in (OUTER if group == "outer" else INNER):
            self.lines[k].translate(np.asarray(delta, dtype=float))

    # --- undo -------------------------------------------------------------
    def snapshot(self) -> None:
        self._undo.append(copy.deepcopy(self.lines))
        if len(self._undo) > 100:
            self._undo.pop(0)
        self._redo.clear()

    def undo(self) -> bool:
        if not self._undo:
            return False
        self._redo.append(copy.deepcopy(self.lines))
        self.lines = self._undo.pop()
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        self._undo.append(copy.deepcopy(self.lines))
        self.lines = self._redo.pop()
        return True

    # --- results ----------------------------------------------------------
    def measure(self):
        if not self.lines:
            return None
        return measure(self.lines, self.n_samples)

    def report(self, side=grades.FRONT) -> dict:
        m = self.measure()
        data = {
            "file": os.path.basename(self.path) if self.path else None,
            "path": self.path,
            "image_size": list(self.size),
            "measured_at": datetime.now().isoformat(timespec="seconds"),
            "samples_per_axis": self.n_samples,
            "display": {"angle_deg": round(self.transform.angle, 3),
                        "zoom": round(self.transform.scale, 4)},
            "lines_image_space": {
                k: {"p1": [round(float(v.p1[0]), 3), round(float(v.p1[1]), 3)],
                    "p2": [round(float(v.p2[0]), 3), round(float(v.p2[1]), 3)],
                    "angle_deg": round(v.angle_deg(), 3)}
                for k, v in self.lines.items()},
        }
        if m and m.valid:
            data["centering"] = {
                "left_right": {
                    "left_pct": round(m.lr.low_pct, 2), "right_pct": round(m.lr.high_pct, 2),
                    "left_px": round(m.lr.low, 2), "right_px": round(m.lr.high, 2),
                    "per_sample_left_pct": [round(v, 2) for v in m.lr.sample_pcts()],
                    "per_sample_left_px": [round(v, 2) for v in m.lr.low_margins],
                    "per_sample_right_px": [round(v, 2) for v in m.lr.high_margins],
                    "spread_pct": round(m.lr.spread, 2)},
                "top_bottom": {
                    "top_pct": round(m.tb.low_pct, 2), "bottom_pct": round(m.tb.high_pct, 2),
                    "top_px": round(m.tb.low, 2), "bottom_px": round(m.tb.high, 2),
                    "per_sample_top_pct": [round(v, 2) for v in m.tb.sample_pcts()],
                    "per_sample_top_px": [round(v, 2) for v in m.tb.low_margins],
                    "per_sample_bottom_px": [round(v, 2) for v in m.tb.high_margins],
                    "spread_pct": round(m.tb.spread, 2)},
                "worst_side_pct": round(m.worst_pct(), 2),
                "card_side": side,
                "grade_ceilings": {c.grader: {"grade": c.grade,
                                              "descriptor": c.descriptor}
                                   for c in grades.ceilings(m, side)},
                "grade_note": ("Centering only. Corners, edges and surface are "
                               "not assessed, so the actual grade can be lower."),
            }
        return data

    def apply_state(self, blob: dict) -> None:
        """Restore transform, sample count and lines from a saved session."""
        t = blob.get("transform", {})
        self.transform.angle = t.get("angle", 0.0)
        self.transform.scale = t.get("scale", 1.0)
        self.transform.pan = vec(*t.get("pan", (0, 0)))
        self.transform.center = vec(*t.get("center", (0, 0)))
        self.n_samples = blob.get("n_samples", 3)
        for k, (p1, p2) in blob.get("lines", {}).items():
            if k in SIDES:
                self.lines[k] = Line(vec(*p1), vec(*p2))
        self._undo.clear()
        self._redo.clear()
