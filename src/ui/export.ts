/**
 * Annotated overlay images.
 *
 * Each card is drawn the way Home frames it -- upright by its stage-1 angle,
 * cropped to the outer frame with the same margin -- rather than as the whole
 * scan. A caption band carries the numbers so the picture stands on its own
 * when it is sent to somebody. With both faces measured they share one sheet
 * under a caption with the final ceiling.
 */

import { exportFrame } from "../core/framing";
import { type Vec, Line, clipLineToRect } from "../core/geometry";
import { type Side, ceilings } from "../core/grades";
import type { Measurement } from "../core/measure";
import { type CardModel, INNER, OUTER } from "../core/model";
import { type TintMode, applyTint } from "../core/raster";
import type { Session } from "../core/session";
import { ViewTransform } from "../core/transform";
import { rasterToCanvas } from "../platform/files";
import { SAMPLE_C, type SchemeName, colorFor, schemeColors } from "./palette";

const BG = "#1e1f22";
const BAND = "#16171a";
const TEXT = "#e6e8ea";
const MUTED = "#9aa0a6";
const RULE = "#3a3e44";
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export interface ExportLook {
  scheme: SchemeName;
  tintMode: TintMode;
  tintStrength: number;
  showSamples: boolean;
}

function newCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")!];
}

/** The card alone: straightened, cropped to Home's framing, lines drawn. */
export function renderCard(model: CardModel, look: ExportLook): HTMLCanvasElement {
  const img = model.image!;
  const built = exportFrame(model);
  const t = built?.transform
    ?? new ViewTransform(model.transform.angle, 1, [img.width / 2, img.height / 2], [...model.transform.center]);
  const size: Vec = built?.size ?? [img.width, img.height];

  const [canvas, ctx] = newCanvas(size[0], size[1]);
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const src = rasterToCanvas(applyTint(img, look.tintMode, look.tintStrength));
  ctx.save();
  ctx.setTransform(...t.canvasMatrix());
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0);
  ctx.restore();

  const m = model.measure();
  if (look.showSamples && m?.valid) {
    ctx.strokeStyle = SAMPLE_C;
    ctx.fillStyle = SAMPLE_C;
    ctx.lineWidth = 1;
    for (const axis of [m.lr, m.tb]) {
      for (const pts of axis.samplePoints) {
        const va = t.imgToView(pts[0]);
        const vb = t.imgToView(pts[3]);
        ctx.beginPath(); ctx.moveTo(va[0], va[1]); ctx.lineTo(vb[0], vb[1]); ctx.stroke();
        for (const q of pts) {
          const v = t.imgToView(q);
          ctx.beginPath(); ctx.arc(v[0], v[1], 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
  }

  ctx.lineWidth = Math.max(2, Math.round(size[0] / 500));
  for (const key of [...OUTER, ...INNER]) {
    const l = model.lines![key];
    const seg = clipLineToRect(new Line(t.imgToView(l.p1), t.imgToView(l.p2)), 0, 0, size[0] - 1, size[1] - 1);
    if (!seg) continue;
    ctx.strokeStyle = colorFor(key, look.scheme);
    ctx.beginPath(); ctx.moveTo(seg[0][0], seg[0][1]); ctx.lineTo(seg[1][0], seg[1][1]); ctx.stroke();
  }
  return canvas;
}

const font = (px: number, weight = 400) => `${weight} ${Math.round(px)}px ${FONT}`;

function textRight(ctx: CanvasRenderingContext2D, s: string, right: number, y: number): void {
  ctx.fillText(s, right - ctx.measureText(s).width, y);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pct: number, colour: string): void {
  const split = Math.round((w * pct) / 100);
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, split, h);
  ctx.fillStyle = RULE;
  ctx.fillRect(x + split, y, w - split, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x + Math.round(w / 2), y, 1, h);
}

/** One face with the caption band underneath. */
export function renderOverlay(model: CardModel, side: Side, look: ExportLook): HTMLCanvasElement {
  const card = renderCard(model, look);
  const m = model.measure();
  const w = card.width;
  const unit = Math.max(11, Math.round(w / 46));
  const pad = unit;
  const bandH = Math.round(unit * 9.6);
  const [out, ctx] = newCanvas(w, card.height + bandH);
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(card, 0, 0);
  ctx.fillStyle = RULE;
  ctx.fillRect(0, card.height, w, 1);
  ctx.textBaseline = "top";

  let y = card.height + pad;
  ctx.fillStyle = MUTED;
  ctx.font = font(unit * 0.85);
  ctx.fillText(model.name ?? "card", pad, y);
  textRight(ctx, `${model.nSamples} samples/axis   ${side}`, w - pad, y);
  y += unit * 1.5;

  if (!m?.valid) {
    ctx.fillStyle = TEXT;
    ctx.font = font(unit * 2, 700);
    ctx.fillText("no valid measurement", pad, y);
    return out;
  }
  const cols = schemeColors(look.scheme);
  const col2 = Math.round(w / 2);
  const axes: Array<[number, string, typeof m.lr, string]> = [
    [pad, "LEFT / RIGHT", m.lr, cols.outer], [col2, "TOP / BOTTOM", m.tb, cols.inner],
  ];
  for (const [x, label, axis, colour] of axes) {
    ctx.fillStyle = MUTED;
    ctx.font = font(unit * 0.8);
    ctx.fillText(label, x, y);
    ctx.fillStyle = TEXT;
    ctx.font = font(unit * 2, 700);
    ctx.fillText(axis.text(), x, y + unit * 1.05);
    bar(ctx, x, Math.round(y + unit * 3.5), col2 - pad * 2, Math.round(unit * 0.5), axis.lowPct, colour);
  }
  y += unit * 4.5;

  if (m.crossed) {
    ctx.fillStyle = "#ff5252";
    ctx.font = font(unit * 1.15, 700);
    ctx.fillText("an outer line sits inside its inner line — not measurable", pad, y);
    return out;
  }
  let x = pad;
  for (const c of ceilings(m, side)) {
    ctx.fillStyle = MUTED;
    ctx.font = font(unit * 0.85);
    ctx.fillText(c.grader, x, y + unit * 0.25);
    ctx.fillStyle = TEXT;
    ctx.font = font(unit * 1.2, 700);
    ctx.fillText(c.grade, x + unit * 2.4, y);
    x += unit * 5.2;
  }
  ctx.fillStyle = MUTED;
  ctx.font = font(unit * 0.8);
  textRight(ctx, "centering ceiling only — corners, edges and surface not assessed", w - pad, y + unit * 0.3);
  const spread = Math.max(m.lr.spread, m.tb.spread);
  if (spread > 4) {
    ctx.fillStyle = cols.inner;
    ctx.fillText(`samples disagree by ${spread.toFixed(1)}% — frames are not parallel`, pad, y + unit * 1.8);
  }
  return out;
}

function sideSummary(ctx: CanvasRenderingContext2D, m: Measurement | null, side: Side, n: number,
  x: number, top: number, unit: number, look: ExportLook): void {
  const cols = schemeColors(look.scheme);
  ctx.fillStyle = TEXT;
  ctx.font = font(unit * 0.95, 700);
  ctx.fillText(side.toUpperCase(), x, top);
  if (!m?.valid) {
    ctx.fillStyle = MUTED;
    ctx.font = font(unit * 1.7, 700);
    ctx.fillText("--", x, top + unit * 1.5);
    return;
  }
  ctx.font = font(unit * 1.7, 700);
  ctx.fillStyle = cols.outer;
  ctx.fillText(`L/R  ${m.lr.text()}`, x, top + unit * 1.5);
  ctx.fillStyle = cols.inner;
  ctx.fillText(`T/B  ${m.tb.text()}`, x, top + unit * 3.4);
  const spread = Math.max(m.lr.spread, m.tb.spread);
  ctx.fillStyle = MUTED;
  ctx.font = font(unit * 0.85);
  ctx.fillText(`${n} samples/axis${spread > 4 ? `    samples disagree by ${spread.toFixed(0)}%` : ""}`, x, top + unit * 5.4);
}

/** One sheet for the whole session: both faces side by side, or one alone. */
export function renderSession(session: Session, look: ExportLook): HTMLCanvasElement | null {
  const loaded = session.loadedSides();
  if (!loaded.length) return null;
  if (loaded.length === 1) return renderOverlay(session.cards[loaded[0]], loaded[0], look);

  const cards = loaded.map((s) => renderCard(session.cards[s], look));
  const height = Math.min(...cards.map((c) => c.height)); // shrink, never upscale
  const widths = cards.map((c) => Math.round((c.width * height) / c.height));
  const gap = Math.max(10, Math.round(height * 0.015));
  const margin = gap;
  const w = widths[0] + widths[1] + gap + margin * 2;
  const unit = Math.max(11, Math.round(w / 78));
  const pad = unit;
  const rowH = height + margin;
  const bandH = pad + Math.round(unit * 10.6);

  const [out, ctx] = newCanvas(w, rowH + bandH);
  ctx.fillStyle = BAND;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.imageSmoothingQuality = "high";
  const xs = [margin, margin + widths[0] + gap];
  cards.forEach((c, i) => ctx.drawImage(c, xs[i], Math.round(margin / 2), widths[i], height));
  ctx.fillStyle = RULE;
  ctx.fillRect(0, rowH, w, 1);
  ctx.textBaseline = "top";

  const top = rowH + pad;
  loaded.forEach((s, i) => sideSummary(ctx, session.measurement(s), s, session.cards[s].nSamples, xs[i], top, unit, look));

  const yRule = top + Math.round(unit * 7.1);
  const yFinal = top + Math.round(unit * 7.9);
  ctx.fillStyle = RULE;
  ctx.fillRect(margin, yRule, w - margin * 2, 1);
  ctx.fillStyle = MUTED;
  ctx.font = font(unit * 0.85);
  ctx.fillText("FINAL CEILING", margin, yFinal + unit * 0.55);
  let x = margin + unit * 8.5;
  for (const c of session.finalCeilings()) {
    ctx.fillStyle = MUTED;
    ctx.font = font(unit * 0.85);
    ctx.fillText(c.grader, x, yFinal + unit * 0.55);
    ctx.fillStyle = TEXT;
    ctx.font = font(unit * 2.1, 700);
    ctx.fillText(c.grade, x + unit * 2.4, yFinal);
    x += unit * 6.6;
  }
  const notes = ["centering only — corners, edges and surface not assessed"];
  const limiting = session.limitingSide();
  if (limiting) notes.unshift(`held down by the ${limiting}`);
  ctx.fillStyle = MUTED;
  ctx.font = font(unit * 0.85);
  notes.forEach((s, i) => textRight(ctx, s, w - margin, yFinal + i * unit * 1.2));
  return out;
}
