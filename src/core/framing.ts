/**
 * Framing the card: what Home shows on screen, and what an export crops to.
 * Both use the same fill so the exported picture looks like the Home view.
 */

import type { Vec } from "./geometry";
import type { CardModel } from "./model";
import { ViewTransform } from "./transform";

/** Fraction of the view the card's outer frame fills. */
export const HOME_FILL = 0.88;

/**
 * Centre the outer frame in the view and size it to fill it, keeping the
 * current rotation. Returns false when there is no usable frame.
 */
export function homeView(model: CardModel, canvasSize: Vec, fill = HOME_FILL): boolean {
  const corners = model.outerCorners();
  const centre = model.outerCenter();
  if (!corners || !centre) return false;
  const t = model.transform;
  const [cw, ch] = canvasSize;
  const view = corners.map((p) => t.imgToView(p));
  const xs = view.map((p) => p[0]);
  const ys = view.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs);
  const bh = Math.max(...ys) - Math.min(...ys);
  if (bw > 1 && bh > 1) {
    const factor = Math.min((cw * fill) / bw, (ch * fill) / bh);
    t.scale = Math.max(0.02, Math.min(40, t.scale * factor));
  }
  const c = t.imgToView(centre);
  t.pan = [t.pan[0] + (cw / 2 - c[0]), t.pan[1] + (ch / 2 - c[1])];
  return true;
}

/**
 * Transform and pixel size for an export: card upright at native resolution,
 * with Home's margin around the outer frame. Null if the frame is degenerate.
 */
export function exportFrame(model: CardModel, fill = HOME_FILL): { transform: ViewTransform; size: Vec } | null {
  const corners = model.outerCorners();
  if (!corners) return null;
  const t = new ViewTransform(model.transform.angle, 1, [0, 0], [...model.transform.center]);
  const view = corners.map((p) => t.imgToView(p));
  const xs = view.map((p) => p[0]);
  const ys = view.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const cw = Math.max(...xs) - x0;
  const ch = Math.max(...ys) - y0;
  if (cw < 2 || ch < 2) return null;
  const mx = (cw * (1 / fill - 1)) / 2;
  const my = (ch * (1 / fill - 1)) / 2;
  t.pan = [mx - x0, my - y0];
  return { transform: t, size: [Math.round(cw + 2 * mx), Math.round(ch + 2 * my)] };
}
