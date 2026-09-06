"""Optional image treatments that make a boundary easier to see.

Card art fights the overlay: a red line vanishes on a Charizard, a yellow one
vanishes on the border.  Rather than only changing the line colour, these let
you push the card itself away from the lines -- desaturate it, darken it, or
lift its local contrast so the printed edge stands out.

Purely cosmetic: nothing here touches the measurement, which works from line
positions alone.
"""

from __future__ import annotations

from PIL import Image, ImageEnhance, ImageOps

MODES = ("None", "Grayscale", "Desaturate", "Darken", "Brighten",
         "Contrast +", "Cool", "Warm")

_COOL = (56, 116, 214)
_WARM = (224, 146, 60)


def apply_tint(img: Image.Image, mode: str, strength: float) -> Image.Image:
    """`strength` is 0-100; 0 or mode "None" returns the image untouched."""
    k = max(0.0, min(1.0, float(strength) / 100.0))
    if mode in (None, "None") or k <= 0.0:
        return img
    if img.mode != "RGB":
        img = img.convert("RGB")

    if mode == "Grayscale":
        return Image.blend(img, ImageOps.grayscale(img).convert("RGB"), k)
    if mode == "Desaturate":
        return ImageEnhance.Color(img).enhance(1.0 - 0.9 * k)
    if mode == "Darken":
        return ImageEnhance.Brightness(img).enhance(1.0 - 0.65 * k)
    if mode == "Brighten":
        return ImageEnhance.Brightness(img).enhance(1.0 + 0.9 * k)
    if mode == "Contrast +":
        return ImageEnhance.Contrast(img).enhance(1.0 + 1.6 * k)
    if mode in ("Cool", "Warm"):
        wash = Image.new("RGB", img.size, _COOL if mode == "Cool" else _WARM)
        return Image.blend(img, wash, 0.45 * k)
    return img
