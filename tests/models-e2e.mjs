/**
 * End-to-end verification of the 3D model system.
 *
 *  1. An administrator adds a model through the UI only — upload a real GLB,
 *     name it, place it, publish it. No source file is touched.
 *  2. The public map picks it up from the registry.
 *  3. The model stays anchored to its coordinate under pan, zoom, rotate and
 *     pitch — proved by projecting the coordinate and hit-testing the rendered
 *     3D geometry there, not by looking at a screenshot.
 *  4. It is drawn inside the map's WebGL scene, not as a DOM overlay.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("models");
const GLB = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "Duck.glb");

// Somewhere unmistakable and empty: the park block east of the hotel.
const TARGET = { lng: 44.8051, lat: 41.6949 };

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
page.on("response", (r) => { if (r.status() >= 400) problems.push(`http ${r.status()} ${r.url().slice(0, 150)}`); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// The location card now offers itself a few seconds in and sits over the lower
// map. Dismiss it the way a guest would before testing anything underneath.
async function dismissLocationCard(page) {
  await page.evaluate(() => {
    const notNow = Array.from(document.querySelectorAll(".location-prompt__actions button"))
      .find((b) => b.textContent.trim() === "Not now");
    notNow?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
}

const results = [];
const check = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

/** Writes a value into a React-controlled input the way a user would. */
async function setInput(selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      const proto = el instanceof HTMLInputElement ? HTMLInputElement : HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    String(value),
  );
}

/* ------------------------------------------------------------------ */
/* 1. Add a model through the admin UI                                 */
/* ------------------------------------------------------------------ */

await page.goto(`${BASE}#/admin`, { waitUntil: "networkidle2" });
// The console opens on Hotels now; select the 3D models section first.
await page.waitForSelector(".admin__sections", { timeout: 40000 });
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".admin__section"))
    .find((b) => /3D models/.test(b.textContent))?.click();
});
await page.waitForSelector(".model-card, .empty-state", { timeout: 20000 });

const before = await page.$$eval(".model-card", (c) => c.length);

await page.click(".btn--accent");                       // "Add 3D model"
await page.waitForSelector("#model-name", { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await wait(6000);

await setInput("#model-name", "Courtyard Duck");
const fileInput = await page.$('input[type="file"]');
await fileInput.uploadFile(GLB);

// Validation → upload → processing → ready, all real states.
await page.waitForFunction(
  () => document.querySelector(".upload-status")?.dataset.tone === "ready",
  { timeout: 30000 },
);
check("uploading a real GLB reaches the ready state", true);

await setInput("#model-lng", TARGET.lng);
await setInput("#model-lat", TARGET.lat);
await setInput("#slider-Scale", 26);
await setInput("#slider-Altitude", 0);

// Publish, then save.
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".segmented button"));
  buttons.find((b) => b.textContent.trim() === "Published")?.click();
});
await wait(500);

await page.evaluate(() => {
  const save = Array.from(document.querySelectorAll(".editor__foot .btn"))
    .find((b) => b.textContent.trim() === "Save model");
  save?.click();
});
await wait(1500);
await page.screenshot({ path: `${OUT}/01-editor-after-save.png` });

await page.evaluate(() => {
  const done = Array.from(document.querySelectorAll(".editor__foot .btn"))
    .find((b) => b.textContent.trim() === "Done");
  done?.click();
});
await page.waitForSelector(".model-card", { timeout: 15000 });
await wait(800);

const after = await page.$$eval(".model-card", (c) => c.length);
check("the admin created a new record without touching source", after === before + 1, `${before} → ${after}`);
await page.screenshot({ path: `${OUT}/02-library.png` });

/* ------------------------------------------------------------------ */
/* 2. The public map loads it from the registry                        */
/* ------------------------------------------------------------------ */

await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await wait(6000);
await dismissLocationCard(page);

const newId = await page.evaluate(async () => {
  const raw = window.localStorage.getItem("hospitality-map.models.v1");
  const records = JSON.parse(raw ?? "[]");
  return records.find((m) => m.name === "Courtyard Duck")?.id ?? null;
});
check("the new record is in the registry the public map reads", Boolean(newId), String(newId));

/* ------------------------------------------------------------------ */
/* 3. Geographic anchoring under pan / zoom / rotate / pitch           */
/* ------------------------------------------------------------------ */

const anchoring = await page.evaluate(
  async (target, id) => {
    const map = window.__map;

    const settle = async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (!map.isMoving() && map.areTilesLoaded() && map.loaded()) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      await new Promise((r) => setTimeout(r, 2500));
    };

    // Each camera is deliberately off-centre from the model by a different
    // amount, so the model lands on a different pixel every time. If it were
    // screen-anchored instead of geo-anchored, these would not all hit.
    const states = [
      { name: "base", center: [target.lng + 0.0004, target.lat - 0.0003], zoom: 17.2, pitch: 55, bearing: 0 },
      { name: "rotated 140°", center: [target.lng - 0.0006, target.lat + 0.0002], zoom: 17.2, pitch: 55, bearing: 140 },
      { name: "pitched 70°", center: [target.lng + 0.0002, target.lat - 0.0008], zoom: 17.2, pitch: 70, bearing: 140 },
      { name: "zoomed 18.6", center: [target.lng - 0.0003, target.lat - 0.0002], zoom: 18.6, pitch: 45, bearing: -70 },
      { name: "panned off-centre", center: [target.lng + 0.0022, target.lat - 0.0014], zoom: 17.2, pitch: 55, bearing: 25 },
      { name: "zoomed out 15.5", center: [target.lng + 0.0012, target.lat + 0.0009], zoom: 15.5, pitch: 50, bearing: 0 },
    ];

    const out = [];
    for (const state of states) {
      map.jumpTo(state);
      await settle();

      // The asset may still be streaming on the first camera, which is not the
      // same thing as the model not being anchored — retry before judging.
      let p = map.project([target.lng, target.lat]);
      let hits = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        p = map.project([target.lng, target.lat]);
        const box = [
          [p.x - 55, p.y - 150],
          [p.x + 55, p.y + 15],
        ];
        hits = map.queryRenderedFeatures(box, { layers: ["app-models"] });
        if (hits.some((f) => f.properties?.id === id)) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      out.push({
        state: state.name,
        screen: { x: Math.round(p.x), y: Math.round(p.y) },
        hit: hits.some((f) => f.properties?.id === id),
        ids: [...new Set(hits.map((f) => f.properties?.id))],
      });
    }
    return out;
  },
  TARGET,
  newId,
);

for (const row of anchoring) {
  check(`anchored: ${row.state}`, row.hit, `screen ${row.screen.x},${row.screen.y}`);
}

// The screen position must actually differ between camera states — otherwise
// "it is always under the same pixel" would pass for the wrong reason.
const distinct = new Set(anchoring.map((r) => `${r.screen.x},${r.screen.y}`)).size;
check("the model lands on a different pixel in each camera", distinct >= 5, `${distinct} distinct positions of ${anchoring.length}`);

/* ------------------------------------------------------------------ */
/* 4. Drawn in the scene, not in the DOM                               */
/* ------------------------------------------------------------------ */

const integration = await page.evaluate(() => {
  const map = window.__map;
  const layer = map.getLayer("app-models");
  return {
    layerType: layer?.type ?? null,
    canvases: document.querySelectorAll("canvas").length,
    mapCanvases: document.querySelectorAll(".map-canvas canvas").length,
    anchorElements: document.querySelectorAll(".model-anchor").length,
    castsShadows: map.getPaintProperty("app-models", "model-cast-shadows"),
    elevationRef: map.getPaintProperty("app-models", "model-elevation-reference"),
    terrain: Boolean(map.getTerrain()),
  };
});

check("rendered by a native Mapbox model layer", integration.layerType === "model", String(integration.layerType));
check("only the map's own canvas exists — no second 3D canvas", integration.canvases === 1 && integration.mapCanvases === 1, `${integration.canvases} canvas element(s)`);
check("the model casts shadows into the scene", integration.castsShadows === true);
check("altitude is referenced to the terrain", integration.elevationRef === "ground", String(integration.elevationRef));

/* ------------------------------------------------------------------ */
/* 5. Tapping the 3D geometry selects it                               */
/* ------------------------------------------------------------------ */

await page.evaluate((target) => {
  window.__map.jumpTo({ center: [target.lng, target.lat], zoom: 17.6, pitch: 55, bearing: 20 });
}, TARGET);
await wait(9000);
await page.screenshot({ path: `${OUT}/03-model-in-scene.png` });

const tapped = await page.evaluate(async (target, id) => {
  const map = window.__map;
  const p = map.project([target.lng, target.lat]);
  // Aim at the body of the model, above its ground point.
  const hits = map.queryRenderedFeatures([[p.x - 40, p.y - 90], [p.x + 40, p.y - 5]], { layers: ["app-models"] });
  const hit = hits.find((f) => f.properties?.id === id);
  if (!hit) return { clicked: false };

  const canvas = map.getCanvas();
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + p.x;
  const cy = rect.top + p.y - 45;
  for (const type of ["mousedown", "mouseup", "click"]) {
    canvas.dispatchEvent(new MouseEvent(type, { clientX: cx, clientY: cy, bubbles: true, button: 0 }));
  }
  await new Promise((r) => setTimeout(r, 1500));
  return { clicked: true };
}, TARGET, newId);

await wait(1200);
const sheet = await page.$$eval('[role="dialog"]', (d) => d.map((x) => x.getAttribute("aria-label")));
check("tapping the 3D model opens its card", tapped.clicked && sheet.includes("Courtyard Duck"), JSON.stringify(sheet));
await page.screenshot({ path: `${OUT}/04-model-selected.png` });

/* ------------------------------------------------------------------ */

console.log(results.join("\n"));
console.log("\nanchoring detail:", JSON.stringify(anchoring, null, 1));
console.log("integration:", JSON.stringify(integration));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
console.log("console problems:", problems.length ? problems.join("\n") : "(none)");

await browser.close();
