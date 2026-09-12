/**
 * Geometry primitives.
 *
 * Everything here works in *image space* (card pixels). Lines are stored as two
 * control points but are treated as infinite -- the control points are only
 * handles, they never bound the line.
 */

export type Vec = [number, number];

export const EPS = 1e-9;

export const vec = (x: number, y: number): Vec => [x, y];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1];
export const norm = (a: Vec): number => Math.hypot(a[0], a[1]);

export function unit(v: Vec): Vec {
  const n = norm(v);
  return n < EPS ? [1, 0] : [v[0] / n, v[1] / n];
}

export const lerp = (a: Vec, b: Vec, t: number): Vec =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export class Line {
  constructor(public p1: Vec, public p2: Vec) {}

  static fromPoints(x1: number, y1: number, x2: number, y2: number): Line {
    return new Line([x1, y1], [x2, y2]);
  }

  copy(): Line {
    return new Line([this.p1[0], this.p1[1]], [this.p2[0], this.p2[1]]);
  }

  direction(): Vec {
    return unit(sub(this.p2, this.p1));
  }

  normal(): Vec {
    const d = this.direction();
    return [-d[1], d[0]];
  }

  midpoint(): Vec {
    return lerp(this.p1, this.p2, 0.5);
  }

  angleDeg(): number {
    const d = sub(this.p2, this.p1);
    return (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  }

  translate(delta: Vec): void {
    this.p1 = add(this.p1, delta);
    this.p2 = add(this.p2, delta);
  }

  /** Slide the line along its own normal only; the angle is preserved. */
  translatePerpendicular(delta: Vec): void {
    const n = this.normal();
    this.translate(scale(n, dot(delta, n)));
  }

  setControl(index: 0 | 1, p: Vec): void {
    if (index === 0) this.p1 = [p[0], p[1]];
    else this.p2 = [p[0], p[1]];
    // Never let the two handles collapse onto each other.
    if (norm(sub(this.p2, this.p1)) < 1) {
      const d = this.direction();
      if (index === 0) this.p2 = add(this.p1, d);
      else this.p1 = sub(this.p2, d);
    }
  }
}

/** Intersection of two infinite lines, or null when (near) parallel. */
export function intersect(a: Line, b: Line): Vec | null {
  const r = sub(a.p2, a.p1);
  const s = sub(b.p2, b.p1);
  const denom = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denom) < 1e-7) return null;
  const q = sub(b.p1, a.p1);
  const t = (q[0] * s[1] - q[1] * s[0]) / denom;
  return add(a.p1, scale(r, t));
}

/** Clip an infinite line to an axis-aligned rectangle (Liang-Barsky). */
export function clipLineToRect(
  line: Line, x0: number, y0: number, x1: number, y1: number,
): [Vec, Vec] | null {
  const p = line.p1;
  const d = sub(line.p2, line.p1);
  if (norm(d) < EPS) return null;
  let tMin = -1e18;
  let tMax = 1e18;
  const edges: Array<[number, number]> = [
    [x0 - p[0], d[0]],
    [p[0] - x1, -d[0]],
    [y0 - p[1], d[1]],
    [p[1] - y1, -d[1]],
  ];
  for (const [num, den] of edges) {
    if (Math.abs(den) < EPS) {
      if (num > 0) return null;
      continue;
    }
    const t = num / den;
    if (den > 0) tMin = Math.max(tMin, t);
    else tMax = Math.min(tMax, t);
  }
  if (tMin > tMax) return null;
  return [add(p, scale(d, tMin)), add(p, scale(d, tMax))];
}

/** Python-style modulo: the result takes the sign of the divisor. */
export const pymod = (a: number, n: number): number => ((a % n) + n) % n;
