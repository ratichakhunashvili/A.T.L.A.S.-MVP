/**
 * The retry ladder and the failure paths.
 *
 * `getCurrentPosition` is replaced in the page so the high-accuracy rung can
 * be made to time out on demand — which is exactly what this machine's Chrome
 * does for real, and what the app previously treated as "no location at all".
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("location");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);

const browser = await launch();
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ["geolocation"]);

/** mode: "ladder" (high fails, standard succeeds) or "allfail". */
async function run(mode) {
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

  await page.evaluateOnNewDocument((m) => {
    window.__calls = [];
    const geo = navigator.geolocation;
    geo.getCurrentPosition = (ok, err, opts) => {
      window.__calls.push({ high: Boolean(opts?.enableHighAccuracy), timeout: opts?.timeout, maximumAge: opts?.maximumAge });
      const timeout = () => err({ code: 3, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "Timeout expired" });
      if (m === "allfail") return setTimeout(timeout, 30);
      if (opts?.enableHighAccuracy) return setTimeout(timeout, 30);
      // The softer rung answers, as it does on most desktops.
      setTimeout(
        () => ok({ coords: { latitude: 41.6949, longitude: 44.8051, accuracy: 65 }, timestamp: Date.now() }),
        40,
      );
    };
    geo.watchPosition = (ok, err, opts) => {
      window.__calls.push({ watch: true, high: Boolean(opts?.enableHighAccuracy), maximumAge: opts?.maximumAge });
      return 99;
    };
    geo.clearWatch = () => {};
  }, mode);

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(11000);

  const state = await page.evaluate(() => {
    const c = window.__map.getCenter();
    return {
      calls: window.__calls,
      dot: Boolean(document.querySelector(".user-dot")),
      dotQuality: document.querySelector(".user-dot")?.dataset.quality ?? null,
      centre: { lat: c.lat, lng: c.lng },
      promptOpen: document.querySelector(".location-prompt")?.dataset.open === "true",
      title: document.querySelector(".location-prompt__title")?.textContent ?? "",
      body: document.querySelector(".location-prompt__text")?.textContent ?? "",
      actions: Array.from(document.querySelectorAll(".location-prompt__actions button")).map((b) => b.textContent.trim()),
      nearest: document.querySelector('.place-marker[data-tier="nearest"] .place-marker__distance')?.textContent ?? null,
    };
  });
  await page.screenshot({ path: `${OUT}/ladder-${mode}.png` });
  await page.close();
  return state;
}

/* -- The ladder recovers a fix the old code would have thrown away ------- */
const ladder = await run("ladder");
check("ladder · high accuracy is tried first",
  ladder.calls[0]?.high === true, JSON.stringify(ladder.calls[0]));
check("ladder · a timeout retries at standard accuracy",
  ladder.calls[1]?.high === false, JSON.stringify(ladder.calls[1]));
check("ladder · every request still asks for a fresh fix",
  ladder.calls.every((c) => c.maximumAge === 0), JSON.stringify(ladder.calls.map((c) => c.maximumAge)));
check("ladder · a position is recovered rather than lost", ladder.dot, String(ladder.dotQuality));
check("ladder · the watch runs in the mode that answered",
  ladder.calls.some((c) => c.watch && c.high === false), JSON.stringify(ladder.calls.filter((c) => c.watch)));
check("ladder · the map goes to the guest",
  Math.abs(ladder.centre.lat - 41.6949) < 0.002 && Math.abs(ladder.centre.lng - 44.8051) < 0.002,
  `${ladder.centre.lat.toFixed(5)},${ladder.centre.lng.toFixed(5)}`);
check("ladder · nearby measured from it", Boolean(ladder.nearest), String(ladder.nearest));

/* -- Both rungs fail: explained, not silent ------------------------------ */
const failed = await run("allfail");
check("failure · both rungs are attempted",
  failed.calls.filter((c) => !c.watch).length === 2, String(failed.calls.filter((c) => !c.watch).length));
check("failure · no location is invented", !failed.dot);
check("failure · the guest is told, not left guessing",
  failed.promptOpen && /could not get a location/i.test(failed.title), `${failed.title}`);
check("failure · the likely cause is named",
  /location services/i.test(failed.body), failed.body.slice(0, 80));
check("failure · a retry is offered", failed.actions.some((a) => /Try again/i.test(a)), JSON.stringify(failed.actions));
check("failure · no distance is claimed", failed.nearest === null, String(failed.nearest));

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
await browser.close();
