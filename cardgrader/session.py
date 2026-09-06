"""A grading session: the front of the card, the back, and the verdict.

Graders state a centering tolerance for each face and a card has to satisfy
both, so a front-only measurement can only ever be half the answer.  A session
holds an independent document per side -- its own scan, rotation, eight lines
and undo history -- and combines the two into one final ceiling.
"""

from __future__ import annotations

import json
import os
from datetime import datetime

from . import grades
from .grades import BACK, FRONT
from .model import CardModel

SIDES = (FRONT, BACK)
LABELS = {FRONT: "Front", BACK: "Back"}


class Session:
    def __init__(self):
        self.cards = {side: CardModel() for side in SIDES}
        self.active = FRONT

    # --- the side being worked on ----------------------------------------
    @property
    def card(self) -> CardModel:
        return self.cards[self.active]

    def set_active(self, side: str) -> bool:
        if side not in SIDES or side == self.active:
            return False
        self.active = side
        return True

    def other_side(self) -> str:
        return BACK if self.active == FRONT else FRONT

    def is_loaded(self, side: str) -> bool:
        return self.cards[side].loaded

    def loaded_sides(self):
        return [s for s in SIDES if self.cards[s].loaded]

    @property
    def any_loaded(self) -> bool:
        return bool(self.loaded_sides())

    @property
    def both_loaded(self) -> bool:
        return len(self.loaded_sides()) == 2

    # --- results ----------------------------------------------------------
    def measurement(self, side: str):
        card = self.cards[side]
        return card.measure() if card.loaded else None

    def side_ceilings(self, side: str):
        return grades.ceilings(self.measurement(side), side)

    def final_ceilings(self):
        """The card is held to whichever face reads worse."""
        return grades.combine(self.measurement(FRONT), self.measurement(BACK))

    def limiting_side(self):
        """Which face is holding the grade down, when they disagree."""
        front = {c.grader: c for c in self.side_ceilings(FRONT)}
        back = {c.grader: c for c in self.side_ceilings(BACK)}
        if not front or not back:
            return None
        worse_front = sum(1 for g in front if front[g].rank > back[g].rank)
        worse_back = sum(1 for g in back if back[g].rank > front[g].rank)
        if worse_front and not worse_back:
            return FRONT
        if worse_back and not worse_front:
            return BACK
        return None

    # --- reporting --------------------------------------------------------
    def report(self) -> dict:
        data = {
            "measured_at": datetime.now().isoformat(timespec="seconds"),
            "sides_measured": self.loaded_sides(),
            "sides": {},
        }
        for side in SIDES:
            card = self.cards[side]
            if card.loaded:
                data["sides"][side] = card.report(side)
        finals = self.final_ceilings()
        if finals:
            data["final_grade_ceilings"] = {
                c.grader: {"grade": c.grade, "descriptor": c.descriptor,
                           "set_by_side": c.side}
                for c in finals}
            data["limiting_side"] = self.limiting_side()
            data["grade_note"] = (
                "Centering only, and a ceiling rather than a prediction. "
                "Corners, edges and surface are not assessed, so the actual "
                "grade can be lower.")
            if not self.both_loaded:
                data["grade_caveat"] = (
                    "Only the %s was measured; the other face could pull the "
                    "grade down further." % ", ".join(self.loaded_sides()))
        return data

    def save_report(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.report(), fh, indent=2)

    # --- saving and reopening a session -----------------------------------
    def save_session(self, path: str) -> None:
        payload = {"version": 2, "active": self.active, "sides": {}}
        for side in SIDES:
            card = self.cards[side]
            if not card.loaded:
                continue
            payload["sides"][side] = {
                "path": card.path,
                "n_samples": card.n_samples,
                "transform": {"angle": card.transform.angle,
                              "scale": card.transform.scale,
                              "pan": list(map(float, card.transform.pan)),
                              "center": list(map(float, card.transform.center))},
                "lines": {k: [list(map(float, v.p1)), list(map(float, v.p2))]
                          for k, v in card.lines.items()},
            }
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2)

    def load_session(self, path: str, canvas_size=(900, 700)):
        """Returns a list of sides whose image file could not be found."""
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        missing = []
        for side in SIDES:
            blob = payload.get("sides", {}).get(side)
            card = CardModel()
            if blob:
                img = blob.get("path")
                if img and os.path.exists(img):
                    card.load(img, canvas_size, auto=False)
                    card.apply_state(blob)
                else:
                    missing.append(side)
            self.cards[side] = card
        self.active = payload.get("active", FRONT)
        if not self.cards[self.active].loaded and self.any_loaded:
            self.active = self.loaded_sides()[0]
        return missing
