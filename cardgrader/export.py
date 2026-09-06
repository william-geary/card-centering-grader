"""Render the annotated overlay image.

The export deliberately matches what Home shows on screen: the card
straightened by the stage-1 angle, cropped to the outer frame with the same
margin around it, rather than the whole scan with its bed and shadows.  A
caption band underneath carries the numbers, so the picture is self-contained
when it is sent to somebody else.
"""

from __future__ import annotations

import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import grades
from .geometry import Line, clip_line_to_rect, vec
from .model import INNER, OUTER
from .palette import SAMPLE_C, color_for, scheme_colors
from .tint import apply_tint
from .transform import ViewTransform

BG = (30, 31, 34)
BAND = (22, 23, 26)
TEXT = (230, 232, 234)
MUTED = (154, 160, 166)
RULE = (58, 62, 68)

# Same fraction of the frame the card fills under Home.
HOME_FILL = 0.88

_FONT_CANDIDATES = (
    "segoeui.ttf", "arial.ttf", "calibri.ttf",          # Windows
    "/System/Library/Fonts/Supplemental/Arial.ttf",     # macOS
    "DejaVuSans.ttf",                                   # Linux / Pillow
)
_FONT_BOLD_CANDIDATES = (
    "segoeuib.ttf", "arialbd.ttf", "calibrib.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "DejaVuSans-Bold.ttf",
)


def _font(size: int, bold: bool = False):
    for name in (_FONT_BOLD_CANDIDATES if bold else _FONT_CANDIDATES):
        try:
            return ImageFont.truetype(name, size)
        except Exception:
            continue
    try:
        return ImageFont.load_default(size)
    except TypeError:                      # Pillow < 10 has no size argument
        return ImageFont.load_default()


def _text_width(draw, text, font):
    try:
        box = draw.textbbox((0, 0), text, font=font)
        return box[2] - box[0]
    except Exception:
        return draw.textlength(text, font=font)


def build_transform(model, fill=HOME_FILL):
    """Export transform plus output size: card upright, Home's margin around it.

    Returns (transform, (width, height)) or None if the frame is degenerate.
    """
    corners = model.outer_corners()
    if corners is None:
        return None
    t = ViewTransform(angle=model.transform.angle, scale=1.0,
                      pan=vec(0.0, 0.0),
                      center=model.transform.center.copy())
    view = np.array([t.img_to_view(p) for p in corners], dtype=float)
    x0, y0 = view[:, 0].min(), view[:, 1].min()
    x1, y1 = view[:, 0].max(), view[:, 1].max()
    cw, ch = x1 - x0, y1 - y0
    if cw < 2 or ch < 2:
        return None
    margin_x = cw * (1.0 / fill - 1.0) / 2.0
    margin_y = ch * (1.0 / fill - 1.0) / 2.0
    t.pan = vec(margin_x - x0, margin_y - y0)
    return t, (int(round(cw + 2 * margin_x)), int(round(ch + 2 * margin_y)))


def render_card(model, scheme=None, tint_mode="None", tint_strength=0.0,
                show_samples=True):
    """The card alone: straightened, cropped to Home's framing, lines drawn."""
    built = build_transform(model)
    if built is None:                       # no usable frame: fall back to the scan
        t = ViewTransform(angle=model.transform.angle, scale=1.0,
                          pan=vec(model.size[0] / 2.0, model.size[1] / 2.0),
                          center=model.transform.center.copy())
        size = model.size
    else:
        t, size = built

    card = model.image.transform(size, Image.AFFINE, t.affine_coeffs(),
                                 resample=Image.BICUBIC, fillcolor=BG)
    card = apply_tint(card, tint_mode, tint_strength)
    d = ImageDraw.Draw(card)

    m = model.measure()
    if show_samples and m and m.valid:
        for axis in (m.lr, m.tb):
            for (pa, a, b, pb) in axis.sample_points:
                va, vb = t.img_to_view(pa), t.img_to_view(pb)
                d.line([tuple(va), tuple(vb)], fill=SAMPLE_C, width=1)
                for q in (pa, a, b, pb):
                    vq = t.img_to_view(q)
                    d.ellipse([vq[0] - 3, vq[1] - 3, vq[0] + 3, vq[1] + 3],
                              fill=SAMPLE_C)

    width = max(2, int(round(size[0] / 500.0)))
    for key in list(OUTER) + list(INNER):
        line = model.lines[key]
        vp = Line(t.img_to_view(line.p1), t.img_to_view(line.p2))
        span = clip_line_to_rect(vp, 0, 0, size[0] - 1, size[1] - 1)
        if span:
            a, b = span
            d.line([tuple(a), tuple(b)],
                   fill=color_for(key, scheme), width=width)

    return card


def render_overlay(model, scheme=None, tint_mode="None", tint_strength=0.0,
                   side=grades.FRONT, show_samples=True, caption=True):
    """One side, with the caption band under it."""
    card = render_card(model, scheme, tint_mode, tint_strength, show_samples)
    if not caption:
        return card
    return _add_caption(card, model, model.measure(), scheme, side)


def _add_caption(card, model, m, scheme, side):
    w = card.width
    unit = max(11, int(round(w / 46.0)))            # scales with the card
    pad = unit
    band_h = int(unit * 9.4)
    out = Image.new("RGB", (w, card.height + band_h), BAND)
    out.paste(card, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, card.height), (w, card.height)], fill=RULE, width=1)

    f_small = _font(int(unit * 0.85))
    f_label = _font(int(unit * 0.8))
    f_big = _font(int(unit * 2.0), bold=True)
    f_grade = _font(int(unit * 1.15), bold=True)

    y = card.height + pad
    name = os.path.basename(model.path) if model.path else "card"
    d.text((pad, y), name, font=f_small, fill=MUTED)
    n = m.n_samples if m else model.n_samples
    right = "%d samples/axis   %s" % (n, side)
    d.text((w - pad - _text_width(d, right, f_small), y), right,
           font=f_small, fill=MUTED)
    y += int(unit * 1.5)

    if m is None or not m.valid:
        d.text((pad, y), "no valid measurement", font=f_big, fill=TEXT)
        return out

    colors = scheme_colors(scheme)
    col2 = w // 2
    for x, label, value, colour in (
            (pad, "LEFT / RIGHT", m.lr.text(), colors["outer"]),
            (col2, "TOP / BOTTOM", m.tb.text(), colors["inner"])):
        d.text((x, y), label, font=f_label, fill=MUTED)
        d.text((x, y + int(unit * 1.05)), value, font=f_big, fill=TEXT)
        bar_y = y + int(unit * 3.35)
        bar_w = col2 - pad * 2
        pct = (m.lr if x == pad else m.tb).low_pct
        split = int(bar_w * pct / 100.0)
        d.rectangle([x, bar_y, x + split, bar_y + int(unit * 0.5)], fill=colour)
        d.rectangle([x + split, bar_y, x + bar_w, bar_y + int(unit * 0.5)],
                    fill=RULE)
        d.line([(x + bar_w // 2, bar_y), (x + bar_w // 2, bar_y + int(unit * 0.5))],
               fill=(255, 255, 255))

    y += int(unit * 4.3)
    if m.crossed:
        d.text((pad, y), "outer line sits inside its inner line -- not measurable",
               font=f_grade, fill=(255, 82, 82))
        return out

    x = pad
    for c in grades.ceilings(m, side):
        d.text((x, y), c.grader, font=f_small, fill=MUTED)
        d.text((x + _text_width(d, c.grader + " ", f_small), y - int(unit * 0.12),),
               c.grade, font=f_grade, fill=TEXT)
        x += int(unit * 5.0)
    note = "centering ceiling only -- corners, edges and surface not assessed"
    d.text((w - pad - _text_width(d, note, f_small), y + int(unit * 0.2)), note,
           font=f_small, fill=MUTED)

    spread = max(m.lr.spread, m.tb.spread)
    if spread > 4.0:
        d.text((pad, y + int(unit * 1.6)),
               "samples disagree by %.1f%% -- frames are not parallel" % spread,
               font=f_small, fill=colors["inner"])
    return out


# ------------------------------------------------------------ both sides
def render_session(session, scheme=None, tint_mode="None", tint_strength=0.0,
                   show_samples=True):
    """A single sheet for the whole session.

    With both faces measured they are placed side by side under one caption
    carrying each side's numbers and the final ceiling; with only one face
    loaded this is just that side's overlay.
    """
    loaded = session.loaded_sides()
    if not loaded:
        return None
    if len(loaded) == 1:
        side = loaded[0]
        return render_overlay(session.cards[side], scheme, tint_mode,
                              tint_strength, side, show_samples)

    cards = {}
    for side in loaded:
        cards[side] = render_card(session.cards[side], scheme, tint_mode,
                                  tint_strength, show_samples)
    # Match heights by shrinking the taller one, never by upscaling.
    height = min(c.height for c in cards.values())
    for side, img in cards.items():
        if img.height != height:
            w = max(1, int(round(img.width * height / img.height)))
            cards[side] = img.resize((w, height), Image.LANCZOS)

    gap = max(10, int(height * 0.015))
    margin = gap
    total_w = sum(c.width for c in cards.values()) + gap + margin * 2
    row = Image.new("RGB", (total_w, height + margin), BAND)
    x = margin
    columns = {}
    for side in loaded:
        row.paste(cards[side], (x, margin // 2))
        columns[side] = (x, cards[side].width)
        x += cards[side].width + gap
    return _add_pair_caption(row, session, scheme, columns, margin)


def _add_pair_caption(row, session, scheme, columns, margin):
    w = row.width
    unit = max(11, int(round(w / 78.0)))
    pad = unit

    # Stack the caption explicitly rather than by fractions of the band, so
    # nothing collides when the sheet is small.
    y_label = 0
    y_lr = int(unit * 1.5)
    y_tb = int(unit * 3.4)
    y_note = int(unit * 5.4)
    y_rule = int(unit * 7.1)
    y_final = int(unit * 7.9)
    band_h = pad + int(unit * 10.4)

    out = Image.new("RGB", (w, row.height + band_h), BAND)
    out.paste(row, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, row.height), (w, row.height)], fill=RULE, width=1)

    f_small = _font(int(unit * 0.85))
    f_side = _font(int(unit * 0.95), bold=True)
    f_big = _font(int(unit * 1.7), bold=True)
    f_final = _font(int(unit * 2.1), bold=True)

    colors = scheme_colors(scheme)
    top = row.height + pad

    for side, (x, cw) in columns.items():
        m = session.measurement(side)
        d.text((x, top + y_label), side.upper(), font=f_side, fill=TEXT)
        if m is None or not m.valid:
            d.text((x, top + y_lr), "--", font=f_big, fill=MUTED)
            continue
        d.text((x, top + y_lr), "L/R  " + m.lr.text(),
               font=f_big, fill=colors["outer"])
        d.text((x, top + y_tb), "T/B  " + m.tb.text(),
               font=f_big, fill=colors["inner"])
        spread = max(m.lr.spread, m.tb.spread)
        note = "%d samples/axis" % m.n_samples
        if spread > 4.0:
            note += "    samples disagree by %.0f%%" % spread
        d.text((x, top + y_note), note, font=f_small, fill=MUTED)

    d.line([(margin, top + y_rule), (w - margin, top + y_rule)],
           fill=RULE, width=1)
    d.text((margin, top + y_final + int(unit * 0.55)), "FINAL CEILING",
           font=f_small, fill=MUTED)

    x = margin + int(unit * 8.5)
    for c in session.final_ceilings():
        d.text((x, top + y_final + int(unit * 0.55)), c.grader,
               font=f_small, fill=MUTED)
        d.text((x + int(unit * 2.4), top + y_final), c.grade,
               font=f_final, fill=TEXT)
        x += int(unit * 6.6)

    notes = ["centering only -- corners, edges and surface not assessed"]
    limiting = session.limiting_side()
    if limiting:
        notes.insert(0, "held down by the %s" % limiting)
    if not session.both_loaded:
        notes.insert(0, "only the %s was measured"
                     % ", ".join(session.loaded_sides()))
    for i, text in enumerate(notes):
        d.text((w - margin - _text_width(d, text, f_small),
                top + y_final + i * int(unit * 1.2)),
               text, font=f_small, fill=MUTED)
    return out


def save_session_sheet(session, path, **kw) -> None:
    img = render_session(session, **kw)
    if img is not None:
        img.save(path)


def save_overlay(model, path, **kw) -> None:
    render_overlay(model, **kw).save(path)
