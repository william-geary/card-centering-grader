/**
 * Pixel operations on plain RGBA buffers.
 *
 * `Raster` has the same shape as the browser's ImageData, so an ImageData can
 * be passed straight in. Nothing here touches the DOM, which is what lets the
 * test suite run these functions under Node.
 */

import { type Vec } from "./geometry";
import { ViewTransform } from "./transform";

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major
}

export function makeRaster(width: number, height: number, fill?: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

/**
 * Luma, bit-for-bit what Pillow's RGB -> "L" conversion produces
 * (ITU-R 601-2 weights in 16.16 fixed point).
 */
export function toGray(r: Raster): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  const d = r.data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (d[p] * 19595 + d[p + 1] * 38470 + d[p + 2] * 7471 + 0x8000) >> 16;
  }
  return out;
}

// ---------------------------------------------------------------- resizing
// A transcription of Pillow's 8-bit bilinear resample (libImaging/Resample.c):
// a triangle filter whose support widens with the reduction, applied in two
// separable passes in 22-bit fixed point. It matches Pillow bit for bit, which
// keeps auto-detection identical to the Python app, and unlike naive box
// averaging it anti-aliases properly at fractional scales.
const PRECISION_BITS = 22;

function precomputeCoeffs(inSize: number, outSize: number): { bounds: Int32Array; kk: Int32Array; ksize: number } {
  const scale = inSize / outSize;
  const filterscale = Math.max(scale, 1);
  const support = filterscale; // bilinear support is 1.0
  const ksize = Math.ceil(support) * 2 + 1;
  const bounds = new Int32Array(outSize * 2);
  const kk = new Int32Array(outSize * ksize);
  const tmp = new Float64Array(ksize);
  const ss = 1 / filterscale;
  for (let xx = 0; xx < outSize; xx++) {
    const center = (xx + 0.5) * scale;
    let xmin = Math.trunc(center - support + 0.5);
    if (xmin < 0) xmin = 0;
    let xmax = Math.trunc(center + support + 0.5);
    if (xmax > inSize) xmax = inSize;
    xmax -= xmin;
    let ww = 0;
    for (let x = 0; x < xmax; x++) {
      let t = (x + xmin - center + 0.5) * ss;
      if (t < 0) t = -t;
      const w = t < 1 ? 1 - t : 0;
      tmp[x] = w;
      ww += w;
    }
    for (let x = 0; x < ksize; x++) {
      const w = x < xmax ? (ww !== 0 ? tmp[x] / ww : tmp[x]) : 0;
      kk[xx * ksize + x] = Math.trunc(w < 0 ? -0.5 + w * (1 << PRECISION_BITS) : 0.5 + w * (1 << PRECISION_BITS));
    }
    bounds[xx * 2] = xmin;
    bounds[xx * 2 + 1] = xmax;
  }
  return { bounds, kk, ksize };
}

const clip8 = (v: number) => (v >= 2 ** (PRECISION_BITS + 8) ? 255 : v <= 0 ? 0 : Math.floor(v / 2 ** PRECISION_BITS));

/** Pillow-exact bilinear resize of an 8-bit single-channel image. */
export function resample8(src: Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const hz = precomputeCoeffs(w, nw);
  const vt = precomputeCoeffs(h, nh);
  const half = 2 ** (PRECISION_BITS - 1);
  let cur = src;
  let cw = w;
  let ch = h;
  const vb = Int32Array.from(vt.bounds);
  if (nw !== w) {
    const yFirst = vb[0];
    const yLast = vb[nh * 2 - 2] + vb[nh * 2 - 1];
    for (let i = 0; i < nh; i++) vb[i * 2] -= yFirst;
    ch = yLast - yFirst;
    const tmp = new Uint8Array(nw * ch);
    for (let yy = 0; yy < ch; yy++) {
      const row = (yy + yFirst) * w;
      for (let xx = 0; xx < nw; xx++) {
        const xmin = hz.bounds[xx * 2];
        const xmax = hz.bounds[xx * 2 + 1];
        const k = xx * hz.ksize;
        let s = half;
        for (let x = 0; x < xmax; x++) s += cur[row + x + xmin] * hz.kk[k + x];
        tmp[yy * nw + xx] = clip8(s);
      }
    }
    cur = tmp;
    cw = nw;
  }
  if (nh === ch && nh === h && nw === cw) return cur;
  const out = new Uint8Array(cw * nh);
  for (let yy = 0; yy < nh; yy++) {
    const ymin = vb[yy * 2];
    const ymax = vb[yy * 2 + 1];
    const k = yy * vt.ksize;
    for (let xx = 0; xx < cw; xx++) {
      let s = half;
      for (let y = 0; y < ymax; y++) s += cur[(y + ymin) * cw + xx] * vt.kk[k + y];
      out[yy * cw + xx] = clip8(s);
    }
  }
  return out;
}

/** Resize an RGBA raster, each channel through the Pillow-exact filter. */
export function resizeRaster(src: Raster, nw: number, nh: number): Raster {
  const n = src.width * src.height;
  const out = makeRaster(nw, nh);
  const chan = new Uint8Array(n);
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) chan[i] = src.data[i * 4 + c];
    const r = resample8(chan, src.width, src.height, nw, nh);
    for (let i = 0; i < nw * nh; i++) out.data[i * 4 + c] = r[i];
  }
  return out;
}

/** Bilinear sample of one pixel; transparent black outside the raster. */
function sample(src: Raster, fx: number, fy: number, out: Uint8ClampedArray, q: number): void {
  const x = fx - 0.5;
  const y = fy - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const { width: w, height: h, data: d } = src;
  if (x0 < -1 || y0 < -1 || x0 >= w || y0 >= h) {
    out[q] = 0; out[q + 1] = 0; out[q + 2] = 0; out[q + 3] = 0;
    return;
  }
  const cx0 = Math.max(0, Math.min(w - 1, x0));
  const cx1 = Math.max(0, Math.min(w - 1, x0 + 1));
  const cy0 = Math.max(0, Math.min(h - 1, y0));
  const cy1 = Math.max(0, Math.min(h - 1, y0 + 1));
  const p00 = (cy0 * w + cx0) * 4;
  const p10 = (cy0 * w + cx1) * 4;
  const p01 = (cy1 * w + cx0) * 4;
  const p11 = (cy1 * w + cx1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = d[p00 + c] + (d[p10 + c] - d[p00 + c]) * tx;
    const bot = d[p01 + c] + (d[p11 + c] - d[p01 + c]) * tx;
    out[q + c] = top + (bot - top) * ty;
  }
}

/**
 * Rotate clockwise-on-screen by `angle` degrees, growing the canvas so nothing
 * is cropped. Returns the rotated raster and a transform whose `viewToImg`
 * maps a point in the rotated raster back to the original.
 */
export function rotateExpand(src: Raster, angle: number): { raster: Raster; mapper: ViewTransform } {
  const t = new ViewTransform(angle, 1, [0, 0], [src.width / 2, src.height / 2]);
  const corners: Vec[] = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]
    .map((p) => t.imgToView(p as Vec));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const nw = Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs));
  const nh = Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys));
  t.pan = [nw / 2, nh / 2];
  const out = makeRaster(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const p = t.viewToImg([x + 0.5, y + 0.5]);
      sample(src, p[0], p[1], out.data, (y * nw + x) * 4);
    }
  }
  return { raster: out, mapper: t };
}

/**
 * Resample `src` through a projective mapping. `dstToSrc` is the 3x3
 * homography (row-major) taking output pixel centres to source coordinates.
 */
export function warpPerspective(src: Raster, dstToSrc: number[], nw: number, nh: number): Raster {
  const out = makeRaster(nw, nh);
  const [a, b, c, d, e, f, g, h, i] = dstToSrc;
  for (let y = 0; y < nh; y++) {
    const cy = y + 0.5;
    for (let x = 0; x < nw; x++) {
      const cx = x + 0.5;
      const wden = g * cx + h * cy + i;
      sample(src, (a * cx + b * cy + c) / wden, (d * cx + e * cy + f) / wden,
        out.data, (y * nw + x) * 4);
    }
  }
  return out;
}

// ------------------------------------------------------------------ tinting
export const TINT_MODES = [
  "None", "Grayscale", "Desaturate", "Darken", "Brighten", "Contrast +", "Cool", "Warm",
] as const;
export type TintMode = (typeof TINT_MODES)[number];

const COOL: [number, number, number] = [56, 116, 214];
const WARM: [number, number, number] = [224, 146, 60];

/**
 * Cosmetic treatments that push the card art away from the overlay lines.
 * `strength` is 0-100. Returns the input unchanged for "None" or 0.
 */
export function applyTint(src: Raster, mode: TintMode, strength: number): Raster {
  const k = Math.max(0, Math.min(1, strength / 100));
  if (mode === "None" || k <= 0) return src;
  const out = makeRaster(src.width, src.height);
  const s = src.data;
  const o = out.data;
  const luma = (p: number) => (s[p] * 19595 + s[p + 1] * 38470 + s[p + 2] * 7471 + 0x8000) >> 16;

  let meanL = 0;
  if (mode === "Contrast +") {
    for (let p = 0; p < s.length; p += 4) meanL += luma(p);
    meanL /= s.length / 4;
  }
  const f = mode === "Desaturate" ? 1 - 0.9 * k
    : mode === "Darken" ? 1 - 0.65 * k
    : mode === "Brighten" ? 1 + 0.9 * k
    : mode === "Contrast +" ? 1 + 1.6 * k
    : 0;
  const wash = mode === "Cool" ? COOL : WARM;

  for (let p = 0; p < s.length; p += 4) {
    o[p + 3] = s[p + 3];
    const L = luma(p);
    for (let c = 0; c < 3; c++) {
      const v = s[p + c];
      switch (mode) {
        case "Grayscale": o[p + c] = v + (L - v) * k; break;
        case "Desaturate": o[p + c] = L + (v - L) * f; break;
        case "Darken":
        case "Brighten": o[p + c] = v * f; break;
        case "Contrast +": o[p + c] = meanL + (v - meanL) * f; break;
        default: o[p + c] = v + (wash[c] - v) * 0.45 * k;
      }
    }
  }
  return out;
}
