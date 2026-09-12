/**
 * A grading session: the front of the card, the back, and the verdict.
 *
 * Graders state a centering tolerance for each face and a card has to satisfy
 * both, so a session holds an independent document per side and combines the
 * two into one final ceiling.
 */

import type { Vec } from "./geometry";
import { type Ceiling, type Side, BACK, FRONT, GRADERS, ceilings, combine } from "./grades";
import type { Measurement } from "./measure";
import { type CardState, CardModel } from "./model";
import type { Raster } from "./raster";

export const SIDE_ORDER: readonly Side[] = [FRONT, BACK];
export const LABELS: Record<Side, string> = { front: "Front", back: "Back" };

export const SESSION_FORMAT = "card-centering-grader/session";
export const SESSION_VERSION = 3;

export interface SavedSide extends CardState { image: string }
export interface SavedSession {
  format: typeof SESSION_FORMAT;
  version: number;
  active: Side;
  sides: Partial<Record<Side, SavedSide>>;
}

export class Session {
  cards: Record<Side, CardModel> = { front: new CardModel(), back: new CardModel() };
  active: Side = FRONT;

  get card(): CardModel { return this.cards[this.active]; }

  setActive(side: Side): boolean {
    if (side === this.active) return false;
    this.active = side;
    return true;
  }

  otherSide(): Side { return this.active === FRONT ? BACK : FRONT; }
  isLoaded(side: Side): boolean { return this.cards[side].loaded; }
  loadedSides(): Side[] { return SIDE_ORDER.filter((s) => this.cards[s].loaded); }
  get anyLoaded(): boolean { return this.loadedSides().length > 0; }
  get bothLoaded(): boolean { return this.loadedSides().length === 2; }

  measurement(side: Side): Measurement | null {
    const c = this.cards[side];
    return c.loaded ? c.measure() : null;
  }

  sideCeilings(side: Side): Ceiling[] { return ceilings(this.measurement(side), side); }

  /** The card is held to whichever face reads worse. */
  finalCeilings(): Ceiling[] { return combine(this.measurement(FRONT), this.measurement(BACK)); }

  /** Which face is holding the grade down, when the two disagree. */
  limitingSide(): Side | null {
    const f = new Map(this.sideCeilings(FRONT).map((c) => [c.grader, c]));
    const b = new Map(this.sideCeilings(BACK).map((c) => [c.grader, c]));
    if (!f.size || !b.size) return null;
    let worseFront = 0;
    let worseBack = 0;
    for (const g of GRADERS) {
      if (f.get(g)!.rank > b.get(g)!.rank) worseFront++;
      if (b.get(g)!.rank > f.get(g)!.rank) worseBack++;
    }
    if (worseFront && !worseBack) return FRONT;
    if (worseBack && !worseFront) return BACK;
    return null;
  }

  report(now = new Date()): Record<string, unknown> {
    const data: Record<string, unknown> = {
      measured_at: now.toISOString().slice(0, 19),
      sides_measured: this.loadedSides(),
      sides: Object.fromEntries(this.loadedSides().map((s) => [s, this.cards[s].report(s)])),
    };
    const finals = this.finalCeilings();
    if (finals.length) {
      data.final_grade_ceilings = Object.fromEntries(finals.map((c) =>
        [c.grader, { grade: c.grade, descriptor: c.descriptor, set_by_side: c.side }]));
      data.limiting_side = this.limitingSide();
      data.grade_note = "Centering only, and a ceiling rather than a prediction. Corners, "
        + "edges and surface are not assessed, so the actual grade can be lower.";
      if (!this.bothLoaded) {
        data.grade_caveat = `Only the ${this.loadedSides().join(", ")} was measured; the other `
          + "face could pull the grade down further.";
      }
    }
    return data;
  }

  /** Serialise, embedding each source image so the file stands on its own. */
  async save(encode: (r: Raster) => Promise<string>): Promise<SavedSession> {
    const sides: Partial<Record<Side, SavedSide>> = {};
    for (const s of this.loadedSides()) {
      const card = this.cards[s];
      sides[s] = { ...card.state(), image: await encode(card.source!) };
    }
    return { format: SESSION_FORMAT, version: SESSION_VERSION, active: this.active, sides };
  }

  static async open(
    saved: SavedSession, decode: (s: string) => Promise<Raster>, canvasSize: Vec,
  ): Promise<Session> {
    if (saved?.format !== SESSION_FORMAT) throw new Error("This is not a Card Centering Grader session file.");
    const session = new Session();
    for (const s of SIDE_ORDER) {
      const blob = saved.sides?.[s];
      if (blob) session.cards[s].restore(await decode(blob.image), blob, canvasSize);
    }
    session.active = saved.active === BACK ? BACK : FRONT;
    if (!session.card.loaded && session.anyLoaded) session.active = session.loadedSides()[0];
    return session;
  }
}
