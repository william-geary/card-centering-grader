"""Generate the application icon: a card with the two frames on it.

    python packaging/make_icon.py
"""

from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = (16, 24, 32, 48, 64, 128, 256)

BG = (30, 31, 34)
CARD = (232, 202, 78)
ART = (46, 82, 120)
LINE = (255, 46, 46)


def draw(size: int) -> Image.Image:
    s = 512                                   # draw big, downsample once
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([28, 28, s - 28, s - 28], radius=54, fill=BG)

    # card, slightly off-centre inside its border -- the thing being measured
    x0, y0, x1, y1 = 116, 76, s - 116, s - 76
    d.rounded_rectangle([x0, y0, x1, y1], radius=18, fill=CARD)
    inset_l, inset_r, inset_t = 46, 30, 44     # deliberately uneven
    d.rectangle([x0 + inset_l, y0 + inset_t, x1 - inset_r, y1 - inset_t], fill=ART)

    w = max(3, s // 90)
    for x in (x0, x1, x0 + inset_l, x1 - inset_r):
        d.line([(x, 20), (x, s - 20)], fill=LINE, width=w)
    for y in (y0, y1, y0 + inset_t, y1 - inset_t):
        d.line([(20, y), (s - 20, y)], fill=LINE, width=w)

    return img.resize((size, size), Image.LANCZOS)


def main():
    frames = [draw(n) for n in SIZES]
    ico = os.path.join(HERE, "icon.ico")
    frames[-1].save(ico, format="ICO",
                    sizes=[(n, n) for n in SIZES], append_images=frames[:-1])
    png = os.path.join(HERE, "icon.png")
    frames[-1].save(png)
    print("wrote", ico, "and", png)
    return 0


if __name__ == "__main__":
    sys.exit(main())
