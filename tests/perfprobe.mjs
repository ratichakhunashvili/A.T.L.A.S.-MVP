import { BASE, launch, outputDir } from "./harness.mjs";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launch();
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ["geolocation"]);
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 41.6949, longitude: 44.8051, accuracy: 12 });
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
await page.waitForSelector(".user-dot", { timeout: 25000 });
await wait(8000);

// Tag the live map and the model source so identity can be compared after moves.
const before = await page.evaluate(() => {
  window.__mapId = window.__mapId ?? Symbol("map");
  window.__seen = window.__map;
  return {
    models: window.__map.querySourceFeatures("app-models").length,
    markerNodes: document.querySelectorAll(".marker-host").length,
    hasModelLayer: Boolean(window.__map.getLayer("app-models")),
    styleLoaded: window.__map.isStyleLoaded(),
  };
});

// Walk the guest 6 times.
for (const [lat, lng] of [[41.6951,44.8053],[41.6953,44.8055],[41.6955,44.8057],[41.6957,44.8059],[41.6959,44.8061],[41.6961,44.8063]]) {
  await page.setGeolocation({ latitude: lat, longitude: lng, accuracy: 12 });
  await wait(2500);
}
await wait(3000);

const after = await page.evaluate(() => ({
  sameMapInstance: window.__seen === window.__map,
  models: window.__map.querySourceFeatures("app-models").length,
  markerNodes: document.querySelectorAll(".marker-host").length,
  hasModelLayer: Boolean(window.__map.getLayer("app-models")),
  styleLoaded: window.__map.isStyleLoaded(),
  dot: Boolean(document.querySelector(".user-dot")),
}));

console.log("before:", JSON.stringify(before));
console.log("after :", JSON.stringify(after));
const ok =
  after.sameMapInstance &&
  after.models === before.models &&
  after.markerNodes === before.markerNodes &&
  after.hasModelLayer && after.styleLoaded && after.dot;
console.log(ok ? "PASS  six position updates left the map, models and markers untouched"
               : "FAIL  a position update churned the map");
await browser.close();
