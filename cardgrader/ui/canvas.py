"""The interactive image canvas: renders the card and the eight lines, and
implements the three editing stages.

Stage 1 "rotate"    -- drag rotates, wheel scales, right-drag pans.
Stage 2 "bulk"      -- one handle per line, dragging slides the whole line
                       along its own normal so its angle is preserved.
Stage 3 "precision" -- two handles per line, each line drawn to the full
                       extent of the canvas so a tilted border can be matched.
"""

from __future__ import annotations

import math
import sys
import tkinter as tk

import numpy as np
from PIL import Image, ImageTk

from ..geometry import Line, clip_line_to_rect, vec
from ..tint import apply_tint
from ..model import INNER, OUTER, PRETTY
from ..transform import ViewTransform
from . import theme

HIT_RADIUS = 14.0
LOUPE_SIZE = 220

SHIFT_MASK = 0x0001
CTRL_MASK = 0x0004
# Tk reports Alt differently per platform, and on Windows bit 0x0008 is Num
# Lock -- testing it there made every bulk drag look like alt+drag whenever
# Num Lock happened to be on.
if sys.platform.startswith("win"):
    ALT_MASK = 0x20000
elif sys.platform == "darwin":
    ALT_MASK = 0x0010
else:
    ALT_MASK = 0x0008


class CardCanvas(tk.Canvas):
    def __init__(self, master, model, on_change=None, on_status=None):
        super().__init__(master, bg=theme.BG, highlightthickness=0, bd=0)
        self.model = model
        self.on_change = on_change or (lambda: None)
        self.on_status = on_status or (lambda msg: None)

        self.stage = "rotate"
        self.selected = None          # (key, ctrl_index|None)
        self.hover = None
        self.show_samples = True
        self.show_loupe = True
        self.show_grid = False
        self.loupe_zoom = 6.0
        self.nudge_step = 1.0
        self.scheme = theme.DEFAULT_SCHEME
        self.tint_mode = "None"
        self.tint_strength = 0.0
        self.line_width = 1
        self.empty_message = "Open a card image to begin   (Ctrl+O)"

        self._photo = None
        self._photo_key = None
        self._loupe_photo = None
        self._drag = None
        self._mouse = None
        self._interacting = False
        self._pending = None
        self._size = None

        self.bind("<Configure>", self._on_configure)
        self.bind("<ButtonPress-1>", self._on_press)
        self.bind("<B1-Motion>", self._on_drag)
        self.bind("<ButtonRelease-1>", self._on_release)
        self.bind("<Motion>", self._on_motion)
        self.bind("<Leave>", self._on_leave)
        self.bind("<ButtonPress-3>", self._on_pan_start)
        self.bind("<B3-Motion>", self._on_pan_move)
        self.bind("<ButtonRelease-3>", self._on_release)
        self.bind("<MouseWheel>", self._on_wheel)
        self.bind("<Button-4>", lambda e: self._on_wheel(e, 120))
        self.bind("<Button-5>", lambda e: self._on_wheel(e, -120))

    # ------------------------------------------------------------------ misc
    def set_stage(self, stage: str) -> None:
        if stage == self.stage:
            return
        self.stage = stage
        # Entering precision: park each handle pair on the frame corners, the
        # layout the precision mock-up shows.
        if stage == "precision" and self.model.loaded:
            self.model.snapshot()
            self.model.place_handles()
        self.selected = None
        self.request_redraw()
        self.on_change()

    def _on_configure(self, e):
        """Hold the viewport still when the window resizes.

        Pan is measured in canvas pixels, so without this the card would slide
        towards a corner every time the window changed size.  Shifting pan by
        half the size delta keeps whatever is in the middle of the view in the
        middle of the view.
        """
        if self._size is not None and self.model.loaded:
            dw = e.width - self._size[0]
            dh = e.height - self._size[1]
            self.model.transform.pan = self.model.transform.pan + vec(dw / 2.0,
                                                                      dh / 2.0)
        self._size = (e.width, e.height)
        self.request_redraw()

    def set_model(self, model) -> None:
        """Point the canvas at another side's document."""
        self.model = model
        self._photo = None
        self._photo_key = None
        self.selected = None
        self.hover = None
        self._drag = None
        self.request_redraw()

    def canvas_size(self):
        w, h = self.winfo_width(), self.winfo_height()
        return (max(1, w), max(1, h))

    def request_redraw(self) -> None:
        """Coalesce redraws so a fast mouse cannot outrun rendering."""
        if self._pending is None:
            self._pending = self.after_idle(self._do_redraw)

    def _do_redraw(self):
        self._pending = None
        self.redraw()

    def color(self, key: str) -> str:
        return theme.color_for(key, self.scheme)

    # -------------------------------------------------------------- geometry
    def v(self, p) -> np.ndarray:
        return self.model.transform.img_to_view(p)

    def i(self, p) -> np.ndarray:
        return self.model.transform.view_to_img(p)

    def handles(self):
        """[(key, ctrl_index|None, view_point)] for the current stage."""
        out = []
        if not self.model.lines:
            return out
        if self.stage == "bulk":
            for key in list(OUTER) + list(INNER):
                pa, pb = self.model.segment(key)
                out.append((key, None, self.v((np.asarray(pa) + np.asarray(pb)) * 0.5)))
        elif self.stage == "precision":
            for key in list(OUTER) + list(INNER):
                line = self.model.lines[key]
                out.append((key, 0, self.v(line.p1)))
                out.append((key, 1, self.v(line.p2)))
        return out

    def hit(self, x, y):
        """Closest handle within the grab radius.

        Ties break towards the line already selected, so working on one line
        near a busy corner does not keep jumping to its neighbour.
        """
        best, best_d = None, HIT_RADIUS
        for key, idx, p in self.handles():
            d = math.hypot(p[0] - x, p[1] - y)
            if d < best_d - 0.5 or (
                    d < best_d + 0.5 and self.selected and key == self.selected[0]):
                best, best_d = (key, idx), d
        return best

    # --------------------------------------------------------------- events
    def _on_press(self, e):
        self.focus_set()
        if not self.model.loaded:
            return
        self._interacting = True
        if self.stage == "rotate":
            self._drag = ("rotate", vec(e.x, e.y))
            return
        target = self.hit(e.x, e.y)
        if target:
            self.model.snapshot()
            self.selected = target
            self._drag = ("handle", vec(e.x, e.y))
        else:
            self._drag = ("pan", vec(e.x, e.y))
        self.request_redraw()
        self.on_change()

    def _on_drag(self, e):
        if not self._drag or not self.model.loaded:
            return
        kind, last = self._drag
        cur = vec(e.x, e.y)
        shift = bool(e.state & SHIFT_MASK)
        ctrl = bool(e.state & CTRL_MASK)
        alt = bool(e.state & ALT_MASK)
        t = self.model.transform

        if kind == "pan":
            t.pan = t.pan + (cur - last)
        elif kind == "rotate":
            if shift:
                t.pan = t.pan + (cur - last)
            else:
                c = vec(*self.canvas_size()) * 0.5
                a0 = math.atan2(last[1] - c[1], last[0] - c[0])
                a1 = math.atan2(cur[1] - c[1], cur[0] - c[0])
                d = math.degrees(a1 - a0)
                t.rotate_about(c, d * (0.25 if ctrl else 1.0))
        elif kind == "handle" and self.selected:
            key, idx = self.selected
            line = self.model.lines[key]
            delta = t.view_delta_to_img(cur - last)
            if ctrl:
                delta = delta * 0.2                     # fine mode
            if self.stage == "bulk":
                if alt:
                    self.model.move_frame("outer" if key.startswith("outer") else "inner",
                                          line.normal() * float(np.dot(delta, line.normal())))
                else:
                    line.translate_perpendicular(delta)
            else:
                if shift:
                    line.translate_perpendicular(delta)  # move, do not pivot
                else:
                    p = np.asarray(line.p1 if idx == 0 else line.p2) + delta
                    line.set_control(idx, p)

        self._drag = (kind, cur)
        self._mouse = cur
        self.request_redraw()
        self.on_change()

    def _on_release(self, e):
        self._drag = None
        self._interacting = False
        self._photo_key = None          # force a clean, filtered re-render
        self.request_redraw()
        self.on_change()

    def _on_pan_start(self, e):
        self._interacting = True
        self._drag = ("pan", vec(e.x, e.y))

    def _on_pan_move(self, e):
        self._on_drag(e)

    def _on_motion(self, e):
        self._mouse = vec(e.x, e.y)
        if self.model.loaded and self.stage != "rotate":
            h = self.hit(e.x, e.y)
            if h != self.hover:
                self.hover = h
                self.configure(cursor="hand2" if h else "")
        self._report_position()
        if self.stage == "precision" and self.show_loupe:
            self.request_redraw()
        elif self.hover is not None or self.stage != "rotate":
            self.request_redraw()

    def _on_leave(self, e):
        self._mouse = None
        self.hover = None
        self.request_redraw()

    def _on_wheel(self, e, delta=None):
        if not self.model.loaded:
            return
        d = delta if delta is not None else e.delta
        ctrl = bool(e.state & CTRL_MASK)
        t = self.model.transform
        if ctrl and self.stage == "rotate":
            t.rotate_about(vec(e.x, e.y), 0.25 * (1 if d > 0 else -1))
        else:
            t.zoom_about(vec(e.x, e.y), 1.12 if d > 0 else 1 / 1.12)
        self.request_redraw()
        self.on_change()

    def nudge(self, dx, dy, factor=1.0):
        """Arrow-key movement of the current selection, in image pixels."""
        if not self.selected or self.stage == "rotate":
            return
        self.model.snapshot()
        key, idx = self.selected
        line = self.model.lines[key]
        step = self.nudge_step * factor
        delta = self.model.transform.view_delta_to_img(vec(dx, dy) * step
                                                       * self.model.transform.scale)
        if self.stage == "bulk" or idx is None:
            line.translate_perpendicular(delta)
        else:
            line.set_control(idx, np.asarray(line.p1 if idx == 0 else line.p2) + delta)
        self.request_redraw()
        self.on_change()

    def _report_position(self):
        if self._mouse is None or not self.model.loaded:
            return
        p = self.i(self._mouse)
        t = self.model.transform
        self.on_status("x %.1f  y %.1f   zoom %.0f%%   angle %+.2f deg"
                       % (p[0], p[1], t.scale * 100, t.angle))

    # -------------------------------------------------------------- painting
    def _render_base(self):
        w, h = self.canvas_size()
        t = self.model.transform
        key = (w, h, round(t.angle, 4), round(t.scale, 6),
               round(float(t.pan[0]), 2), round(float(t.pan[1]), 2),
               self._interacting, id(self.model.image),
               self.tint_mode, round(self.tint_strength, 1))
        if key == self._photo_key and self._photo is not None:
            return self._photo
        resample = Image.NEAREST if self._interacting else Image.BILINEAR
        frame = self.model.image.transform(
            (w, h), Image.AFFINE, t.affine_coeffs(), resample=resample,
            fillcolor=(30, 31, 34))
        frame = apply_tint(frame, self.tint_mode, self.tint_strength)
        self._photo = ImageTk.PhotoImage(frame)
        self._photo_key = key
        return self._photo

    def redraw(self):
        self.delete("all")
        w, h = self.canvas_size()
        if not self.model.loaded:
            self.create_text(w / 2, h / 2, fill=theme.MUTED, font=("Segoe UI", 13),
                             text=self.empty_message)
            return

        self.create_image(0, 0, anchor="nw", image=self._render_base())
        if self.show_grid:
            self._draw_grid(w, h)
        self._draw_lines(w, h)
        if self.show_samples and self.stage != "rotate":
            self._draw_samples()
        self._draw_handles()
        self._draw_hud(w, h)
        if self.stage == "precision" and self.show_loupe and self._mouse is not None:
            self._draw_loupe(w, h)

    def _draw_grid(self, w, h):
        step = 60
        for x in range(step, w, step):
            self.create_line(x, 0, x, h, fill=theme.GRID_C, width=1, stipple="gray25")
        for y in range(step, h, step):
            self.create_line(0, y, w, y, fill=theme.GRID_C, width=1, stipple="gray25")
        self.create_line(w // 2, 0, w // 2, h, fill=theme.GRID_C, width=1)
        self.create_line(0, h // 2, w, h // 2, fill=theme.GRID_C, width=1)

    def _draw_lines(self, w, h):
        infinite = self.stage == "precision"
        for key in list(OUTER) + list(INNER):
            line = self.model.lines[key]
            col = self.color(key)
            sel = self.selected and self.selected[0] == key
            width = self.line_width + 1 if sel else self.line_width
            if infinite:
                # Draw the true infinite line, clipped to the visible canvas.
                vp = Line(self.v(line.p1), self.v(line.p2))
                span = clip_line_to_rect(vp, -2, -2, w + 2, h + 2)
                if span:
                    a, b = span
                    self.create_line(a[0], a[1], b[0], b[1], fill=col, width=width)
            else:
                pa, pb = (self.v(p) for p in self.model.segment(key))
                self.create_line(pa[0], pa[1], pb[0], pb[1], fill=col, width=width)

    def _draw_handles(self):
        if self.stage == "rotate":
            return
        for key, idx, p in self.handles():
            sel = self.selected == (key, idx)
            hov = self.hover == (key, idx)
            r = 6.0 if self.stage == "bulk" else 5.0
            if sel:
                r += 1.5
            fill = theme.SEL_C if sel else self.color(key)
            outline = theme.HOVER_C if (hov or sel) else "#111417"
            self.create_oval(p[0] - r, p[1] - r, p[0] + r, p[1] + r,
                             fill=fill, outline=outline, width=2)

    def _draw_samples(self):
        m = self.model.measure()
        if not m or not m.valid:
            return
        for axis in (m.lr, m.tb):
            for (pa, a, b, pb) in axis.sample_points:
                va, vb = self.v(pa), self.v(pb)
                self.create_line(va[0], va[1], vb[0], vb[1],
                                 fill=theme.SAMPLE_C, width=1, dash=(4, 4))
                for q, big in ((pa, True), (a, False), (b, False), (pb, True)):
                    vq = self.v(q)
                    r = 3.0 if big else 2.5
                    self.create_oval(vq[0] - r, vq[1] - r, vq[0] + r, vq[1] + r,
                                     fill=theme.SAMPLE_C, outline="")

    def _draw_hud(self, w, h):
        titles = {"rotate": "1  ROTATION",
                  "bulk": "2  BULK MOVEMENT",
                  "precision": "3  PRECISION"}
        hints = {
            "rotate": "drag: rotate   shift+drag: pan   wheel: zoom   ctrl+wheel: 0.25 deg",
            "bulk": "drag a handle to slide a line   alt+drag: whole frame   arrows: nudge",
            "precision": "drag either end to pivot   shift+drag: slide   ctrl+drag: fine",
        }
        self.create_text(14, 14, anchor="nw", text=titles[self.stage],
                         fill=theme.TEXT, font=("Segoe UI Semibold", 11))
        self.create_text(14, 34, anchor="nw", text=hints[self.stage],
                         fill=theme.MUTED, font=("Segoe UI", 8))
        if self.selected:
            key, idx = self.selected
            label = PRETTY[key] + ("" if idx is None else "  handle %d" % (idx + 1))
            self.create_text(14, h - 16, anchor="sw", text=label,
                             fill=self.color(key), font=("Segoe UI Semibold", 9))

    def _draw_loupe(self, w, h):
        """Magnified inset around the cursor, with the lines drawn on top."""
        mx, my = float(self._mouse[0]), float(self._mouse[1])
        size = LOUPE_SIZE
        pad = 12
        # Sit in whichever corner the cursor is furthest from.
        bx = pad if mx > w / 2 else w - size - pad
        by = pad if my > h / 2 else h - size - pad

        t = self.model.transform
        lt = ViewTransform(angle=t.angle, scale=t.scale * self.loupe_zoom,
                           pan=vec(0, 0), center=t.center.copy())
        anchor = t.view_to_img((mx, my))
        lt.pan = vec(size / 2.0, size / 2.0) - lt.img_to_view(anchor)
        try:
            crop = self.model.image.transform(
                (size, size), Image.AFFINE, lt.affine_coeffs(),
                resample=Image.NEAREST, fillcolor=(30, 31, 34))
        except Exception:
            return
        crop = apply_tint(crop, self.tint_mode, self.tint_strength)
        self._loupe_photo = ImageTk.PhotoImage(crop)
        self.create_image(bx, by, anchor="nw", image=self._loupe_photo)

        for key in list(OUTER) + list(INNER):
            line = self.model.lines[key]
            vp = Line(lt.img_to_view(line.p1), lt.img_to_view(line.p2))
            span = clip_line_to_rect(vp, 0, 0, size, size)
            if span:
                a, b = span
                self.create_line(bx + a[0], by + a[1], bx + b[0], by + b[1],
                                 fill=self.color(key), width=1)
        c = size / 2.0
        self.create_line(bx + c - 8, by + c, bx + c + 8, by + c, fill="#ffffff")
        self.create_line(bx + c, by + c - 8, bx + c, by + c + 8, fill="#ffffff")
        self.create_rectangle(bx, by, bx + size, by + size,
                              outline=theme.STROKE, width=1)
        self.create_text(bx + 6, by + 6, anchor="nw", text="%.0fx" % self.loupe_zoom,
                         fill=theme.MUTED, font=("Consolas", 8))

    # ------------------------------------------------------------- exporting
    def export_overlay(self, path: str, side="front") -> None:
        """Save the card cropped and padded exactly as Home frames it, with
        the lines and the measured numbers drawn on."""
        from .. import export as export_mod

        export_mod.save_overlay(self.model, path, scheme=self.scheme,
                                tint_mode=self.tint_mode,
                                tint_strength=self.tint_strength,
                                side=side, show_samples=self.show_samples)
