"""Right-hand side panels: per-stage controls and the live centering readout."""

from __future__ import annotations

import tkinter as tk
from tkinter import ttk

from .. import grades
from ..session import LABELS, SIDES
from ..model import INNER, OUTER, PRETTY
from ..tint import MODES as TINT_MODES
from . import theme

MAX_SAMPLES = 9


class ScrollFrame(ttk.Frame):
    """Vertically scrollable container, so the stage tabs stay usable on a
    short window while the results panel keeps its place at the bottom."""

    def __init__(self, master):
        super().__init__(master)
        self.canvas = tk.Canvas(self, bg=theme.PANEL, highlightthickness=0, bd=0)
        self.bar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self._on_scroll)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.inner = ttk.Frame(self.canvas)
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>", self._resize)
        self.canvas.bind("<Configure>", self._stretch)
        self.canvas.bind("<MouseWheel>", self._wheel)
        self.inner.bind_all("<MouseWheel>", self._wheel_global, add="+")

    def _on_scroll(self, lo, hi):
        # Only take up scrollbar space when there is something to scroll.
        if float(lo) <= 0.0 and float(hi) >= 1.0:
            self.bar.pack_forget()
        elif not self.bar.winfo_ismapped():
            # `before` matters: the canvas expands, so a bar packed after it
            # would be allocated zero width.
            self.bar.pack(side="right", fill="y", before=self.canvas)
        self.bar.set(lo, hi)

    def _resize(self, _e=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _stretch(self, e):
        self.canvas.itemconfigure(self._win, width=e.width)

    def _wheel(self, e):
        self.canvas.yview_scroll(-1 if e.delta > 0 else 1, "units")
        return "break"

    def _wheel_global(self, e):
        w = e.widget
        while w is not None:
            if w is self.inner:
                return self._wheel(e)
            w = getattr(w, "master", None)


class Collapsible(ttk.Frame):
    """A header you click to fold a block away.

    The side panel has more to say than fits at once; folding the parts you
    are not using keeps the live numbers and the stage controls both on screen.
    """

    def __init__(self, master, title, open_=False, padding=(0, 0)):
        super().__init__(master, padding=padding)
        self.title = title
        self.open = bool(open_)
        self.header = ttk.Button(self, text="", style="Link.TButton",
                                 command=self.toggle)
        self.header.pack(fill="x")
        self.body = ttk.Frame(self)
        self._sync()

    def _sync(self):
        self.header.configure(text=("▾  " if self.open else "▸  ") + self.title)
        if self.open:
            self.body.pack(fill="x")
        else:
            self.body.pack_forget()

    def toggle(self):
        self.open = not self.open
        self._sync()


# --------------------------------------------------------------------- stages
class RotationPanel(ttk.Frame):
    """Stage 1: get the card square to the screen and sized to work with."""

    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        self._sync = False

        ttk.Label(self, text="Straighten the scan", style="Head.TLabel").pack(anchor="w")
        ttk.Label(self, wraplength=290, style="Muted.TLabel",
                  text="Drag on the image to rotate, wheel to zoom, right-drag "
                       "to pan. Centering ratios are unaffected by this stage; "
                       "it exists so the next two stages are easy to judge."
                  ).pack(anchor="w", pady=(2, 10))

        ttk.Label(self, text="Rotation (degrees)").pack(anchor="w")
        row = ttk.Frame(self); row.pack(fill="x", pady=(2, 2))
        self.angle = tk.DoubleVar(value=0.0)
        self.angle_scale = ttk.Scale(row, from_=-45, to=45, variable=self.angle,
                                     command=lambda *_: self._push_angle())
        self.angle_scale.pack(side="left", fill="x", expand=True)
        self.angle_box = ttk.Spinbox(row, from_=-180, to=180, increment=0.1, width=7,
                                     textvariable=self.angle,
                                     command=self._push_angle)
        self.angle_box.pack(side="left", padx=(6, 0))
        self.angle_box.bind("<Return>", lambda e: self._push_angle())

        row = ttk.Frame(self); row.pack(fill="x", pady=(4, 10))
        for label, d in (("-1.0", -1.0), ("-0.1", -0.1), ("+0.1", 0.1), ("+1.0", 1.0)):
            ttk.Button(row, text=label, width=5,
                       command=lambda d=d: self._bump(d)).pack(side="left", padx=1)
        ttk.Button(row, text="0", width=3, command=lambda: self._set_angle(0.0)
                   ).pack(side="left", padx=(6, 1))

        row = ttk.Frame(self); row.pack(fill="x", pady=(0, 12))
        ttk.Button(row, text="Rotate -90", command=lambda: self._bump(-90)
                   ).pack(side="left", padx=1)
        ttk.Button(row, text="Rotate +90", command=lambda: self._bump(90)
                   ).pack(side="left", padx=1)

        ttk.Label(self, text="Zoom").pack(anchor="w")
        row = ttk.Frame(self); row.pack(fill="x", pady=(2, 2))
        self.zoom = tk.DoubleVar(value=100.0)
        ttk.Scale(row, from_=5, to=800, variable=self.zoom,
                  command=lambda *_: self._push_zoom()).pack(side="left", fill="x",
                                                             expand=True)
        self.zoom_box = ttk.Spinbox(row, from_=5, to=4000, increment=5, width=7,
                                    textvariable=self.zoom, command=self._push_zoom)
        self.zoom_box.pack(side="left", padx=(6, 0))
        self.zoom_box.bind("<Return>", lambda e: self._push_zoom())

        row = ttk.Frame(self); row.pack(fill="x", pady=(8, 0))
        ttk.Button(row, text="Fit scan", command=app.fit_view).pack(side="left")
        ttk.Button(row, text="Home", command=app.home_view).pack(side="left", padx=(4, 0))
        self.grid_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(row, text="Alignment grid", variable=self.grid_var,
                        command=self._toggle_grid).pack(side="left", padx=(10, 0))

    def _toggle_grid(self):
        self.app.canvas.show_grid = self.grid_var.get()
        self.app.canvas.request_redraw()

    def _bump(self, d):
        self._set_angle(self.app.model.transform.angle + d)

    def _set_angle(self, a):
        """Rotate about the middle of the viewport, not the image centre, so
        whatever the user is looking at stays where it is."""
        a = (float(a) + 180.0) % 360.0 - 180.0
        t = self.app.model.transform
        w, h = self.app.canvas.canvas_size()
        t.rotate_about((w / 2.0, h / 2.0), a - t.angle)
        self.app.canvas._photo_key = None
        self.refresh()
        self.app.canvas.request_redraw()
        self.app.refresh_results()

    def _push_angle(self):
        if self._sync:
            return
        try:
            self._set_angle(float(self.angle.get()))
        except (tk.TclError, ValueError):
            pass

    def _push_zoom(self):
        if self._sync:
            return
        try:
            z = max(1.0, float(self.zoom.get())) / 100.0
        except (tk.TclError, ValueError):
            return
        t = self.app.model.transform
        w, h = self.app.canvas.canvas_size()
        t.zoom_about((w / 2, h / 2), z / t.scale if t.scale else 1.0)
        self.app.canvas.request_redraw()
        self.app.status_transform()

    def refresh(self):
        t = self.app.model.transform
        self._sync = True
        self.angle.set(round(t.angle, 2))
        self.zoom.set(round(t.scale * 100, 1))
        self._sync = False


class LineChooser(ttk.LabelFrame):
    """Radio list of the eight lines, so the keyboard can drive the nudges."""

    def __init__(self, master, app, text="Selected line"):
        super().__init__(master, text=text, padding=8)
        self.app = app
        self.var = tk.StringVar(value="")
        cols = ttk.Frame(self); cols.pack(fill="x")
        left = ttk.Frame(cols); left.pack(side="left", expand=True, fill="x")
        right = ttk.Frame(cols); right.pack(side="left", expand=True, fill="x")
        ttk.Label(left, text="OUTER", style="Mono.TLabel").pack(anchor="w")
        for k in OUTER:
            ttk.Radiobutton(left, text=PRETTY[k].split(" ", 1)[1].title(),
                            value=k, variable=self.var,
                            command=self._pick).pack(anchor="w")
        ttk.Label(right, text="INNER", style="Mono.TLabel").pack(anchor="w")
        for k in INNER:
            ttk.Radiobutton(right, text=PRETTY[k].split(" ", 1)[1].title(),
                            value=k, variable=self.var,
                            command=self._pick).pack(anchor="w")

    def _pick(self):
        key = self.var.get()
        if not key:
            return
        c = self.app.canvas
        idx = None if c.stage == "bulk" else 0
        c.selected = (key, idx)
        c.request_redraw()

    def refresh(self):
        sel = self.app.canvas.selected
        self.var.set(sel[0] if sel else "")


class NudgePad(ttk.Frame):
    def __init__(self, master, app):
        super().__init__(master)
        self.app = app
        grid = ttk.Frame(self); grid.pack()
        ttk.Button(grid, text="▲", width=3,
                   command=lambda: app.canvas.nudge(0, -1)).grid(row=0, column=1, pady=1)
        ttk.Button(grid, text="◀", width=3,
                   command=lambda: app.canvas.nudge(-1, 0)).grid(row=1, column=0, padx=1)
        ttk.Button(grid, text="▶", width=3,
                   command=lambda: app.canvas.nudge(1, 0)).grid(row=1, column=2, padx=1)
        ttk.Button(grid, text="▼", width=3,
                   command=lambda: app.canvas.nudge(0, 1)).grid(row=2, column=1, pady=1)


class BulkPanel(ttk.Frame):
    """Stage 2: one handle per line, sliding it along its own normal."""

    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        ttk.Label(self, text="Place the eight lines", style="Head.TLabel").pack(anchor="w")
        ttk.Label(self, wraplength=290, style="Muted.TLabel",
                  text="Each line carries one handle at its midpoint. Dragging "
                       "slides the whole line along its normal, so its angle "
                       "never changes. Alt+drag moves all four lines of that "
                       "frame together."
                  ).pack(anchor="w", pady=(2, 10))

        ttk.Button(self, text="Auto-detect both frames", style="Accent.TButton",
                   command=app.auto_detect).pack(fill="x")
        row = ttk.Frame(self); row.pack(fill="x", pady=(6, 10))
        ttk.Button(row, text="Straighten all", command=app.straighten
                   ).pack(side="left", expand=True, fill="x", padx=(0, 3))
        ttk.Button(row, text="Reset lines", command=app.reset_lines
                   ).pack(side="left", expand=True, fill="x", padx=(3, 0))

        self.chooser = LineChooser(self, app)
        self.chooser.pack(fill="x", pady=(0, 10))

        row = ttk.Frame(self); row.pack(fill="x")
        NudgePad(row, app).pack(side="left")
        box = ttk.Frame(row); box.pack(side="left", padx=(14, 0))
        ttk.Label(box, text="Nudge step (px)").pack(anchor="w")
        self.step = tk.DoubleVar(value=1.0)
        ttk.Spinbox(box, from_=0.1, to=50, increment=0.1, width=8,
                    textvariable=self.step,
                    command=self._push_step).pack(anchor="w", pady=2)
        ttk.Label(box, text="Shift = x0.2   Ctrl = x5", style="Mono.TLabel").pack(anchor="w")

    def _push_step(self):
        try:
            self.app.canvas.nudge_step = max(0.01, float(self.step.get()))
        except (tk.TclError, ValueError):
            pass

    def refresh(self):
        self.chooser.refresh()


class PrecisionPanel(ttk.Frame):
    """Stage 3: two handles per line, lines drawn to infinite length."""

    def __init__(self, master, app):
        super().__init__(master, padding=10)
        self.app = app
        ttk.Label(self, text="Match tilted borders", style="Head.TLabel").pack(anchor="w")
        ttk.Label(self, wraplength=290, style="Muted.TLabel",
                  text="Every line now has two handles and is drawn to the full "
                       "extent of the view. Drag one end to pivot about the "
                       "other, shift+drag to slide the line without changing "
                       "its angle, ctrl+drag for fine control."
                  ).pack(anchor="w", pady=(2, 10))

        ttk.Button(self, text="Reset handles near corners",
                   command=app.snap_handles).pack(fill="x")
        ttk.Button(self, text="Straighten selected line",
                   command=app.straighten_selected).pack(fill="x", pady=(6, 10))

        box = ttk.LabelFrame(self, text="Magnifier", padding=8)
        box.pack(fill="x", pady=(0, 10))
        self.loupe_on = tk.BooleanVar(value=True)
        ttk.Checkbutton(box, text="Show magnifier at cursor", variable=self.loupe_on,
                        command=self._toggle).pack(anchor="w")
        row = ttk.Frame(box); row.pack(fill="x", pady=(6, 0))
        ttk.Label(row, text="Zoom").pack(side="left")
        self.zoom = tk.DoubleVar(value=6.0)
        ttk.Scale(row, from_=2, to=20, variable=self.zoom,
                  command=self._push_zoom).pack(side="left", fill="x", expand=True,
                                                padx=(6, 0))

        self.chooser = LineChooser(self, app, text="Selected line (handle 1)")
        self.chooser.pack(fill="x", pady=(0, 10))

        row = ttk.Frame(self); row.pack(fill="x")
        NudgePad(row, app).pack(side="left")
        info = ttk.Frame(row); info.pack(side="left", padx=(14, 0))
        ttk.Label(info, text="Handle").pack(anchor="w")
        self.handle_var = tk.IntVar(value=0)
        ttk.Radiobutton(info, text="end 1", value=0, variable=self.handle_var,
                        command=self._pick_handle).pack(anchor="w")
        ttk.Radiobutton(info, text="end 2", value=1, variable=self.handle_var,
                        command=self._pick_handle).pack(anchor="w")
        self.angle_lbl = ttk.Label(self, text="", style="Mono.TLabel")
        self.angle_lbl.pack(anchor="w", pady=(8, 0))

    def _toggle(self):
        self.app.canvas.show_loupe = self.loupe_on.get()
        self.app.canvas.request_redraw()

    def _push_zoom(self, *_):
        self.app.canvas.loupe_zoom = float(self.zoom.get())
        self.app.canvas.request_redraw()

    def _pick_handle(self):
        sel = self.app.canvas.selected
        if sel:
            self.app.canvas.selected = (sel[0], self.handle_var.get())
            self.app.canvas.request_redraw()

    def refresh(self):
        self.chooser.refresh()
        sel = self.app.canvas.selected
        if sel and sel[0] in self.app.model.lines:
            if sel[1] is not None:
                self.handle_var.set(sel[1])
            line = self.app.model.lines[sel[0]]
            horizontal = sel[0].endswith("top") or sel[0].endswith("bottom")
            tilt = line.angle_deg() - (0.0 if horizontal else 90.0)
            tilt = (tilt + 90.0) % 180.0 - 90.0
            self.angle_lbl.configure(
                text="%s   tilt %+.2f deg from %s"
                     % (PRETTY[sel[0]], tilt, "horizontal" if horizontal else "vertical"))
        else:
            self.angle_lbl.configure(text="no line selected")


class AdvancedPanel(Collapsible):
    """Collapsed by default: line colours and image treatments.

    None of it touches the measurement -- it is all about being able to see a
    boundary against whatever art happens to be underneath it.
    """

    def __init__(self, master, app):
        super().__init__(master, "Advanced options", padding=(10, 4))
        self.app = app

        row = ttk.Frame(self.body); row.pack(fill="x")
        ttk.Label(row, text="Line colour", width=12).pack(side="left")
        self.scheme = tk.StringVar(value=theme.DEFAULT_SCHEME)
        box = ttk.Combobox(row, textvariable=self.scheme, state="readonly",
                           width=13, values=list(theme.SCHEME_NAMES))
        box.pack(side="left")
        box.bind("<<ComboboxSelected>>", lambda e: self._push_scheme())
        self.sw_outer = tk.Canvas(row, width=16, height=16, highlightthickness=0, bd=0)
        self.sw_outer.pack(side="left", padx=(6, 2))
        self.sw_inner = tk.Canvas(row, width=16, height=16, highlightthickness=0, bd=0)
        self.sw_inner.pack(side="left")

        row = ttk.Frame(self.body); row.pack(fill="x", pady=(6, 0))
        ttk.Label(row, text="Line width", width=12).pack(side="left")
        self.width = tk.IntVar(value=1)
        ttk.Spinbox(row, from_=1, to=4, width=4, textvariable=self.width,
                    command=self._push_width).pack(side="left")
        ttk.Label(row, text="card edge / border edge", style="Mono.TLabel"
                  ).pack(side="left", padx=(8, 0))

        ttk.Separator(self.body, orient="horizontal").pack(fill="x", pady=8)

        row = ttk.Frame(self.body); row.pack(fill="x")
        ttk.Label(row, text="Image tint", width=12).pack(side="left")
        self.tint = tk.StringVar(value="None")
        box = ttk.Combobox(row, textvariable=self.tint, state="readonly",
                           width=13, values=list(TINT_MODES))
        box.pack(side="left")
        box.bind("<<ComboboxSelected>>", lambda e: self._push_tint())

        row = ttk.Frame(self.body); row.pack(fill="x", pady=(6, 0))
        ttk.Label(row, text="Strength", width=12).pack(side="left")
        self.strength = tk.DoubleVar(value=60.0)
        ttk.Scale(row, from_=0, to=100, variable=self.strength,
                  command=lambda *_: self._push_tint()).pack(side="left", fill="x",
                                                             expand=True)
        ttk.Label(self.body, style="Mono.TLabel", wraplength=290,
                  text="Tinting only changes how the card is displayed and "
                       "exported, never the measurement."
                  ).pack(anchor="w", pady=(8, 0))
        self._paint_swatches()

    def _paint_swatches(self):
        cols = theme.scheme_colors(self.scheme.get())
        for canvas, key in ((self.sw_outer, "outer"), (self.sw_inner, "inner")):
            canvas.configure(bg=cols[key])

    def _push_scheme(self):
        self.app.canvas.scheme = self.scheme.get()
        self._paint_swatches()
        self.app.canvas.request_redraw()
        self.app.results.restyle()

    def _push_width(self):
        try:
            self.app.canvas.line_width = max(1, min(4, int(self.width.get())))
        except (tk.TclError, ValueError):
            return
        self.app.canvas.request_redraw()

    def _push_tint(self):
        c = self.app.canvas
        c.tint_mode = self.tint.get()
        c.tint_strength = float(self.strength.get())
        c._photo_key = None
        c.request_redraw()


# ----------------------------------------------------------------- results
class Bar(tk.Canvas):
    """A split bar showing one axis, with a tick at true centre."""

    def __init__(self, master, low_color, high_color, height=16):
        super().__init__(master, height=height, bg=theme.PANEL2,
                         highlightthickness=0, bd=0)
        self.low_color = low_color
        self.high_color = high_color
        self.pct = 50.0
        self.valid = False
        self.bind("<Configure>", lambda e: self.render())

    def set(self, pct, valid=True):
        self.pct = pct
        self.valid = valid
        self.render()

    def render(self):
        self.delete("all")
        w = max(1, self.winfo_width())
        h = max(1, self.winfo_height())
        if not self.valid:
            self.create_rectangle(0, 0, w, h, fill=theme.PANEL2, outline="")
            return
        x = w * self.pct / 100.0
        self.create_rectangle(0, 0, x, h, fill=self.low_color, outline="")
        self.create_rectangle(x, 0, w, h, fill=self.high_color, outline="")
        self.create_line(w / 2, 0, w / 2, h, fill="#ffffff", width=1, dash=(3, 3))


class ResultsPanel(ttk.Frame):
    """Always-visible live centering readout."""

    def __init__(self, master, app):
        super().__init__(master, padding=(10, 8))
        self.app = app
        self.rows = []

        head = ttk.Frame(self); head.pack(fill="x")
        self.centering_lbl = ttk.Label(head, text="CENTERING", style="Head.TLabel")
        self.centering_lbl.pack(side="left")
        ttk.Label(head, text="samples/axis", style="Mono.TLabel").pack(side="left",
                                                                      padx=(10, 4))
        self.n_var = tk.IntVar(value=3)
        ttk.Spinbox(head, from_=1, to=MAX_SAMPLES, width=3, textvariable=self.n_var,
                    command=self._push_n).pack(side="left")

        self.lr_val = ttk.Label(self, text="--", style="Big.TLabel")
        self.lr_val.pack(anchor="w", pady=(6, 0))
        ttk.Label(self, text="LEFT / RIGHT", style="Mono.TLabel").pack(anchor="w")
        self.lr_bar = Bar(self, theme.OUTER_C, theme.PANEL2)
        self.lr_bar.pack(fill="x", pady=(3, 2))
        self.lr_px = ttk.Label(self, text="", style="Mono.TLabel")
        self.lr_px.pack(anchor="w")

        self.tb_val = ttk.Label(self, text="--", style="Big.TLabel")
        self.tb_val.pack(anchor="w", pady=(8, 0))
        ttk.Label(self, text="TOP / BOTTOM", style="Mono.TLabel").pack(anchor="w")
        self.tb_bar = Bar(self, theme.INNER_C, theme.PANEL2)
        self.tb_bar.pack(fill="x", pady=(3, 2))
        self.tb_px = ttk.Label(self, text="", style="Mono.TLabel")
        self.tb_px.pack(anchor="w")

        self.warn = ttk.Label(self, text="", style="Mono.TLabel", wraplength=290)
        self.warn.pack(anchor="w", pady=(8, 0))

        self.table_box = Collapsible(self, "Per-sample detail", open_=False)
        self.table_box.pack(fill="x", pady=(6, 0))
        self.table = ttk.Frame(self.table_box.body, padding=(2, 4))
        self.table.pack(fill="x")
        self._build_table(3)

        ttk.Separator(self, orient="horizontal").pack(fill="x", pady=(10, 6))
        head = ttk.Frame(self); head.pack(fill="x")
        ttk.Label(head, text="GRADE CEILING", style="Head.TLabel").pack(side="left")
        self.sides_lbl = ttk.Label(head, text="", style="Mono.TLabel")
        self.sides_lbl.pack(side="right")

        grid = ttk.Frame(self); grid.pack(fill="x", pady=(6, 0))
        for col, g in enumerate(grades.GRADERS):
            ttk.Label(grid, text=g, style="Mono.TLabel").grid(
                row=0, column=col + 1, padx=(0, 14), sticky="w")

        self.grade_cells = {}
        rows = [(side, LABELS[side]) for side in SIDES] + [("final", "Final")]
        for r, (key, label) in enumerate(rows, start=1):
            style = "Head.TLabel" if key == "final" else "Muted.TLabel"
            ttk.Label(grid, text=label, style=style).grid(row=r, column=0,
                                                          sticky="w", padx=(0, 12))
            for col, g in enumerate(grades.GRADERS):
                cell = ttk.Label(grid, text="--",
                                 style="Grade.TLabel" if key == "final"
                                 else "GradeSmall.TLabel")
                cell.grid(row=r, column=col + 1, sticky="w", padx=(0, 14))
                self.grade_cells[(key, g)] = cell

        self.guide = ttk.Label(self, text="", style="Mono.TLabel", wraplength=300)
        self.guide.pack(anchor="w", pady=(6, 0))

    def restyle(self):
        """Follow the line colour scheme, so the bars match the overlay."""
        cols = theme.scheme_colors(self.app.canvas.scheme)
        self.lr_bar.low_color = cols["outer"]
        self.tb_bar.low_color = cols["inner"]
        self.lr_bar.render()
        self.tb_bar.render()

    def _push_n(self):
        try:
            self.app.model.n_samples = max(1, min(MAX_SAMPLES, int(self.n_var.get())))
        except (tk.TclError, ValueError):
            return
        self._build_table(self.app.model.n_samples)
        self.app.canvas.request_redraw()
        self.app.refresh_results()

    def _build_table(self, n):
        for child in self.table.winfo_children():
            child.destroy()
        self.rows = []
        headers = ("#", "L px", "R px", "L %", "T px", "B px", "T %")
        for c, text in enumerate(headers):
            ttk.Label(self.table, text=text, style="Mono.TLabel").grid(
                row=0, column=c, sticky="w", padx=(0, 7))
        for r in range(n):
            cells = []
            for c in range(7):
                lbl = ttk.Label(self.table, text="-", font=("Consolas", 9))
                lbl.grid(row=r + 1, column=c, sticky="w", padx=(0, 7))
                cells.append(lbl)
            cells[0].configure(text=str(r + 1), style="Mono.TLabel")
            self.rows.append(cells)

    def refresh(self):
        self.centering_lbl.configure(
            text="CENTERING \u00b7 %s" % LABELS[self.app.session.active].upper())
        m = self.app.model.measure()
        if m is None or not m.valid:
            self.lr_val.configure(text="--")
            self.tb_val.configure(text="--")
            self.lr_bar.set(50, False)
            self.tb_bar.set(50, False)
            self.lr_px.configure(text="")
            self.tb_px.configure(text="")
            self._set_grades(None)
            self.warn.configure(text="Lines do not form a valid frame.",
                                foreground=theme.MUTED)
            for row in self.rows:
                for c in row[1:]:
                    c.configure(text="-")
            return

        self.lr_val.configure(text=m.lr.text())
        self.tb_val.configure(text=m.tb.text())
        self.lr_bar.set(m.lr.low_pct)
        self.tb_bar.set(m.tb.low_pct)
        self.lr_px.configure(text="left %.1f px   right %.1f px   spread %.1f%%"
                                  % (m.lr.low, m.lr.high, m.lr.spread))
        self.tb_px.configure(text="top %.1f px   bottom %.1f px   spread %.1f%%"
                                  % (m.tb.low, m.tb.high, m.tb.spread))
        if m.crossed:
            bad = "left/right" if m.lr.crossed else "top/bottom"
            self.warn.configure(
                text="An outer line is sitting inside its inner line on the %s "
                     "axis, so these percentages are not meaningful." % bad,
                foreground=theme.SEL_C)
            self._set_grades(None)
            self._fill_table(m)
            return

        worst_spread = max(m.lr.spread, m.tb.spread)
        self._set_grades(m)
        if worst_spread > 4.0:
            self.warn.configure(
                text="Samples disagree by %.1f%%: the inner and outer frames are "
                     "not parallel. Use stage 3 to match the tilt." % worst_spread,
                foreground=theme.INNER_C)
        elif worst_spread > 1.5:
            self.warn.configure(text="Slight sample spread (%.1f%%); check the "
                                     "line angles in stage 3." % worst_spread,
                                foreground=theme.MUTED)
        else:
            self.warn.configure(text="Samples agree to within %.1f%%."
                                     % worst_spread, foreground=theme.MUTED)

        self._fill_table(m)

    def _set_grades(self, _m=None):
        """Per-side ceilings plus the final one, which is the worse of the two.

        A grader states a tolerance for each face and the card has to satisfy
        both, so the final row follows whichever side reads worse.
        """
        session = self.app.session
        for side in SIDES:
            cs = {c.grader: c for c in session.side_ceilings(side)}
            for g in grades.GRADERS:
                c = cs.get(g)
                self.grade_cells[(side, g)].configure(
                    text=c.grade if c else "--",
                    foreground=theme.TEXT if c else theme.MUTED)

        finals = {c.grader: c for c in session.final_ceilings()}
        for g in grades.GRADERS:
            c = finals.get(g)
            self.grade_cells[("final", g)].configure(
                text=c.grade if c else "--",
                foreground=theme.TEXT if c else theme.MUTED)

        loaded = session.loaded_sides()
        self.sides_lbl.configure(
            text="both sides" if len(loaded) == 2
            else (loaded[0] + " only" if loaded else "no image"))

        if not finals:
            self.guide.configure(text="Place the lines to get a grade estimate.",
                                 foreground=theme.MUTED)
            return

        parts = ["Centering only, and a ceiling rather than a prediction \u2014 "
                 "corners, edges and surface are not assessed."]
        if len(loaded) < 2:
            other = grades.BACK if loaded[0] == grades.FRONT else grades.FRONT
            parts.append("The %s has not been measured and could pull this down."
                         % other)
        else:
            limiting = session.limiting_side()
            if limiting:
                parts.append("The %s is holding it down." % limiting)
        self.guide.configure(text=" ".join(parts), foreground=theme.MUTED)

    def _fill_table(self, m):
        lr, tb = m.lr.sample_pcts(), m.tb.sample_pcts()
        for r, row in enumerate(self.rows):
            if r < len(lr):
                row[1].configure(text="%.1f" % m.lr.low_margins[r])
                row[2].configure(text="%.1f" % m.lr.high_margins[r])
                row[3].configure(text="%.1f" % lr[r])
            if r < len(tb):
                row[4].configure(text="%.1f" % m.tb.low_margins[r])
                row[5].configure(text="%.1f" % m.tb.high_margins[r])
                row[6].configure(text="%.1f" % tb[r])
