/** Line colours, shared by the canvas and the exported images. */

import type { LineKey } from "../core/measure";

// Each scheme gives the card edge a strong colour and the border edge a lighter
// relative of it, so the two frames stay distinguishable but read as one set.
export const LINE_SCHEMES = {
  Red: { outer: "#ff2e2e", inner: "#ff9e9e" },
  "Cyan / Amber": { outer: "#4fc3f7", inner: "#ffd54f" },
  Green: { outer: "#00e676", inner: "#c6ff6b" },
  Magenta: { outer: "#ff3dda", inner: "#ffa3f0" },
} as const;

export type SchemeName = keyof typeof LINE_SCHEMES;
export const SCHEME_NAMES = Object.keys(LINE_SCHEMES) as SchemeName[];
export const DEFAULT_SCHEME: SchemeName = "Red";

export const SAMPLE_C = "#69f0ae"; // measurement scan lines
export const SEL_C = "#ffffff";
export const CORNER_C = "#ffd54f"; // perspective corner handles

export const schemeColors = (s: SchemeName) => LINE_SCHEMES[s] ?? LINE_SCHEMES[DEFAULT_SCHEME];
export const colorFor = (key: LineKey, s: SchemeName) =>
  schemeColors(s)[key.startsWith("outer") ? "outer" : "inner"];
