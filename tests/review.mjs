/**
 * Final product review: the guest journey end to end, then the admin surfaces
 * that feed it.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("review");

const TOKEN = "VELIDEMO2026TBILISI0";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

const browser = await launch();
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ["geolocation"]);

const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 150)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 150)}`); });
await page.setGeolocation({ latitude: 41.6949, longitude: 44.8051, accuracy: 18 });

// Morning, so the day has room in it.
await page.evaluateOnNewDocument(() => {
  const frozen = new Date();
  frozen.setHours(9, 30, 0, 0);
  const fixed = frozen.getTime();
  const Real = Date;
  class Frozen extends Real {
    constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
    static now() { return fixed; }
  }
  window.Date = Frozen;
});

const setInput = (sel, val) =>
  page.evaluate((s, v) => {
    const el = document.querySelector(s);
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, sel, val);

const clickText = (sel, label) =>
  page.evaluate((s, want) => {
    const el = Array.from(document.querySelectorAll(s))
      .find((n) => n.textContent.trim().toLowerCase().includes(want.toLowerCase()));
    el?.click();
    return Boolean(el);
  }, sel, label);

const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* -- Onboard ------------------------------------------------------------- */
await page.goto(`${BASE}/join/hotel/${TOKEN}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.evaluate(() => localStorage.clear());
await page.goto(`${BASE}/join/hotel/${TOKEN}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".join__display", { timeout: 30000 });
await wait(700);
await page.screenshot({ path: `${OUT}/01-welcome.png` });

await clickText(".btn", "set up your stay");
await page.waitForSelector(".join__option", { timeout: 15000 });
await clickText(".join__option", "Enter it yourself");
await page.waitForSelector("#join-name", { timeout: 15000 });
await setInput("#join-name", "Nino");
await setInput("#join-in", isoDay(-1));
await setInput("#join-out", isoDay(3));
await wait(400);
await clickText(".btn--block", "That's right");

await page.waitForSelector(".join__tile", { timeout: 15000 });
for (const want of ["Food", "Sightseeing", "Nature"]) await clickText(".join__tile", want);
await wait(400);
await page.screenshot({ path: `${OUT}/02-interests.png` });

await clickText(".btn--block", "Next");
await page.waitForSelector(".join__choice", { timeout: 15000 });
await clickText(".join__choice", "Balanced");
await clickText(".btn--block", "Next");
await wait(700);
await clickText(".join__choice", "Moderate");
await clickText(".btn--block", "Next");

await page.waitForSelector("#join-c-time", { timeout: 15000 });
await setInput("#join-c-time", "20:00");
await setInput("#join-c-date", isoDay(0));
await setInput("#join-c-label", "Dinner with friends");
await clickText(".btn--ghost", "Add to the diary");
await wait(400);
await clickText(".btn--block", "Build my day");
await page.waitForSelector(".join__icon--ok", { timeout: 25000 });

/* -- The map ------------------------------------------------------------- */
await page.waitForFunction(() => window.location.pathname === "/", { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
await page.waitForFunction(
  () => window.__map.isStyleLoaded() && window.__map.areTilesLoaded(),
  { timeout: 90000, polling: 500 },
).catch(() => undefined);
await page.waitForFunction(() => document.querySelectorAll(".task-marker").length > 0,
  { timeout: 40000, polling: 400 }).catch(() => undefined);
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".location-prompt__actions button"))
    .find((b) => b.textContent.trim() === "Not now")?.click();
});
await wait(2000);
await page.screenshot({ path: `${OUT}/03-map.png` });

/* -- The stay panel ------------------------------------------------------ */
await page.click(".guest-pill");
await wait(1100);
await page.screenshot({ path: `${OUT}/04-stay.png` });
await page.keyboard.press("Escape");
await wait(700);

/* -- The day ------------------------------------------------------------- */
await page.click('button[aria-label="Mission panel"]');
await page.waitForSelector(".day__hero, .empty-state", { timeout: 20000 });
await wait(1400);
await page.screenshot({ path: `${OUT}/05-day.png` });

/* -- Finish everything through the UI, so the reward unlocks ------------- */
// Driven by clicking rather than by calling the repository: under Vite dev a
// dynamic import is a second module instance, and the running app would never
// see the writes.
let completed = 0;
for (let guard = 0; guard < 8; guard += 1) {
  // The celebration replaces the hero for a couple of seconds after each
  // completion, so wait for the next task rather than assuming it is there.
  const ready = await page
    .waitForFunction(
      () => Boolean(document.querySelector(".day__hero-actions .btn--block")),
      { timeout: 6000, polling: 300 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ready) break;

  await page.click(".day__hero-actions .btn--block"); // Start
  await wait(800);
  await page.click(".day__hero-actions .btn--block"); // Complete
  await wait(1200);
  completed += 1;
}
// Let the last celebration finish so the reward panel is what is on screen.
await wait(2600);
await page.screenshot({ path: `${OUT}/06-reward.png` });

const overflow = await page.evaluate(() => {
  const region = document.querySelector(".scroll-region");
  if (!region) return null;
  const widest = Array.from(region.querySelectorAll("*"))
    .map((el) => ({ cls: el.className, w: el.scrollWidth }))
    .sort((a, b) => b.w - a.w)[0];
  return {
    client: region.clientWidth,
    scroll: region.scrollWidth,
    pad: getComputedStyle(region).paddingLeft,
    widest: `${widest?.cls} @ ${widest?.w}`,
  };
});
console.log("day panel width:", JSON.stringify(overflow));

const reward = await page.evaluate(() => ({
  unlocked: document.querySelector('.day__reward[data-unlocked="true"]') !== null,
  label: document.querySelector(".day__reward-label")?.textContent?.trim(),
  title: document.querySelector(".day__reward-title")?.textContent?.trim(),
}));
console.log("tasks completed:", completed, "| reward:", JSON.stringify(reward));
await page.keyboard.press("Escape");
await wait(600);

/* -- Collect an achievement ---------------------------------------------- */
await page.goto(`${BASE}/scan/attraction/exp-narikala`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".ach-toast__title", { timeout: 30000 }).catch(() => undefined);
await wait(800);
await page.screenshot({ path: `${OUT}/07-achievement.png` });

await page.evaluate(() => {
  Array.from(document.querySelectorAll(".location-prompt__actions button"))
    .find((b) => b.textContent.trim() === "Not now")?.click();
});
await wait(4200);

/* -- Profile and collection ---------------------------------------------- */
await page.click('button[aria-label="Profile panel"]');
await page.waitForSelector(".ach-entry", { timeout: 20000 });
await wait(1200);
await page.screenshot({ path: `${OUT}/08-profile.png` });

await page.evaluate(() => {
  document.querySelector(".scroll-region")?.scrollTo({ top: 900 });
});
await wait(700);
await page.screenshot({ path: `${OUT}/09-preferences.png` });

await page.evaluate(() => document.querySelector(".scroll-region")?.scrollTo({ top: 0 }));
await wait(400);
await page.click(".ach-entry");
await page.waitForSelector(".ach-grid", { timeout: 20000 });
await wait(1000);
await page.screenshot({ path: `${OUT}/10-collection.png` });

/* -- Admin --------------------------------------------------------------- */
await page.setViewport({ width: 1280, height: 950, deviceScaleFactor: 1 });
await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".admin__sections", { timeout: 40000 });
await wait(1400);
await page.evaluate(() => document.querySelector(".hp__row .btn")?.click());
await page.waitForSelector(".hp__tabs", { timeout: 20000 });
await wait(2200);
await page.screenshot({ path: `${OUT}/11-hotel-overview.png` });

await page.evaluate(() => {
  Array.from(document.querySelectorAll(".hp__tab")).find((b) => b.textContent.trim() === "Activities")?.click();
});
await wait(1400);
await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll(".hp__row"));
  const narikala = rows.find((r) => /Narikala/.test(r.textContent));
  narikala?.querySelector(".btn--ghost")?.click();
});
await page.waitForSelector(".hp__block", { timeout: 20000 });
await wait(2600);
await page.screenshot({ path: `${OUT}/12-attraction-form.png` });

await page.evaluate(() => {
  const blocks = Array.from(document.querySelectorAll(".hp__block"));
  blocks[blocks.length - 1]?.scrollIntoView({ block: "center" });
});
await wait(1400);
await page.screenshot({ path: `${OUT}/13-attraction-qr.png` });

console.log("problems:", problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)");
await browser.close();
