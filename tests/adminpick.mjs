/** Picking a location in the admin editor, and the admin's own position. */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("admin");

const ME = { latitude: 41.6975, longitude: 44.8005, accuracy: 15 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
const problems = [];

const browser = await launch();
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ["geolocation"]);

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 140)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 140)}`); });
await page.setGeolocation(ME);

await page.goto(`${BASE}#/admin`, { waitUntil: "domcontentloaded", timeout: 90000 });
// The console opens on Hotels now; select the 3D models section first.
await page.waitForSelector(".admin__sections", { timeout: 40000 });
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".admin__section"))
    .find((b) => /3D models/.test(b.textContent))?.click();
});
await page.waitForSelector(".model-card, .empty-state", { timeout: 30000 });
await page.click(".btn--accent"); // Add 3D model
await page.waitForSelector("#model-lat", { timeout: 30000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
await wait(12000);

const coords = () =>
  page.evaluate(() => ({
    lat: Number(document.querySelector("#model-lat").value),
    lng: Number(document.querySelector("#model-lng").value),
  }));

/* -- The aiming affordances exist --------------------------------------- */
const chrome = await page.evaluate(() => ({
  crosshair: Boolean(document.querySelector(".editor__crosshair")),
  placeHere: Array.from(document.querySelectorAll(".editor__tools button")).map((b) => b.textContent.trim()),
  refPlaces: document.querySelectorAll(".editor-ref:not(.editor-ref--model)").length,
  refModels: document.querySelectorAll(".editor-ref--model").length,
  hint: document.querySelector(".editor__hint")?.textContent?.trim() ?? "",
}));
check("a centre crosshair is shown to aim with", chrome.crosshair);
check("the map carries Place here and My location", chrome.placeHere.length === 2, JSON.stringify(chrome.placeHere));
check("nearby places are drawn for context", chrome.refPlaces > 0, `${chrome.refPlaces} places`);
check("existing models are drawn for context", chrome.refModels > 0, `${chrome.refModels} models`);
check("the hint explains the new gesture", /Place here/i.test(chrome.hint), chrome.hint);

/* -- Place here drops the model at the map centre ------------------------ */
await page.evaluate(() => window.__map.jumpTo({ center: [44.8090, 41.6880], zoom: 17 }));
await wait(4000);
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".editor__tools button"))
    .find((b) => /Place here/i.test(b.textContent))?.click();
});
await wait(1200);
const afterPlace = await coords();
check(
  "Place here uses the map centre",
  Math.abs(afterPlace.lat - 41.688) < 0.0006 && Math.abs(afterPlace.lng - 44.809) < 0.0006,
  `${afterPlace.lat}, ${afterPlace.lng}`,
);

/* -- The admin's own position -------------------------------------------- */
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".editor__tools button"))
    .find((b) => /My location/i.test(b.textContent))?.click();
});
const gotDot = await page
  .waitForSelector(".user-dot", { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
check("the admin's live position appears in the editor", gotDot);
await wait(5000);

const centred = await page.evaluate(() => {
  const c = window.__map.getCenter();
  return { lat: c.lat, lng: c.lng };
});
check(
  "My location takes the camera there",
  Math.abs(centred.lat - ME.latitude) < 0.002 && Math.abs(centred.lng - ME.longitude) < 0.002,
  `${centred.lat.toFixed(5)}, ${centred.lng.toFixed(5)}`,
);
check(
  "the position is not confused with the model",
  Math.abs(afterPlace.lat - ME.latitude) > 0.005,
  "model stayed where it was placed",
);
await page.screenshot({ path: `${OUT}/01-editor.png` });

/* -- Put it where I am --------------------------------------------------- */
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".editor__place-actions button"))
    .find((b) => /where I am/i.test(b.textContent))?.click();
});
await wait(1500);
const atMe = await coords();
check(
  "Put it where I am uses the real fix",
  Math.abs(atMe.lat - ME.latitude) < 0.0002 && Math.abs(atMe.lng - ME.longitude) < 0.0002,
  `${atMe.lat}, ${atMe.lng}`,
);

/* -- Pasting coordinates -------------------------------------------------- */
await page.evaluate(() => {
  const input = Array.from(document.querySelectorAll(".input")).find(
    (i) => i.placeholder === "41.6949, 44.8051",
  );
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "41.7151, 44.8271");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.evaluate(() => {
  document.querySelector('button[aria-label="Apply pasted coordinates"]')?.click();
});
await wait(1200);
const pasted = await coords();
check(
  "pasted coordinates are applied latitude-first",
  Math.abs(pasted.lat - 41.7151) < 0.0002 && Math.abs(pasted.lng - 44.8271) < 0.0002,
  `${pasted.lat}, ${pasted.lng}`,
);

// And nonsense is refused rather than silently accepted.
await page.evaluate(() => {
  const input = Array.from(document.querySelectorAll(".input")).find(
    (i) => i.placeholder === "41.6949, 44.8051",
  );
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, "somewhere near the river");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.evaluate(() => {
  document.querySelector('button[aria-label="Apply pasted coordinates"]')?.click();
});
await wait(900);
const refused = await page.evaluate(() => ({
  error: document.querySelector(".field__error")?.textContent ?? null,
  lat: Number(document.querySelector("#model-lat").value),
}));
check("unparseable input is refused inline", Boolean(refused.error), String(refused.error).slice(0, 60));
check("and leaves the coordinates alone", Math.abs(refused.lat - 41.7151) < 0.0002, String(refused.lat));

/* -- Clicking the map still places, through the reference markers -------- */
await page.evaluate(() => window.__map.jumpTo({ center: [44.7990, 41.6960], zoom: 16 }));
await wait(3500);
const box = await page.evaluate(() => {
  const c = document.querySelector(".map-canvas canvas").getBoundingClientRect();
  return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
});
await page.mouse.click(box.x + 40, box.y + 30);
await wait(1500);
const clicked = await coords();
check(
  "clicking the map still places the model",
  Math.abs(clicked.lat - 41.7151) > 0.0005,
  `${clicked.lat}, ${clicked.lng}`,
);

await page.screenshot({ path: `${OUT}/02-after.png` });
console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 5).join("\n") : "(none)");
await browser.close();
