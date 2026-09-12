/**
 * A rough first guess at where the two frames sit.
 *
 * Only there to save some dragging -- every line it produces is meant to be
 * corrected by hand. Sum the gradient magnitude along rows and columns and pick
 * the strongest peak inside a plausible search band.
 */

import { type Raster, resample8, toGray } from "./raster";

const MAX_WORK = 900; // longest side used for detection, keeps it fast

export type Rect = [x0: number, y0: number, x1: number, y1: number];
export interface Frames { outer: Rect; inner: Rect }

/** Python's round(): halves go to the nearest even integer. */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const f32 = Math.fround;

/**
 * NumPy's float32 sum along a contiguous row: pairwise summation, unrolled in
 * blocks of eight below 128 elements. Reproduced step for step, since the
 * order additions happen in decides the last bits, and those can decide which
 * of two near-equal peaks wins.
 */
function pairwiseSum(a: Float32Array, lo: number, n: number): number {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res = f32(res + a[lo + i]);
    return res;
  }
  if (n <= 128) {
    const r = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => a[lo + j]);
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let j = 0; j < 8; j++) r[j] = f32(r[j] + a[lo + i + j]);
    }
    let res = f32(f32(f32(r[0] + r[1]) + f32(r[2] + r[3])) + f32(f32(r[4] + r[5]) + f32(r[6] + r[7])));
    for (; i < n; i++) res = f32(res + a[lo + i]);
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return f32(pairwiseSum(a, lo, n2) + pairwiseSum(a, lo + n2, n - n2));
}

/**
 * Mean absolute gradient collapsed onto one axis, then lightly smoothed.
 * axis 0 -> profile along x (finds vertical lines); 1 -> along y.
 *
 * Matches `np.abs(np.diff(gray32, axis)).mean(other_axis)` followed by
 * `np.convolve(prof, ones(3)/3, "same")` exactly: the column means accumulate
 * sequentially in float32, the row means pairwise, and the convolution is a
 * sequential sum of products in float64.
 */
function energy(gray: Uint8Array, w: number, h: number, axis: 0 | 1): Float64Array {
  let prof: Float64Array;
  if (axis === 0) {
    const acc = new Float32Array(w - 1);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w - 1; x++) acc[x] = f32(acc[x] + Math.abs(gray[row + x + 1] - gray[row + x]));
    }
    prof = Float64Array.from(acc, (v) => f32(v / h));
  } else {
    prof = new Float64Array(h - 1);
    const diff = new Float32Array(w);
    for (let y = 0; y < h - 1; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) diff[x] = Math.abs(gray[row + w + x] - gray[row + x]);
      prof[y] = f32(pairwiseSum(diff, 0, w) / w);
    }
  }
  if (prof.length >= 5) {
    const k = 1 / 3;
    const sm = new Float64Array(prof.length);
    for (let i = 0; i < prof.length; i++) {
      let s = 0;
      if (i > 0) s += prof[i - 1] * k;
      s += prof[i] * k;
      if (i < prof.length - 1) s += prof[i + 1] * k;
      sm[i] = s;
    }
    prof = sm;
  }
  return prof;
}

function peak(prof: Float64Array, lo: number, hi: number): number | null {
  const loI = Math.max(0, roundHalfEven(lo));
  const hiI = Math.min(prof.length, roundHalfEven(hi));
  if (hiI - loI < 2) return null;
  let i = 0;
  let best = -Infinity;
  for (let k = loI; k < hiI; k++) {
    if (prof[k] > best) { best = prof[k]; i = k - loI; }
  }
  if (best <= 1e-6) return null;
  const n = hiI - loI;
  let fi = i;
  if (i > 0 && i < n - 1) {
    const a = prof[loI + i - 1];
    const b = prof[loI + i];
    const c = prof[loI + i + 1];
    const denom = a - 2 * b + c;
    if (Math.abs(denom) > 1e-9) fi = i + (0.5 * (a - c)) / denom;
  }
  return loI + fi + 0.5; // +0.5: a difference sits between two pixels
}

/** Outer and inner rectangles, in the input raster's pixel coordinates. */
export function detectFrames(image: Raster): Frames {
  const { width: w, height: h } = image;
  const s = Math.min(1, MAX_WORK / Math.max(w, h));
  const sw = Math.max(8, Math.trunc(w * s));
  const sh = Math.max(8, Math.trunc(h * s));
  let gray = toGray(image);
  if (sw !== w || sh !== h) gray = resample8(gray, w, h, sw, sh);

  const px = energy(gray, sw, sh, 0);
  const py = energy(gray, sw, sh, 1);

  let ox0 = peak(px, 0, sw * 0.25);
  let ox1 = peak(px, sw * 0.75, sw);
  let oy0 = peak(py, 0, sh * 0.25);
  let oy1 = peak(py, sh * 0.75, sh);
  if (ox0 === null || ox1 === null || oy0 === null || oy1 === null
      || ox1 - ox0 < sw * 0.4 || oy1 - oy0 < sh * 0.4) {
    ox0 = 0; oy0 = 0; ox1 = sw; oy1 = sh;
  }
  const bw = ox1 - ox0;
  const bh = oy1 - oy0;

  let ix0 = peak(px, ox0 + 0.03 * bw, ox0 + 0.22 * bw);
  let ix1 = peak(px, ox1 - 0.22 * bw, ox1 - 0.03 * bw);
  let iy0 = peak(py, oy0 + 0.03 * bh, oy0 + 0.22 * bh);
  let iy1 = peak(py, oy1 - 0.22 * bh, oy1 - 0.03 * bh);
  if (ix0 === null || ix1 === null || ix1 <= ix0) { ix0 = ox0 + 0.1 * bw; ix1 = ox1 - 0.1 * bw; }
  if (iy0 === null || iy1 === null || iy1 <= iy0) { iy0 = oy0 + 0.09 * bh; iy1 = oy1 - 0.09 * bh; }

  const k = 1 / s;
  return {
    outer: [ox0 * k, oy0 * k, ox1 * k, oy1 * k],
    inner: [ix0 * k, iy0 * k, ix1 * k, iy1 * k],
  };
}
