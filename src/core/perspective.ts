/**
 * Perspective correction for photographed cards.
 *
 * A scanner gives a flat image, but a phone held slightly off-parallel gives a
 * keystoned card, and perspective does not preserve distance ratios -- the
 * centering numbers would drift by a few points with no warning. Flattening
 * maps the four card corners the user places onto a rectangle before any
 * lines are drawn.
 *
 * Lines survive a homography as lines, so re-flattening after lines are placed
 * just carries each line's two control points through the change.
 */

import { type Vec, norm, sub } from "./geometry";
import { type Raster, warpPerspective } from "./raster";

export type Quad = [tl: Vec, tr: Vec, br: Vec, bl: Vec];
export type Mat3 = number[]; // row-major 3x3

/** Output is capped so a 48 MP photo does not produce a 48 MP working image. */
export const MAX_FLAT_SIDE = 3200;
/** Space kept around the card, as a fraction of its size, for the outer lines. */
export const FLAT_MARGIN = 0.06;

/** Solve A x = b for an n x n system by Gaussian elimination with pivoting. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Homography taking each point of `from` to the matching point of `to`. */
export function homography(from: Quad, to: Quad): Mat3 | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}

export function applyH(H: Mat3, p: Vec): Vec {
  const w = H[6] * p[0] + H[7] * p[1] + H[8];
  return [(H[0] * p[0] + H[1] * p[1] + H[2]) / w, (H[3] * p[0] + H[4] * p[1] + H[5]) / w];
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

export function multiply3(x: Mat3, y: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c] += x[r * 3 + k] * y[k * 3 + c];
  return out;
}

/** True when the quad is convex and wound consistently -- a usable card outline. */
export function isConvexQuad(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export interface Flattened {
  raster: Raster;
  /** Source pixel -> flattened pixel. */
  srcToFlat: Mat3;
}

/**
 * Warp the photographed card to a rectangle. The rectangle keeps the card's
 * measured proportions (the mean of opposite edge lengths), so no card size is
 * assumed; the centering ratios do not depend on it anyway, because each axis
 * is measured along its own direction.
 */
export function flatten(src: Raster, corners: Quad): Flattened | null {
  if (!isConvexQuad(corners)) return null;
  const [tl, tr, br, bl] = corners;
  let cw = (norm(sub(tr, tl)) + norm(sub(br, bl))) / 2;
  let ch = (norm(sub(bl, tl)) + norm(sub(br, tr))) / 2;
  const totalW = cw * (1 + 2 * FLAT_MARGIN);
  const totalH = ch * (1 + 2 * FLAT_MARGIN);
  const k = Math.min(1, MAX_FLAT_SIDE / Math.max(totalW, totalH));
  cw *= k;
  ch *= k;
  const mx = cw * FLAT_MARGIN;
  const my = ch * FLAT_MARGIN;
  const nw = Math.max(8, Math.round(cw + 2 * mx));
  const nh = Math.max(8, Math.round(ch + 2 * my));
  const target: Quad = [[mx, my], [mx + cw, my], [mx + cw, my + ch], [mx, my + ch]];
  const srcToFlat = homography(corners, target);
  if (!srcToFlat) return null;
  const flatToSrc = invert3(srcToFlat);
  if (!flatToSrc) return null;
  return { raster: warpPerspective(src, flatToSrc, nw, nh), srcToFlat };
}
