/**
 * End-to-end: the built app, in a real browser, used the way a person would.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { applyH, homography, type Quad } from "../../src/core/perspective";
import { warpPerspective } from "../../src/core/raster";

const SAMPLE = "public/samples/sample_offset.png";
const ROTATED = "public/samples/sample_rotated.png";
// make_sample.py drew sample_offset with its card edge at these corners and a
// true centering of 57.0 / 43.0 left-right, 46.1 / 53.9 top-bottom.
const CARD: Quad = [[40, 40], [774, 40], [774, 1064], [40, 1064]];

declare global {
  interface Window { cardGrader: any }
}

async function openImage(page: Page, file: string, via = "Open"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: via, exact: true }).first().click();
  await (await chooser).setFiles(file);
  await expect(page.locator(".busy")).toBeHidden();
}

async function results(page: Page) {
  return page.evaluate(() => ({
    lr: document.querySelectorAll(".big")[0].textContent!,
    tb: document.querySelectorAll(".big")[1].textContent!,
    final: [...document.querySelectorAll(".grades tr.final td")].map((t) => t.textContent),
    rows: [...document.querySelectorAll(".grades tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((t) => t.textContent)),
    sides: document.querySelector(".results-head .muted")?.textContent,
  }));
}

const pct = (s: string) => s.split("/").map((v) => Number(v.trim()));

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (e) => { throw e; });
  await page.goto("/");
});

test("measures the sample card exactly as the Python app did", async ({ page }) => {
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  const r = await results(page);
  expect(r.tb).toBe("46.3 / 53.7");
  expect(r.final).toEqual(["9", "9", "9.5"]);
});

test("a bulk handle moves only its own edge", async ({ page }) => {
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  await page.getByRole("tab", { name: /Bulk/ }).click();

  const before = await page.evaluate(() => JSON.stringify(window.cardGrader.session.card.state().lines));
  const at = await page.evaluate(() => {
    const app = window.cardGrader;
    const m = app.session.card;
    const [a, b] = m.segment("outer_left");
    const v = m.transform.imgToView([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const r = app.view.canvas.getBoundingClientRect();
    return [r.left + v[0], r.top + v[1]];
  });
  await page.mouse.move(at[0], at[1]);
  await page.mouse.down();
  await page.mouse.move(at[0] + 15, at[1] + 40, { steps: 6 });
  await page.mouse.up();

  const after = await page.evaluate(() => JSON.stringify(window.cardGrader.session.card.state().lines));
  const b = JSON.parse(before);
  const a = JSON.parse(after);
  const moved = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  expect(moved).toEqual(["outer_left"]);
  // Perpendicular only: a vertical line moved sideways, not up or down.
  expect(a.outer_left[0][1]).toBeCloseTo(b.outer_left[0][1], 6);
  await expect(page.locator(".big").first()).not.toHaveText("57.6 / 42.4");

  await page.keyboard.press("Control+z");
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
});

test("perspective correction recovers the true centering from a keystoned photo", async ({ page }, info) => {
  // Build a keystoned "phone photo" of the sample card.
  const png = PNG.sync.read(readFileSync(SAMPLE));
  const src = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  const W = src.width, H = src.height;
  const photoCorners: Quad = [[70, 30], [W - 20, 90], [W - 60, H - 20], [30, H - 110]];
  const full: Quad = [[0, 0], [W, 0], [W, H], [0, H]];
  const photo = warpPerspective(src, homography(photoCorners, full)!, W, H);
  const out = new PNG({ width: W, height: H });
  out.data = Buffer.from(photo.data);
  const photoPath = info.outputPath("keystoned.png");
  writeFileSync(photoPath, PNG.sync.write(out));
  const toPhoto = homography(full, photoCorners)!;
  const truth = CARD.map((p) => applyH(toPhoto, p));

  await openImage(page, photoPath);
  await page.getByRole("tab", { name: /Perspective/ }).click();

  // Really drag one corner, to prove the handles respond to the pointer...
  const tl = await page.evaluate(() => {
    const v = window.cardGrader.view;
    const p = v.perspTransform.imgToView(v.corners[0]);
    const r = v.canvas.getBoundingClientRect();
    return [r.left + p[0], r.top + p[1]];
  });
  const cornerBefore = await page.evaluate(() => [...window.cardGrader.view.corners[0]]);
  await page.mouse.move(tl[0], tl[1]);
  await page.mouse.down();
  await page.mouse.move(tl[0] + 25, tl[1] + 25, { steps: 5 });
  await page.mouse.up();
  const cornerAfter = await page.evaluate(() => [...window.cardGrader.view.corners[0]]);
  expect(cornerAfter[0]).toBeGreaterThan(cornerBefore[0] + 5);

  // ...then place all four where a careful user would, and flatten.
  await page.evaluate((q) => { window.cardGrader.view.corners = q; }, truth);
  await page.getByRole("button", { name: "Flatten card" }).click();
  await expect(page.getByRole("tab", { name: /Bulk/ })).toHaveAttribute("aria-selected", "true");

  const r = await results(page);
  const [lr] = pct(r.lr);
  const [tb] = pct(r.tb);
  expect(Math.abs(lr - 57.0)).toBeLessThan(1.5);
  expect(Math.abs(tb - 46.1)).toBeLessThan(1.5);
  await expect(page.locator(".file-info")).toContainText("flattened");
});

test("front and back combine into a final ceiling", async ({ page }) => {
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Now the back" })).toBeVisible();
  await openImage(page, ROTATED, "Open image");

  // Straighten in stage 1, then detect on the straightened card.
  const angle = page.getByLabel("Rotation in degrees");
  await angle.fill("-4");
  await angle.press("Enter");
  await page.getByRole("tab", { name: /Bulk/ }).click();
  await page.getByRole("button", { name: "Auto-detect both frames" }).click();
  await expect(page.locator(".busy")).toBeHidden();

  const r = await results(page);
  const [lr] = pct(r.lr);
  expect(Math.abs(lr - 57.0)).toBeLessThan(1.5);
  expect(r.rows[0]).toEqual(["9", "9", "9.5"]); // front
  expect(r.rows[1].every((v) => v !== "--")).toBe(true); // back
  expect(r.final).toEqual(["9", "9", "9.5"]); // held to the worse face
  await expect(page.getByText("both sides")).toBeVisible();
});

test("exports an overlay image and a report", async ({ page }) => {
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");

  await page.getByRole("button", { name: "Export" }).click();
  const imgDl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Overlay image/ }).click();
  const img = await (await imgDl).path();
  const decoded = PNG.sync.read(readFileSync(img));
  expect(decoded.width).toBeGreaterThan(700);
  expect(decoded.height).toBeGreaterThan(decoded.width); // card plus caption band

  await page.getByRole("button", { name: "Export" }).click();
  const repDl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Report/ }).click();
  const report = JSON.parse(readFileSync(await (await repDl).path(), "utf8"));
  expect(report.sides.front.centering.left_right.left_pct).toBeCloseTo(57.57, 1);
  expect(report.final_grade_ceilings.PSA.grade).toBe("9");
  expect(report.grade_caveat).toContain("front");
});

test("saves a session and reopens it in a fresh window", async ({ page, context }) => {
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  await page.getByRole("tab", { name: /Rotation/ }).click();
  const angle = page.getByLabel("Rotation in degrees");
  await angle.fill("2.5");
  await angle.press("Enter");

  const dl = page.waitForEvent("download");
  await page.keyboard.press("Control+s");
  const file = await (await dl).path();

  const fresh = await context.newPage();
  await fresh.goto("/");
  await fresh.getByRole("button", { name: "More actions" }).click();
  const chooser = fresh.waitForEvent("filechooser");
  await fresh.getByRole("menuitem", { name: "Open session…" }).click();
  await (await chooser).setFiles(file);
  await expect(fresh.locator(".big").first()).toHaveText("57.6 / 42.4");
  const reopenedAngle = await fresh.evaluate(() => window.cardGrader.session.card.transform.angle);
  expect(reopenedAngle).toBeCloseTo(2.5, 6);
});

test("keeps working offline once it has been opened", async ({ page, context }) => {
  // The service worker precaches the app on the first visit; after one reload
  // the page is served through it.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  await context.setOffline(false);
});

test("works on a phone, with pinch to zoom @phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone", "phone layout only");
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");

  // Results and the canvas are both on screen at phone width.
  await expect(page.locator(".card-canvas")).toBeInViewport();
  await expect(page.locator(".results")).toBeInViewport();

  // Two fingers moving apart.
  const scaleBefore = await page.evaluate(() => window.cardGrader.session.card.transform.scale);
  await page.evaluate(() => {
    const c = window.cardGrader.view.canvas as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const fire = (type: string, id: number, x: number, y: number) =>
      c.dispatchEvent(new PointerEvent(type, {
        pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 1,
      }));
    fire("pointerdown", 1, cx - 30, cy);
    fire("pointerdown", 2, cx + 30, cy);
    for (let i = 1; i <= 10; i++) {
      fire("pointermove", 1, cx - 30 - i * 6, cy);
      fire("pointermove", 2, cx + 30 + i * 6, cy);
    }
    fire("pointerup", 1, cx - 90, cy);
    fire("pointerup", 2, cx + 90, cy);
  });
  const scaleAfter = await page.evaluate(() => window.cardGrader.session.card.transform.scale);
  expect(scaleAfter / scaleBefore).toBeGreaterThan(2.5); // 60 px apart -> 180 px apart
  await page.screenshot({ path: info.outputPath("phone.png") });
});
