import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { expect } from "vitest";
import { type Vec, Line } from "../src/core/geometry";
import type { LineKey, Lines } from "../src/core/measure";
import type { Raster } from "../src/core/raster";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function fixture<T = any>(name: string): T {
  return JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", name), "utf8"));
}

export function loadPng(rel: string): Raster {
  const png = PNG.sync.read(readFileSync(join(ROOT, rel)));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
}

export const SAMPLE_OFFSET = "public/samples/sample_offset.png";
export const SAMPLE_ROTATED = "public/samples/sample_rotated.png";

/** Floating-point agreement with the Python reference: relative + absolute slack. */
export function near(actual: number, expected: number, tol = 1e-9): void {
  const slack = tol * Math.max(1, Math.abs(expected));
  if (Math.abs(actual - expected) > slack) {
    expect.fail(`expected ${expected}, got ${actual} (diff ${Math.abs(actual - expected)})`);
  }
}

export function nearVec(actual: Vec | null, expected: Vec | null, tol = 1e-9): void {
  if (expected === null) {
    expect(actual).toBeNull();
    return;
  }
  expect(actual).not.toBeNull();
  near(actual![0], expected[0], tol);
  near(actual![1], expected[1], tol);
}

export function linesFrom(json: Record<string, [Vec, Vec]>): Lines {
  return Object.fromEntries(
    Object.entries(json).map(([k, [a, b]]) => [k, new Line([...a] as Vec, [...b] as Vec)]),
  ) as Lines;
}

export function frame(
  ol: number, ot: number, or: number, ob: number,
  il: number, it: number, ir: number, ib: number,
): Lines {
  const v = (x: number) => Line.fromPoints(x, 0, x, 200);
  const h = (y: number) => Line.fromPoints(0, y, 200, y);
  return {
    outer_left: v(ol), outer_right: v(or), outer_top: h(ot), outer_bottom: h(ob),
    inner_left: v(il), inner_right: v(ir), inner_top: h(it), inner_bottom: h(ib),
  } satisfies Record<LineKey, Line>;
}
