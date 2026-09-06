"""Dark palette and ttk styling."""

from __future__ import annotations

from tkinter import ttk

# The line palette lives in cardgrader.palette so the overlay renderer can use
# it without importing Tk; re-exported here for the widgets.
from ..palette import (  # noqa: F401
    DEFAULT_SCHEME, INNER_C, LINE_SCHEMES, OUTER_C, SAMPLE_C, SCHEME_NAMES,
    color_for, scheme_colors,
)

BG = "#1e1f22"          # canvas / window background
PANEL = "#26282c"       # side panel
PANEL2 = "#2f3237"      # raised blocks
STROKE = "#3a3e44"
TEXT = "#e6e8ea"
MUTED = "#9aa0a6"

SEL_C = "#ff5252"       # selected handle
HOVER_C = "#ffffff"
GRID_C = "#6b7076"


def apply(root) -> None:
    root.configure(bg=BG)
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(".", background=PANEL, foreground=TEXT,
                    fieldbackground=PANEL2, bordercolor=STROKE,
                    lightcolor=PANEL2, darkcolor=PANEL2)
    style.configure("TFrame", background=PANEL)
    style.configure("Canvas.TFrame", background=BG)
    style.configure("TLabel", background=PANEL, foreground=TEXT)
    style.configure("Muted.TLabel", foreground=MUTED)
    style.configure("Head.TLabel", font=("Segoe UI Semibold", 10))
    style.configure("Big.TLabel", font=("Consolas", 22, "bold"))
    style.configure("Mono.TLabel", font=("Consolas", 9), foreground=MUTED)
    style.configure("Stage.TLabel", font=("Segoe UI Semibold", 11))
    style.configure("Grade.TLabel", font=("Consolas", 17, "bold"))
    style.configure("GradeSmall.TLabel", font=("Consolas", 11))

    style.configure("TButton", background=PANEL2, foreground=TEXT,
                    borderwidth=1, focusthickness=0, padding=(8, 4))
    style.map("TButton",
              background=[("active", "#3a3f46"), ("pressed", "#454b53")])
    style.configure("Link.TButton", background=PANEL, foreground=MUTED,
                    borderwidth=0, anchor="w", padding=(0, 3))
    style.map("Link.TButton", background=[("active", PANEL)],
              foreground=[("active", TEXT)])
    style.configure("Side.Toolbutton", background=PANEL2, foreground=MUTED,
                    borderwidth=1, padding=(14, 4), anchor="center")
    style.map("Side.Toolbutton",
              background=[("selected", "#2d5f7a"), ("active", "#3a3f46")],
              foreground=[("selected", TEXT)])
    style.configure("Accent.TButton", background="#2d5f7a")
    style.map("Accent.TButton", background=[("active", "#37738f")])

    style.configure("TNotebook", background=PANEL, borderwidth=0)
    style.configure("TNotebook.Tab", background=PANEL2, foreground=MUTED,
                    padding=(12, 6), borderwidth=0)
    style.map("TNotebook.Tab",
              background=[("selected", PANEL)],
              foreground=[("selected", TEXT)])

    style.configure("TLabelframe", background=PANEL, bordercolor=STROKE)
    style.configure("TLabelframe.Label", background=PANEL, foreground=MUTED)
    style.configure("Horizontal.TScale", background=PANEL, troughcolor=PANEL2)
    style.configure("TCheckbutton", background=PANEL, foreground=TEXT)
    style.map("TCheckbutton", background=[("active", PANEL)])
    style.configure("TRadiobutton", background=PANEL, foreground=TEXT)
    style.map("TRadiobutton", background=[("active", PANEL)])
    style.configure("TSpinbox", fieldbackground=PANEL2, foreground=TEXT,
                    arrowcolor=TEXT)
    style.configure("TSeparator", background=STROKE)

    # clam draws a readonly combobox with its *selection* colours, which land
    # dark-on-dark here unless every state is spelled out.
    style.configure("TCombobox", fieldbackground=PANEL2, background=PANEL2,
                    foreground=TEXT, arrowcolor=TEXT, bordercolor=STROKE,
                    lightcolor=PANEL2, darkcolor=PANEL2,
                    selectbackground=PANEL2, selectforeground=TEXT,
                    padding=(6, 3))
    style.map("TCombobox",
              fieldbackground=[("readonly", PANEL2), ("disabled", PANEL)],
              foreground=[("readonly", TEXT), ("disabled", MUTED)],
              background=[("readonly", PANEL2), ("active", "#3a3f46")],
              selectbackground=[("readonly", PANEL2)],
              selectforeground=[("readonly", TEXT)],
              arrowcolor=[("readonly", TEXT)])
    # The dropdown itself is a plain Tk listbox, reachable only via options.
    root.option_add("*TCombobox*Listbox.background", PANEL2)
    root.option_add("*TCombobox*Listbox.foreground", TEXT)
    root.option_add("*TCombobox*Listbox.selectBackground", "#3a5f7a")
    root.option_add("*TCombobox*Listbox.selectForeground", TEXT)
    root.option_add("*TCombobox*Listbox.borderWidth", 0)
