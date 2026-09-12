/**
 * Centering-only grade ceilings for the major graders.
 *
 * A grade depends on centering, corners, edges and surface. This tool only
 * looks at centering, so what it can honestly report is a *ceiling*: the best
 * grade the measured centering still allows.
 *
 * Each table maps "worst of the four percentages" to the best grade permitted
 * at or below that number, best grade first. These are the centering
 * tolerances as they are commonly published; graders revise them, so they are
 * gathered here in one place to be easy to check and edit.
 */

import type { Measurement } from "./measure";

export const FRONT = "front";
export const BACK = "back";
export type Side = typeof FRONT | typeof BACK;

type Row = readonly [limit: number, grade: string, descriptor: string];
type Table = readonly Row[];

const PSA_FRONT: Table = [
  [55, "10", "Gem Mint"], [60, "9", "Mint"], [65, "8", "NM-MT"], [70, "7", "NM"],
  [80, "6", "EX-MT"], [85, "5", "EX"], [90, "3", "VG"], [100, "1", "Poor"],
];
const PSA_BACK: Table = [[75, "10", "Gem Mint"], [90, "9", "Mint"], [100, "1", "Poor"]];

// Beckett grades centering as its own subgrade; a 10 in all four subgrades is
// the Black Label.
const BGS_FRONT: Table = [
  [50, "10", "Pristine"], [55, "9.5", "Gem Mint"], [60, "9", "Mint"],
  [65, "8.5", "NM-MT+"], [70, "8", "NM-MT"], [75, "7.5", "NM+"], [80, "7", "NM"],
  [85, "6.5", "EX-MT+"], [90, "6", "EX-MT"], [100, "5", "EX"],
];
const BGS_BACK: Table = [
  [55, "10", "Pristine"], [60, "9.5", "Gem Mint"], [65, "9", "Mint"],
  [75, "8.5", "NM-MT+"], [85, "8", "NM-MT"], [90, "7.5", "NM+"], [100, "7", "NM"],
];

const CGC_FRONT: Table = [
  [50, "10", "Pristine"], [55, "10", "Gem Mint"], [60, "9.5", "Mint+"],
  [65, "9", "Mint"], [70, "8.5", "NM-MT+"], [80, "8", "NM-MT"], [85, "7", "NM"],
  [90, "6", "EX-MT"], [100, "5", "EX"],
];
const CGC_BACK: Table = [
  [60, "10", "Pristine"], [65, "10", "Gem Mint"], [70, "9.5", "Mint+"],
  [80, "9", "Mint"], [90, "8", "NM-MT"], [100, "6", "EX-MT"],
];

export const GRADERS = ["PSA", "BGS", "CGC"] as const;
export type Grader = (typeof GRADERS)[number];

export const TABLES: Record<Grader, Record<Side, Table>> = {
  PSA: { front: PSA_FRONT, back: PSA_BACK },
  BGS: { front: BGS_FRONT, back: BGS_BACK },
  CGC: { front: CGC_FRONT, back: CGC_BACK },
};

export interface Ceiling {
  grader: Grader;
  grade: string;
  descriptor: string;
  side: Side;
  rank: number; // index into the table; 0 is the best row
}

export function ceiling(grader: Grader, worstPct: number, side: Side = FRONT): Ceiling {
  const table = TABLES[grader][side];
  for (let i = 0; i < table.length; i++) {
    const [limit, grade, descriptor] = table[i];
    if (worstPct <= limit + 1e-9) return { grader, grade, descriptor, side, rank: i };
  }
  const i = table.length - 1;
  return { grader, grade: table[i][1], descriptor: table[i][2], side, rank: i };
}

/**
 * The lower of two ceilings for the same grader. Ranks are compared rather
 * than labels, because CGC lists Pristine 10 above Gem Mint 10 and both print
 * as "10".
 */
export function worse(a: Ceiling | undefined, b: Ceiling | undefined): Ceiling | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.rank > a.rank ? b : a;
}

/** Ceilings for every grader, or [] when the lines are not usable. */
export function ceilings(m: Measurement | null | undefined, side: Side = FRONT): Ceiling[] {
  if (!m || !m.valid || m.crossed) return [];
  const worst = m.worstPct();
  return GRADERS.map((g) => ceiling(g, worst, side));
}

/**
 * Final ceilings from both faces. A card has to satisfy the tolerance on each
 * side, so it is held to whichever reads worse. With one side measured the
 * result is that side alone.
 */
export function combine(front: Measurement | null | undefined, back: Measurement | null | undefined): Ceiling[] {
  const f = new Map(ceilings(front, FRONT).map((c) => [c.grader, c]));
  const b = new Map(ceilings(back, BACK).map((c) => [c.grader, c]));
  const out: Ceiling[] = [];
  for (const g of GRADERS) {
    const c = worse(f.get(g), b.get(g));
    if (c) out.push(c);
  }
  return out;
}
