"""Self-contained checks for the geometry and measurement layer.

    python tools/selftest.py

No test framework required; exits non-zero on the first failure.
"""

from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cardgrader import export, grades  # noqa: E402
from cardgrader.geometry import Line, clip_line_to_rect, intersect  # noqa: E402
from cardgrader.tint import MODES, apply_tint  # noqa: E402
from cardgrader.measure import measure  # noqa: E402
from cardgrader.model import CardModel  # noqa: E402
from cardgrader.session import Session  # noqa: E402
from cardgrader.transform import ViewTransform  # noqa: E402

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  ok   %s" % name)
    else:
        FAIL += 1
        print("  FAIL %s  %s" % (name, detail))


def close(a, b, tol=1e-6):
    return abs(float(a) - float(b)) <= tol


def frame(ol, ot, orr, ob, il, it, ir, ib):
    return {
        "outer_left": Line.from_points(ol, 0, ol, 200),
        "outer_right": Line.from_points(orr, 0, orr, 200),
        "outer_top": Line.from_points(0, ot, 200, ot),
        "outer_bottom": Line.from_points(0, ob, 200, ob),
        "inner_left": Line.from_points(il, 0, il, 200),
        "inner_right": Line.from_points(ir, 0, ir, 200),
        "inner_top": Line.from_points(0, it, 200, it),
        "inner_bottom": Line.from_points(0, ib, 200, ib),
    }


def rotate_frame(lines, deg, centre=(50, 70)):
    a = math.radians(deg)
    c = np.array(centre, dtype=float)

    def rot(p):
        v = np.asarray(p, dtype=float) - c
        return c + np.array([math.cos(a) * v[0] - math.sin(a) * v[1],
                             math.sin(a) * v[0] + math.cos(a) * v[1]])

    return {k: Line(rot(v.p1), rot(v.p2)) for k, v in lines.items()}


# ------------------------------------------------------------------ geometry
def test_geometry():
    print("geometry")
    p = intersect(Line.from_points(0, 0, 10, 0), Line.from_points(3, -5, 3, 5))
    check("intersection", p is not None and close(p[0], 3) and close(p[1], 0))
    check("parallel lines give None",
          intersect(Line.from_points(0, 0, 1, 0), Line.from_points(0, 5, 1, 5)) is None)

    line = Line.from_points(2, 0, 2, 10)
    line.translate_perpendicular(np.array([3.0, 7.0]))
    check("perpendicular slide ignores the along-line component",
          close(line.p1[0], 5) and close(line.p1[1], 0),
          "got %s" % line.p1)

    span = clip_line_to_rect(Line.from_points(-50, 5, 50, 5), 0, 0, 20, 20)
    check("infinite line clips to the view",
          span is not None and close(span[0][0], 0) and close(span[1][0], 20))
    check("line outside the view clips away",
          clip_line_to_rect(Line.from_points(-5, 99, 5, 99), 0, 0, 20, 20) is None)


# ----------------------------------------------------------------- transform
def test_transform():
    print("transform")
    t = ViewTransform(angle=23.5, scale=1.7)
    t.center = np.array([100.0, 150.0])
    t.pan = np.array([400.0, 300.0])
    p = np.array([37.0, 211.0])
    check("img->view->img round trip", np.allclose(t.view_to_img(t.img_to_view(p)), p))

    d = t.img_to_view([15, 9]) - t.img_to_view([0, 0])
    check("delta transform matches point transform",
          np.allclose(t.view_delta_to_img(d), [15, 9]))

    anchor = np.array([500.0, 420.0])
    before = t.view_to_img(anchor)
    t.zoom_about(anchor, 2.3)
    check("zoom keeps the point under the cursor fixed",
          np.allclose(t.view_to_img(anchor), before, atol=1e-9))
    t.rotate_about(anchor, 17.0)
    check("rotate keeps the point under the cursor fixed",
          np.allclose(t.view_to_img(anchor), before, atol=1e-9))


# --------------------------------------------------------------- measurement
def test_measure():
    print("measurement")
    m = measure(frame(0, 0, 100, 140, 10, 10, 90, 130), 3)
    check("perfectly centred reads 50/50",
          close(m.lr.low_pct, 50) and close(m.tb.low_pct, 50))
    check("margins in pixels are right", close(m.lr.low, 10) and close(m.tb.high, 10))

    m = measure(frame(0, 0, 100, 140, 18, 10, 98, 130), 3)
    check("inner frame shifted 8px right reads 90/10",
          close(m.lr.low_pct, 90) and close(m.lr.high_pct, 10),
          "got %s" % m.lr.text())
    check("the untouched axis is unaffected", close(m.tb.low_pct, 50))

    base = frame(0, 0, 100, 140, 10, 10, 90, 130)
    for n in (1, 2, 3, 5, 9):
        r = measure(base, n)
        check("parallel frames give the same answer at n=%d" % n,
              close(r.lr.low_pct, 50, 1e-9) and close(r.lr.spread, 0, 1e-9))

    # A rotated inner frame still averages to centred, but the samples must
    # disagree -- that disagreement is what tells the user to use stage 3.
    tilted = dict(base)
    inner = rotate_frame({k: v for k, v in base.items() if k.startswith("inner")}, 4.0)
    tilted.update(inner)
    r = measure(tilted, 3)
    check("tilted inner frame still averages 50/50", close(r.lr.low_pct, 50, 1e-6))
    check("tilted inner frame shows a large sample spread", r.lr.spread > 20,
          "spread %.2f" % r.lr.spread)
    check("single sample would have hidden the tilt",
          close(measure(tilted, 1).lr.spread, 0))

    # Rigid motion of the whole configuration must not change the ratios.
    m0 = measure(frame(0, 0, 100, 140, 18, 12, 98, 132), 3)
    m1 = measure(rotate_frame(frame(0, 0, 100, 140, 18, 12, 98, 132), 31.0), 3)
    check("ratios are invariant to rotation",
          close(m0.lr.low_pct, m1.lr.low_pct, 1e-6)
          and close(m0.tb.low_pct, m1.tb.low_pct, 1e-6),
          "%.4f vs %.4f" % (m0.lr.low_pct, m1.lr.low_pct))

    scaled = {k: Line(v.p1 * 3.7, v.p2 * 3.7)
              for k, v in frame(0, 0, 100, 140, 18, 12, 98, 132).items()}
    check("ratios are invariant to scale",
          close(m0.lr.low_pct, measure(scaled, 3).lr.low_pct, 1e-6))

    check("percentages always sum to 100",
          close(m0.lr.low_pct + m0.lr.high_pct, 100)
          and close(m0.tb.low_pct + m0.tb.high_pct, 100))

    degenerate = frame(0, 0, 100, 140, 10, 10, 90, 130)
    degenerate["inner_left"] = degenerate["inner_top"]
    check("a degenerate frame is reported invalid, not crashed",
          not measure(degenerate, 3).lr.valid)


# --------------------------------------------------------------------- model
def test_model(sample):
    print("model + autodetect  (%s)" % os.path.basename(sample))
    m = CardModel()
    m.load(sample, (900, 700))
    r = m.measure()
    check("autodetect lands near the truth of 57.0/43.0",
          abs(r.lr.low_pct - 57.0) < 2.0, "got %s" % r.lr.text())

    before = m.measure().lr.low_pct
    m.transform.angle = 12.0
    m.transform.scale = 2.5
    check("display rotation and zoom do not move the numbers",
          close(m.measure().lr.low_pct, before, 1e-9))
    m.transform.angle = 0.0

    m.snapshot()
    m.lines["outer_left"].translate_perpendicular(np.array([25.0, 0.0]))
    check("editing a line changes the result", not close(m.measure().lr.low_pct, before))
    m.undo()
    check("undo restores it", close(m.measure().lr.low_pct, before, 1e-9))
    m.redo()
    check("redo re-applies it", not close(m.measure().lr.low_pct, before))
    m.undo()

    m.place_handles()
    pts = [tuple(np.round(m.lines[k].p1, 3)) for k in m.lines]
    check("handles never coincide after placement", len(set(pts)) == len(pts))

    m.transform.angle = -4.0
    m.straighten()
    # The real invariant: the line must look horizontal on screen, which means
    # it is deliberately NOT horizontal in raw image pixels.
    line = m.lines["outer_top"]
    on_screen = m.transform.img_to_view(line.p2) - m.transform.img_to_view(line.p1)
    check("straighten squares lines to the screen", close(on_screen[1], 0, 1e-9),
          "screen dy %.6f" % on_screen[1])
    check("which means they are tilted in image space",
          close(line.angle_deg(), 4.0, 1e-6), "got %.4f deg" % line.angle_deg())
    vline = m.lines["outer_left"]
    on_screen = m.transform.img_to_view(vline.p2) - m.transform.img_to_view(vline.p1)
    check("side lines are square to the screen too", close(on_screen[0], 0, 1e-9))

    rep = m.report()
    check("report carries the centering block", "centering" in rep)
    check("report records per-sample detail",
          len(rep["centering"]["left_right"]["per_sample_left_pct"]) == m.n_samples)


def test_rotated_flow(sample):
    print("rotated scan flow  (%s)" % os.path.basename(sample))
    crooked = CardModel()
    crooked.load(sample, (900, 700))
    off = abs(crooked.measure().lr.low_pct - 57.0)

    straight = CardModel()
    straight.load(sample, (900, 700), auto=False)
    straight.transform.angle = -4.0          # what stage 1 is for
    straight.reset_lines(auto=True)
    fixed = abs(straight.measure().lr.low_pct - 57.0)
    check("straightening first makes detection far more accurate",
          fixed < 1.5 and fixed < off / 3,
          "crooked off by %.1f, straightened off by %.1f" % (off, fixed))


# -------------------------------------------------------------------- grades
class _FakeMeasure:
    valid = True
    crossed = False

    def __init__(self, worst):
        self._worst = worst

    def worst_pct(self):
        return self._worst


def test_grades():
    print("grade ceilings")
    perfect = _FakeMeasure(50.0)
    cs = {c.grader: c for c in grades.ceilings(perfect, grades.FRONT)}
    check("50/50 allows PSA 10", cs["PSA"].grade == "10")
    check("50/50 allows the BGS 10 subgrade", cs["BGS"].grade == "10")
    check("BGS 10 is labelled Pristine", cs["BGS"].descriptor == "Pristine")
    check("52/48 drops BGS to 9.5 but keeps PSA 10",
          grades.ceiling("BGS", 52.0).grade == "9.5"
          and grades.ceiling("PSA", 52.0).grade == "10")
    check("58/42 drops PSA to 9", grades.ceiling("PSA", 58.0).grade == "9")

    # A worse card must never be given a better ceiling.
    for grader in grades.GRADERS:
        for side in (grades.FRONT, grades.BACK):
            vals = [float(grades.ceiling(grader, w, side).grade)
                    for w in range(50, 100)]
            check("%s %s ceilings never improve as centering worsens"
                  % (grader, side),
                  all(b <= a + 1e-9 for a, b in zip(vals, vals[1:])))

    check("the back is never stricter than the front",
          all(float(grades.ceiling(g, w, grades.BACK).grade)
              >= float(grades.ceiling(g, w, grades.FRONT).grade)
              for g in grades.GRADERS for w in range(50, 100)))

    crossed = _FakeMeasure(60.0)
    crossed.crossed = True
    check("a crossed frame gets no grade", grades.ceilings(crossed) == [])

    # Combining the two faces: the card is held to whichever reads worse.
    good, bad = _FakeMeasure(52.0), _FakeMeasure(88.0)
    combined = {c.grader: c for c in grades.combine(good, bad)}
    front_only = {c.grader: c for c in grades.combine(good, None)}
    check("a poor back drags the final ceiling down",
          combined["PSA"].rank > front_only["PSA"].rank
          and combined["BGS"].rank > front_only["BGS"].rank)
    check("the final ceiling records which side set it",
          combined["PSA"].side == grades.BACK)
    check("a good back does not lift a poor front",
          grades.combine(bad, good)[0].side == grades.FRONT)
    check("one side alone still yields a ceiling", len(front_only) == 3)
    check("no sides yields nothing", grades.combine(None, None) == [])
    check("CGC Pristine outranks Gem Mint despite both printing 10",
          grades.ceiling("CGC", 50.0).rank < grades.ceiling("CGC", 54.0).rank
          and grades.ceiling("CGC", 50.0).grade
          == grades.ceiling("CGC", 54.0).grade)
    check("summary of an unusable frame is a dash",
          grades.summary(None) == "--")


# ---------------------------------------------------------------- appearance
def test_tint(sample):
    print("tint")
    from PIL import Image
    img = Image.open(sample).convert("RGB").resize((64, 64))
    check("None is a no-op", apply_tint(img, "None", 100) is img)
    check("zero strength is a no-op", apply_tint(img, "Grayscale", 0) is img)
    for mode in MODES:
        out = apply_tint(img, mode, 60)
        check("%s keeps size and mode" % mode,
              out.size == img.size and out.mode == "RGB")
    gray = apply_tint(img, "Grayscale", 100).getpixel((32, 32))
    check("full grayscale has equal channels", abs(gray[0] - gray[2]) <= 2,
          "got %s" % (gray,))


def test_export(sample):
    print("overlay export")
    m = CardModel()
    m.load(sample, (900, 700))
    built = export.build_transform(m)
    check("export transform is buildable", built is not None)
    t, size = built

    corners = [t.img_to_view(p) for p in m.outer_corners()]
    xs = [p[0] for p in corners]
    ys = [p[1] for p in corners]
    fill_x = (max(xs) - min(xs)) / size[0]
    fill_y = (max(ys) - min(ys)) / size[1]
    check("the card fills the same fraction Home uses",
          close(fill_x, export.HOME_FILL, 0.01) and close(fill_y, export.HOME_FILL, 0.01),
          "fill %.3f x %.3f" % (fill_x, fill_y))
    check("margins are equal on both sides",
          close(min(xs), size[0] - max(xs), 1.0)
          and close(min(ys), size[1] - max(ys), 1.0))
    # The crop is sized from the card, never from the scan.  On a scan with a
    # wide bed that means the bed is cropped away; on a tightly cropped scan
    # the export can legitimately be larger than the original.
    from PIL import Image
    wide = Image.new("RGB", (m.size[0] * 2, m.size[1] * 2), (12, 12, 12))
    wide.paste(m.image, (m.size[0] // 2, m.size[1] // 2))
    wide_path = os.path.join(os.path.dirname(sample), "_selftest_wide.png")
    wide.save(wide_path)
    try:
        m2 = CardModel()
        m2.load(wide_path, (900, 700))
        _, size2 = export.build_transform(m2)
        check("a scan with a wide bed gets the bed cropped away",
              size2[0] < m2.size[0] * 0.75 and size2[1] < m2.size[1] * 0.75,
              "crop %s vs scan %s" % (size2, m2.size))
        card_w = max(p[0] for p in m2.outer_corners()) - min(p[0] for p in m2.outer_corners())
        check("crop width tracks the card, not the scan",
              close(size2[0], card_w / export.HOME_FILL, 2.0),
              "crop %d vs card %.0f" % (size2[0], card_w))
    finally:
        os.remove(wide_path)

    img = export.render_overlay(m, scheme="Red")
    check("the caption band is added below the card", img.height > size[1])
    check("the overlay keeps the crop width", img.width == size[0])
    check("no caption when it is not asked for",
          export.render_overlay(m, caption=False).height == size[1])

    # A rotated scan must come out upright.
    m.transform.angle = -4.0
    m.reset_lines(auto=True)
    t2, size2 = export.build_transform(m)
    top = m.lines["outer_top"]
    d = t2.img_to_view(top.p2) - t2.img_to_view(top.p1)
    check("a straightened scan exports upright", close(d[1], 0, 1e-9),
          "export dy %.6f" % d[1])


# ------------------------------------------------------------------ session
def test_session(flat, rotated):
    print("session (front + back)")
    s = Session()
    check("a new session has nothing loaded", not s.any_loaded)
    check("final ceilings are empty until something is measured",
          s.final_ceilings() == [])

    s.cards[grades.FRONT].load(flat, (900, 700))
    check("front only is reported as one side", s.loaded_sides() == [grades.FRONT]
          and not s.both_loaded)
    front_only = {c.grader: c.grade for c in s.final_ceilings()}
    check("a one-sided session still grades", len(front_only) == 3)

    s.set_active(grades.BACK)
    check("the active card follows the switch",
          s.card is s.cards[grades.BACK])
    s.cards[grades.BACK].load(rotated, (900, 700), auto=False)
    s.cards[grades.BACK].transform.angle = -4.0
    s.cards[grades.BACK].reset_lines(auto=True)
    check("both sides now loaded", s.both_loaded)

    # The two documents must be genuinely independent.
    check("each side keeps its own transform",
          close(s.cards[grades.FRONT].transform.angle, 0.0)
          and close(s.cards[grades.BACK].transform.angle, -4.0))
    before = s.measurement(grades.BACK).lr.low_pct
    s.cards[grades.FRONT].lines["outer_left"].translate_perpendicular(
        np.array([30.0, 0.0]))
    check("editing one side leaves the other alone",
          close(s.measurement(grades.BACK).lr.low_pct, before, 1e-9))
    s.cards[grades.FRONT].load(flat, (900, 700))          # undo that edit

    # The final row is the worse of the two, never better than either.
    front = {c.grader: c for c in s.side_ceilings(grades.FRONT)}
    back = {c.grader: c for c in s.side_ceilings(grades.BACK)}
    finals = {c.grader: c for c in s.final_ceilings()}
    check("the final ceiling is never better than either side",
          all(finals[g].rank >= max(front[g].rank, back[g].rank)
              for g in grades.GRADERS))
    check("the final ceiling matches the worse side",
          all(finals[g].rank == max(front[g].rank, back[g].rank)
              for g in grades.GRADERS))
    check("the limiting side is identified", s.limiting_side() in
          (grades.FRONT, grades.BACK, None))

    rep = s.report()
    check("the report covers both sides", set(rep["sides"]) == set(grades_sides()))
    check("the report carries a final ceiling", "final_grade_ceilings" in rep)
    check("a two-sided report has no one-side caveat", "grade_caveat" not in rep)

    # Save and reopen.
    path = os.path.join(os.path.dirname(flat), "_selftest_session.cgs.json")
    try:
        s.save_session(path)
        s2 = Session()
        missing = s2.load_session(path, (900, 700))
        check("reopening a session finds both images", missing == [])
        check("reopened lines measure identically",
              close(s2.measurement(grades.FRONT).lr.low_pct,
                    s.measurement(grades.FRONT).lr.low_pct, 1e-6)
              and close(s2.measurement(grades.BACK).lr.low_pct,
                        s.measurement(grades.BACK).lr.low_pct, 1e-6))
        check("reopened transforms survive",
              close(s2.cards[grades.BACK].transform.angle, -4.0, 1e-9))
    finally:
        if os.path.exists(path):
            os.remove(path)

    # Sheets.
    sheet = export.render_session(s, scheme="Red")
    single = export.render_overlay(s.cards[grades.FRONT], scheme="Red")
    check("a two-sided sheet is wider than a single overlay",
          sheet.width > single.width * 1.7)
    lone = Session()
    lone.cards[grades.FRONT].load(flat, (900, 700))
    check("a one-sided session exports the single overlay",
          export.render_session(lone).width == single.width)
    check("an empty session exports nothing",
          export.render_session(Session()) is None)


def grades_sides():
    return (grades.FRONT, grades.BACK)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    flat = os.path.join(root, "samples", "sample_offset.png")
    rotated = os.path.join(root, "samples", "sample_rotated.png")
    test_geometry()
    test_transform()
    test_measure()
    if os.path.exists(flat):
        test_model(flat)
    if os.path.exists(rotated):
        test_rotated_flow(rotated)
    test_grades()
    if os.path.exists(flat) and os.path.exists(rotated):
        test_session(flat, rotated)
    if os.path.exists(flat):
        test_tint(flat)
        test_export(flat)
    print("\n%d passed, %d failed" % (PASS, FAIL))
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
