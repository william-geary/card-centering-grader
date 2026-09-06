#!/usr/bin/env python
"""Launch the card centering grader:  python run.py [card.png]

Also the entry point for the packaged executable.  Because that build has no
console, an unhandled error would otherwise vanish silently -- so anything
that escapes is shown in a dialog and written to a log next to the exe.
"""

from __future__ import annotations

import os
import sys
import traceback
from datetime import datetime

from cardgrader.ui.app import main as run_app

APP_NAME = "Card Centering Grader"


def log_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def report(text: str) -> None:
    try:
        sys.stderr.write(text)
    except Exception:
        pass
    try:
        path = os.path.join(log_dir(), "cardgrader-error.log")
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n=== %s ===\n%s" % (datetime.now().isoformat(" ", "seconds"),
                                           text))
    except Exception:
        path = "(could not be written)"
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = getattr(tk, "_default_root", None)
        owned = root is None
        if owned:
            root = tk.Tk()
            root.withdraw()
        messagebox.showerror(
            "%s - unexpected error" % APP_NAME,
            "%s\n\nWritten to:\n%s" % (text.strip()[-1500:], path))
        if owned:
            root.destroy()
    except Exception:
        pass


def _excepthook(exc_type, exc, tb):
    report("".join(traceback.format_exception(exc_type, exc, tb)))


def main() -> int:
    sys.excepthook = _excepthook
    image = sys.argv[1] if len(sys.argv) > 1 else None
    run_app(image)
    return 0


if __name__ == "__main__":
    sys.exit(main())
