"""Line colours, shared by the on-screen canvas and the exported images.

This lives outside the ui package on purpose: the overlay renderer needs the
same colours the canvas draws with, and importing the Tk theme for them would
mean no report or overlay could be produced without a display.
"""

from __future__ import annotations

# Four line palettes.  Each gives the card edge a strong colour and the border
# edge a lighter relative of it, so the two frames stay tellable apart while
# the pair still reads as one scheme.
LINE_SCHEMES = {
    "Red": {"outer": "#ff2e2e", "inner": "#ff9e9e"},
    "Cyan / Amber": {"outer": "#4fc3f7", "inner": "#ffd54f"},
    "Green": {"outer": "#00e676", "inner": "#c6ff6b"},
    "Magenta": {"outer": "#ff3dda", "inner": "#ffa3f0"},
}
SCHEME_NAMES = tuple(LINE_SCHEMES)
DEFAULT_SCHEME = "Red"

SAMPLE_C = "#69f0ae"    # measurement scan lines

# Convenience aliases for anything that just wants "a line colour".
OUTER_C = LINE_SCHEMES[DEFAULT_SCHEME]["outer"]
INNER_C = LINE_SCHEMES[DEFAULT_SCHEME]["inner"]


def scheme_colors(scheme: str | None = None) -> dict:
    return LINE_SCHEMES.get(scheme or DEFAULT_SCHEME,
                            LINE_SCHEMES[DEFAULT_SCHEME])


def color_for(key: str, scheme: str | None = None) -> str:
    """Colour for a line key such as "outer_left" or "inner_top"."""
    group = "outer" if key.startswith("outer") else "inner"
    return scheme_colors(scheme)[group]
