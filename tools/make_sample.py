"""Generate a synthetic card with a known centering error, for testing.

    python tools/make_sample.py sample.png --dx 9 --dy -5 --tilt 1.5
"""

from __future__ import annotations

import argparse
import math
import os
import sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def build(dx=8.0, dy=-4.0, tilt=0.0, card=(734, 1024), border=64, scan_pad=40):
    cw, ch = card
    img = Image.new("RGB", (cw + 2 * scan_pad, ch + 2 * scan_pad), (28, 28, 30))
    d = ImageDraw.Draw(img)
    x0, y0 = scan_pad, scan_pad
    x1, y1 = scan_pad + cw, scan_pad + ch
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(232, 202, 78))          # yellow border

    # Inner art panel, offset by (dx, dy) and optionally rotated by `tilt`.
    ix0, iy0 = x0 + border + dx, y0 + border + dy
    ix1, iy1 = x1 - border + dx, y1 - border + dy
    cx, cy = (ix0 + ix1) / 2.0, (iy0 + iy1) / 2.0
    a = math.radians(tilt)

    def rot(p):
        vx, vy = p[0] - cx, p[1] - cy
        return (cx + math.cos(a) * vx - math.sin(a) * vy,
                cy + math.sin(a) * vx + math.cos(a) * vy)

    pts = [rot(p) for p in ((ix0, iy0), (ix1, iy0), (ix1, iy1), (ix0, iy1))]
    d.polygon(pts, fill=(46, 82, 120))
    d.rectangle([ix0 + 40, iy0 + 60, ix1 - 40, iy0 + 420], fill=(120, 160, 190))
    d.text((ix0 + 50, iy1 - 120), "SAMPLE CARD", fill=(240, 240, 240))
    return img, dict(outer=(x0, y0, x1, y1), inner=(ix0, iy0, ix1, iy1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--dx", type=float, default=8.0)
    ap.add_argument("--dy", type=float, default=-4.0)
    ap.add_argument("--tilt", type=float, default=0.0)
    ap.add_argument("--rotate", type=float, default=0.0,
                    help="rotate the whole scan, to exercise stage 1")
    args = ap.parse_args()
    img, truth = build(args.dx, args.dy, args.tilt)
    if args.rotate:
        img = img.rotate(-args.rotate, resample=Image.BICUBIC,
                         expand=True, fillcolor=(28, 28, 30))
    img.save(args.out)

    ox0, oy0, ox1, oy1 = truth["outer"]
    ix0, iy0, ix1, iy1 = truth["inner"]
    left, right = ix0 - ox0, ox1 - ix1
    top, bottom = iy0 - oy0, oy1 - iy1
    print("wrote", args.out, img.size)
    print("truth  L/R %.1f / %.1f   T/B %.1f / %.1f" % (
        100 * left / (left + right), 100 * right / (left + right),
        100 * top / (top + bottom), 100 * bottom / (top + bottom)))


if __name__ == "__main__":
    main()
