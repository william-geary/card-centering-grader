"""Centering-only grade ceilings for the major graders.

A grade depends on centering, corners, edges and surface.  This tool only
looks at centering, so what it can honestly report is a *ceiling*: the best
grade the measured centering still allows.  A card can always come back lower
for reasons this tool never sees; it cannot come back higher on centering.

Each table maps "worst of the four percentages" to the best grade permitted at
or below that number, best grade first.  These are the published centering
tolerances as they are commonly documented; graders revise them from time to
time, so they are gathered here in one place to be easy to check and edit.
"""

from __future__ import annotations

from dataclasses import dataclass

FRONT = "front"
BACK = "back"

# (worst-side percentage allowed, grade label, descriptor)
PSA_FRONT = (
    (55.0, "10", "Gem Mint"),
    (60.0, "9", "Mint"),
    (65.0, "8", "NM-MT"),
    (70.0, "7", "NM"),
    (80.0, "6", "EX-MT"),
    (85.0, "5", "EX"),
    (90.0, "3", "VG"),
    (100.0, "1", "Poor"),
)
PSA_BACK = (
    (75.0, "10", "Gem Mint"),
    (90.0, "9", "Mint"),
    (100.0, "1", "Poor"),
)

# Beckett grades centering as its own subgrade; the overall BGS grade is built
# from four subgrades, and a 10 in every one of them is the Black Label.
BGS_FRONT = (
    (50.0, "10", "Pristine"),
    (55.0, "9.5", "Gem Mint"),
    (60.0, "9", "Mint"),
    (65.0, "8.5", "NM-MT+"),
    (70.0, "8", "NM-MT"),
    (75.0, "7.5", "NM+"),
    (80.0, "7", "NM"),
    (85.0, "6.5", "EX-MT+"),
    (90.0, "6", "EX-MT"),
    (100.0, "5", "EX"),
)
BGS_BACK = (
    (55.0, "10", "Pristine"),
    (60.0, "9.5", "Gem Mint"),
    (65.0, "9", "Mint"),
    (75.0, "8.5", "NM-MT+"),
    (85.0, "8", "NM-MT"),
    (90.0, "7.5", "NM+"),
    (100.0, "7", "NM"),
)

CGC_FRONT = (
    (50.0, "10", "Pristine"),
    (55.0, "10", "Gem Mint"),
    (60.0, "9.5", "Mint+"),
    (65.0, "9", "Mint"),
    (70.0, "8.5", "NM-MT+"),
    (80.0, "8", "NM-MT"),
    (85.0, "7", "NM"),
    (90.0, "6", "EX-MT"),
    (100.0, "5", "EX"),
)
CGC_BACK = (
    (60.0, "10", "Pristine"),
    (65.0, "10", "Gem Mint"),
    (70.0, "9.5", "Mint+"),
    (80.0, "9", "Mint"),
    (90.0, "8", "NM-MT"),
    (100.0, "6", "EX-MT"),
)

TABLES = {
    "PSA": {FRONT: PSA_FRONT, BACK: PSA_BACK},
    "BGS": {FRONT: BGS_FRONT, BACK: BGS_BACK},
    "CGC": {FRONT: CGC_FRONT, BACK: CGC_BACK},
}
GRADERS = ("PSA", "BGS", "CGC")


@dataclass
class Ceiling:
    grader: str
    grade: str
    descriptor: str
    side: str = FRONT
    rank: int = 0        # index into the table; 0 is the best row

    def short(self) -> str:
        return "%s %s" % (self.grader, self.grade)

    def long(self) -> str:
        return "%s %s %s" % (self.grader, self.grade, self.descriptor)


def ceiling(grader: str, worst_pct: float, side: str = FRONT) -> Ceiling:
    table = TABLES[grader][side]
    for i, (limit, grade, descriptor) in enumerate(table):
        if worst_pct <= limit + 1e-9:
            return Ceiling(grader, grade, descriptor, side, i)
    i = len(table) - 1
    limit, grade, descriptor = table[i]
    return Ceiling(grader, grade, descriptor, side, i)


def worse(a: Ceiling, b: Ceiling) -> Ceiling:
    """The lower of two ceilings for the same grader.

    Ranks are compared rather than the printed grade, because a label is not
    always a number -- CGC lists Pristine 10 above Gem Mint 10, and both print
    as "10".
    """
    if a is None:
        return b
    if b is None:
        return a
    return b if b.rank > a.rank else a


def combine(front_measurement, back_measurement):
    """Final ceilings from both sides.

    Graders state a tolerance for each face and a card has to satisfy both, so
    the card is held to whichever side reads worse.  With only one side
    measured the result is that side alone -- it is still a ceiling, just one
    the unmeasured face could pull down further.
    """
    front = {c.grader: c for c in ceilings(front_measurement, FRONT)}
    back = {c.grader: c for c in ceilings(back_measurement, BACK)}
    out = []
    for g in GRADERS:
        combined = worse(front.get(g), back.get(g))
        if combined is not None:
            out.append(combined)
    return out


def ceilings(measurement, side: str = FRONT):
    """[Ceiling] for every grader, or [] when the lines are not usable."""
    if measurement is None or not measurement.valid or measurement.crossed:
        return []
    worst = measurement.worst_pct()
    return [ceiling(g, worst, side) for g in GRADERS]


def summary(measurement, side: str = FRONT) -> str:
    cs = ceilings(measurement, side)
    if not cs:
        return "--"
    return "   ".join(c.short() for c in cs)
