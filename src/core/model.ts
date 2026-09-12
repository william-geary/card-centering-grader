/**
 * One face of a card: its image, how it is being viewed, and the eight lines.
 */

import { detectFrames, type Frames, type Rect } from "./autodetect";
import { type Vec, Line, add, intersect, lerp, scale, unit } from "./geometry";
import { type Ceiling, type Side, FRONT, ceilings } from "./grades";
import { type LineKey, type Lines, type Measurement, SIDES, measure } from "./measure";
import { type Mat3, type Quad, applyH, flatten, invert3, multiply3 } from "./perspective";
import { type Raster, resizeRaster, rotateExpand } from "./raster";
import { ViewTransform } from "./transform";

export const HANDLE_INSET = 0.09; // how far precision handles sit in from corners
const DETECT_MAX = 900;

export const OUTER: readonly LineKey[] = ["outer_left", "outer_right", "outer_top", "outer_bottom"];
export const INNER: readonly LineKey[] = ["inner_left", "inner_right", "inner_top", "inner_bottom"];

/** The two lines each line meets at its ends. */
export const PARTNERS: Record<LineKey, [LineKey, LineKey]> = {
  outer_top: ["outer_left", "outer_right"],
  outer_bottom: ["outer_left", "outer_right"],
  outer_left: ["outer_top", "outer_bottom"],
  outer_right: ["outer_top", "outer_bottom"],
  inner_top: ["inner_left", "inner_right"],
  inner_bottom: ["inner_left", "inner_right"],
  inner_left: ["inner_top", "inner_bottom"],
  inner_right: ["inner_top", "inner_bottom"],
};

export const PRETTY: Record<LineKey, string> = {
  outer_left: "Outer left", outer_right: "Outer right",
  outer_top: "Outer top", outer_bottom: "Outer bottom",
  inner_left: "Inner left", inner_right: "Inner right",
  inner_top: "Inner top", inner_bottom: "Inner bottom",
};

export const isHorizontal = (k: LineKey) => k.endsWith("top") || k.endsWith("bottom");

export const rectCorners = ([x0, y0, x1, y1]: Rect): Quad => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

export function linesFromQuads(outer: Quad, inner: Quad): Lines {
  const [otl, otr, obr, obl] = outer;
  const [itl, itr, ibr, ibl] = inner;
  const L = (a: Vec, b: Vec) => new Line([...a] as Vec, [...b] as Vec);
  return {
    outer_left: L(otl, obl), outer_right: L(otr, obr),
    outer_top: L(otl, otr), outer_bottom: L(obl, obr),
    inner_left: L(itl, ibl), inner_right: L(itr, ibr),
    inner_top: L(itl, itr), inner_bottom: L(ibl, ibr),
  };
}

export const copyLines = (l: Lines): Lines =>
  Object.fromEntries(SIDES.map((k) => [k, l[k].copy()])) as Lines;

export interface CardState {
  name: string | null;
  nSamples: number;
  flattenCorners: Quad | null;
  transform: { angle: number; scale: number; pan: Vec; center: Vec };
  lines: Record<LineKey, [Vec, Vec]> | null;
}

export class CardModel {
  /** The image as loaded. */
  source: Raster | null = null;
  /** What the lines live on: the source, or its perspective-corrected copy. */
  image: Raster | null = null;
  name: string | null = null;
  flattenCorners: Quad | null = null;
  private srcToFlat: Mat3 | null = null;

  transform = new ViewTransform();
  lines: Lines | null = null;
  nSamples = 3;
  private undoStack: Lines[] = [];
  private redoStack: Lines[] = [];
  /** Bumped whenever `image` is replaced, so renderers can drop caches. */
  imageVersion = 0;

  get loaded(): boolean { return this.image !== null; }
  get size(): Vec { return this.image ? [this.image.width, this.image.height] : [0, 0]; }
  get flattened(): boolean { return this.flattenCorners !== null; }

  load(raster: Raster, name: string | null, canvasSize: Vec, auto = true): void {
    this.source = raster;
    this.image = raster;
    this.name = name;
    this.flattenCorners = null;
    this.srcToFlat = null;
    this.imageVersion++;
    this.transform = new ViewTransform();
    this.transform.fit(this.size, canvasSize);
    this.undoStack = [];
    this.redoStack = [];
    this.resetLines(auto);
  }

  // ------------------------------------------------------------- perspective
  /**
   * Flatten using four source-image corners, or pass null to go back to the
   * unflattened source. Existing lines are carried through the change.
   * Returns false if the corners cannot define a card.
   */
  setFlatten(corners: Quad | null, canvasSize: Vec): boolean {
    if (!this.source) return false;
    const oldToSrc = this.srcToFlat ? invert3(this.srcToFlat) : identity();
    let newSrcToWork: Mat3;
    if (corners === null) {
      this.image = this.source;
      this.flattenCorners = null;
      this.srcToFlat = null;
      newSrcToWork = identity();
    } else {
      const f = flatten(this.source, corners);
      if (!f) return false;
      this.image = f.raster;
      this.flattenCorners = corners.map((p) => [...p]) as Quad;
      this.srcToFlat = f.srcToFlat;
      newSrcToWork = f.srcToFlat;
    }
    this.imageVersion++;
    if (this.lines && oldToSrc) {
      const H = multiply3(newSrcToWork, oldToSrc); // old working -> new working
      for (const k of SIDES) {
        const l = this.lines[k];
        this.lines[k] = new Line(applyH(H, l.p1), applyH(H, l.p2));
      }
      this.undoStack = [];
      this.redoStack = [];
    }
    this.transform.angle = 0;
    this.transform.fit(this.size, canvasSize);
    return true;
  }

  // ------------------------------------------------------------ line set-up
  /**
   * Place the lines from auto-detection (or a fixed default) in the frame the
   * user is looking at. Once stage 1 has rotated the card straight on screen,
   * a rectangle that is axis-aligned on screen is a tilted one in image pixels,
   * so detection runs on an upright copy and the result is mapped back.
   */
  resetLines(auto = true): void {
    if (!this.image) return;
    let src = this.image;
    let sx = 1;
    let sy = 1;
    let mapper: ViewTransform | null = null;
    if (Math.abs(this.transform.angle) >= 0.005) {
      // Detection only needs ~900 px, so shrink before rotating: far cheaper on
      // a phone than rotating a full-resolution photo. Unrotated images skip
      // this and let detectFrames downscale, exactly as the Python app did.
      const s = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
      if (s < 1) {
        src = resizeRaster(src, Math.max(8, Math.round(src.width * s)), Math.max(8, Math.round(src.height * s)));
        sx = src.width / this.image.width;
        sy = src.height / this.image.height;
      }
      const r = rotateExpand(src, this.transform.angle);
      src = r.raster;
      mapper = r.mapper;
    }

    let box: Frames | null = null;
    if (auto) {
      try { box = detectFrames(src); } catch { box = null; }
    }
    if (!box) {
      const { width: w, height: h } = src;
      const ox0 = 0.03 * w, oy0 = 0.03 * h, ox1 = 0.97 * w, oy1 = 0.97 * h;
      const bw = ox1 - ox0, bh = oy1 - oy0;
      box = {
        outer: [ox0, oy0, ox1, oy1],
        inner: [ox0 + 0.1 * bw, oy0 + 0.09 * bh, ox1 - 0.1 * bw, oy1 - 0.09 * bh],
      };
    }
    const back = (p: Vec): Vec => {
      const q = mapper ? mapper.viewToImg(p) : p;
      return [q[0] / sx, q[1] / sy];
    };
    const outer = rectCorners(box.outer).map(back) as Quad;
    const inner = rectCorners(box.inner).map(back) as Quad;
    this.lines = linesFromQuads(outer, inner);
  }

  corner(a: LineKey, b: LineKey): Vec | null {
    return this.lines ? intersect(this.lines[a], this.lines[b]) : null;
  }

  outerCorners(): Quad | null {
    const pts = [
      this.corner("outer_top", "outer_left"), this.corner("outer_top", "outer_right"),
      this.corner("outer_bottom", "outer_right"), this.corner("outer_bottom", "outer_left"),
    ];
    return pts.some((p) => p === null) ? null : (pts as Quad);
  }

  outerCenter(): Vec | null {
    const q = this.outerCorners();
    if (!q) return null;
    return [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
  }

  /** The span of a line between its two partners: a visible rectangle edge. */
  segment(key: LineKey): [Vec, Vec] {
    const lines = this.lines!;
    const line = lines[key];
    const [ka, kb] = PARTNERS[key];
    const pa = intersect(line, lines[ka]);
    const pb = intersect(line, lines[kb]);
    return pa && pb ? [pa, pb] : [line.p1, line.p2];
  }

  /**
   * Park each line's control points near its corners -- pulled in by
   * HANDLE_INSET, because perpendicular lines meet at a single point and
   * handles exactly on a corner would coincide.
   */
  placeHandles(keys: readonly LineKey[] = SIDES, inset = HANDLE_INSET): void {
    if (!this.lines) return;
    const spans = keys.map((k) => this.segment(k));
    keys.forEach((k, i) => {
      const [pa, pb] = spans[i];
      this.lines![k] = new Line(lerp(pa, pb, inset), lerp(pa, pb, 1 - inset));
    });
  }

  /** Square lines to the screen axes, keeping their position. */
  straighten(keys: readonly LineKey[] = SIDES): void {
    if (!this.lines) return;
    const dirH = unit(this.transform.viewDeltaToImg([1, 0]));
    const dirV = unit(this.transform.viewDeltaToImg([0, 1]));
    for (const k of keys) {
      const mid = this.lines[k].midpoint();
      const d = isHorizontal(k) ? dirH : dirV;
      this.lines[k] = new Line(add(mid, scale(d, -100)), add(mid, scale(d, 100)));
    }
    this.placeHandles();
  }

  moveFrame(group: "outer" | "inner", delta: Vec): void {
    if (!this.lines) return;
    for (const k of group === "outer" ? OUTER : INNER) this.lines[k].translate(delta);
  }

  // ------------------------------------------------------------------- undo
  snapshot(): void {
    if (!this.lines) return;
    this.undoStack.push(copyLines(this.lines));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): boolean {
    if (!this.lines || !this.undoStack.length) return false;
    this.redoStack.push(copyLines(this.lines));
    this.lines = this.undoStack.pop()!;
    return true;
  }

  redo(): boolean {
    if (!this.lines || !this.redoStack.length) return false;
    this.undoStack.push(copyLines(this.lines));
    this.lines = this.redoStack.pop()!;
    return true;
  }

  // ---------------------------------------------------------------- results
  measure(): Measurement | null {
    return this.lines ? measure(this.lines, this.nSamples) : null;
  }

  ceilings(side: Side = FRONT): Ceiling[] {
    return ceilings(this.measure(), side);
  }

  report(side: Side = FRONT): Record<string, unknown> {
    const m = this.measure();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const data: Record<string, unknown> = {
      file: this.name,
      image_size: this.size,
      perspective_corrected: this.flattened,
      samples_per_axis: this.nSamples,
      display: { angle_deg: r3(this.transform.angle), zoom: Math.round(this.transform.scale * 1e4) / 1e4 },
      lines_image_space: this.lines
        ? Object.fromEntries(SIDES.map((k) => [k, {
            p1: this.lines![k].p1.map(r3), p2: this.lines![k].p2.map(r3),
            angle_deg: r3(this.lines![k].angleDeg()),
          }]))
        : null,
    };
    if (m && m.valid) {
      data.centering = {
        left_right: {
          left_pct: r2(m.lr.lowPct), right_pct: r2(m.lr.highPct),
          left_px: r2(m.lr.low), right_px: r2(m.lr.high),
          per_sample_left_pct: m.lr.samplePcts().map(r2),
          per_sample_left_px: m.lr.lowMargins.map(r2),
          per_sample_right_px: m.lr.highMargins.map(r2),
          spread_pct: r2(m.lr.spread),
        },
        top_bottom: {
          top_pct: r2(m.tb.lowPct), bottom_pct: r2(m.tb.highPct),
          top_px: r2(m.tb.low), bottom_px: r2(m.tb.high),
          per_sample_top_pct: m.tb.samplePcts().map(r2),
          per_sample_top_px: m.tb.lowMargins.map(r2),
          per_sample_bottom_px: m.tb.highMargins.map(r2),
          spread_pct: r2(m.tb.spread),
        },
        worst_side_pct: r2(m.worstPct()),
        card_side: side,
        grade_ceilings: Object.fromEntries(
          ceilings(m, side).map((c) => [c.grader, { grade: c.grade, descriptor: c.descriptor }])),
      };
    }
    return data;
  }

  state(): CardState {
    return {
      name: this.name,
      nSamples: this.nSamples,
      flattenCorners: this.flattenCorners,
      transform: {
        angle: this.transform.angle, scale: this.transform.scale,
        pan: [...this.transform.pan], center: [...this.transform.center],
      },
      lines: this.lines
        ? Object.fromEntries(SIDES.map((k) => [k, [[...this.lines![k].p1], [...this.lines![k].p2]]])) as
            Record<LineKey, [Vec, Vec]>
        : null,
    };
  }

  /** Restore a saved card onto an already-decoded source image. */
  restore(source: Raster, st: CardState, canvasSize: Vec): void {
    this.load(source, st.name, canvasSize, false);
    this.nSamples = st.nSamples ?? 3;
    if (st.flattenCorners) this.setFlatten(st.flattenCorners, canvasSize);
    const t = st.transform;
    if (t) this.transform = new ViewTransform(t.angle, t.scale, [...t.pan], [...t.center]);
    if (st.lines) {
      this.lines = Object.fromEntries(
        SIDES.map((k) => [k, new Line([...st.lines![k][0]], [...st.lines![k][1]])])) as Lines;
    }
    this.undoStack = [];
    this.redoStack = [];
  }
}

const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
