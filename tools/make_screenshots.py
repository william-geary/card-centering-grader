"""Regenerate the screenshots used in the README.

    python tools/make_screenshots.py

Writes into docs/images/. Needs a desktop session -- it drives the real Tk
window and grabs it off the screen, so do not use the machine while it runs.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "images")
FRONT_IMG = os.path.join(ROOT, "samples", "sample_offset.png")
BACK_IMG = os.path.join(ROOT, "samples", "sample_rotated.png")

from cardgrader import export                      # noqa: E402
from cardgrader.ui.app import App                  # noqa: E402


def grab(app, name):
    from PIL import ImageGrab

    app.update_idletasks()
    app.update()
    x, y = app.winfo_rootx(), app.winfo_rooty()
    shot = ImageGrab.grab(bbox=(x, y, x + app.winfo_width(),
                                y + app.winfo_height()))
    path = os.path.join(OUT, name)
    shot.save(path)
    print("wrote", os.path.relpath(path, ROOT), shot.size)


def main():
    if not os.path.exists(FRONT_IMG):
        raise SystemExit("run tools/make_sample.py first")
    os.makedirs(OUT, exist_ok=True)

    app = App()
    app.update()

    # Stage 1 -- the front, straight out of auto-detect.
    app.open_image(FRONT_IMG)
    app.home_view()
    grab(app, "stage1-rotation.png")

    # Stage 2 -- bulk handles.
    app.nb.select(1)
    app.update()
    grab(app, "stage2-bulk.png")

    # Stage 3 -- infinite lines, paired handles and the loupe.
    app.nb.select(2)
    app.update()
    import numpy as np

    app.canvas._mouse = np.array([430.0, 300.0])
    app.canvas.request_redraw()
    grab(app, "stage3-precision.png")

    # Both sides, with the grade ceiling filled in.
    app.set_side("back")
    app.open_image(BACK_IMG)
    app.rotation_panel._set_angle(-4.0)
    app.auto_detect()
    app.home_view()
    app.nb.select(1)
    app.update()
    grab(app, "both-sides.png")

    # The exported sheet.
    sheet = export.render_session(app.session, scheme=app.canvas.scheme)
    if sheet is not None:
        sheet.thumbnail((1100, 1100))
        path = os.path.join(OUT, "overlay-sheet.png")
        sheet.save(path)
        print("wrote", os.path.relpath(path, ROOT), sheet.size)

    app.destroy()


if __name__ == "__main__":
    main()
