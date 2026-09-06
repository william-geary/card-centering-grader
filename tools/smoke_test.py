"""Drive the GUI without a human: render each stage, simulate drags, shoot PNGs.

    python tools/smoke_test.py samples/sample_offset.png outdir
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cardgrader.ui.app import App  # noqa: E402


class FakeEvent:
    def __init__(self, x, y, state=0, delta=0):
        self.x, self.y, self.state, self.delta = x, y, state, delta


def shot(app, out, name):
    app.update_idletasks()
    app.update()
    try:
        from PIL import ImageGrab
        x, y = app.winfo_rootx(), app.winfo_rooty()
        w, h = app.winfo_width(), app.winfo_height()
        ImageGrab.grab(bbox=(x, y, x + w, y + h)).save(os.path.join(out, name))
        print("shot", name)
    except Exception as exc:
        print("shot failed", name, exc)


def drag(canvas, x0, y0, x1, y1, steps=6, state=0):
    canvas._on_press(FakeEvent(x0, y0, state))
    for i in range(1, steps + 1):
        t = i / steps
        canvas._on_drag(FakeEvent(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, state))
    canvas._on_release(FakeEvent(x1, y1, state))


def report(app, label):
    m = app.model.measure()
    print("%-22s L/R %s   T/B %s   spread %.2f/%.2f"
          % (label, m.lr.text(), m.tb.text(), m.lr.spread, m.tb.spread))


def main():
    img = sys.argv[1] if len(sys.argv) > 1 else "samples/sample_offset.png"
    out = sys.argv[2] if len(sys.argv) > 2 else "shots"
    os.makedirs(out, exist_ok=True)

    app = App()
    app.update()
    app.open_image(img)
    app.update()
    report(app, "after autodetect")
    shot(app, out, "stage1_rotation.png")

    # --- stage 1: rotation + zoom ---------------------------------------
    c = app.canvas
    app.rotation_panel._set_angle(3.0)
    before = app.model.measure().lr.low_pct
    c._on_wheel(FakeEvent(400, 350, delta=120))
    app.update()
    after = app.model.measure().lr.low_pct
    print("rotation/zoom invariance: %.4f -> %.4f  (must be identical)" % (before, after))
    shot(app, out, "stage1_rotated.png")
    app.rotation_panel._set_angle(0.0)
    app.fit_view()

    # --- stage 2: bulk --------------------------------------------------
    app.nb.select(1)
    app.update()
    hs = c.handles()
    print("bulk handles:", len(hs), [h[0] for h in hs])
    key, _, p = hs[0]
    drag(c, p[0], p[1], p[0] + 25, p[1] + 25)      # slide the outer-left line
    app.update()
    report(app, "after bulk drag")
    moved = [h for h in c.handles() if h[0] == key][0][2]
    print("handle followed the drag horizontally: dx=%.1f dy=%.1f"
          % (moved[0] - p[0], moved[1] - p[1]))
    shot(app, out, "stage2_bulk.png")
    app.undo()

    # --- stage 3: precision ---------------------------------------------
    app.nb.select(2)
    app.update()
    hs = c.handles()
    print("precision handles:", len(hs))
    key, idx, p = hs[0]
    a0 = app.model.lines[key].angle_deg()
    drag(c, p[0], p[1], p[0] + 30, p[1])           # pivot the line
    a1 = app.model.lines[key].angle_deg()
    print("pivot changed %s angle: %.2f -> %.2f deg" % (key, a0, a1))
    c._mouse = __import__("numpy").array([500.0, 400.0])
    c.request_redraw()
    app.update()
    report(app, "after pivot")
    shot(app, out, "stage3_precision.png")
    app.undo()

    # --- samples + export ------------------------------------------------
    app.results.n_var.set(5)
    app.results._push_n()
    app.update()
    report(app, "5 samples per axis")
    app.results.n_var.set(3)
    app.results._push_n()

    # --- the back of the card -------------------------------------------
    rotated = os.path.join(os.path.dirname(img), "sample_rotated.png")
    if os.path.exists(rotated):
        app.set_side("back")
        app.update()
        print("switched to back; canvas follows:",
              app.canvas.model is app.session.cards["back"])
        app.open_image(rotated)
        app.rotation_panel._set_angle(-4.0)
        app.auto_detect()
        app.update()
        report(app, "back after stage 1")
        front = app.session.measurement("front")
        print("front survived the switch:", front.lr.text())
        rows = {}
        for (key, grader), cell in app.results.grade_cells.items():
            rows.setdefault(key, {})[grader] = cell.cget("text")
        for key in ("front", "back", "final"):
            print("  %-6s %s" % (key, rows[key]))
        shot(app, out, "both_sides.png")

    app.session.save_report(os.path.join(out, "report.json"))
    from cardgrader import export as export_mod
    export_mod.save_session_sheet(app.session,
                                  os.path.join(out, "overlay.png"),
                                  scheme=c.scheme)
    print("exports written")

    app.destroy()


if __name__ == "__main__":
    main()
