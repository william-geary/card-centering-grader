/**
 * The application shell: toolbar, stage panels, live results, menus, keyboard
 * and file handling, wrapped around the canvas view.
 */

import { BACK, FRONT, GRADERS, type Side } from "../core/grades";
import { type LineKey } from "../core/measure";
import { INNER, OUTER, PRETTY, isHorizontal } from "../core/model";
import { TINT_MODES, type TintMode } from "../core/raster";
import { LABELS, SIDE_ORDER, Session, type SavedSession } from "../core/session";
import {
  canvasToBlob, decodeImage, isTauri, pickFile, rasterToDataURL, saveFile,
} from "../platform/files";
import { $, clear, h, typingInField } from "./dom";
import { renderSession } from "./export";
import { DEFAULT_SCHEME, SCHEME_NAMES, type SchemeName, schemeColors } from "./palette";
import { CardView, STAGES, STAGE_TITLES, type Stage, stageHints } from "./view";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/heic,image/heif,image/bmp,image/tiff,image/*";
const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/sample_offset.png`;

/** Phones, and phones held sideways. Tablets keep the desktop layout. */
const MOBILE_QUERY = "(max-width: 760px), (max-height: 520px) and (pointer: coarse)";

type Sheet = "results" | "options";

// Bottom-navigation icons: simple strokes in currentColor.
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" `
  + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const NAV_ICONS: Record<Stage | "results", string> = {
  perspective: svg("M6 5l13 2v12L5 18z"),
  rotate: svg("M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"),
  bulk: svg("M3 7h18M3 17h18M7 3v18M17 3v18"),
  precision: svg("M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6"),
  results: svg("M5 20v-8M12 20V5M19 20v-11"),
};
const NAV_LABELS: Record<Stage | "results", string> = {
  perspective: "Deskew", rotate: "Rotate", bulk: "Bulk", precision: "Precision", results: "Results",
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "--");

export class App {
  session = new Session();
  view!: CardView;
  private root: HTMLElement;
  private stagePanel!: HTMLElement;
  private r: Record<string, HTMLElement> = {};
  private resultsPending = 0;
  private tintTimer = 0;
  private scheme: SchemeName = DEFAULT_SCHEME;
  /** Phone layout: card full screen, navigation at the bottom. */
  mobile = false;
  private sheet: Sheet | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    const mq = matchMedia(MOBILE_QUERY);
    mq.addEventListener("change", () => this.applyLayout(mq.matches));
    this.applyLayout(mq.matches);
    this.bindKeys();
    this.bindDrop();
    this.renderStagePanel();
    this.refresh();
    if (!isTauri()) {
      addEventListener("beforeunload", (e) => {
        if (this.session.anyLoaded) e.preventDefault();
      });
    }
  }

  private get card() { return this.session.card; }

  // ================================================================== layout
  private build(): void {
    const r = this.r;
    const btn = (label: string, onclick: () => void, extra: Record<string, string> = {}) =>
      h("button", { type: "button", onclick: () => onclick(), ...extra }, label);

    const sideSeg = h("div", { class: "seg", role: "group", "aria-label": "Card side" },
      ...SIDE_ORDER.map((s) => {
        const b = h("button", { type: "button", "data-side": s, onclick: () => this.setSide(s) }, LABELS[s]);
        r[`side-${s}`] = b;
        return b;
      }));

    r.exportMenu = this.menu("Export", [
      ["Overlay image (PNG)", () => this.exportImage(), "Ctrl+E"],
      ["Report (JSON)", () => this.exportReport()],
    ]);
    r.moreMenu = this.menu("⋯", [
      ["Take a photo", () => this.takePhoto(), undefined, "mobile-only"],
      ["Choose a photo", () => this.openImage(), undefined, "mobile-only"],
      ["Open image…", () => this.openImage(), "Ctrl+O", "desktop-only"],
      ["Try the sample card", () => this.openSample()],
      null,
      ["Export overlay image", () => this.exportImage(), undefined, "mobile-only"],
      ["Export report", () => this.exportReport(), undefined, "mobile-only"],
      ["Save session…", () => this.saveSession(), "Ctrl+S"],
      ["Open session…", () => this.openSession()],
      null,
      ["Auto-detect frames", () => this.autoDetect(), "A"],
      ["Reset lines", () => this.resetLines()],
      ["Fit whole scan", () => this.view.fitScan(), "F"],
      null,
      ["Keyboard shortcuts", () => this.showShortcuts(), "?"],
      ["About", () => this.showAbout()],
    ], "More actions");

    const header = h("header", { class: "topbar" },
      h("div", { class: "brand" },
        h("img", { class: "logo", src: `${import.meta.env.BASE_URL}favicon.svg`, alt: "", width: 24, height: 24 }),
        h("span", { class: "brand-name" }, "Centering Grader")),
      btn("Open", () => this.openImage(), { class: "primary desktop-only", title: "Open a card image (Ctrl+O)" }),
      sideSeg,
      h("div", { class: "group" },
        (r.undo = h("button", { type: "button", title: "Undo (Ctrl+Z)", "aria-label": "Undo", onclick: () => this.undo() },
          h("span", { class: "ico", "aria-hidden": "true" }, "↶"), h("span", { class: "lbl" }, "Undo"))),
        (r.redo = h("button", { type: "button", title: "Redo (Ctrl+Shift+Z)", "aria-label": "Redo", onclick: () => this.redo() },
          h("span", { class: "ico", "aria-hidden": "true" }, "↷"), h("span", { class: "lbl" }, "Redo")))),
      btn("Home", () => this.view.home(), { title: "Centre the card (H)", class: "hide-sm desktop-only" }),
      h("div", { class: "spacer" }),
      h("div", { class: "desktop-only" }, r.exportMenu),
      r.moreMenu,
    );

    const tabs = h("nav", { class: "stage-tabs", role: "tablist" },
      ...STAGES.map((s, i) => {
        const t = h("button", {
          type: "button", role: "tab", "data-stage": s, onclick: () => this.setStage(s),
          title: `${STAGE_TITLES[s]} (${i + 1})`,
        }, h("span", { class: "num" }, String(i + 1)), STAGE_TITLES[s],
        s === "perspective" ? h("span", { class: "opt" }, "photos") : null);
        r[`tab-${s}`] = t;
        return t;
      }));

    const host = h("div", { class: "canvas-host" });
    r.empty = h("div", { class: "empty" },
      h("div", { class: "empty-card" },
        h("h1", {}, "Measure a card's centering"),
        h("p", {}, "Open a scan or photo of the front, place the lines, then do the back. "
          + "You get left/right and top/bottom centering and the best grade that centering allows."),
        h("div", { class: "row empty-actions" },
          btn("Take a photo", () => this.takePhoto(), { class: "primary mobile-only" }),
          (r.chooseBtn = btn("Open image", () => this.openImage(), { class: "primary" })),
          btn("Try the sample card", () => this.openSample())),
        h("ul", { class: "tips mobile-only" },
          h("li", {}, "Lay the card flat on a plain, dark surface."),
          h("li", {}, "Hold the phone directly above it and fill the frame."),
          h("li", {}, "Avoid glare: turn off the flash, and angle away from lights.")),
        h("p", { class: "muted small" }, h("span", { class: "desktop-only" }, "Or drop an image here. "),
          "Your images never leave this device.")));
    r.busy = h("div", { class: "busy", hidden: true }, h("div", { class: "spinner" }), (r.busyText = h("span", {}, "Working…")));
    r.drop = h("div", { class: "drop", hidden: true }, "Drop to open");
    // Phone layout: live numbers over the card, the stage's main actions above
    // the bottom nav, and short-lived messages in place of the status bar.
    r.chip = h("button", { type: "button", class: "chip mobile-only", hidden: true, "aria-label": "Show results",
      onclick: () => this.toggleSheet("results") });
    r.actions = h("div", { class: "actions mobile-only", hidden: true });
    r.toast = h("div", { class: "toast", role: "status", hidden: true });
    host.append(r.chip, r.actions, r.toast, r.empty, r.busy, r.drop);
    // The panels below read the view's defaults, so it has to exist first.
    this.view = new CardView(host, {
      change: () => this.scheduleResults(),
      viewChange: () => this.refreshViewReadouts(),
      status: (m) => this.status(m),
    });
    this.view.scheme = this.scheme;

    this.stagePanel = h("section", { class: "panel stage-panel" });
    const advanced = this.buildAdvanced();
    const results = this.buildResults();

    const sheetHead = h("div", { class: "sheet-head mobile-only" },
      h("span", { class: "grabber", "aria-hidden": "true" }),
      (r.sheetTitle = h("h2", {}, "")),
      h("button", { type: "button", class: "sm", onclick: () => this.closeSheet() }, "Done"));
    r.sidebar = h("aside", { class: "sidebar" }, sheetHead, results, this.stagePanel, advanced);
    const workspace = h("main", { class: "workspace" },
      h("section", { class: "stage-area" }, tabs, host), r.sidebar);

    r.status = h("span", { class: "status-msg" }, "Open a card image to begin.");
    r.fileInfo = h("span", { class: "file-info" });
    const footer = h("footer", { class: "statusbar" }, r.status, r.fileInfo);

    r.backdrop = h("div", { class: "backdrop", onclick: () => this.closeSheet() });
    const nav = h("nav", { class: "mobile-nav", "aria-label": "Stages" },
      ...[...STAGES, "results" as const].map((key) => {
        const b = h("button", {
          type: "button", "data-nav": key,
          onclick: () => (key === "results" ? this.toggleSheet("results") : this.navTo(key)),
        }, h("span", { class: "nav-ico" }), h("span", {}, NAV_LABELS[key]));
        (b.firstElementChild as HTMLElement).innerHTML = NAV_ICONS[key]; // static markup
        r[`nav-${key}`] = b;
        return b;
      }));

    this.root.append(header, workspace, footer, r.backdrop, nav);

  }

  private menu(label: string, items: Array<[string, () => void, string?, string?] | null>, aria?: string): HTMLElement {
    const list = h("div", { class: "menu-list", role: "menu", hidden: true });
    for (const it of items) {
      if (!it) { list.append(h("hr")); continue; }
      const [text, fn, key, cls] = it;
      list.append(h("button", {
        type: "button", role: "menuitem", class: cls,
        onclick: () => { list.hidden = true; fn(); },
      }, h("span", {}, text), key ? h("kbd", {}, key) : null));
    }
    const trigger = h("button", {
      type: "button", "aria-haspopup": "menu", "aria-label": aria ?? label,
      onclick: (e: Event) => {
        e.stopPropagation();
        const open = list.hidden;
        document.querySelectorAll<HTMLElement>(".menu-list").forEach((m) => (m.hidden = true));
        list.hidden = !open;
      },
    }, label);
    document.addEventListener("click", () => (list.hidden = true));
    return h("div", { class: "menu" }, trigger, list);
  }

  // ============================================================ stage panels
  private renderStagePanel(): void {
    const p = this.stagePanel;
    clear(p);
    const stage = this.view.stage;
    const build: Record<Stage, () => void> = {
      perspective: () => this.buildPerspective(p),
      rotate: () => this.buildRotation(p),
      bulk: () => this.buildBulk(p),
      precision: () => this.buildPrecision(p),
    };
    build[stage]();
    this.refreshPanels();
  }

  private buildPerspective(p: HTMLElement): void {
    const r = this.r;
    p.append(
      h("h2", {}, "Correct perspective"),
      h("p", { class: "muted" }, "For photos. A phone held even slightly off-parallel skews the card, and "
        + "that skews the percentages. Drag the four corners to where the card's straight edges would meet, "
        + "then flatten. Scans can skip this step."),
      (r.perspState = h("p", { class: "pill" })),
      h("div", { class: "row wrap" },
        (r.flattenBtn = h("button", { type: "button", class: "primary", onclick: () => this.applyFlatten() }, "Flatten card")),
        (r.unflattenBtn = h("button", { type: "button", onclick: () => this.removeFlatten() }, "Remove correction"))),
      h("div", { class: "row wrap" },
        h("button", { type: "button", onclick: () => { this.view.beginPerspective(); this.view.requestDraw(); } }, "Reset corners")),
      this.nudgePad("Nudges the selected corner"),
    );
  }

  private buildRotation(p: HTMLElement): void {
    const r = this.r;
    const angle = h("input", { type: "range", min: -45, max: 45, step: 0.05, "aria-label": "Rotation" }) as HTMLInputElement;
    const angleNum = h("input", { type: "number", step: 0.1, min: -180, max: 180, class: "num-input", "aria-label": "Rotation in degrees" }) as HTMLInputElement;
    angle.addEventListener("input", () => this.setAngle(Number(angle.value)));
    angleNum.addEventListener("change", () => this.setAngle(Number(angleNum.value)));
    const zoom = h("input", { type: "range", min: 0, max: 1, step: 0.001, "aria-label": "Zoom" }) as HTMLInputElement;
    const zoomNum = h("input", { type: "number", step: 5, min: 2, max: 4000, class: "num-input", "aria-label": "Zoom percent" }) as HTMLInputElement;
    zoom.addEventListener("input", () => this.setZoom(sliderToZoom(Number(zoom.value))));
    zoomNum.addEventListener("change", () => this.setZoom(Number(zoomNum.value) / 100));
    Object.assign(r, { angle, angleNum, zoom, zoomNum });

    const bump = (d: number) => h("button", { type: "button", class: "sm", onclick: () => this.setAngle(this.card.transform.angle + d) },
      d > 0 ? `+${d}` : String(d));
    const grid = h("input", { type: "checkbox" }) as HTMLInputElement;
    grid.checked = this.view.showGrid;
    grid.addEventListener("change", () => { this.view.showGrid = grid.checked; this.view.requestDraw(); });

    p.append(
      h("h2", {}, "Straighten the card"),
      h("p", { class: "muted" }, "Rotation and zoom only change the view — never the numbers. Straightening "
        + "here is what lets the lines in the next stages sit square to the card."),
      h("label", { class: "field" }, h("span", {}, "Rotation (°)"), h("div", { class: "row" }, angle, angleNum)),
      h("div", { class: "row wrap" }, bump(-1), bump(-0.1), bump(0.1), bump(1),
        h("button", { type: "button", class: "sm", onclick: () => this.setAngle(0) }, "0"),
        h("button", { type: "button", class: "sm", onclick: () => this.setAngle(this.card.transform.angle - 90) }, "−90"),
        h("button", { type: "button", class: "sm", onclick: () => this.setAngle(this.card.transform.angle + 90) }, "+90")),
      h("label", { class: "field" }, h("span", {}, "Zoom (%)"), h("div", { class: "row" }, zoom, zoomNum)),
      h("div", { class: "row wrap" },
        h("button", { type: "button", onclick: () => this.view.home() }, "Home"),
        h("button", { type: "button", onclick: () => this.view.fitScan() }, "Fit scan"),
        h("label", { class: "check" }, grid, "Alignment grid")),
    );
  }

  private buildBulk(p: HTMLElement): void {
    p.append(
      h("h2", {}, "Place the eight lines"),
      h("p", { class: "muted" }, "Each line has one handle at its middle. Dragging slides the whole line along "
        + "its normal, so its angle never changes. Alt+drag moves all four lines of a frame together."),
      h("button", { type: "button", class: "primary block", onclick: () => this.autoDetect() }, "Auto-detect both frames"),
      h("div", { class: "row" },
        h("button", { type: "button", class: "grow", onclick: () => this.straightenAll() }, "Straighten all"),
        h("button", { type: "button", class: "grow", onclick: () => this.resetLines() }, "Reset lines")),
      this.lineChooser(),
      this.nudgePad("Nudges the selected line"),
    );
  }

  private buildPrecision(p: HTMLElement): void {
    const r = this.r;
    const loupe = h("input", { type: "checkbox" }) as HTMLInputElement;
    loupe.checked = this.view.loupeEnabled;
    loupe.addEventListener("change", () => { this.view.loupeEnabled = loupe.checked; this.view.requestDraw(); });
    const lz = h("input", { type: "range", min: 2, max: 20, step: 1, value: this.view.loupeZoom, "aria-label": "Magnifier zoom" }) as HTMLInputElement;
    lz.addEventListener("input", () => { this.view.loupeZoom = Number(lz.value); this.view.requestDraw(); });

    const ends = h("div", { class: "row" }, ...([0, 1] as const).map((i) => {
      const inp = h("input", { type: "radio", name: "end", value: i }) as HTMLInputElement;
      inp.addEventListener("change", () => {
        if (this.view.selected) { this.view.selected = { ...this.view.selected, idx: i }; this.view.requestDraw(); }
      });
      r[`end${i}`] = inp;
      return h("label", { class: "check" }, inp, `End ${i + 1}`);
    }));

    p.append(
      h("h2", {}, "Match tilted borders"),
      h("p", { class: "muted" }, "Every line now has two handles and runs to the edge of the view. Drag an end "
        + "to pivot, shift+drag to slide without changing the angle, ctrl+drag for fine control."),
      h("div", { class: "row" },
        h("button", { type: "button", class: "grow", onclick: () => this.placeHandles() }, "Reset handles"),
        h("button", { type: "button", class: "grow", onclick: () => this.straightenSelected() }, "Straighten line")),
      h("fieldset", {}, h("legend", {}, "Magnifier"),
        h("label", { class: "check" }, loupe, "Show while dragging and on hover"),
        h("label", { class: "field" }, h("span", {}, "Zoom"), lz)),
      this.lineChooser(),
      h("fieldset", {}, h("legend", {}, "Handle"), ends),
      this.nudgePad("Nudges the selected handle"),
      (r.tilt = h("p", { class: "mono muted" })),
    );
  }

  private lineChooser(): HTMLElement {
    const col = (title: string, keys: readonly LineKey[]) => h("div", { class: "col" },
      h("div", { class: "eyebrow" }, title),
      ...keys.map((k) => {
        const inp = h("input", { type: "radio", name: "line", value: k }) as HTMLInputElement;
        inp.addEventListener("change", () => {
          this.view.selected = { key: k, idx: this.view.stage === "bulk" ? null : 0 };
          this.view.requestDraw();
          this.refreshPanels();
        });
        this.r[`line-${k}`] = inp;
        const side = k.split("_")[1];
        return h("label", { class: "check" }, inp, side[0].toUpperCase() + side.slice(1));
      }));
    return h("fieldset", {}, h("legend", {}, "Selected line"),
      h("div", { class: "two-col" }, col("Outer", OUTER), col("Inner", INNER)));
  }

  private nudgePad(hint: string): HTMLElement {
    const step = h("input", { type: "number", min: 0.05, max: 50, step: 0.05, value: this.view.nudgeStep, class: "num-input", "aria-label": "Nudge step in pixels" }) as HTMLInputElement;
    step.addEventListener("change", () => { this.view.nudgeStep = Math.max(0.01, Number(step.value) || 1); });
    const arrow = (label: string, dx: number, dy: number, cls: string) =>
      h("button", { type: "button", class: `sm ${cls}`, "aria-label": `Nudge ${cls}`, onclick: () => this.view.nudge(dx, dy) }, label);
    return h("fieldset", {}, h("legend", {}, "Nudge"),
      h("div", { class: "nudge" },
        h("div", { class: "pad" }, arrow("▲", 0, -1, "up"), arrow("◀", -1, 0, "left"), arrow("▶", 1, 0, "right"), arrow("▼", 0, 1, "down")),
        h("div", {},
          h("label", { class: "field" }, h("span", {}, "Step (px)"), step),
          h("p", { class: "muted small" }, `${hint}. Arrow keys work too: shift ×0.2, ctrl ×5.`))));
  }

  private buildAdvanced(): HTMLElement {
    const r = this.r;
    const scheme = h("select", { "aria-label": "Line colour" },
      ...SCHEME_NAMES.map((s) => h("option", { value: s }, s))) as HTMLSelectElement;
    scheme.value = this.scheme;
    r.swOuter = h("span", { class: "swatch" });
    r.swInner = h("span", { class: "swatch" });
    scheme.addEventListener("change", () => {
      this.scheme = scheme.value as SchemeName;
      this.view.scheme = this.scheme;
      this.view.requestDraw();
      this.refresh();
    });
    const width = h("input", { type: "range", min: 1, max: 4, step: 0.5, value: this.view.lineWidth, "aria-label": "Line width" }) as HTMLInputElement;
    width.addEventListener("input", () => { this.view.lineWidth = Number(width.value); this.view.requestDraw(); });

    const tint = h("select", { "aria-label": "Image tint" },
      ...TINT_MODES.map((m) => h("option", { value: m }, m))) as HTMLSelectElement;
    const strength = h("input", { type: "range", min: 0, max: 100, step: 1, value: this.view.tintStrength, "aria-label": "Tint strength" }) as HTMLInputElement;
    const pushTint = () => {
      clearTimeout(this.tintTimer);
      // Tinting a large photo takes a moment, so wait for the slider to settle.
      this.tintTimer = window.setTimeout(() => this.view.setTint(tint.value as TintMode, Number(strength.value)), 90);
    };
    tint.addEventListener("change", pushTint);
    strength.addEventListener("input", pushTint);

    const samples = h("input", { type: "checkbox" }) as HTMLInputElement;
    samples.checked = this.view.showSamples;
    samples.addEventListener("change", () => this.setSamplesVisible(samples.checked));
    r.samplesToggle = samples;

    return h("details", { class: "panel advanced" },
      h("summary", {}, "Advanced options"),
      h("label", { class: "field" }, h("span", {}, "Line colour"), h("div", { class: "row" }, scheme, r.swOuter, r.swInner)),
      h("label", { class: "field" }, h("span", {}, "Line width"), width),
      h("label", { class: "field" }, h("span", {}, "Image tint"), tint),
      h("label", { class: "field" }, h("span", {}, "Tint strength"), strength),
      h("label", { class: "check" }, samples, "Show sample scan lines"),
      h("p", { class: "muted small" }, "Colours and tint change what you see and export, never the measurement."));
  }

  private buildResults(): HTMLElement {
    const r = this.r;
    const n = h("select", { "aria-label": "Samples per axis" },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => h("option", { value: v }, String(v)))) as HTMLSelectElement;
    n.value = "3";
    n.addEventListener("change", () => {
      this.card.nSamples = Number(n.value);
      this.view.requestDraw();
      this.refresh();
    });
    r.nSamples = n;

    const axis = (key: "lr" | "tb", label: string) => {
      r[`${key}Val`] = h("div", { class: "big" }, "--");
      r[`${key}Bar`] = h("div", { class: "bar" }, h("div", { class: "fill" }), h("div", { class: "mid" }));
      r[`${key}Px`] = h("div", { class: "mono muted small" });
      return h("div", { class: "axis" }, h("div", { class: "eyebrow" }, label), r[`${key}Val`], r[`${key}Bar`], r[`${key}Px`]);
    };

    r.table = h("tbody");
    const grid = h("table", { class: "grades" },
      h("thead", {}, h("tr", {}, h("th"), ...GRADERS.map((g) => h("th", {}, g)))),
      (r.gradeBody = h("tbody")));

    return h("section", { class: "panel results", "aria-live": "polite" },
      h("div", { class: "results-head" },
        (r.centeringLabel = h("h2", {}, "Centering")),
        h("label", { class: "inline muted small" }, "samples/axis ", n)),
      h("div", { class: "axes" }, axis("lr", "Left / Right"), axis("tb", "Top / Bottom")),
      (r.warn = h("p", { class: "small warn" })),
      h("details", { class: "per-sample" },
        h("summary", {}, "Per-sample detail"),
        h("table", { class: "samples" },
          h("thead", {}, h("tr", {}, ...["#", "L px", "R px", "L %", "T px", "B px", "T %"].map((t) => h("th", {}, t)))),
          r.table)),
      h("div", { class: "results-head" }, h("h2", {}, "Grade ceiling"), (r.sidesLabel = h("span", { class: "muted small" }))),
      grid,
      (r.guide = h("p", { class: "muted small" })));
  }

  // ================================================================ refresh
  private scheduleResults(): void {
    if (this.resultsPending) return;
    this.resultsPending = requestAnimationFrame(() => {
      this.resultsPending = 0;
      this.refresh();
    });
  }

  refresh(): void {
    const r = this.r;
    const loaded = this.card.loaded;
    r.empty.hidden = this.session.anyLoaded && loaded;
    r.sidebar.classList.toggle("no-image", !loaded);
    if (!loaded && this.session.anyLoaded) {
      $("h1", r.empty).textContent = `Now the ${LABELS[this.session.active].toLowerCase()}`;
      $("p", r.empty).textContent = `Open an image of the ${LABELS[this.session.active].toLowerCase()} of the same card. `
        + "The final grade ceiling uses whichever side reads worse.";
    }
    for (const s of SIDE_ORDER) {
      const b = r[`side-${s}`];
      b.classList.toggle("active", s === this.session.active);
      b.classList.toggle("loaded", this.session.isLoaded(s));
      b.setAttribute("aria-pressed", String(s === this.session.active));
    }
    for (const s of STAGES) {
      const t = r[`tab-${s}`];
      t.classList.toggle("active", s === this.view.stage);
      t.setAttribute("aria-selected", String(s === this.view.stage));
      const n = r[`nav-${s}`];
      n.classList.toggle("active", s === this.view.stage && this.sheet !== "results");
      (n as HTMLButtonElement).disabled = !loaded;
    }
    r["nav-results"].classList.toggle("active", this.sheet === "results");
    this.root.dataset.stage = this.view.stage;
    const sc = schemeColors(this.scheme);
    r.swOuter.style.background = sc.outer;
    r.swInner.style.background = sc.inner;
    (r.undo as HTMLButtonElement).disabled = !loaded;
    (r.redo as HTMLButtonElement).disabled = !loaded;

    const c = this.card;
    r.fileInfo.textContent = loaded
      ? `${LABELS[this.session.active]} — ${c.name ?? "image"}  ${c.size[0]}×${c.size[1]}${c.flattened ? "  · flattened" : ""}`
      : "";
    this.refreshResults();
    this.refreshPanels();
    this.refreshViewReadouts();
  }

  private refreshResults(): void {
    const r = this.r;
    const c = this.card;
    const cols = schemeColors(this.scheme);
    r.centeringLabel.textContent = `Centering · ${LABELS[this.session.active]}`;
    (r.nSamples as HTMLSelectElement).value = String(c.nSamples);
    const m = c.loaded ? c.measure() : null;

    // The chip over the phone canvas: both axes and the final ceiling.
    r.chip.hidden = !c.loaded || this.view.stage === "perspective";
    if (!r.chip.hidden) {
      clear(r.chip);
      const finals = this.session.finalCeilings();
      r.chip.append(
        h("span", { class: "chip-axes" },
          h("span", {}, h("b", {}, "L/R "), m?.valid ? m.lr.text() : "--"),
          h("span", {}, h("b", {}, "T/B "), m?.valid ? m.tb.text() : "--")),
        h("span", { class: "chip-grades" },
          finals.length ? finals.map((f) => `${f.grader} ${f.grade}`).join(" · ") : "Tap for results"));
      r.chip.classList.toggle("caution", !!m?.valid && (m.crossed || Math.max(m.lr.spread, m.tb.spread) > 4));
    }

    const setAxis = (key: "lr" | "tb", colour: string) => {
      const a = m?.[key];
      r[`${key}Val`].textContent = m?.valid && a ? a.text() : "--";
      const fill = r[`${key}Bar`].firstElementChild as HTMLElement;
      fill.style.width = m?.valid && a ? `${Math.max(0, Math.min(100, a.lowPct))}%` : "0";
      fill.style.background = colour;
      r[`${key}Px`].textContent = m?.valid && a
        ? `${a.lowLabel} ${fmt(a.low)} px   ${a.highLabel} ${fmt(a.high)} px   spread ${fmt(a.spread)}%`
        : "";
    };
    setAxis("lr", cols.outer);
    setAxis("tb", cols.inner);

    clear(r.table);
    if (m?.valid) {
      const lr = m.lr.samplePcts();
      const tb = m.tb.samplePcts();
      for (let i = 0; i < Math.max(lr.length, tb.length); i++) {
        r.table.append(h("tr", {}, h("td", {}, String(i + 1)),
          h("td", {}, fmt(m.lr.lowMargins[i])), h("td", {}, fmt(m.lr.highMargins[i])), h("td", {}, fmt(lr[i])),
          h("td", {}, fmt(m.tb.lowMargins[i])), h("td", {}, fmt(m.tb.highMargins[i])), h("td", {}, fmt(tb[i]))));
      }
    }

    const warn = r.warn;
    warn.className = "small warn";
    if (!c.loaded) {
      warn.textContent = "";
    } else if (!m?.valid) {
      warn.textContent = "The lines do not form a valid frame.";
    } else if (m.crossed) {
      warn.textContent = `An outer line sits inside its inner line on the ${m.lr.crossed ? "left/right" : "top/bottom"} axis, so these percentages mean nothing yet.`;
      warn.classList.add("bad");
    } else {
      const spread = Math.max(m.lr.spread, m.tb.spread);
      if (spread > 4) {
        warn.textContent = `Samples disagree by ${fmt(spread)}%: the frames are not parallel. Use Precision to match the tilt.`;
        warn.classList.add("caution");
      } else if (spread > 1.5) {
        warn.textContent = `Slight sample spread (${fmt(spread)}%). Check the line angles in Precision.`;
      } else {
        warn.textContent = `Samples agree to within ${fmt(spread)}%.`;
      }
    }

    // Grade grid: a row per side and the final, which follows the worse side.
    const s = this.session;
    clear(r.gradeBody);
    const row = (label: string, cs: Map<string, { grade: string; descriptor: string }>, final = false) =>
      h("tr", { class: final ? "final" : "" }, h("th", {}, label),
        ...GRADERS.map((g) => {
          const v = cs.get(g);
          return h("td", { title: v?.descriptor ?? "" }, v ? v.grade : "--");
        }));
    for (const side of SIDE_ORDER) {
      r.gradeBody.append(row(LABELS[side], new Map(s.sideCeilings(side).map((c) => [c.grader, c]))));
    }
    const finals = s.finalCeilings();
    r.gradeBody.append(row("Final", new Map(finals.map((c) => [c.grader, c])), true));
    const loadedSides = s.loadedSides();
    r.sidesLabel.textContent = loadedSides.length === 2 ? "both sides" : loadedSides.length ? `${loadedSides[0]} only` : "";

    if (!finals.length) {
      r.guide.textContent = s.anyLoaded ? "Place the lines to get a grade ceiling." : "";
    } else {
      const parts = ["Centering only, and a ceiling rather than a prediction — corners, edges and surface are not assessed."];
      if (loadedSides.length < 2) {
        parts.push(`The ${loadedSides[0] === FRONT ? "back" : "front"} has not been measured and could pull this down.`);
      } else {
        const lim = s.limitingSide();
        if (lim) parts.push(`The ${lim} is holding it down.`);
      }
      r.guide.textContent = parts.join(" ");
    }
  }

  private refreshPanels(): void {
    const r = this.r;
    const v = this.view;
    const c = this.card;
    const bar = r.actions;
    const want = `${v.stage}|${c.loaded}|${c.flattened}|${this.mobile}`;
    if (bar && bar.dataset.state !== want) {
      bar.dataset.state = want;
      this.renderActions();
    }
    if (v.stage === "perspective" && r.perspState) {
      r.perspState.textContent = !c.loaded ? "No image" : c.flattened ? "Perspective corrected" : "Not corrected";
      r.perspState.classList.toggle("on", c.flattened);
      (r.flattenBtn as HTMLButtonElement).disabled = !c.loaded;
      (r.flattenBtn as HTMLButtonElement).textContent = c.flattened ? "Re-flatten" : "Flatten card";
      (r.unflattenBtn as HTMLButtonElement).disabled = !c.flattened;
    }
    for (const k of [...OUTER, ...INNER]) {
      const inp = r[`line-${k}`] as HTMLInputElement | undefined;
      if (inp?.isConnected) inp.checked = v.selected?.key === k;
    }
    if (v.stage === "precision") {
      const sel = v.selected;
      if (sel?.idx !== null && sel && r.end0?.isConnected) (r[`end${sel.idx}`] as HTMLInputElement).checked = true;
      if (r.tilt?.isConnected) {
        if (sel && c.lines) {
          const horiz = isHorizontal(sel.key);
          let tilt = c.lines[sel.key].angleDeg() - (horiz ? 0 : 90);
          tilt = ((((tilt + 90) % 180) + 180) % 180) - 90;
          r.tilt.textContent = `${PRETTY[sel.key]}: ${tilt >= 0 ? "+" : ""}${tilt.toFixed(2)}° from ${horiz ? "horizontal" : "vertical"}`;
        } else {
          r.tilt.textContent = "No line selected";
        }
      }
    }
  }

  private refreshViewReadouts(): void {
    const r = this.r;
    if (r.mAngle?.isConnected && this.card.loaded) r.mAngle.textContent = `${this.card.transform.angle.toFixed(1)}°`;
    if (this.view.stage !== "rotate" || !r.angle?.isConnected || !this.card.loaded) return;
    const t = this.card.transform;
    if (document.activeElement !== r.angle) (r.angle as HTMLInputElement).value = String(t.angle);
    if (document.activeElement !== r.angleNum) (r.angleNum as HTMLInputElement).value = t.angle.toFixed(2);
    if (document.activeElement !== r.zoom) (r.zoom as HTMLInputElement).value = String(zoomToSlider(t.scale));
    if (document.activeElement !== r.zoomNum) (r.zoomNum as HTMLInputElement).value = (t.scale * 100).toFixed(0);
  }

  status(msg: string): void {
    this.r.status.textContent = msg;
    if (this.mobile && msg) this.toast(msg);
  }

  /** A message that fades after a few seconds; the phone layout has no status bar. */
  private toast(msg: string, ms = 3200): void {
    const t = this.r.toast;
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), ms);
  }

  // ============================================================ phone layout
  private applyLayout(mobile: boolean): void {
    this.mobile = mobile;
    this.root.classList.toggle("mobile", mobile);
    const v = this.view;
    v.hud = !mobile;
    // Nearly edge to edge on a phone; the chip and action bar sit over the
    // card's surroundings, so frame the card in the space between them.
    v.homeFill = mobile ? 0.94 : 0.88;
    v.insets = mobile ? { top: 58, bottom: 76 } : { top: 0, bottom: 0 };
    (this.r.chooseBtn as HTMLButtonElement).textContent = mobile ? "Choose a photo" : "Open image";
    this.closeSheet();
    if (this.card.loaded) v.home();
    this.renderActions();
    v.requestDraw();
  }

  private toggleSheet(kind: Sheet): void {
    if (this.sheet === kind) this.closeSheet();
    else this.openSheet(kind);
  }

  private openSheet(kind: Sheet): void {
    if (!this.card.loaded && kind === "options") return;
    this.sheet = kind;
    this.root.dataset.sheet = kind;
    this.r.sheetTitle.textContent = kind === "results" ? "Results" : `${STAGE_TITLES[this.view.stage]} options`;
    this.r.sidebar.scrollTop = 0;
    this.refresh();
  }

  closeSheet(): void {
    if (!this.sheet && !this.root.dataset.sheet) return;
    this.sheet = null;
    delete this.root.dataset.sheet;
    this.refresh();
  }

  private navTo(stage: Stage): void {
    this.closeSheet();
    if (stage === this.view.stage) return;
    this.setStage(stage);
    if (this.mobile && this.card.loaded) this.toast(stageHints(true)[stage], 2600);
  }

  /** The stage's main actions, floating above the bottom navigation. */
  private renderActions(): void {
    const bar = this.r.actions;
    if (!bar) return;
    clear(bar);
    const c = this.card;
    bar.hidden = !this.mobile || !c.loaded;
    if (bar.hidden) return;
    const act = (label: string, fn: () => void, cls = "") =>
      h("button", { type: "button", class: cls, onclick: () => fn() }, label);
    const options = act("⚙", () => this.openSheet("options"), "icon");
    options.setAttribute("aria-label", "More options");

    switch (this.view.stage) {
      case "perspective":
        bar.append(
          c.flattened ? act("Remove", () => this.removeFlatten()) : act("Skip", () => this.skipDeskew()),
          act("Reset", () => { this.view.beginPerspective(); this.view.requestDraw(); }),
          act(c.flattened ? "Re-flatten" : "Flatten ✓", () => this.applyFlatten(), "primary grow"),
          options);
        break;
      case "rotate": {
        const angle = h("span", { class: "readout" });
        this.r.mAngle = angle;
        bar.append(
          act("−0.1°", () => this.setAngle(c.transform.angle - 0.1)),
          angle,
          act("+0.1°", () => this.setAngle(c.transform.angle + 0.1)),
          act("Home", () => this.view.home(), "grow"),
          options);
        this.refreshViewReadouts();
        break;
      }
      case "bulk":
        bar.append(
          act("Auto-detect", () => this.autoDetect(), "primary grow"),
          act("Straighten", () => this.straightenAll()),
          options);
        break;
      case "precision":
        bar.append(
          act("Reset handles", () => this.placeHandles(), "grow"),
          act("Home", () => this.view.home()),
          options);
        break;
    }
  }

  private skipDeskew(): void {
    this.setStage("bulk");
    this.view.home();
    this.toast("No deskew. Fine for scans; for photos, flattening first is more accurate.");
  }

  async takePhoto(): Promise<void> {
    const f = await pickFile("image/*", "environment");
    if (f) await this.loadInto(this.session.active, f, f.name || "photo.jpg");
  }

  private async busy<T>(label: string, work: () => T | Promise<T>): Promise<T> {
    this.r.busyText.textContent = label;
    this.r.busy.hidden = false;
    await nextFrame(); // let the overlay paint before the heavy work
    try {
      return await work();
    } finally {
      this.r.busy.hidden = true;
    }
  }

  // ================================================================ actions
  setStage(stage: Stage): void {
    this.view.setStage(stage);
    this.renderStagePanel();
    this.refresh();
  }

  setSide(side: Side): void {
    if (!this.session.setActive(side)) return;
    this.sheet = null;
    delete this.root.dataset.sheet;
    this.view.setModel(this.session.card);
    this.renderStagePanel();
    this.refresh();
    this.status(`Now working on the ${LABELS[side].toLowerCase()}.`);
  }

  private setAngle(a: number): void {
    if (!this.card.loaded || !Number.isFinite(a)) return;
    const t = this.card.transform;
    const [w, hgt] = this.view.viewSize;
    // Pivot about the middle of the view so what you are looking at stays put.
    t.rotateAbout([w / 2, hgt / 2], a - t.angle);
    this.view.requestDraw();
    this.refreshViewReadouts();
  }

  private setZoom(scale: number): void {
    if (!this.card.loaded || !Number.isFinite(scale) || scale <= 0) return;
    const t = this.card.transform;
    const [w, hgt] = this.view.viewSize;
    t.zoomAbout([w / 2, hgt / 2], scale / t.scale);
    this.view.requestDraw();
    this.refreshViewReadouts();
  }

  private setSamplesVisible(on: boolean): void {
    this.view.showSamples = on;
    (this.r.samplesToggle as HTMLInputElement).checked = on;
    this.view.requestDraw();
  }

  async openImage(file?: File | null): Promise<void> {
    const f = file ?? (await pickFile(IMAGE_ACCEPT));
    if (!f) return;
    await this.loadInto(this.session.active, f, f.name);
  }

  async openSample(): Promise<void> {
    try {
      const res = await fetch(SAMPLE_URL);
      await this.loadInto(this.session.active, await res.blob(), "sample_offset.png");
    } catch (e) {
      this.error("Could not load the sample card", e);
    }
  }

  private async loadInto(side: Side, blob: Blob, name: string): Promise<void> {
    try {
      await this.busy("Opening image…", async () => {
        const { raster, resizedFrom } = await decodeImage(blob);
        const card = this.session.cards[side];
        card.load(raster, name, this.view.viewSize, true);
        this.view.setModel(this.session.card);
        this.view.home();
        const other = LABELS[side === FRONT ? BACK : FRONT].toLowerCase();
        const scaled = resizedFrom ? ` Scaled from ${resizedFrom[0]}×${resizedFrom[1]} to fit the browser.` : "";
        this.status(this.session.bothLoaded
          ? `Both sides loaded. The final ceiling uses whichever reads worse.${scaled}`
          : `Loaded the ${LABELS[side].toLowerCase()}. Place the lines, then switch to the ${other}.${scaled}`);
      });
      if (this.mobile) {
        // A phone photo is almost always skewed: start by squaring it up.
        this.closeSheet();
        if (this.view.stage === "perspective") this.view.beginPerspective();
        else this.setStage("perspective");
        this.view.home();
        this.toast("Drag the corners onto the card's corners, then Flatten.", 4000);
      } else if (this.view.stage === "perspective") {
        this.view.beginPerspective();
      }
      this.renderStagePanel();
      this.refresh();
    } catch (e) {
      this.error("Could not open that image", e);
    }
  }

  private applyFlatten(): void {
    const c = this.card;
    const corners = this.view.corners;
    if (!c.loaded || !corners) return;
    const first = !c.flattened;
    void this.busy("Flattening…", () => {
      if (!c.setFlatten(corners, this.view.viewSize)) {
        this.status("Those corners do not outline a card: keep them in order, clockwise from top-left.");
        return;
      }
      // First flatten: detection works far better on the flattened card.
      // Re-flatten: the existing lines were carried through, keep them.
      if (first) c.resetLines(true);
      this.setStage("bulk");
      this.view.home();
      this.status(first ? "Card flattened. Lines auto-detected on the corrected image." : "Re-flattened; your lines were carried across.");
    });
  }

  private removeFlatten(): void {
    const c = this.card;
    if (!c.flattened) return;
    void this.busy("Restoring…", () => {
      c.setFlatten(null, this.view.viewSize);
      this.view.beginPerspective();
      this.view.requestDraw();
      this.refresh();
      this.status("Perspective correction removed; lines carried back to the original image.");
    });
  }

  private edit(fn: () => void): void {
    if (!this.card.loaded) return;
    this.card.snapshot();
    fn();
    this.view.requestDraw();
    this.refresh();
  }

  autoDetect(): void {
    if (!this.card.loaded) return;
    void this.busy("Detecting…", () => this.edit(() => this.card.resetLines(true)))
      .then(() => this.status("Auto-detected both frames. Correct them by hand."));
  }

  resetLines(): void { this.edit(() => this.card.resetLines(false)); }
  private straightenAll(): void { this.edit(() => this.card.straighten()); }
  private placeHandles(): void { this.edit(() => this.card.placeHandles()); }
  private straightenSelected(): void {
    const sel = this.view.selected;
    if (sel) this.edit(() => this.card.straighten([sel.key]));
  }

  undo(): void {
    if (this.card.undo()) { this.view.requestDraw(); this.refresh(); this.status("Undone."); }
  }

  redo(): void {
    if (this.card.redo()) { this.view.requestDraw(); this.refresh(); this.status("Redone."); }
  }

  private baseName(): string {
    for (const s of SIDE_ORDER) {
      const n = this.session.cards[s].name;
      if (this.session.isLoaded(s) && n) return n.replace(/\.[^.]+$/, "");
    }
    return "card";
  }

  private requireImage(): boolean {
    if (this.session.anyLoaded) return true;
    this.status("Open a card image first.");
    return false;
  }

  async exportImage(): Promise<void> {
    if (!this.requireImage()) return;
    try {
      const canvas = await this.busy("Rendering…", () => renderSession(this.session, {
        scheme: this.scheme, tintMode: this.view.tintMode,
        tintStrength: this.view.tintStrength, showSamples: this.view.showSamples,
      }));
      if (!canvas) return;
      const res = await saveFile(await canvasToBlob(canvas), {
        filename: `${this.baseName()}_centering.png`, mime: "image/png",
        filterName: "PNG image", extensions: ["png"],
      });
      this.reportSaved(res, "Overlay image", this.session.bothLoaded ? "" : " (one side only)");
    } catch (e) {
      this.error("Could not export the image", e);
    }
  }

  async exportReport(): Promise<void> {
    if (!this.requireImage()) return;
    try {
      const blob = new Blob([JSON.stringify(this.session.report(), null, 2)], { type: "application/json" });
      const res = await saveFile(blob, {
        filename: `${this.baseName()}_centering.json`, mime: "application/json",
        filterName: "JSON report", extensions: ["json"],
      });
      this.reportSaved(res, "Report");
    } catch (e) {
      this.error("Could not export the report", e);
    }
  }

  async saveSession(): Promise<void> {
    if (!this.requireImage()) return;
    try {
      const saved = await this.busy("Saving…", () => this.session.save(rasterToDataURL));
      const blob = new Blob([JSON.stringify(saved)], { type: "application/json" });
      const res = await saveFile(blob, {
        filename: `${this.baseName()}.cgs.json`, mime: "application/json",
        filterName: "Grading session", extensions: ["json"],
      });
      this.reportSaved(res, "Session");
    } catch (e) {
      this.error("Could not save the session", e);
    }
  }

  async openSession(file?: File | null): Promise<void> {
    const f = file ?? (await pickFile(".json,application/json"));
    if (!f) return;
    try {
      const saved = JSON.parse(await f.text()) as SavedSession;
      const session = await this.busy("Opening session…", () =>
        Session.open(saved, async (url) => (await decodeImage(url)).raster, this.view.viewSize));
      this.session = session;
      this.view.setModel(session.card);
      this.renderStagePanel();
      this.refresh();
      this.status(`Session opened: ${session.loadedSides().join(" and ")}.`);
    } catch (e) {
      this.error("Could not open that session", e);
    }
  }

  private reportSaved(res: string, what: string, extra = ""): void {
    const msg: Record<string, string> = {
      saved: `${what} saved${extra}.`,
      downloaded: `${what} downloaded${extra}.`,
      shared: `${what} shared${extra}.`,
      cancelled: "Cancelled.",
    };
    this.status(msg[res] ?? "");
  }

  private error(what: string, e: unknown): void {
    console.error(e);
    this.status(`${what}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ================================================================= dialogs
  private dialog(title: string, body: HTMLElement): void {
    const dlg = h("dialog", { class: "dialog" },
      h("form", { method: "dialog" },
        h("h2", {}, title), body,
        h("div", { class: "row end" }, h("button", { class: "primary", value: "close" }, "Close"))));
    dlg.addEventListener("close", () => dlg.remove());
    document.body.append(dlg);
    (dlg as HTMLDialogElement).showModal();
  }

  private showShortcuts(): void {
    const rows: Array<[string, string]> = [
      ["1 – 4", "Switch stage"], ["Ctrl+O", "Open image"], ["Ctrl+S", "Save session"],
      ["Ctrl+E", "Export overlay image"], ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"],
      ["H", "Home: centre the card"], ["F", "Fit the whole scan"], ["A", "Auto-detect"],
      ["S", "Show or hide sample lines"], ["Arrows", "Nudge (shift ×0.2, ctrl ×5)"],
      ["Wheel / pinch", "Zoom"], ["Alt+wheel", "Fine rotate (Rotation stage)"],
    ];
    this.dialog("Keyboard shortcuts", h("table", { class: "shortcuts" },
      ...rows.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d)))));
  }

  private showAbout(): void {
    this.dialog("Card Centering Grader", h("div", {},
      h("p", {}, `Version ${__APP_VERSION__}. Manual centering measurement for trading cards.`),
      h("p", { class: "muted" }, "Grade ceilings are centering only — corners, edges and surface are not "
        + "assessed — and use the commonly published tolerances. Not affiliated with PSA, Beckett or CGC."),
      h("p", { class: "muted" }, "Everything runs on this device; images are never uploaded."),
      h("p", {}, h("a", { href: "https://github.com/william-geary/card-centering-grader", target: "_blank", rel: "noopener" }, "Source code and downloads"))));
  }

  // ============================================================== keyboard
  private bindKeys(): void {
    addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod) {
        const actions: Record<string, () => void> = {
          o: () => void this.openImage(),
          s: () => void this.saveSession(),
          e: () => void this.exportImage(),
          z: () => (e.shiftKey ? this.redo() : this.undo()),
          y: () => this.redo(),
        };
        if (actions[key] && !(key === "z" && typingInField())) {
          e.preventDefault();
          actions[key]();
        } else if (key.startsWith("arrow") && !typingInField()) {
          e.preventDefault();
          this.arrow(e, 5);
        }
        return;
      }
      if (typingInField() || e.altKey) return;
      if (key.startsWith("arrow")) {
        e.preventDefault();
        this.arrow(e, e.shiftKey ? 0.2 : 1);
        return;
      }
      const idx = ["1", "2", "3", "4"].indexOf(e.key);
      if (idx >= 0) return this.setStage(STAGES[idx]);
      const simple: Record<string, () => void> = {
        h: () => this.view.home(),
        f: () => this.view.fitScan(),
        a: () => this.autoDetect(),
        s: () => this.setSamplesVisible(!this.view.showSamples),
        "?": () => this.showShortcuts(),
      };
      simple[e.key === "?" ? "?" : key]?.();
    });
  }

  private arrow(e: KeyboardEvent, factor: number): void {
    const d: Record<string, [number, number]> = {
      arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1],
    };
    const v = d[e.key.toLowerCase()];
    if (v && this.view.nudge(v[0], v[1], factor)) this.refresh();
  }

  private bindDrop(): void {
    let depth = 0;
    const show = (on: boolean) => (this.r.drop.hidden = !on);
    addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { depth++; show(true); } });
    addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
    addEventListener("dragover", (e) => e.preventDefault());
    addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      show(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      if (f.name.endsWith(".json") || f.type === "application/json") void this.openSession(f);
      else void this.openImage(f);
    });
  }
}

// The zoom slider is logarithmic: 2% to 4000%.
const ZMIN = Math.log(0.02);
const ZMAX = Math.log(40);
const sliderToZoom = (v: number) => Math.exp(ZMIN + v * (ZMAX - ZMIN));
const zoomToSlider = (s: number) => (Math.log(s) - ZMIN) / (ZMAX - ZMIN);
