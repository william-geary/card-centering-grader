"""Main window: toolbar, the three stage tabs, canvas and live results."""

from __future__ import annotations

import os
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .. import export as export_mod
from ..geometry import vec
from ..grades import BACK, FRONT
from ..session import LABELS, SIDES, Session
from . import theme
from .canvas import CardCanvas
from .panels import (AdvancedPanel, BulkPanel, PrecisionPanel, ResultsPanel,
                     RotationPanel, ScrollFrame)

HOME_FILL = 0.88   # fraction of the viewport the card fills on Home

STAGES = ("rotate", "bulk", "precision")
STAGE_TITLES = ("1  Rotation", "2  Bulk movement", "3  Precision")
IMAGE_TYPES = [("Card images", "*.png *.jpg *.jpeg *.tif *.tiff *.bmp *.webp"),
               ("All files", "*.*")]


class App(tk.Tk):
    def __init__(self, initial_image=None):
        super().__init__()
        self.title("Card Centering Grader")
        self.geometry("1440x920")
        self.minsize(1050, 700)
        theme.apply(self)

        self.session = Session()
        self._last_dir = os.path.expanduser("~")
        self._build_menu()
        self._build()
        self._bind_keys()

        if initial_image and os.path.exists(initial_image):
            self.after(120, lambda: self.open_image(initial_image))
        else:
            self.after(80, self.refresh_results)

    @property
    def model(self):
        """The document for the side currently being worked on."""
        return self.session.card

    def report_callback_exception(self, exc, val, tb):
        """Surface widget-callback errors; the packaged build has no console."""
        import traceback
        text = "".join(traceback.format_exception(exc, val, tb))
        try:
            sys.stderr.write(text)
        except Exception:
            pass
        messagebox.showerror("Something went wrong", text.strip()[-1200:])

    def _build_menu(self):
        """A real menu, so Open is reachable even if a shortcut is swallowed."""
        bar = tk.Menu(self)
        f = tk.Menu(bar, tearoff=0)
        f.add_command(label="Open image for this side...", accelerator="Ctrl+O",
                      command=self.open_image)
        f.add_command(label="Open front image...",
                      command=lambda: self.open_image_for(FRONT))
        f.add_command(label="Open back image...",
                      command=lambda: self.open_image_for(BACK))
        f.add_separator()
        f.add_command(label="Save session...", command=self.save_session)
        f.add_command(label="Open session...", command=self.load_session)
        f.add_separator()
        f.add_command(label="Export report (JSON)...", accelerator="Ctrl+S",
                      command=self.export_report)
        f.add_command(label="Export overlay (PNG)...", accelerator="Ctrl+E",
                      command=self.export_overlay)
        f.add_separator()
        f.add_command(label="Quit", command=self.destroy)
        bar.add_cascade(label="File", menu=f)

        e = tk.Menu(bar, tearoff=0)
        e.add_command(label="Undo", accelerator="Ctrl+Z", command=self.undo)
        e.add_command(label="Redo", accelerator="Ctrl+Y", command=self.redo)
        e.add_separator()
        e.add_command(label="Auto-detect frames", accelerator="A",
                      command=self.auto_detect)
        e.add_command(label="Reset lines", command=self.reset_lines)
        bar.add_cascade(label="Edit", menu=e)

        v = tk.Menu(bar, tearoff=0)
        v.add_command(label="Home (centre the card)", accelerator="H",
                      command=self.home_view)
        v.add_command(label="Fit whole scan", accelerator="F", command=self.fit_view)
        v.add_separator()
        for side in SIDES:
            v.add_command(label="Show %s" % LABELS[side].lower(),
                          command=lambda s=side: self.set_side(s))
        v.add_separator()
        for i, title in enumerate(STAGE_TITLES):
            v.add_command(label=title, accelerator=str(i + 1),
                          command=lambda i=i: self.nb.select(i))
        bar.add_cascade(label="View", menu=v)
        self.configure(menu=bar)

    # ----------------------------------------------------------------- build
    def _build(self):
        bar = ttk.Frame(self, padding=(10, 8))
        bar.pack(side="top", fill="x")
        ttk.Button(bar, text="Open image", style="Accent.TButton",
                   command=self.open_image).pack(side="left")
        ttk.Button(bar, text="Auto-detect", command=self.auto_detect
                   ).pack(side="left", padx=(6, 0))
        ttk.Button(bar, text="Reset lines", command=self.reset_lines
                   ).pack(side="left", padx=(6, 0))
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=10)
        ttk.Button(bar, text="Home", command=self.home_view).pack(side="left")
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=10)

        self.side_var = tk.StringVar(value=FRONT)
        self.side_buttons = {}
        for side in SIDES:
            b = ttk.Radiobutton(bar, text=LABELS[side], value=side,
                                variable=self.side_var, style="Side.Toolbutton",
                                command=self.switch_side)
            b.pack(side="left", padx=(0, 2))
            self.side_buttons[side] = b
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=10)
        ttk.Button(bar, text="Undo", command=self.undo).pack(side="left")
        ttk.Button(bar, text="Redo", command=self.redo).pack(side="left", padx=(6, 0))
        ttk.Separator(bar, orient="vertical").pack(side="left", fill="y", padx=10)
        ttk.Button(bar, text="< Back", command=lambda: self.step_stage(-1)).pack(side="left")
        ttk.Button(bar, text="Next >", command=lambda: self.step_stage(1)
                   ).pack(side="left", padx=(6, 0))

        ttk.Button(bar, text="Export overlay", command=self.export_overlay
                   ).pack(side="right")
        ttk.Button(bar, text="Export report", command=self.export_report
                   ).pack(side="right", padx=(0, 6))
        self.samples_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="Show sample lines", variable=self.samples_var,
                        command=self._toggle_samples).pack(side="right", padx=(0, 14))

        body = ttk.Frame(self)
        body.pack(side="top", fill="both", expand=True)

        holder = ttk.Frame(body, style="Canvas.TFrame")
        holder.pack(side="left", fill="both", expand=True)
        self.canvas = CardCanvas(holder, self.model,
                                 on_change=self.refresh_results,
                                 on_status=self.set_status)
        self.canvas.pack(fill="both", expand=True)

        side = ttk.Frame(body, width=340)
        side.pack(side="right", fill="y")
        side.pack_propagate(False)

        # Results stay pinned to the bottom; the stage tabs scroll if the
        # window is too short for them.
        self.results = ResultsPanel(side, self)
        self.results.pack(side="bottom", fill="x")
        ttk.Separator(side, orient="horizontal").pack(side="bottom", fill="x",
                                                      pady=(6, 0))

        self.scroll = ScrollFrame(side)
        self.scroll.pack(side="top", fill="both", expand=True)
        self.nb = ttk.Notebook(self.scroll.inner)
        self.nb.pack(side="top", fill="both", expand=True)
        self.rotation_panel = RotationPanel(self.nb, self)
        self.bulk_panel = BulkPanel(self.nb, self)
        self.precision_panel = PrecisionPanel(self.nb, self)
        for panel, title in zip((self.rotation_panel, self.bulk_panel,
                                 self.precision_panel), STAGE_TITLES):
            self.nb.add(panel, text=title)
        self.nb.bind("<<NotebookTabChanged>>", self._on_tab)

        ttk.Separator(self.scroll.inner, orient="horizontal").pack(fill="x",
                                                                   pady=(8, 0))
        self.advanced = AdvancedPanel(self.scroll.inner, self)
        self.advanced.pack(side="top", fill="x")

        status = ttk.Frame(self, padding=(10, 4))
        status.pack(side="bottom", fill="x")
        self.status = ttk.Label(status, text="Open a card image to begin.",
                                style="Mono.TLabel")
        self.status.pack(side="left")
        self.file_lbl = ttk.Label(status, text="", style="Mono.TLabel")
        self.file_lbl.pack(side="right")

    def _bind_keys(self):
        self.bind("<Control-o>", lambda e: self.open_image())
        self.bind("<Control-s>", lambda e: self.export_report())
        self.bind("<Control-e>", lambda e: self.export_overlay())
        self.bind("<Control-z>", lambda e: self.undo())
        self.bind("<Control-y>", lambda e: self.redo())
        for i, _ in enumerate(STAGES):
            self.bind(str(i + 1), lambda e, i=i: self.set_stage_index(i))
        self.bind("f", lambda e: self.fit_view())
        self.bind("h", lambda e: self._hotkey(self.home_view))
        self.bind("a", lambda e: self.auto_detect())
        self.bind("s", lambda e: self._toggle_samples(flip=True))
        for key, d in (("<Left>", (-1, 0)), ("<Right>", (1, 0)),
                       ("<Up>", (0, -1)), ("<Down>", (0, 1))):
            self.bind(key, lambda e, d=d: self._arrow(e, d))
            self.bind("<Shift-%s" % key[1:], lambda e, d=d: self._arrow(e, d, 0.2))
            self.bind("<Control-%s" % key[1:], lambda e, d=d: self._arrow(e, d, 5.0))

    def _hotkey(self, fn):
        """Ignore single-letter shortcuts while a text field has focus."""
        if isinstance(self.focus_get(), (ttk.Spinbox, tk.Entry)):
            return
        fn()

    def _arrow(self, event, d, factor=1.0):
        if isinstance(self.focus_get(), (ttk.Spinbox, ttk.Scale, tk.Entry)):
            return
        self.canvas.nudge(d[0], d[1], factor)
        return "break"

    # ---------------------------------------------------------------- stages
    def _on_tab(self, _event=None):
        idx = self.nb.index(self.nb.select())
        self.canvas.set_stage(STAGES[idx])
        self.refresh_results()

    def set_stage_index(self, idx):
        if isinstance(self.focus_get(), (ttk.Spinbox, tk.Entry)):
            return
        self.nb.select(idx)

    def step_stage(self, d):
        idx = self.nb.index(self.nb.select())
        self.nb.select(max(0, min(len(STAGES) - 1, idx + d)))

    # ----------------------------------------------------------------- sides
    def switch_side(self):
        self.set_side(self.side_var.get())

    def set_side(self, side: str) -> None:
        if not self.session.set_active(side):
            return
        self.side_var.set(side)
        self.canvas.empty_message = ("Open the %s image   (Ctrl+O)"
                                     % LABELS[side].lower())
        self.canvas.set_model(self.session.card)
        self.rotation_panel.refresh()
        self.refresh_results()
        self.set_status("Now working on the %s." % LABELS[side].lower())

    def refresh_side_buttons(self) -> None:
        for side, button in self.side_buttons.items():
            mark = "  •" if self.session.is_loaded(side) else ""
            button.configure(text=LABELS[side] + mark)

    # ----------------------------------------------------------------- files
    def open_image_for(self, side: str, path=None):
        self.set_side(side)
        self.open_image(path)

    def open_image(self, path=None):
        if path is None:
            path = self._ask_open()
        if not path:
            return
        self._last_dir = os.path.dirname(path) or self._last_dir
        try:
            self.model.load(path, self.canvas.canvas_size())
        except Exception as exc:
            messagebox.showerror("Could not open image", str(exc))
            return
        self.canvas._photo_key = None
        self.canvas.selected = None
        self.canvas.set_model(self.model)
        self.refresh_side_buttons()
        self.file_lbl.configure(text="%s  —  %s   %d x %d px"
                                     % (LABELS[self.session.active],
                                        os.path.basename(path), *self.model.size))
        self.rotation_panel.refresh()
        self.canvas.request_redraw()
        self.refresh_results()
        if self.session.both_loaded:
            self.set_status("Both sides loaded. The final ceiling uses whichever "
                            "side reads worse.")
        else:
            self.set_status("Loaded the %s. Straighten it, place the lines, then "
                            "switch to the %s."
                            % (LABELS[self.session.active].lower(),
                               LABELS[self.session.other_side()].lower()))

    def _ask_open(self):
        """Open the file browser, parented and raised.

        An unparented Tk dialog can come up behind the main window, which looks
        exactly like the shortcut having done nothing.
        """
        try:
            self.lift()
            self.focus_force()
        except tk.TclError:
            pass
        try:
            return filedialog.askopenfilename(
                parent=self, title="Open card image",
                initialdir=self._last_dir, filetypes=IMAGE_TYPES)
        except tk.TclError as exc:
            messagebox.showerror("Could not open the file browser", str(exc))
            return ""

    def export_report(self):
        if not self._require_image():
            return
        path = filedialog.asksaveasfilename(
            parent=self, initialdir=self._last_dir,
            title="Export centering report", defaultextension=".json",
            initialfile=self._base_name() + "_centering.json",
            filetypes=[("JSON report", "*.json")])
        if not path:
            return
        self.session.save_report(path)
        self.set_status("Report written to %s" % path)

    def export_overlay(self):
        if not self._require_image():
            return
        path = filedialog.asksaveasfilename(
            parent=self, initialdir=self._last_dir,
            title="Export annotated image", defaultextension=".png",
            initialfile=self._base_name() + "_overlay.png",
            filetypes=[("PNG image", "*.png")])
        if not path:
            return
        export_mod.save_session_sheet(
            self.session, path, scheme=self.canvas.scheme,
            tint_mode=self.canvas.tint_mode,
            tint_strength=self.canvas.tint_strength,
            show_samples=self.canvas.show_samples)
        self.set_status("Overlay written to %s%s"
                        % (path, "" if self.session.both_loaded
                           else "  (one side only)"))

    def _require_image(self):
        if not self.session.any_loaded:
            messagebox.showinfo("No image", "Open a card image first.")
            return False
        return True

    def _base_name(self):
        for side in SIDES:
            card = self.session.cards[side]
            if card.loaded and card.path:
                return os.path.splitext(os.path.basename(card.path))[0]
        return "card"

    def save_session(self):
        if not self._require_image():
            return
        path = filedialog.asksaveasfilename(
            parent=self, initialdir=self._last_dir, title="Save session",
            defaultextension=".cgs.json",
            initialfile=self._base_name() + ".cgs.json",
            filetypes=[("Grading session", "*.cgs.json"), ("JSON", "*.json")])
        if not path:
            return
        self.session.save_session(path)
        self.set_status("Session saved to %s" % path)

    def load_session(self):
        path = filedialog.askopenfilename(
            parent=self, initialdir=self._last_dir, title="Open session",
            filetypes=[("Grading session", "*.cgs.json"), ("JSON", "*.json"),
                       ("All files", "*.*")])
        if not path:
            return
        try:
            missing = self.session.load_session(path, self.canvas.canvas_size())
        except Exception as exc:
            messagebox.showerror("Could not open session", str(exc))
            return
        self.side_var.set(self.session.active)
        self.canvas.set_model(self.session.card)
        self.refresh_side_buttons()
        self.rotation_panel.refresh()
        self.refresh_results()
        if missing:
            messagebox.showwarning(
                "Images not found",
                "The session referenced images that are no longer at their "
                "saved paths (%s). Reopen them for those sides."
                % ", ".join(missing))
        self.set_status("Session loaded from %s" % path)

    # ---------------------------------------------------------------- edits
    def auto_detect(self):
        if not self.model.loaded:
            return
        self.model.snapshot()
        self.model.reset_lines(auto=True)
        self.canvas.request_redraw()
        self.refresh_results()
        self.set_status("Auto-detected both frames. Correct them by hand.")

    def reset_lines(self):
        if not self.model.loaded:
            return
        self.model.snapshot()
        self.model.reset_lines(auto=False)
        self.canvas.request_redraw()
        self.refresh_results()

    def straighten(self):
        if not self.model.loaded:
            return
        self.model.snapshot()
        self.model.straighten()
        self.canvas.request_redraw()
        self.refresh_results()

    def straighten_selected(self):
        sel = self.canvas.selected
        if not sel:
            return
        self.model.snapshot()
        self.model.straighten([sel[0]])
        self.canvas.request_redraw()
        self.refresh_results()

    def snap_handles(self):
        if not self.model.loaded:
            return
        self.model.snapshot()
        self.model.place_handles()
        self.canvas.request_redraw()
        self.refresh_results()

    def undo(self):
        if self.model.undo():
            self.canvas.request_redraw()
            self.refresh_results()
            self.set_status("Undo")

    def redo(self):
        if self.model.redo():
            self.canvas.request_redraw()
            self.refresh_results()
            self.set_status("Redo")

    def home_view(self):
        """Bring the outer frame back to the middle of the viewport.

        Keeps the stage-1 rotation; only pan and zoom change, so the numbers
        are untouched.
        """
        if not self.model.loaded:
            return
        corners = self.model.outer_corners()
        centre = self.model.outer_center()
        if corners is None or centre is None:
            self.fit_view()
            return
        t = self.model.transform
        cw, ch = self.canvas.canvas_size()
        view = [t.img_to_view(p) for p in corners]
        xs = [p[0] for p in view]
        ys = [p[1] for p in view]
        bw, bh = max(xs) - min(xs), max(ys) - min(ys)
        if bw > 1.0 and bh > 1.0:
            factor = min(cw * HOME_FILL / bw, ch * HOME_FILL / bh)
            t.scale = max(0.02, min(40.0, t.scale * factor))
        t.pan = t.pan + (vec(cw / 2.0, ch / 2.0) - t.img_to_view(centre))
        self.canvas._photo_key = None
        self.rotation_panel.refresh()
        self.canvas.request_redraw()
        self.set_status("Centred on the card.")

    def fit_view(self):
        if not self.model.loaded:
            return
        self.model.transform.fit(self.model.size, self.canvas.canvas_size())
        self.canvas._photo_key = None
        self.rotation_panel.refresh()
        self.canvas.request_redraw()

    def _toggle_samples(self, flip=False):
        if flip:
            if isinstance(self.focus_get(), (ttk.Spinbox, tk.Entry)):
                return
            self.samples_var.set(not self.samples_var.get())
        self.canvas.show_samples = self.samples_var.get()
        self.canvas.request_redraw()

    # --------------------------------------------------------------- refresh
    def refresh_results(self):
        self.refresh_side_buttons()
        self.results.refresh()
        self.rotation_panel.refresh()
        self.bulk_panel.refresh()
        self.precision_panel.refresh()

    def status_transform(self):
        t = self.model.transform
        self.set_status("zoom %.0f%%   angle %+.2f deg" % (t.scale * 100, t.angle))

    def set_status(self, msg):
        self.status.configure(text=msg)


def main(initial_image=None):
    App(initial_image).mainloop()
