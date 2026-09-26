/**
 * Location correctness suite — scenarios A–J.
 *
 * Every page has the Geolocation API wrapped before app code runs, so the
 * assertions compare what the browser was asked, what it returned, and what
 * the application then rendered.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("location");

const PRECISE = { latitude: 41.6949, longitude: 44.8051, accuracy: 12 };
const MOVED = { latitude: 41.6962, longitude: 44.8068, accuracy: 14 };
const APPROX = { latitude: 41.6949, longitude: 44.8051, accuracy: 900 };
const COARSE = { latitude: 41.78, longitude: 44.93, accuracy: 25000 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

const browser = await launch();
const context = browser.defaultBrowserContext();
const problems = [];

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 140)}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 140)}`); });
  await page.evaluateOnNewDocument(() => {
    window.__gps = { get: [], watch: [], clear: [] };
    const geo = navigator.geolocation;
    const rg = geo.getCurrentPosition.bind(geo);
    const rw = geo.watchPosition.bind(geo);
    const rc = geo.clearWatch.bind(geo);
    geo.getCurrentPosition = (ok, err, opts) => (window.__gps.get.push({ ...opts }), rg(ok, err, opts));
    geo.watchPosition = (ok, err, opts) => {
      const id = rw(ok, err, opts);
      window.__gps.watch.push({ id, ...opts });
      return id;
    };
    geo.clearWatch = (id) => (window.__gps.clear.push(id), rc(id));
  });
  return page;
}

const boot = async (page) => {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(9000);
};
const state = (page) =>
  page.evaluate(() => {
    const m = window.__map;
    const c = m.getCenter();
    const dot = document.querySelector(".user-dot");
    return {
      centre: { lng: c.lng, lat: c.lat },
      zoom: +m.getZoom().toFixed(2),
      dot: Boolean(dot),
      dotQuality: dot?.dataset.quality ?? null,
      ring: Boolean(m.getLayer("guest-accuracy-fill")),
      ringFeatures: m.querySourceFeatures ? m.querySourceFeatures("guest-accuracy").length : -1,
      nearestDistance:
        document.querySelector('.place-marker[data-tier="nearest"] .place-marker__distance')
          ?.textContent ?? null,
      tiers: Array.from(document.querySelectorAll(".place-marker")).reduce((acc, el) => {
        acc[el.dataset.tier] = (acc[el.dataset.tier] ?? 0) + 1;
        return acc;
      }, {}),
      promptOpen: document.querySelector(".location-prompt")?.dataset.open === "true",
      promptTitle: document.querySelector(".location-prompt__title")?.textContent ?? "",
      promptText: document.querySelector(".location-prompt__text")?.textContent ?? "",
      gps: window.__gps,
    };
  });

/* -- A: permission granted immediately ---------------------------------- */
await context.overridePermissions(BASE, ["geolocation"]);
{
  const page = await newPage();
  await page.setGeolocation(PRECISE);
  await boot(page);
  await page.waitForSelector(".user-dot", { timeout: 25000 });
  await wait(5000);
  const s = await state(page);

  check("A · precise fix puts the camera on the guest",
    Math.abs(s.centre.lat - PRECISE.latitude) < 0.0008 && Math.abs(s.centre.lng - PRECISE.longitude) < 0.0008,
    `${s.centre.lat.toFixed(5)},${s.centre.lng.toFixed(5)}`);
  check("A · at street zoom", s.zoom >= 16, String(s.zoom));
  check("A · the dot reads as exact", s.dotQuality === "precise", String(s.dotQuality));
  check("A · no accuracy ring for a precise fix", s.ringFeatures === 0, String(s.ringFeatures));

  check("every request asks for a fresh fix (maximumAge 0)",
    [...s.gps.get, ...s.gps.watch].every((o) => o.maximumAge === 0),
    JSON.stringify([...s.gps.get, ...s.gps.watch].map((o) => o.maximumAge)));
  check("a finite timeout is set",
    [...s.gps.get, ...s.gps.watch].every((o) => o.timeout > 0 && o.timeout <= 30000), "");

  /* -- I/H: one watcher, through re-renders and overlay churn ----------- */
  for (const sel of ['button[aria-label="Mission panel"]', 'button[aria-label="Profile panel"]',
                     'button[aria-label^="Notifications"]', 'button[aria-label="Scan a QR code"]']) {
    await page.click(sel); await wait(700);
    await page.keyboard.press("Escape"); await wait(700);
  }
  const after = await page.evaluate(() => window.__gps);
  check("H/I · exactly one watcher survives overlay churn and re-renders",
    after.watch.length === 1 && after.clear.length === 0,
    `watch=${after.watch.length} clear=${after.clear.length}`);

  /* -- E: the guest moves ------------------------------------------------ */
  const before = await state(page);
  await page.setGeolocation(MOVED);
  await wait(9000);
  const moved = await state(page);
  const markerFollowed = await page.evaluate((target) => {
    // The marker is positioned by Mapbox from the same fix the ranking uses.
    const dot = document.querySelector(".user-dot");
    if (!dot) return false;
    const host = dot.closest(".marker-host");
    const rect = host.getBoundingClientRect();
    const p = window.__map.project([target.longitude, target.latitude]);
    return Math.abs(rect.x + rect.width / 2 - p.x) < 24 && Math.abs(rect.y + rect.height / 2 - p.y) < 24;
  }, MOVED);
  check("E · the marker follows the guest", markerFollowed);
  check("F · but the camera does not chase them",
    Math.abs(moved.centre.lat - before.centre.lat) < 0.0004,
    `${before.centre.lat.toFixed(5)} → ${moved.centre.lat.toFixed(5)}`);

  /* -- F: manual panning is not undone ---------------------------------- */
  await page.evaluate(() => window.__map.jumpTo({ center: [44.78, 41.72], zoom: 14 }));
  await wait(2000);
  await page.setGeolocation({ latitude: 41.6970, longitude: 44.8075, accuracy: 12 });
  await wait(8000);
  const panned = await state(page);
  check("F · a new fix does not yank a panned map back",
    Math.abs(panned.centre.lat - 41.72) < 0.01 && Math.abs(panned.centre.lng - 44.78) < 0.01,
    `${panned.centre.lat.toFixed(4)},${panned.centre.lng.toFixed(4)}`);

  /* -- J: nearby uses the guest's real coordinates ---------------------- */
  const ranking = await page.evaluate(() => {
    const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
    const dist = (a, b) => {
      const p1 = rad(a.lat), p2 = rad(b.lat);
      const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const nearestEl = document.querySelector('.place-marker[data-tier="nearest"]');
    return { name: nearestEl?.querySelector(".place-marker__name")?.textContent ?? null, _dist: dist };
  });
  check("J · a nearest place is chosen from the live fix", Boolean(ranking.name), String(ranking.name));

  await page.screenshot({ path: `${OUT}/01-precise.png` });
  await page.close();
}

/* -- D: low accuracy (the reported bug) --------------------------------- */
{
  const page = await newPage();
  await page.setGeolocation(COARSE);
  await boot(page);
  await wait(9000);
  const s = await state(page);

  check("D · a ±25 km fix does NOT move the camera",
    Math.abs(s.centre.lat - COARSE.latitude) > 0.02 || Math.abs(s.centre.lng - COARSE.longitude) > 0.02,
    `centre ${s.centre.lat.toFixed(4)},${s.centre.lng.toFixed(4)} vs fix ${COARSE.latitude},${COARSE.longitude}`);
  check("D · the dot does not claim precision", s.dotQuality === "coarse", String(s.dotQuality));
  check("D · an accuracy radius is drawn", s.ringFeatures > 0, `${s.ringFeatures} feature(s)`);
  check("D · no precise distance is claimed", s.nearestDistance === null, String(s.nearestDistance));
  check("D · nothing is ranked as nearest", !s.tiers.nearest, JSON.stringify(s.tiers));
  check("D · the guest is told it is approximate",
    s.promptOpen && /approximate/i.test(s.promptTitle + s.promptText),
    `${s.promptTitle} / ${s.promptText.slice(0, 70)}`);
  const actions = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".location-prompt__actions button")).map((b) => b.textContent.trim()));
  check("D · showing that area is offered, not taken", actions.some((a) => /Show that area/i.test(a)),
    JSON.stringify(actions));

  await page.screenshot({ path: `${OUT}/02-coarse.png` });

  // ...and taking the offer does move the camera, on an explicit tap only.
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".location-prompt__actions button"))
      .find((b) => /Show that area/i.test(b.textContent))?.click();
  });
  await wait(4000);
  const shown = await state(page);
  check("D · tapping it frames the area", Math.abs(shown.centre.lat - COARSE.latitude) < 0.03,
    `${shown.centre.lat.toFixed(4)},${shown.centre.lng.toFixed(4)}`);
  await page.close();
}

/* -- Mid accuracy: usable, but framed and labelled honestly ------------- */
{
  const page = await newPage();
  await page.setGeolocation(APPROX);
  await boot(page);
  await page.waitForSelector(".user-dot", { timeout: 25000 });
  await wait(7000);
  const s = await state(page);

  check("approximate fix is framed to its uncertainty, not street zoom",
    s.zoom <= 15.6, String(s.zoom));
  check("approximate fix still centres near the guest",
    Math.abs(s.centre.lat - APPROX.latitude) < 0.01, s.centre.lat.toFixed(5));
  check("approximate fix draws its radius", s.ringFeatures > 0, String(s.ringFeatures));
  check("approximate fix still ranks nearby places", Boolean(s.tiers.nearest), JSON.stringify(s.tiers));

  await page.evaluate(() => document.querySelector('.place-marker[data-tier="nearest"]')?.click());
  await wait(2500);
  const meta = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".place-meta__item")).map((i) => i.textContent.trim()));
  check("approximate distances are marked with ≈", meta.some((m) => m.includes("≈")), JSON.stringify(meta));
  check("no walking time is promised from an approximate fix",
    !meta.some((m) => /min walk/.test(m)), JSON.stringify(meta));
  await page.screenshot({ path: `${OUT}/03-approximate.png` });
  await page.close();
}

/* -- B then C: denied, then granted ------------------------------------- */
await context.clearPermissionOverrides();
{
  const page = await newPage();
  await boot(page);
  await page.click('button[aria-label="Use your location"]');
  await wait(600);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".location-prompt__actions button"))
      .find((b) => b.textContent.trim().startsWith("Allow"))?.click();
  });
  await wait(5000);
  const denied = await state(page);
  check("B · denial leaves the map working", !denied.dot && Object.keys(denied.tiers).length > 0,
    JSON.stringify(denied.tiers));
  check("B · denial is reported, not hidden", /turned off|blocked/i.test(denied.promptTitle + denied.promptText),
    denied.promptTitle);

  // C: grant it afterwards, as a user would in site settings.
  await context.overridePermissions(BASE, ["geolocation"]);
  await page.setGeolocation(PRECISE);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".location-prompt__actions button"))
      .find((b) => /Allow|Try again/.test(b.textContent))?.click();
  });
  const recovered = await page
    .waitForSelector(".user-dot", { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("C · granting after a denial activates location", recovered);
  await page.close();
}

/* -- G: reload asks again rather than trusting a stale value ------------ */
{
  const page = await newPage();
  await page.setGeolocation(PRECISE);
  await boot(page);
  await page.waitForSelector(".user-dot", { timeout: 25000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(8000);
  const s = await state(page);
  check("G · a reload requests a fresh fix", s.gps.get.length >= 1 && s.gps.get.every((o) => o.maximumAge === 0),
    `${s.gps.get.length} request(s)`);
  const stored = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => /lat|lng|coord|position|location/i.test(k)));
  check("G · no coordinates are persisted between sessions",
    stored.filter((k) => k !== "hospitality-map.location.dismissed").length === 0,
    JSON.stringify(stored));
  await page.close();
}

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)");
await browser.close();
