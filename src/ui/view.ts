/**
 * The interactive card canvas.
 *
 * Stages:
 *   perspective -- four corner handles over the original photo; flattening maps
 *                  them to a rectangle. Optional: scans do not need it.
 *   rotate      -- straighten and size the card on screen.
 *   bulk        -- one handle per line; dragging slides the line along its own
 *                  normal, so its angle never changes.
 *   precision   -- two handles per line, lines drawn to the edge of the view,
 *                  so a tilted border can be matched.
 *
 * Input goes through Pointer Events, so mouse, trackpad, pen and touch share
 * one path; two fingers pinch to zoom and, in the rotate stage, twist.
 */

import { type Vec, Line, clipLineToRect, dot, lerp } from "../core/geometry";
import { type LineKey, SIDES } from "../core/measure";
import { type CardModel, OUTER, INNER, PRETTY } from "../core/model";
import type { Quad } from "../core/perspective";
import { type Raster, type TintMode, applyTint } from "../core/raster";
import { ViewTransform } from "../core/transform";
import { homeView } from "../core/framing";
import { coarsePointer, rasterToCanvas } from "../platform/files";
import { CORNER_C, DEFAULT_SCHEME, SAMPLE_C, SEL_C, type SchemeName, colorFor } from "./palette";

export type Stage = "perspective" | "rotate" | "bulk" | "precision";

export const STAGES: readonly Stage[] = ["perspective", "rotate", "bulk", "precision"];
export const STAGE_TITLES: Record<Stage, string> = {
  perspective: "Perspective",
  rotate: "Rotation",
  bulk: "Bulk",
  precision: "Precision",
};

interface Selected { key: LineKey; idx: 0 | 1 | null }
type Drag =
  | { kind: "pan"; last: Vec }
  | { kind: "rotate"; last: Vec }
  | { kind: "handle"; last: Vec }
  | { kind: "corner"; index: number; last: Vec };
interface Gesture { center: Vec; dist: number; angle: number }

export interface ViewEvents {
  /** Lines or selection changed: the numbers need recomputing. */
  change(): void;
  /** Only the view moved: rotation/zoom readouts need updating. */
  viewChange(): void;
  status(msg: string): void;
}

const BG = "#16171a";

export class CardView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  model: CardModel | null = null;
  stage: Stage = "rotate";
  scheme: SchemeName = DEFAULT_SCHEME;
  tintMode: TintMode = "None";
  tintStrength = 60;
  lineWidth = 1.5;
  showSamples = true;
  showGrid = false;
  loupeEnabled = true;
  loupeZoom = 6;
  nudgeStep = 1;

  selected: Selected | null = null;
  private hover: Selected | number | null = null;

  /** Perspective stage: corners in source-image pixels, and its own view. */
  corners: Quad | null = null;
  selectedCorner: number | null = null;
  perspTransform = new ViewTransform();

  private pointers = new Map<number, { pos: Vec; type: string }>();
  private drag: Drag | null = null;
  private gesture: Gesture | null = null;
  private mouse: Vec | null = null;
  private size: Vec = [1, 1];
  private dpr = 1;
  private pending = 0;

  private workCache = { canvas: document.createElement("canvas"), key: "" };
  private srcCache = { canvas: document.createElement("canvas"), key: "" };

  constructor(host: HTMLElement, private events: ViewEvents) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "card-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "Card image. Drag handles to place the boundary lines.");
    host.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;

    new ResizeObserver(() => this.resize()).observe(host);
    const c = this.canvas;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e));
    c.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { this.mouse = null; this.requestDraw(); } });
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    this.resize();
  }

  // ------------------------------------------------------------------ state
  get viewSize(): Vec { return this.size; }

  setModel(model: CardModel | null): void {
    this.model = model;
    this.selected = null;
    this.hover = null;
    this.drag = null;
    this.gesture = null;
    this.corners = null;
    this.selectedCorner = null;
    this.workCache.key = "";
    this.srcCache.key = "";
    if (model?.loaded && this.stage === "perspective") this.beginPerspective();
    this.requestDraw();
  }

  setStage(stage: Stage): void {
    if (stage === this.stage) return;
    const leaving = this.stage;
    this.stage = stage;
    this.selected = null;
    this.hover = null;
    if (this.model?.loaded) {
      if (stage === "perspective") this.beginPerspective();
      // Entering precision: park each handle pair near its corners.
      if (stage === "precision" && leaving !== "precision") {
        this.model.snapshot();
        this.model.placeHandles();
      }
    }
    this.requestDraw();
    this.events.change();
  }

  /** The transform for whatever image the current stage shows. */
  get transform(): ViewTransform {
    return this.stage === "perspective" ? this.perspTransform : this.model!.transform;
  }

  setTint(mode: TintMode, strength: number): void {
    this.tintMode = mode;
    this.tintStrength = strength;
    this.requestDraw();
  }

  // ------------------------------------------------------------- perspective
  /** Start from saved corners, or from the outer frame if there is one. */
  beginPerspective(): void {
    const m = this.model!;
    const src = m.source!;
    this.perspTransform = new ViewTransform();
    this.perspTransform.fit([src.width, src.height], this.size);
    if (m.flattenCorners) {
      this.corners = m.flattenCorners.map((p) => [...p]) as Quad;
    } else {
      const oc = m.outerCorners();
      const inBounds = oc?.every(([x, y]) => x > -src.width && x < 2 * src.width && y > -src.height && y < 2 * src.height);
      this.corners = oc && inBounds
        ? (oc.map((p) => [...p]) as Quad)
        : [[src.width * 0.1, src.height * 0.1], [src.width * 0.9, src.height * 0.1],
           [src.width * 0.9, src.height * 0.9], [src.width * 0.1, src.height * 0.9]];
    }
    this.selectedCorner = null;
  }

  // ----------------------------------------------------------------- framing
  home(): void {
    if (!this.model?.loaded) return;
    if (this.stage === "perspective") {
      const src = this.model.source!;
      this.perspTransform.fit([src.width, src.height], this.size);
    } else if (!homeView(this.model, this.size)) {
      this.fitScan();
      return;
    }
    this.requestDraw();
    this.events.viewChange();
  }

  fitScan(): void {
    if (!this.model?.loaded) return;
    const t = this.transform;
    const img = this.stage === "perspective" ? this.model.source! : this.model.image!;
    const angle = t.angle;
    t.fit([img.width, img.height], this.size);
    t.angle = angle;
    this.requestDraw();
    this.events.viewChange();
  }

  private resize(): void {
    const host = this.canvas.parentElement!;
    const w = Math.max(1, host.clientWidth);
    const hgt = Math.max(1, host.clientHeight);
    const [ow, oh] = this.size;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(hgt * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${hgt}px`;
    // Keep whatever is in the middle of the view in the middle.
    if (this.model?.loaded && (ow > 1 || oh > 1)) {
      const dx = (w - ow) / 2;
      const dy = (hgt - oh) / 2;
      for (const t of [this.model.transform, this.perspTransform]) t.pan = [t.pan[0] + dx, t.pan[1] + dy];
    }
    this.size = [w, hgt];
    this.draw();
  }

  // ---------------------------------------------------------------- handles
  private hitRadius(type: string): number {
    return type === "mouse" ? 14 : 26;
  }

  private handles(): Array<{ sel: Selected; p: Vec }> {
    const m = this.model;
    if (!m?.lines) return [];
    const t = m.transform;
    const out: Array<{ sel: Selected; p: Vec }> = [];
    if (this.stage === "bulk") {
      for (const k of [...OUTER, ...INNER]) {
        const [a, b] = m.segment(k);
        out.push({ sel: { key: k, idx: null }, p: t.imgToView(lerp(a, b, 0.5)) });
      }
    } else if (this.stage === "precision") {
      for (const k of [...OUTER, ...INNER]) {
        out.push({ sel: { key: k, idx: 0 }, p: t.imgToView(m.lines[k].p1) });
        out.push({ sel: { key: k, idx: 1 }, p: t.imgToView(m.lines[k].p2) });
      }
    }
    return out;
  }

  /** Nearest handle within reach; ties go to the line already selected. */
  private hit(pos: Vec, type: string): Selected | null {
    let best: Selected | null = null;
    let bestD = this.hitRadius(type);
    for (const { sel, p } of this.handles()) {
      const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
      if (d < bestD - 0.5 || (d < bestD + 0.5 && this.selected && sel.key === this.selected.key)) {
        best = sel;
        bestD = d;
      }
    }
    return best;
  }

  private hitCorner(pos: Vec, type: string): number | null {
    if (!this.corners) return null;
    let best: number | null = null;
    let bestD = this.hitRadius(type) + 4;
    this.corners.forEach((c, i) => {
      const p = this.perspTransform.imgToView(c);
      const d = Math.hypot(p[0] - pos[0], p[1] - pos[1]);
      if (d < bestD) { best = i; bestD = d; }
    });
    return best;
  }

  // ------------------------------------------------------------------ input
  private pos(e: PointerEvent | WheelEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    if (!this.model?.loaded) return;
    // Capture can throw for a pointer the browser has already released.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    const pos = this.pos(e);
    this.pointers.set(e.pointerId, { pos, type: e.pointerType });

    if (this.pointers.size === 2) {
      // A second finger turns whatever was happening into pinch/twist.
      this.drag = null;
      this.gesture = this.gestureNow();
      return;
    }
    if (this.pointers.size > 2) return;

    const type = e.pointerType;
    if (e.button === 1 || e.button === 2) {
      this.drag = { kind: "pan", last: pos };
    } else if (this.stage === "perspective") {
      const i = this.hitCorner(pos, type);
      this.selectedCorner = i;
      this.drag = i !== null ? { kind: "corner", index: i, last: pos } : { kind: "pan", last: pos };
    } else if (this.stage === "rotate") {
      this.drag = type === "mouse" && !e.shiftKey ? { kind: "rotate", last: pos } : { kind: "pan", last: pos };
    } else {
      const target = this.hit(pos, type);
      if (target) {
        this.model.snapshot();
        this.selected = target;
        this.drag = { kind: "handle", last: pos };
        this.events.change();
      } else {
        this.drag = { kind: "pan", last: pos };
      }
    }
    this.requestDraw();
  }

  private onMove(e: PointerEvent): void {
    const pos = this.pos(e);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) ptr.pos = pos;
    if (e.pointerType === "mouse") this.mouse = pos;
    if (!this.model?.loaded) return;

    if (this.gesture && this.pointers.size >= 2) {
      this.applyGesture();
      return;
    }
    if (!this.drag) {
      if (e.pointerType === "mouse") this.updateHover(pos);
      return;
    }

    const t = this.transform;
    const d = this.drag;
    const dv: Vec = [pos[0] - d.last[0], pos[1] - d.last[1]];
    const fine = e.ctrlKey || e.metaKey ? 0.2 : 1;
    d.last = pos;

    switch (d.kind) {
      case "pan":
        t.pan = [t.pan[0] + dv[0], t.pan[1] + dv[1]];
        this.events.viewChange();
        break;
      case "rotate": {
        const c: Vec = [this.size[0] / 2, this.size[1] / 2];
        const prev: Vec = [pos[0] - dv[0], pos[1] - dv[1]];
        const a0 = Math.atan2(prev[1] - c[1], prev[0] - c[0]);
        const a1 = Math.atan2(pos[1] - c[1], pos[0] - c[0]);
        let deg = ((a1 - a0) * 180) / Math.PI;
        if (deg > 180) deg -= 360;
        if (deg < -180) deg += 360;
        t.rotateAbout(c, deg * (e.ctrlKey || e.metaKey ? 0.25 : 1));
        this.events.viewChange();
        break;
      }
      case "corner": {
        const delta = t.viewDeltaToImg([dv[0] * fine, dv[1] * fine]);
        const p = this.corners![d.index];
        this.corners![d.index] = [p[0] + delta[0], p[1] + delta[1]];
        break;
      }
      case "handle": {
        const sel = this.selected;
        const m = this.model;
        if (!sel || !m.lines) break;
        const line = m.lines[sel.key];
        const delta = t.viewDeltaToImg([dv[0] * fine, dv[1] * fine]);
        if (this.stage === "bulk") {
          if (e.altKey) {
            const n = line.normal();
            const k = dot(delta, n);
            m.moveFrame(sel.key.startsWith("outer") ? "outer" : "inner", [n[0] * k, n[1] * k]);
          } else {
            line.translatePerpendicular(delta);
          }
        } else if (e.shiftKey || sel.idx === null) {
          line.translatePerpendicular(delta);
        } else {
          const p = sel.idx === 0 ? line.p1 : line.p2;
          line.setControl(sel.idx, [p[0] + delta[0], p[1] + delta[1]]);
        }
        this.events.change();
        break;
      }
    }
    this.requestDraw();
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch { /* not fatal */ }
    if (this.gesture) {
      // Stay out of single-finger mode until every finger has lifted, so the
      // view does not jump when one finger leaves before the other.
      if (this.pointers.size === 0) this.gesture = null;
      else if (this.pointers.size >= 2) this.gesture = this.gestureNow();
      this.requestDraw();
      return;
    }
    if (this.drag) {
      const wasHandle = this.drag.kind === "handle";
      this.drag = null;
      if (wasHandle) this.events.change();
    }
    this.requestDraw();
  }

  private gestureNow(): Gesture {
    const [a, b] = [...this.pointers.values()].map((p) => p.pos);
    return {
      center: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
      dist: Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1])),
      angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
    };
  }

  private applyGesture(): void {
    const g = this.gesture!;
    const now = this.gestureNow();
    const t = this.transform;
    t.pan = [t.pan[0] + now.center[0] - g.center[0], t.pan[1] + now.center[1] - g.center[1]];
    t.zoomAbout(now.center, now.dist / g.dist);
    if (this.stage === "rotate") {
      let deg = ((now.angle - g.angle) * 180) / Math.PI;
      if (deg > 180) deg -= 360;
      if (deg < -180) deg += 360;
      t.rotateAbout(now.center, deg);
    }
    this.gesture = now;
    this.events.viewChange();
    this.requestDraw();
  }

  private onWheel(e: WheelEvent): void {
    if (!this.model?.loaded) return;
    e.preventDefault();
    const pos = this.pos(e);
    const t = this.transform;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (this.stage === "rotate" && e.altKey) {
      t.rotateAbout(pos, dy > 0 ? -0.25 : 0.25);
    } else {
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      t.zoomAbout(pos, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
    }
    this.events.viewChange();
    this.requestDraw();
  }

  private updateHover(pos: Vec): void {
    let h: Selected | number | null = null;
    if (this.stage === "perspective") h = this.hitCorner(pos, "mouse");
    else if (this.stage === "bulk" || this.stage === "precision") h = this.hit(pos, "mouse");
    const cursor = h !== null ? "grab" : this.stage === "rotate" ? "alias" : "default";
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
    const changed = JSON.stringify(h) !== JSON.stringify(this.hover);
    this.hover = h;
    if (changed || (this.stage === "precision" && this.loupeEnabled)) this.requestDraw();
  }

  /** Arrow-key movement of the selection, in image pixels. */
  nudge(dx: number, dy: number, factor = 1): boolean {
    const m = this.model;
    if (!m?.loaded) return false;
    const step = this.nudgeStep * factor;
    if (this.stage === "perspective" && this.corners && this.selectedCorner !== null) {
      const d = this.perspTransform.viewDeltaToImg([dx * step * this.perspTransform.scale, dy * step * this.perspTransform.scale]);
      const p = this.corners[this.selectedCorner];
      this.corners[this.selectedCorner] = [p[0] + d[0], p[1] + d[1]];
      this.requestDraw();
      return true;
    }
    if (!this.selected || !m.lines || this.stage === "rotate") return false;
    m.snapshot();
    const line = m.lines[this.selected.key];
    const d = m.transform.viewDeltaToImg([dx * step * m.transform.scale, dy * step * m.transform.scale]);
    if (this.stage === "bulk" || this.selected.idx === null) {
      line.translatePerpendicular(d);
    } else {
      const p = this.selected.idx === 0 ? line.p1 : line.p2;
      line.setControl(this.selected.idx, [p[0] + d[0], p[1] + d[1]]);
    }
    this.events.change();
    this.requestDraw();
    return true;
  }

  // ---------------------------------------------------------------- drawing
  requestDraw(): void {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.draw();
    });
  }

  private drawable(raster: Raster, cache: { canvas: HTMLCanvasElement; key: string }, version: string): HTMLCanvasElement {
    const key = `${version}|${this.tintMode}|${this.tintStrength}`;
    if (cache.key !== key) {
      rasterToCanvas(applyTint(raster, this.tintMode, this.tintStrength), cache.canvas);
      cache.key = key;
    }
    return cache.canvas;
  }

  draw(): void {
    const ctx = this.ctx;
    const [w, hgt] = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, hgt);
    const m = this.model;
    if (!m?.loaded) return;

    const t = this.transform;
    const persp = this.stage === "perspective";
    const img = persp
      ? this.drawable(m.source!, this.srcCache, `src${m.imageVersion}`)
      : this.drawable(m.image!, this.workCache, `work${m.imageVersion}`);
    const [a, b, c, d, e, f] = t.canvasMatrix();
    const k = this.dpr;
    ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k);
    // Crisp pixels once zoomed in, so an edge can be seated exactly.
    ctx.imageSmoothingEnabled = t.scale < 2;
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    if (this.showGrid && this.stage === "rotate") this.drawGrid();
    if (persp) {
      this.drawPerspective();
    } else if (m.lines) {
      this.drawLines();
      if (this.showSamples && this.stage !== "rotate") this.drawSamples();
      this.drawHandles();
    }
    this.drawHud();
    this.drawLoupe();
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const [w, hgt] = this.size;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 60; x < w; x += 60) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, hgt); }
    for (let y = 60; y < hgt; y += 60) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(Math.round(w / 2) + 0.5, 0); ctx.lineTo(Math.round(w / 2) + 0.5, hgt);
    ctx.moveTo(0, Math.round(hgt / 2) + 0.5); ctx.lineTo(w, Math.round(hgt / 2) + 0.5);
    ctx.stroke();
  }

  private drawLines(): void {
    const m = this.model!;
    const t = m.transform;
    const ctx = this.ctx;
    const [w, hgt] = this.size;
    const infinite = this.stage === "precision";
    ctx.globalAlpha = this.stage === "rotate" ? 0.55 : 1;
    for (const key of [...OUTER, ...INNER]) {
      const sel = this.selected?.key === key;
      let seg: [Vec, Vec] | null;
      if (infinite) {
        const l = m.lines![key];
        seg = clipLineToRect(new Line(t.imgToView(l.p1), t.imgToView(l.p2)), -2, -2, w + 2, hgt + 2);
      } else {
        const [a, b] = m.segment(key);
        seg = [t.imgToView(a), t.imgToView(b)];
      }
      if (!seg) continue;
      ctx.strokeStyle = colorFor(key, this.scheme);
      ctx.lineWidth = this.lineWidth + (sel ? 1 : 0);
      ctx.beginPath();
      ctx.moveTo(seg[0][0], seg[0][1]);
      ctx.lineTo(seg[1][0], seg[1][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawSamples(): void {
    const m = this.model!;
    const r = m.measure();
    if (!r?.valid) return;
    const t = m.transform;
    const ctx = this.ctx;
    ctx.strokeStyle = SAMPLE_C;
    ctx.fillStyle = SAMPLE_C;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const axis of [r.lr, r.tb]) {
      for (const [pa, , , pb] of axis.samplePoints) {
        const va = t.imgToView(pa);
        const vb = t.imgToView(pb);
        ctx.beginPath();
        ctx.moveTo(va[0], va[1]);
        ctx.lineTo(vb[0], vb[1]);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    for (const axis of [r.lr, r.tb]) {
      for (const pts of axis.samplePoints) {
        pts.forEach((q, i) => {
          const v = t.imgToView(q);
          ctx.beginPath();
          ctx.arc(v[0], v[1], i === 0 || i === 3 ? 3 : 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
  }

  private drawHandles(): void {
    const ctx = this.ctx;
    const big = coarsePointer();
    for (const { sel, p } of this.handles()) {
      const isSel = this.selected?.key === sel.key && this.selected.idx === sel.idx;
      const isHover = typeof this.hover === "object" && this.hover?.key === sel.key && this.hover.idx === sel.idx;
      let r = (this.stage === "bulk" ? 6 : 5) + (big ? 3 : 0);
      if (isSel) r += 1.5;
      ctx.beginPath();
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? SEL_C : colorFor(sel.key, this.scheme);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isSel || isHover ? "#ffffff" : "#111417";
      ctx.stroke();
    }
  }

  private drawPerspective(): void {
    if (!this.corners) return;
    const ctx = this.ctx;
    const t = this.perspTransform;
    const [w, hgt] = this.size;
    const v = this.corners.map((p) => t.imgToView(p));
    // Faint extensions of each edge help line a handle up with a straight card
    // edge, since real card corners are rounded and the true corner is virtual.
    ctx.strokeStyle = "rgba(255,213,79,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    for (let i = 0; i < 4; i++) {
      const seg = clipLineToRect(new Line(v[i], v[(i + 1) % 4]), 0, 0, w, hgt);
      if (!seg) continue;
      ctx.beginPath();
      ctx.moveTo(seg[0][0], seg[0][1]);
      ctx.lineTo(seg[1][0], seg[1][1]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = CORNER_C;
    ctx.lineWidth = 2;
    ctx.beginPath();
    v.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    const big = coarsePointer();
    const labels = ["TL", "TR", "BR", "BL"];
    v.forEach((p, i) => {
      const sel = this.selectedCorner === i;
      ctx.beginPath();
      ctx.arc(p[0], p[1], (big ? 11 : 8) + (sel ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle = sel ? "#ffffff" : "rgba(255,213,79,0.25)";
      ctx.fill();
      ctx.strokeStyle = CORNER_C;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#ffd54f";
      ctx.font = "600 10px system-ui, sans-serif";
      ctx.fillText(labels[i], p[0] + 12, p[1] - 10);
    });
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const touch = coarsePointer();
    const hints: Record<Stage, string> = touch ? {
      perspective: "Drag the four corners onto the card's corners · pinch to zoom",
      rotate: "Twist two fingers to rotate · pinch to zoom · drag to pan",
      bulk: "Drag a handle to slide its line · pinch to zoom",
      precision: "Drag either end to pivot a line · pinch to zoom",
    } : {
      perspective: "Drag the corners onto the card's corners · wheel: zoom · right-drag: pan",
      rotate: "Drag: rotate · shift or right-drag: pan · wheel: zoom · alt+wheel: fine rotate",
      bulk: "Drag a handle to slide its line · alt+drag: whole frame · arrows: nudge",
      precision: "Drag an end to pivot · shift+drag: slide · ctrl+drag: fine",
    };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.fillStyle = "#e6e8ea";
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(STAGE_TITLES[this.stage].toUpperCase(), 14, 22);
    ctx.fillStyle = "#b5bac0";
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillText(hints[this.stage], 14, 40);
    if (this.selected && this.stage !== "perspective") {
      ctx.fillStyle = colorFor(this.selected.key, this.scheme);
      ctx.font = "600 12px system-ui, sans-serif";
      const label = PRETTY[this.selected.key] + (this.selected.idx === null ? "" : `  · end ${this.selected.idx + 1}`);
      ctx.fillText(label, 14, this.size[1] - 14);
    }
    ctx.restore();
  }

  /** Magnified inset, shown on hover in precision and while dragging a handle. */
  private drawLoupe(): void {
    if (!this.loupeEnabled || !this.model?.loaded) return;
    const m = this.model;
    let anchorView: Vec | null = null;
    if (this.drag?.kind === "handle" && this.selected && m.lines) {
      const l = m.lines[this.selected.key];
      anchorView = this.selected.idx === null
        ? m.transform.imgToView(lerp(...m.segment(this.selected.key), 0.5))
        : m.transform.imgToView(this.selected.idx === 0 ? l.p1 : l.p2);
    } else if (this.drag?.kind === "corner" && this.corners) {
      anchorView = this.perspTransform.imgToView(this.corners[this.drag.index]);
    } else if (this.stage === "precision" && this.mouse && !this.drag && !this.gesture) {
      anchorView = this.mouse;
    }
    if (!anchorView) return;

    const ctx = this.ctx;
    const [w, hgt] = this.size;
    const size = Math.min(coarsePointer() ? 170 : 220, Math.min(w, hgt) * 0.42);
    const pad = 12;
    const bx = anchorView[0] > w / 2 ? pad : w - size - pad;
    const by = anchorView[1] > hgt / 2 ? pad + 44 : hgt - size - pad;

    const t = this.transform;
    const lt = new ViewTransform(t.angle, t.scale * this.loupeZoom, [0, 0], [...t.center]);
    const anchorImg = t.viewToImg(anchorView);
    const at = lt.imgToView(anchorImg);
    lt.pan = [size / 2 - at[0], size / 2 - at[1]];

    const persp = this.stage === "perspective";
    const img = persp ? this.srcCache.canvas : this.workCache.canvas;
    const k = this.dpr;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, size, size, 10);
    ctx.clip();
    ctx.fillStyle = BG;
    ctx.fillRect(bx, by, size, size);
    const [a, b, c, d, e, f] = lt.canvasMatrix();
    ctx.setTransform(a * k, b * k, c * k, d * k, (e + bx) * k, (f + by) * k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    ctx.lineWidth = 1.5;
    if (persp && this.corners) {
      const v = this.corners.map((p) => lt.imgToView(p));
      ctx.strokeStyle = CORNER_C;
      for (let i = 0; i < 4; i++) {
        const seg = clipLineToRect(new Line(v[i], v[(i + 1) % 4]), 0, 0, size, size);
        if (!seg) continue;
        ctx.beginPath();
        ctx.moveTo(seg[0][0] + bx, seg[0][1] + by);
        ctx.lineTo(seg[1][0] + bx, seg[1][1] + by);
        ctx.stroke();
      }
    } else if (m.lines) {
      for (const key of SIDES) {
        const l = m.lines[key];
        const seg = clipLineToRect(new Line(lt.imgToView(l.p1), lt.imgToView(l.p2)), 0, 0, size, size);
        if (!seg) continue;
        ctx.strokeStyle = colorFor(key, this.scheme);
        ctx.beginPath();
        ctx.moveTo(seg[0][0] + bx, seg[0][1] + by);
        ctx.lineTo(seg[1][0] + bx, seg[1][1] + by);
        ctx.stroke();
      }
    }
    const cx = bx + size / 2;
    const cy = by + size / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy);
    ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 9);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx + 0.5, by + 0.5, size - 1, size - 1, 10);
    ctx.stroke();
    ctx.fillStyle = "#9aa0a6";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText(`${this.loupeZoom.toFixed(0)}×`, bx + 8, by + 16);
  }
}
