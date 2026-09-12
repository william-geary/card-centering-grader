/**
 * Behaviour: the properties the app relies on, independent of the Python
 * reference. Most were checks in the old tools/selftest.py; the perspective
 * tests are new with the web version.
 */

import { describe, expect, it } from "vitest";
import { Line, type Vec } from "../src/core/geometry";
import { BACK, FRONT, GRADERS, TABLES, combine, ceiling, ceilings } from "../src/core/grades";
import { exportFrame, homeView, HOME_FILL } from "../src/core/framing";
import { SIDES, measure, type Lines } from "../src/core/measure";
import { CardModel } from "../src/core/model";
import { applyH, homography, isConvexQuad, type Quad } from "../src/core/perspective";
import { TINT_MODES, applyTint, makeRaster, resample8, warpPerspective } from "../src/core/raster";
import { SESSION_FORMAT, Session } from "../src/core/session";
import { ViewTransform } from "../src/core/transform";
import { SAMPLE_OFFSET, SAMPLE_ROTATED, frame, loadPng, near } from "./helpers";

// make_sample.py drew the sample with the inner frame offset by (+9, -5):
const TRUTH_LR = 57.0;
const TRUTH_TB = 46.1;
// ...and, for sample_offset.png, the card edge at these pixel corners.
const CARD: Quad = [[40, 40], [774, 40], [774, 1064], [40, 1064]];
const CANVAS: Vec = [1000, 800];

const rotateLines = (lines: Lines, deg: number, c: Vec = [50, 70]): Lines => {
  const a = (deg * Math.PI) / 180;
  const rot = (p: Vec): Vec => {
    const x = p[0] - c[0], y = p[1] - c[1];
    return [c[0] + Math.cos(a) * x - Math.sin(a) * y, c[1] + Math.sin(a) * x + Math.cos(a) * y];
  };
  return Object.fromEntries(SIDES.map((k) => [k, new Line(rot(lines[k].p1), rot(lines[k].p2))])) as Lines;
};

describe("geometry", () => {
  it("slides a line perpendicular to itself, ignoring the along-line part", () => {
    const l = Line.fromPoints(2, 0, 2, 10);
    l.translatePerpendicular([3, 7]);
    expect(l.p1[0]).toBeCloseTo(5, 12);
    expect(l.p1[1]).toBeCloseTo(0, 12);
  });

  it("never lets a line's two handles collapse together", () => {
    const l = Line.fromPoints(0, 0, 10, 0);
    l.setControl(0, [10, 0]);
    expect(Math.hypot(l.p2[0] - l.p1[0], l.p2[1] - l.p1[1])).toBeGreaterThanOrEqual(0.999);
  });
});

describe("transform", () => {
  it("keeps the point under the cursor fixed while zooming and rotating", () => {
    const t = new ViewTransform(23.5, 1.7, [400, 300], [100, 150]);
    const anchor: Vec = [500, 420];
    const before = t.viewToImg(anchor);
    t.zoomAbout(anchor, 2.3);
    t.rotateAbout(anchor, 17);
    const after = t.viewToImg(anchor);
    near(after[0], before[0], 1e-9);
    near(after[1], before[1], 1e-9);
  });
});

describe("measurement", () => {
  it("reads a centred frame as 50/50 with the right pixel margins", () => {
    const m = measure(frame(0, 0, 100, 140, 10, 10, 90, 130), 3);
    near(m.lr.lowPct, 50); near(m.tb.lowPct, 50);
    near(m.lr.low, 10); near(m.tb.high, 10);
  });

  it("reads an inner frame shifted 8 px right as 90/10, leaving T/B alone", () => {
    const m = measure(frame(0, 0, 100, 140, 18, 10, 98, 130), 3);
    near(m.lr.lowPct, 90); near(m.lr.highPct, 10); near(m.tb.lowPct, 50);
  });

  it("gives the same answer at any sample count when frames are parallel", () => {
    for (const n of [1, 2, 3, 5, 9]) {
      const m = measure(frame(0, 0, 100, 140, 10, 10, 90, 130), n);
      near(m.lr.lowPct, 50); near(m.lr.spread, 0, 1e-9);
    }
  });

  it("exposes a tilted print through spread, which one sample would hide", () => {
    const base = frame(0, 0, 100, 140, 10, 10, 90, 130);
    const inner = rotateLines(base, 4);
    const tilted = { ...base, inner_left: inner.inner_left, inner_right: inner.inner_right,
      inner_top: inner.inner_top, inner_bottom: inner.inner_bottom };
    const m = measure(tilted, 3);
    near(m.lr.lowPct, 50, 1e-6);
    expect(m.lr.spread).toBeGreaterThan(20);
    near(measure(tilted, 1).lr.spread, 0);
  });

  it("is invariant to rotating or scaling the whole configuration", () => {
    const f = frame(0, 0, 100, 140, 18, 12, 98, 132);
    const m0 = measure(f, 3);
    const m1 = measure(rotateLines(f, 31), 3);
    const scaled = Object.fromEntries(SIDES.map((k) =>
      [k, new Line([f[k].p1[0] * 3.7, f[k].p1[1] * 3.7], [f[k].p2[0] * 3.7, f[k].p2[1] * 3.7])])) as Lines;
    near(m1.lr.lowPct, m0.lr.lowPct, 1e-9); near(m1.tb.lowPct, m0.tb.lowPct, 1e-9);
    near(measure(scaled, 3).lr.lowPct, m0.lr.lowPct, 1e-9);
    near(m0.lr.lowPct + m0.lr.highPct, 100);
  });

  it("flags a crossed frame and reports a degenerate one as invalid", () => {
    expect(measure(frame(30, 0, 100, 140, 10, 10, 90, 130), 3).crossed).toBe(true);
    const deg = frame(0, 0, 100, 140, 10, 10, 90, 130);
    deg.inner_left = deg.inner_top;
    expect(measure(deg, 3).lr.valid).toBe(false);
  });
});

describe("grades", () => {
  it("never allows a better grade for worse centering", () => {
    for (const g of GRADERS) for (const s of [FRONT, BACK] as const) {
      let lastRank = 0;
      for (let w = 50; w <= 100; w += 0.5) {
        const r = ceiling(g, w, s).rank;
        expect(r).toBeGreaterThanOrEqual(lastRank);
        lastRank = r;
      }
      expect(TABLES[g][s].at(-1)![0]).toBe(100);
    }
  });

  it("holds a card to its worse face, and keeps a CGC Pristine above Gem Mint", () => {
    const fake = (w: number) => ({ valid: true, crossed: false, worstPct: () => w }) as any;
    const good = new Map(combine(fake(52), null).map((c) => [c.grader, c]));
    const both = new Map(combine(fake(52), fake(88)).map((c) => [c.grader, c]));
    expect(both.get("PSA")!.rank).toBeGreaterThan(good.get("PSA")!.rank);
    expect(both.get("PSA")!.side).toBe(BACK);
    expect(combine(fake(88), fake(52))[0].side).toBe(FRONT);
    expect(combine(null, null)).toEqual([]);
    expect(ceiling("CGC", 50).rank).toBeLessThan(ceiling("CGC", 54).rank);
    expect(ceiling("CGC", 50).grade).toBe(ceiling("CGC", 54).grade);
    expect(ceilings(fake(52)).length).toBe(3);
  });
});

describe("card model on the sample scans", () => {
  const load = (rel: string, auto = true) => {
    const m = new CardModel();
    m.load(loadPng(rel), rel, CANVAS, auto);
    return m;
  };

  it("auto-detects close to the known truth", () => {
    const m = load(SAMPLE_OFFSET).measure()!;
    expect(Math.abs(m.lr.lowPct - TRUTH_LR)).toBeLessThan(2);
    expect(Math.abs(m.tb.lowPct - TRUTH_TB)).toBeLessThan(2);
  });

  it("does not move the numbers when the view is rotated or zoomed", () => {
    const m = load(SAMPLE_OFFSET);
    const before = m.measure()!.lr.lowPct;
    m.transform.angle = 12;
    m.transform.scale = 2.5;
    near(m.measure()!.lr.lowPct, before, 1e-12);
  });

  it("undoes and redoes line edits", () => {
    const m = load(SAMPLE_OFFSET);
    const before = m.measure()!.lr.lowPct;
    m.snapshot();
    m.lines!.outer_left.translatePerpendicular([25, 0]);
    expect(m.measure()!.lr.lowPct).not.toBeCloseTo(before, 6);
    expect(m.undo()).toBe(true);
    near(m.measure()!.lr.lowPct, before, 1e-12);
    expect(m.redo()).toBe(true);
    expect(m.measure()!.lr.lowPct).not.toBeCloseTo(before, 6);
  });

  it("never places two precision handles on the same point", () => {
    const m = load(SAMPLE_OFFSET);
    m.placeHandles();
    const pts = SIDES.flatMap((k) => [m.lines![k].p1, m.lines![k].p2]).map((p) => p.map((v) => v.toFixed(3)).join());
    expect(new Set(pts).size).toBe(pts.length);
  });

  it("squares straightened lines to the screen, not to raw pixels", () => {
    const m = load(SAMPLE_OFFSET);
    m.transform.angle = -4;
    m.straighten();
    const top = m.lines!.outer_top;
    const d = [m.transform.imgToView(top.p2), m.transform.imgToView(top.p1)];
    near(d[0][1] - d[1][1], 0, 1e-9);
    near(top.angleDeg(), 4, 1e-9);
  });

  it("detects a crooked scan far better once stage 1 has straightened it", () => {
    const crooked = load(SAMPLE_ROTATED);
    const off = Math.abs(crooked.measure()!.lr.lowPct - TRUTH_LR);
    const straight = load(SAMPLE_ROTATED, false);
    straight.transform.angle = -4;
    straight.resetLines(true);
    const fixed = Math.abs(straight.measure()!.lr.lowPct - TRUTH_LR);
    expect(fixed).toBeLessThan(1.5);
    expect(fixed).toBeLessThan(off / 3);
  });
});

describe("perspective correction", () => {
  // Keystone the flat sample the way a phone held at an angle would.
  const src = loadPng(SAMPLE_OFFSET);
  const W = src.width, H = src.height;
  const photoCorners: Quad = [[70, 30], [W - 20, 90], [W - 60, H - 20], [30, H - 110]];
  const flatToPhoto = homography([[0, 0], [W, 0], [W, H], [0, H]], photoCorners)!;
  const photoToFlat = homography(photoCorners, [[0, 0], [W, 0], [W, H], [0, H]])!;
  const photo = warpPerspective(src, photoToFlat, W, H);
  const cardInPhoto = CARD.map((p) => applyH(flatToPhoto, p)) as Quad;

  it("maps each corner exactly onto its target", () => {
    photoCorners.forEach((p, i) => {
      const q = applyH(flatToPhoto, [[0, 0], [W, 0], [W, H], [0, H]][i] as Vec);
      near(q[0], p[0], 1e-9); near(q[1], p[1], 1e-9);
    });
  });

  it("rejects corners that cannot outline a card", () => {
    expect(isConvexQuad(CARD)).toBe(true);
    expect(isConvexQuad([[0, 0], [10, 10], [10, 0], [0, 10]])).toBe(false);
  });

  it("recovers the true centering from a keystoned photo", () => {
    const m = new CardModel();
    m.load(photo, "photo", CANVAS, false);
    expect(m.setFlatten(cardInPhoto, CANVAS)).toBe(true);
    m.resetLines(true);
    const r = m.measure()!;
    expect(Math.abs(r.lr.lowPct - TRUTH_LR)).toBeLessThan(1.5);
    expect(Math.abs(r.tb.lowPct - TRUTH_TB)).toBeLessThan(1.5);
  });

  it("carries existing lines through a re-flatten instead of discarding them", () => {
    const m = new CardModel();
    m.load(photo, "photo", CANVAS, false);
    m.setFlatten(cardInPhoto, CANVAS);
    m.resetLines(true);
    const before = m.measure()!;
    const nudged = cardInPhoto.map(([x, y]) => [x + 2, y - 1]) as Quad;
    m.setFlatten(nudged, CANVAS);
    const after = m.measure()!;
    expect(Math.abs(after.lr.lowPct - before.lr.lowPct)).toBeLessThan(0.5);
    m.setFlatten(null, CANVAS);
    expect(m.image).toBe(m.source);
    expect(m.measure()!.valid).toBe(true);
  });
});

describe("pixel operations", () => {
  it("returns the input untouched when no resize is needed", () => {
    const g = new Uint8Array([1, 2, 3, 4]);
    expect(resample8(g, 2, 2, 2, 2)).toBe(g);
  });

  it("keeps size and alpha under every tint, and makes true greys", () => {
    const r = makeRaster(4, 3, [200, 40, 90, 255]);
    expect(applyTint(r, "None", 80)).toBe(r);
    expect(applyTint(r, "Grayscale", 0)).toBe(r);
    for (const mode of TINT_MODES) {
      const t = applyTint(r, mode, 60);
      expect([t.width, t.height, t.data[3]]).toEqual([4, 3, 255]);
    }
    const g = applyTint(r, "Grayscale", 100).data;
    expect(g[0]).toBe(g[1]); expect(g[1]).toBe(g[2]);
  });
});

describe("framing", () => {
  it("fills the view with the card on Home and centres it", () => {
    const m = new CardModel();
    m.load(loadPng(SAMPLE_OFFSET), "s", CANVAS, true);
    m.transform.pan = [900, -300];
    m.transform.scale *= 3.4;
    expect(homeView(m, CANVAS)).toBe(true);
    const c = m.transform.imgToView(m.outerCenter()!);
    near(c[0], CANVAS[0] / 2, 1e-9); near(c[1], CANVAS[1] / 2, 1e-9);
  });

  it("crops an export to the card with Home's margin on every side", () => {
    const m = new CardModel();
    m.load(loadPng(SAMPLE_OFFSET), "s", CANVAS, true);
    const f = exportFrame(m)!;
    const corners = m.outerCorners()!.map((p) => f.transform.imgToView(p));
    const xs = corners.map((p) => p[0]);
    const left = Math.min(...xs);
    const right = f.size[0] - Math.max(...xs);
    expect(Math.abs(left - right)).toBeLessThan(1);
    expect((Math.max(...xs) - left) / f.size[0]).toBeCloseTo(HOME_FILL, 2);
  });

  it("sizes the crop from the card, so a wide scanner bed is cut away", () => {
    // The sample's own bed is narrower than Home's margin, so lay it on a big one.
    const s = loadPng(SAMPLE_OFFSET);
    const bed = makeRaster(s.width + 1200, s.height + 1200, [28, 28, 30, 255]);
    for (let y = 0; y < s.height; y++) {
      bed.data.set(s.data.subarray(y * s.width * 4, (y + 1) * s.width * 4), ((y + 600) * bed.width + 600) * 4);
    }
    const m = new CardModel();
    m.load(bed, "bed", CANVAS, false);
    const shift = (l: Line, dx: number, dy: number) => new Line([l.p1[0] + dx, l.p1[1] + dy], [l.p2[0] + dx, l.p2[1] + dy]);
    const ref = new CardModel();
    ref.load(s, "s", CANVAS, true);
    m.lines = Object.fromEntries(SIDES.map((k) => [k, shift(ref.lines![k], 600, 600)])) as Lines;
    const f = exportFrame(m)!;
    near(f.size[0], exportFrame(ref)!.size[0], 1e-9);
    expect(f.size[0]).toBeLessThan(bed.width / 2);
  });
});

describe("session", () => {
  const two = () => {
    const s = new Session();
    s.cards.front.load(loadPng(SAMPLE_OFFSET), "front.png", CANVAS, true);
    s.setActive(BACK);
    s.cards.back.load(loadPng(SAMPLE_ROTATED), "back.png", CANVAS, false);
    s.cards.back.transform.angle = -4;
    s.cards.back.resetLines(true);
    return s;
  };

  it("keeps each face independent", () => {
    const s = two();
    expect(s.bothLoaded).toBe(true);
    const before = s.measurement(BACK)!.lr.lowPct;
    s.cards.front.lines!.outer_left.translatePerpendicular([30, 0]);
    near(s.measurement(BACK)!.lr.lowPct, before, 1e-12);
    expect(s.cards.front.transform.angle).toBe(0);
  });

  it("makes the final ceiling exactly the worse face per grader", () => {
    const s = two();
    const f = new Map(s.sideCeilings(FRONT).map((c) => [c.grader, c]));
    const b = new Map(s.sideCeilings(BACK).map((c) => [c.grader, c]));
    for (const c of s.finalCeilings()) {
      expect(c.rank).toBe(Math.max(f.get(c.grader)!.rank, b.get(c.grader)!.rank));
    }
    const rep = s.report();
    expect(Object.keys(rep.sides as object).sort()).toEqual(["back", "front"]);
    expect(rep.final_grade_ceilings).toBeTruthy();
    expect(rep.grade_caveat).toBeUndefined();
  });

  it("saves and reopens both faces, lines and perspective included", async () => {
    const s = two();
    s.cards.front.setFlatten(CARD.map(([x, y]) => [x - 5, y - 5]) as Quad, CANVAS);
    const images = new Map<string, any>();
    const saved = await s.save(async (r) => { const id = `img${images.size}`; images.set(id, r); return id; });
    expect(saved.format).toBe(SESSION_FORMAT);
    const json = JSON.parse(JSON.stringify(saved));
    const back = await Session.open(json, async (id) => images.get(id), CANVAS);
    for (const side of [FRONT, BACK] as const) {
      near(back.measurement(side)!.lr.lowPct, s.measurement(side)!.lr.lowPct, 1e-9);
      near(back.measurement(side)!.tb.lowPct, s.measurement(side)!.tb.lowPct, 1e-9);
    }
    expect(back.cards.front.flattened).toBe(true);
    near(back.cards.back.transform.angle, -4, 1e-12);
    expect(back.active).toBe(BACK);
  });

  it("refuses a file that is not a session", async () => {
    await expect(Session.open({ nope: 1 } as any, async () => makeRaster(1, 1), CANVAS)).rejects.toThrow();
  });
});
