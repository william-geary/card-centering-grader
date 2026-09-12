/**
 * Multi-point centering measurement.
 *
 * The eight boundary lines form an outer frame (the card edge) and an inner
 * frame (the inside edge of the printed border). Rather than one margin per
 * side, N samples are taken per axis and averaged. That cancels small
 * misjudgements and handles an inner frame that is rotated relative to the
 * card edge -- the classic tilted-print case.
 *
 * Left/right sampling, with the inner frame's corners TL/TR/BL/BR:
 *
 *     A(t) = lerp(TL, BL, t)   on the inner-left line
 *     B(t) = lerp(TR, BR, t)   on the inner-right line
 *
 * The scan line through A(t) and B(t) is intersected with the outer-left and
 * outer-right lines. The left margin runs from that intersection to A(t),
 * measured along the scan direction; the right margin from B(t) to the
 * outer-right intersection. With N=3 the samples land on the two inner corners
 * and the midpoint between them. Top/bottom is the same, rotated 90 degrees.
 *
 * All distances are in image pixels, so the ratios are independent of how the
 * card happens to be displayed.
 */

import { type Vec, Line, dot, intersect, lerp, sub, unit } from "./geometry";

export const SIDES = [
  "outer_left", "outer_right", "outer_top", "outer_bottom",
  "inner_left", "inner_right", "inner_top", "inner_bottom",
] as const;
export type LineKey = (typeof SIDES)[number];
export type Lines = Record<LineKey, Line>;

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

export class AxisResult {
  lowMargins: number[] = []; // per sample, image px
  highMargins: number[] = [];
  samplePoints: Array<[Vec, Vec, Vec, Vec]> = []; // outerA, innerA, innerB, outerB
  valid = false;

  constructor(
    public name: string,
    public lowLabel: string,
    public highLabel: string,
  ) {}

  get low(): number { return mean(this.lowMargins); }
  get high(): number { return mean(this.highMargins); }
  get total(): number { return this.low + this.high; }

  get lowPct(): number {
    const t = this.total;
    return t > 1e-9 ? (100 * this.low) / t : 50;
  }

  get highPct(): number { return 100 - this.lowPct; }

  samplePcts(): number[] {
    return this.lowMargins.map((lo, i) => {
      const t = lo + this.highMargins[i];
      return t > 1e-9 ? (100 * lo) / t : 50;
    });
  }

  /** A negative margin: an outer line has been dragged inside its inner one. */
  get crossed(): boolean {
    return [...this.lowMargins, ...this.highMargins].some((v) => v < 0);
  }

  /** Max minus min of the per-sample percentages; large = frames not parallel. */
  get spread(): number {
    const p = this.samplePcts();
    return p.length ? Math.max(...p) - Math.min(...p) : 0;
  }

  text(): string {
    return this.valid ? `${this.lowPct.toFixed(1)} / ${this.highPct.toFixed(1)}` : "--";
  }
}

export class Measurement {
  constructor(public lr: AxisResult, public tb: AxisResult, public nSamples = 3) {}

  get valid(): boolean { return this.lr.valid && this.tb.valid; }
  get crossed(): boolean { return this.lr.crossed || this.tb.crossed; }

  /** The largest of the four percentages: how far off-centre the worst side is. */
  worstPct(): number {
    if (!this.valid) return 50;
    return Math.max(this.lr.lowPct, this.lr.highPct, this.tb.lowPct, this.tb.highPct);
  }
}

function sampleAxis(
  name: string, lowLabel: string, highLabel: string,
  a0: Vec | null, a1: Vec | null, b0: Vec | null, b1: Vec | null,
  outerLow: Line, outerHigh: Line, n: number,
): AxisResult {
  const res = new AxisResult(name, lowLabel, highLabel);
  if (!a0 || !a1 || !b0 || !b1) return res;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = lerp(a0, a1, t); // on the low inner line
    const b = lerp(b0, b1, t); // on the high inner line
    const scan = new Line(a, b);
    const pa = intersect(scan, outerLow);
    const pb = intersect(scan, outerHigh);
    if (!pa || !pb) return new AxisResult(name, lowLabel, highLabel);
    const u = unit(sub(b, a)); // scan direction, low -> high
    res.lowMargins.push(dot(sub(a, pa), u));
    res.highMargins.push(dot(sub(pb, b), u));
    res.samplePoints.push([pa, a, b, pb]);
  }
  res.valid = true;
  return res;
}

export function measure(lines: Lines, nSamples = 3): Measurement {
  const n = Math.max(1, Math.trunc(nSamples));
  const il = lines.inner_left;
  const ir = lines.inner_right;
  const it = lines.inner_top;
  const ib = lines.inner_bottom;
  const tl = intersect(it, il);
  const tr = intersect(it, ir);
  const bl = intersect(ib, il);
  const br = intersect(ib, ir);
  const lr = sampleAxis("Left / Right", "L", "R", tl, bl, tr, br,
    lines.outer_left, lines.outer_right, n);
  const tb = sampleAxis("Top / Bottom", "T", "B", tl, tr, bl, br,
    lines.outer_top, lines.outer_bottom, n);
  return new Measurement(lr, tb, n);
}
