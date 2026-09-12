/**
 * Mapping between image space and view (canvas) space.
 *
 *     view = pan + scale * R(angle) * (p_img - center)
 *
 * R is expressed in screen coordinates (y down), so a positive angle rotates
 * the card clockwise on screen.
 */

import { type Vec, pymod } from "./geometry";

export class ViewTransform {
  constructor(
    public angle = 0, // degrees, positive = clockwise on screen
    public scale = 1,
    public pan: Vec = [0, 0], // view px
    public center: Vec = [0, 0], // image px
  ) {}

  copy(): ViewTransform {
    return new ViewTransform(this.angle, this.scale, [...this.pan], [...this.center]);
  }

  private cs(): [number, number] {
    const r = (this.angle * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r)];
  }

  imgToView(p: Vec): Vec {
    const [c, s] = this.cs();
    const dx = p[0] - this.center[0];
    const dy = p[1] - this.center[1];
    return [
      this.pan[0] + this.scale * (c * dx - s * dy),
      this.pan[1] + this.scale * (s * dx + c * dy),
    ];
  }

  viewToImg(p: Vec): Vec {
    const [c, s] = this.cs();
    const dx = p[0] - this.pan[0];
    const dy = p[1] - this.pan[1];
    return [
      this.center[0] + (c * dx + s * dy) / this.scale,
      this.center[1] + (-s * dx + c * dy) / this.scale,
    ];
  }

  /** Rotate and scale a *delta* (no translation) from view into image space. */
  viewDeltaToImg(d: Vec): Vec {
    const [c, s] = this.cs();
    return [(c * d[0] + s * d[1]) / this.scale, (-s * d[0] + c * d[1]) / this.scale];
  }

  /**
   * The same mapping as a canvas matrix (image -> view), for
   * `ctx.setTransform(a, b, c, d, e, f)`.
   */
  canvasMatrix(): [number, number, number, number, number, number] {
    const [c, s] = this.cs();
    const k = this.scale;
    const a = k * c;
    const b = k * s;
    const cc = -k * s;
    const d = k * c;
    const e = this.pan[0] - (a * this.center[0] + cc * this.center[1]);
    const f = this.pan[1] - (b * this.center[0] + d * this.center[1]);
    return [a, b, cc, d, e, f];
  }

  fit(imgSize: Vec, canvasSize: Vec, margin = 0.9): void {
    const [iw, ih] = imgSize;
    const [cw, ch] = canvasSize;
    this.center = [iw / 2, ih / 2];
    if (iw <= 0 || ih <= 0 || cw <= 0 || ch <= 0) return;
    this.scale = Math.min(cw / iw, ch / ih) * margin;
    this.pan = [cw / 2, ch / 2];
  }

  /** Zoom keeping the image point under `viewPoint` stationary. */
  zoomAbout(viewPoint: Vec, factor: number, lo = 0.02, hi = 40): void {
    const anchor = this.viewToImg(viewPoint);
    this.scale = Math.max(lo, Math.min(hi, this.scale * factor));
    const nv = this.imgToView(anchor);
    this.pan = [this.pan[0] + (viewPoint[0] - nv[0]), this.pan[1] + (viewPoint[1] - nv[1])];
  }

  rotateAbout(viewPoint: Vec, deltaDeg: number): void {
    const anchor = this.viewToImg(viewPoint);
    this.angle = pymod(this.angle + deltaDeg + 180, 360) - 180;
    const nv = this.imgToView(anchor);
    this.pan = [this.pan[0] + (viewPoint[0] - nv[0]), this.pan[1] + (viewPoint[1] - nv[1])];
  }
}
