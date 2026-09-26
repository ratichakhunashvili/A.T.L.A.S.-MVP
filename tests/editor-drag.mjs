import { BASE, launch, outputDir } from "./harness.mjs";

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);

// Seed a published model directly in storage, then open it in the editor.
await page.goto(BASE, { waitUntil: "networkidle2" });
await wait(5000);
await page.evaluate(() => {
  const record = {
    id: "drag-target", name: "Drag Target",
    modelUrl: "https://docs.mapbox.com/mapbox-gl-js/assets/tower.glb",
    longitude: 44.8051, latitude: 41.6949, altitude: 0, scale: 0.4,
    rotationX: 0, rotationY: 0, rotationZ: 0,
    visible: true, status: "published", category: "landmark",
    description: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  const raw = JSON.parse(localStorage.getItem("hospitality-map.models.v1") ?? "[]");
  localStorage.setItem("hospitality-map.models.v1", JSON.stringify([record, ...raw]));
});

await page.goto(`${BASE}#/admin`, { waitUntil: "networkidle2" });
await page.reload({ waitUntil: "networkidle2" });
// The console opens on Hotels, and a reload puts it back there — so select
// the 3D models section after the reload, not before.
await page.waitForSelector(".admin__sections", { timeout: 40000 });
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".admin__section"))
    .find((b) => /3D models/.test(b.textContent))?.click();
});
await page.waitForSelector(".model-card", { timeout: 20000 });
await wait(1500);
console.log("cards:", await page.$$eval(".model-card__name", (n) => n.map((x) => x.textContent)));
await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll(".model-card"))
    .find((c) => c.textContent.includes("Drag Target"));
  card?.querySelector(".btn").click();
});
await page.waitForSelector("#model-lat", { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await wait(16000);

const before = await page.evaluate(() => ({
  lat: document.querySelector("#model-lat").value,
  lng: document.querySelector("#model-lng").value,
}));

// Find the model on screen and drag its body.
const spot = await page.evaluate(() => {
  const map = window.__map;
  map.jumpTo({ center: [44.8051, 41.6949], zoom: 17.4, pitch: 55, bearing: 0 });
  return null;
});
void spot;
await wait(12000);
await page.screenshot({ path: `${outputDir("models")}/05-editor-before-drag.png` });

const target = await page.evaluate(() => {
  const map = window.__map;
  const p = map.project([44.8051, 41.6949]);
  const hits = map.queryRenderedFeatures(
    [[p.x - 70, p.y - 200], [p.x + 70, p.y + 20]],
    { layers: ["app-models"] },
  );
  if (hits.length === 0) return null;
  const rect = map.getCanvas().getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y - 55, ground: { x: p.x, y: p.y } };
});
check("the model is hit-testable in the editor", Boolean(target), JSON.stringify(target));

if (target) {
  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(target.x - i * 14, target.y + i * 9);
    await wait(60);
  }
  await page.mouse.up();
  await wait(1600);

  const after = await page.evaluate(() => ({
    lat: document.querySelector("#model-lat").value,
    lng: document.querySelector("#model-lng").value,
  }));

  check(
    "dragging the model updates its coordinates",
    after.lat !== before.lat || after.lng !== before.lng,
    `${before.lng},${before.lat} → ${after.lng},${after.lat}`,
  );

  // And the change is persisted by the debounced autosave.
  await wait(1800);
  const stored = await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("hospitality-map.models.v1") ?? "[]");
    const r = records.find((m) => m.id === "drag-target");
    return r ? { lng: r.longitude, lat: r.latitude } : null;
  });
  check(
    "the dragged position is saved to the registry",
    stored && (String(stored.lng) !== before.lng || String(stored.lat) !== before.lat),
    JSON.stringify(stored),
  );
  await page.screenshot({ path: `${outputDir("models")}/06-editor-after-drag.png` });
}

console.log(results.join("\n"));
console.log("failures:", results.filter((r) => r.startsWith("FAIL")).length);
await browser.close();
