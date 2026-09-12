/**
 * Regenerates the images in docs/images for the README.
 *
 *     npm run docs:screenshots
 *
 * Not part of the test run; tagged @docs so only the "docs" project picks it up.
 */

import { expect, test, type Page } from "@playwright/test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { homography, type Quad, applyH } from "../../src/core/perspective";
import { warpPerspective } from "../../src/core/raster";

const OUT = "docs/images";
mkdirSync(OUT, { recursive: true });

async function open(page: Page, file: string, button = "Open"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: button, exact: true }).first().click();
  await (await chooser).setFiles(file);
  await expect(page.locator(".busy")).toBeHidden();
}

test("both sides, bulk stage @docs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await open(page, "public/samples/sample_rotated.png", "Open image");
  const angle = page.getByLabel("Rotation in degrees");
  await angle.fill("-4");
  await angle.press("Enter");
  await page.getByRole("tab", { name: /Bulk/ }).click();
  await page.getByRole("button", { name: "Auto-detect both frames" }).click();
  await expect(page.locator(".busy")).toBeHidden();
  await page.keyboard.press("h");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/app.png` });

  await page.getByRole("button", { name: "Export" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Overlay image/ }).click();
  copyFileSync(await (await dl).path(), `${OUT}/overlay-sheet.png`);
});

test("precision with the magnifier @docs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the sample card" }).click();
  await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
  await page.getByRole("tab", { name: /Precision/ }).click();
  const at = await page.evaluate(() => {
    const app = (window as any).cardGrader;
    const m = app.session.card;
    const v = m.transform.imgToView(m.lines.inner_left.p1);
    const r = app.view.canvas.getBoundingClientRect();
    return [r.left + v[0] + 2, r.top + v[1] + 30];
  });
  await page.mouse.move(at[0], at[1]);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/precision.png` });
});

test("perspective on a photo @docs", async ({ page }, info) => {
  const png = PNG.sync.read(readFileSync("public/samples/sample_offset.png"));
  const W = png.width, H = png.height;
  const full: Quad = [[0, 0], [W, 0], [W, H], [0, H]];
  const photoCorners: Quad = [[70, 30], [W - 20, 90], [W - 60, H - 20], [30, H - 110]];
  const photo = warpPerspective({ width: W, height: H, data: new Uint8ClampedArray(png.data) },
    homography(photoCorners, full)!, W, H);
  const out = new PNG({ width: W, height: H });
  out.data = Buffer.from(photo.data);
  const path = info.outputPath("keystoned.png");
  writeFileSync(path, PNG.sync.write(out));

  await page.goto("/");
  await open(page, path, "Open image");
  await page.getByRole("tab", { name: /Perspective/ }).click();
  const toPhoto = homography(full, photoCorners)!;
  const card: Quad = [[40, 40], [774, 40], [774, 1064], [40, 1064]];
  await page.evaluate((q) => {
    const v = (window as any).cardGrader.view;
    v.corners = q;
    v.requestDraw();
  }, card.map((p) => applyH(toPhoto, p)));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/perspective.png` });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  test("phone layout @docs", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try the sample card" }).click();
    await expect(page.locator(".big").first()).toHaveText("57.6 / 42.4");
    await page.getByRole("tab", { name: /Bulk/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/phone.png` });
  });
});
