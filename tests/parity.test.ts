/**
 * Parity with the original Python implementation.
 *
 * tests/fixtures/*.json were produced by running the Python core (the last
 * version is commit a3695d8) over fixed inputs. Every number the TypeScript
 * port produces must match. If one of these fails, the web app would grade a
 * card differently from the desktop app it replaced.
 */

import { describe, expect, it } from "vitest";
import { detectFrames } from "../src/core/autodetect";
import { Line, clipLineToRect, intersect, type Vec } from "../src/core/geometry";
import { GRADERS, TABLES, ceiling, type Grader, type Side } from "../src/core/grades";
import { SIDES, measure } from "../src/core/measure";
import { CardModel } from "../src/core/model";
import { makeRaster } from "../src/core/raster";
import { ViewTransform } from "../src/core/transform";
import { SAMPLE_OFFSET, fixture, linesFrom, loadPng, near, nearVec } from "./helpers";

describe("geometry", () => {
  const geo = fixture("geometry.json");

  it("intersects lines exactly as Python did", () => {
    for (const c of geo.intersect) {
      const a = new Line(c.a[0], c.a[1]);
      const b = new Line(c.b[0], c.b[1]);
      nearVec(intersect(a, b), c.out, 1e-9);
    }
  });

  it("clips infinite lines to a rectangle exactly as Python did", () => {
    for (const c of geo.clip) {
      const r = clipLineToRect(new Line(c.line[0], c.line[1]), ...(c.rect as [number, number, number, number]));
      if (c.out === null) expect(r).toBeNull();
      else {
        nearVec(r![0], c.out[0]);
        nearVec(r![1], c.out[1]);
      }
    }
  });
});

describe("transform", () => {
  const cases = fixture("transform.json");

  it("maps points both ways", () => {
    for (const c of cases) {
      const t = new ViewTransform(c.angle, c.scale, c.pan, c.center);
      nearVec(t.imgToView(c.p), c.img_to_view);
      nearVec(t.viewToImg(c.p), c.view_to_img);
      nearVec(t.viewDeltaToImg(c.p), c.view_delta_to_img);
    }
  });

  it("zooms, rotates and fits", () => {
    for (const c of cases) {
      const z = new ViewTransform(c.angle, c.scale, c.pan, c.center);
      z.zoomAbout(c.anchor, c.zoom.factor);
      near(z.scale, c.zoom.scale);
      nearVec(z.pan, c.zoom.pan, 1e-8);

      const r = new ViewTransform(c.angle, c.scale, c.pan, c.center);
      r.rotateAbout(c.anchor, c.rotate.delta);
      near(r.angle, c.rotate.angle, 1e-9);
      nearVec(r.pan, c.rotate.pan, 1e-8);

      const f = new ViewTransform();
      f.fit(c.fit.img, c.fit.canvas);
      near(f.scale, c.fit.scale);
      nearVec(f.pan, c.fit.pan);
      nearVec(f.center, c.fit.center);
    }
  });

  it("gives the canvas the same matrix as imgToView", () => {
    for (const c of cases) {
      const t = new ViewTransform(c.angle, c.scale, c.pan, c.center);
      const [a, b, cc, d, e, f] = t.canvasMatrix();
      const p = c.p as Vec;
      nearVec([a * p[0] + cc * p[1] + e, b * p[0] + d * p[1] + f], c.img_to_view, 1e-9);
    }
  });
});

describe("measurement", () => {
  const cases = fixture("measure.json");

  it(`reproduces all ${cases.length} reference measurements`, () => {
    for (const c of cases) {
      const m = measure(linesFrom(c.lines), c.n);
      const o = c.out;
      expect(m.valid, c.name).toBe(o.valid);
      expect(m.crossed, c.name).toBe(o.crossed);
      near(m.worstPct(), o.worst_pct);
      for (const axis of ["lr", "tb"] as const) {
        const a = m[axis];
        const e = o[axis];
        expect(a.valid).toBe(e.valid);
        expect(a.lowMargins.length).toBe(e.low_margins.length);
        near(a.low, e.low); near(a.high, e.high);
        near(a.lowPct, e.low_pct); near(a.highPct, e.high_pct);
        near(a.spread, e.spread, 1e-9);
        expect(a.crossed).toBe(e.crossed);
        a.lowMargins.forEach((v, i) => near(v, e.low_margins[i]));
        a.highMargins.forEach((v, i) => near(v, e.high_margins[i]));
        a.samplePcts().forEach((v, i) => near(v, e.sample_pcts[i]));
        a.samplePoints.forEach((pts, i) => pts.forEach((p, j) => nearVec(p, e.sample_points[i][j])));
      }
    }
  });
});

describe("grades", () => {
  const g = fixture("grades.json");

  it("has identical tolerance tables", () => {
    for (const grader of GRADERS) {
      for (const side of ["front", "back"] as const) {
        expect(TABLES[grader][side].map((r) => [...r])).toEqual(g.tables[grader][side]);
      }
    }
  });

  it(`gives the same ceiling at all ${g.ceilings.length} sampled percentages`, () => {
    for (const [grader, side, worst, grade, descriptor, rank] of g.ceilings) {
      const c = ceiling(grader as Grader, worst, side as Side);
      expect([c.grade, c.descriptor, c.rank]).toEqual([grade, descriptor, rank]);
    }
  });
});

describe("model operations", () => {
  const cases = fixture("model.json");

  const modelWith = (lines: any) => {
    const m = new CardModel();
    m.load(makeRaster(800, 1100), null, [1000, 800], false);
    m.lines = linesFrom(lines);
    return m;
  };

  it("finds the same segments, corners and centre", () => {
    for (const c of cases) {
      const m = modelWith(c.lines);
      for (const k of SIDES) {
        const [a, b] = m.segment(k);
        nearVec(a, c.segments[k][0]);
        nearVec(b, c.segments[k][1]);
      }
      m.outerCorners()!.forEach((p, i) => nearVec(p, c.outer_corners[i]));
      nearVec(m.outerCenter(), c.outer_center);
    }
  });

  it("places precision handles identically", () => {
    for (const c of cases) {
      const m = modelWith(c.lines);
      m.placeHandles();
      for (const k of SIDES) {
        nearVec(m.lines![k].p1, c.placed[k][0]);
        nearVec(m.lines![k].p2, c.placed[k][1]);
      }
    }
  });

  it("straightens to the screen identically", () => {
    for (const c of cases) {
      const m = modelWith(c.lines);
      m.transform.angle = c.straighten_angle;
      m.transform.scale = c.straighten_scale;
      m.straighten();
      for (const k of SIDES) {
        nearVec(m.lines![k].p1, c.straightened[k][0], 1e-8);
        nearVec(m.lines![k].p2, c.straightened[k][1], 1e-8);
      }
    }
  });
});

describe("auto-detect", () => {
  // The sample is 1104 px tall, so this goes through the downsample to 900 px.
  // Matching exactly depends on the port reproducing Pillow's fixed-point
  // bilinear resample and NumPy's float32 summation order: the smoothed peaks
  // here are three-way near-ties, and the last bits decide which sample wins.
  it("finds exactly the frames Python found on the sample card", () => {
    const [ref] = fixture("autodetect.json");
    const box = detectFrames(loadPng(SAMPLE_OFFSET));
    box.outer.forEach((v, i) => near(v, ref.box.outer[i], 1e-12));
    box.inner.forEach((v, i) => near(v, ref.box.inner[i], 1e-12));
  });

  it("places the same starting lines when a card is opened", () => {
    // Opening a card is what users actually do, and it must land on the same
    // lines as the Python app, not just the same detector output.
    const [ref] = fixture("autodetect.json");
    const m = new CardModel();
    m.load(loadPng(SAMPLE_OFFSET), "sample", [1000, 800], true);
    const [ox0, oy0, ox1, oy1] = ref.box.outer;
    const [ix0, iy0, ix1, iy1] = ref.box.inner;
    near(m.lines!.outer_left.p1[0], ox0, 1e-12);
    near(m.lines!.outer_top.p1[1], oy0, 1e-12);
    near(m.lines!.outer_right.p1[0], ox1, 1e-12);
    near(m.lines!.outer_bottom.p1[1], oy1, 1e-12);
    near(m.lines!.inner_left.p1[0], ix0, 1e-12);
    near(m.lines!.inner_top.p1[1], iy0, 1e-12);
    near(m.lines!.inner_right.p1[0], ix1, 1e-12);
    near(m.lines!.inner_bottom.p1[1], iy1, 1e-12);
  });
});
