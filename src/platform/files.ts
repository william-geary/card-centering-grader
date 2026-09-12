/**
 * Getting files in and out, which is the one place a browser and the Tauri
 * desktop app genuinely differ.
 *
 * Opening works the same way in both: a file input, or a file dropped on the
 * window (Tauri's own drop handling is switched off in tauri.conf.json so the
 * page receives the drop). Saving differs: a browser downloads -- or on a
 * phone offers the share sheet -- while the desktop app shows a real Save
 * dialog and writes the file where the user chose.
 */

import type { Raster } from "../core/raster";

/** Browsers cap canvas area (iOS Safari at roughly 16.7 MP). Stay under it. */
export const MAX_PIXELS = 16_000_000;

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const coarsePointer = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

export interface Decoded {
  raster: Raster;
  /** Original dimensions when the image had to be scaled down to fit. */
  resizedFrom: [number, number] | null;
}

/**
 * Decode an image file or data URL into pixels. Uses an <img> element, which
 * applies the EXIF orientation of phone photos, then scales down anything too
 * large for the browser to hold in a canvas.
 */
export async function decodeImage(src: Blob | string): Promise<Decoded> {
  const url = typeof src === "string" ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const w0 = img.naturalWidth;
    const h0 = img.naturalHeight;
    if (!w0 || !h0) throw new Error("That file did not decode as an image.");
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w0 * h0)));
    const w = Math.max(1, Math.round(w0 * k));
    const h = Math.max(1, Math.round(h0 * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { raster: data, resizedFrom: k < 1 ? [w0, h0] : null };
  } finally {
    if (typeof src !== "string") URL.revokeObjectURL(url);
  }
}

export function rasterToCanvas(r: Raster, canvas = document.createElement("canvas")): HTMLCanvasElement {
  canvas.width = r.width;
  canvas.height = r.height;
  const data = r instanceof ImageData ? r : new ImageData(new Uint8ClampedArray(r.data), r.width, r.height);
  canvas.getContext("2d")!.putImageData(data, 0, 0);
  return canvas;
}

/** PNG data URL, used to embed the scans inside a saved session. */
export function rasterToDataURL(r: Raster): Promise<string> {
  return Promise.resolve(rasterToCanvas(r).toDataURL("image/png"));
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the image."))), type));
}

/** Ask for a file with the platform's picker. Resolves null if cancelled. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let settled = false;
    const done = (f: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(f);
    };
    input.addEventListener("change", () => done(input.files?.[0] ?? null));
    input.addEventListener("cancel", () => done(null));
    document.body.append(input);
    input.click();
  });
}

export interface SaveOptions {
  filename: string;
  mime: string;
  /** For the desktop Save dialog's type filter. */
  filterName: string;
  extensions: string[];
}

export type SaveResult = "saved" | "shared" | "downloaded" | "cancelled";

/** Save a file the way the current platform expects. */
export async function saveFile(blob: Blob, opts: SaveOptions): Promise<SaveResult> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({
      defaultPath: opts.filename,
      filters: [{ name: opts.filterName, extensions: opts.extensions }],
    });
    if (!path) return "cancelled";
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return "saved";
  }

  // On a phone, the share sheet is what lets someone put an image in Photos or
  // send it on; a "download" there often goes nowhere they can find.
  const file = new File([blob], opts.filename, { type: opts.mime });
  if (coarsePointer() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: opts.filename });
      return "shared";
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") return "cancelled";
      // otherwise fall through to a plain download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
