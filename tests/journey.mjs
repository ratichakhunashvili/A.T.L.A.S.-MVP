/**
 * The complete guest journey, through the real UI:
 * QR link → welcome → reservation → preferences → availability → plan → map
 * → task details → start → complete → persisted history.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("journey");

const TOKEN = "VELIDEMO2026TBILISI0";
const ME = { latitude: 41.6949, longitude: 44.8051, accuracy: 18 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
const problems = [];

const browser = await launch();
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ["geolocation"]);

const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 150)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 150)}`); });
await page.setGeolocation(ME);

/*
 * Freeze the clock at 09:30 this morning.
 *
 * The engine plans against the real time of day, so running this at 19:30
 * genuinely yields an empty day — correct behaviour, useless as a test. This
 * pins "now" so the journey exercises a full day every time.
 */
await page.evaluateOnNewDocument(() => {
  const frozen = new Date();
  frozen.setHours(9, 30, 0, 0);
  const fixed = frozen.getTime();
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() { return fixed; }
  }
  window.Date = FrozenDate;
});

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const text = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);

/**
 * Sets a React-controlled input. Assigning `el.value` directly does not reach
 * React's state, so the native setter is invoked and an `input` event fired —
 * which is what React actually listens for.
 */
const setInput = (selector, value) =>
  page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector, value,
  );
const clickText = async (selector, label) => {
  const done = await page.evaluate(
    (sel, want) => {
      const target = Array.from(document.querySelectorAll(sel))
        .find((el) => el.textContent.trim().toLowerCase().includes(want.toLowerCase()));
      if (!target) return false;
      target.click();
      return true;
    },
    selector, label,
  );
  return done;
};

/* == 1 · Arrive by QR ==================================================== */
await page.goto(`${BASE}/join/hotel/${TOKEN}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector(".join__display, .join__title", { timeout: 30000 });
await wait(600);

const welcome = await text(".join__display");
check("A · the QR identifies the hotel with no search", welcome === "Hotel Veli", String(welcome));
check("A · and the guest was never asked to pick one",
  (await page.$("select#hotel")) === null);
await shot("01-welcome");

/* == 2 · Reservation ===================================================== */
await clickText(".btn", "set up your stay");
await page.waitForSelector(".join__option", { timeout: 15000 });
await shot("02-method");

const methods = await page.$$eval(".join__option-title", (els) => els.map((e) => e.textContent.trim()));
check("B · both registration routes are offered", methods.length === 2, methods.join(" / "));

await clickText(".join__option", "Enter it yourself");
await page.waitForSelector("#join-name", { timeout: 15000 });

// Deliberately invalid first: check-out before check-in.
await setInput("#join-name", "Nino");
await setInput("#join-in", "2026-09-26");
await setInput("#join-out", "2026-09-24");
await wait(300);
await clickText(".btn--block", "That's right");
await wait(500);
const dateError = await text(".field__error");
check("C · check-out before check-in is refused", Boolean(dateError), String(dateError));

// Now a real stay.
const today = new Date();
const isoDay = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
await setInput("#join-in", isoDay(-1));
await setInput("#join-out", isoDay(3));
await wait(400);

const derived = await text(".join__derived");
check("C · nights are calculated, not asked for", /4 nights/.test(String(derived)), String(derived));
await shot("03-stay");

await clickText(".btn--block", "That's right");
await page.waitForSelector(".join__tile", { timeout: 15000 });

/* == 3 · Preferences ===================================================== */
const interestCount = await page.$$eval(".join__tile", (els) => els.length);
check("D · interests are offered as visual cards", interestCount >= 10, `${interestCount} tiles`);

for (const want of ["Food", "Sightseeing", "Relaxation"]) {
  await clickText(".join__tile", want);
}
const selected = await page.$$eval('.join__tile[data-active="true"]', (els) =>
  els.map((e) => e.textContent.trim()));
check("D · multi-select works", selected.length === 3, selected.join(", "));
await shot("04-interests");

await clickText(".btn--block", "Next");
await page.waitForSelector(".join__choice", { timeout: 15000 });
await clickText(".join__choice", "Balanced");
await clickText(".btn--block", "Next");
await wait(700);
await clickText(".join__choice", "Moderate");
await clickText(".btn--block", "Next");

/* == 4 · Availability ==================================================== */
await page.waitForSelector("#join-c-time", { timeout: 15000 });
await setInput("#join-c-time", "20:00");
await setInput("#join-c-date", isoDay(0));
await setInput("#join-c-label", "Dinner with friends");
await clickText(".btn--ghost", "Add to the diary");
await wait(500);

const diary = await page.$$eval(".join__diary-item", (els) => els.map((e) => e.textContent.trim()));
check("E · a fixed commitment is recorded", diary.length === 1, diary.join(" | "));
await shot("05-schedule");

await clickText(".btn--block", "Build my day");
await page.waitForSelector(".join__icon--ok", { timeout: 25000 });
check("F · onboarding completes", true);
await shot("06-done");

/* == 5 · The map and the plan ============================================ */
await page.waitForFunction(() => window.location.pathname === "/", { timeout: 20000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
// Wait on the condition, not on a guess: the intro animation and the first
// tiles both have to finish before a screenshot means anything.
await page.waitForFunction(
  () => window.__map.isStyleLoaded() && window.__map.areTilesLoaded(),
  { timeout: 90000, polling: 500 },
).catch(() => undefined);
await page.waitForFunction(
  () => document.querySelectorAll(".task-marker").length > 0,
  { timeout: 40000, polling: 400 },
).catch(() => undefined);
await wait(1500);

await page.evaluate(() => {
  Array.from(document.querySelectorAll(".location-prompt__actions button"))
    .find((b) => b.textContent.trim() === "Not now")?.click();
});
await wait(1200);
await shot("07-map");

const mapState = await page.evaluate(() => ({
  canvas: Boolean(document.querySelector(".map-canvas canvas")),
  taskMarkers: document.querySelectorAll(".task-marker").length,
  placeMarkers: document.querySelectorAll(".place-marker").length,
  modelAnchors: document.querySelectorAll(".model-anchor").length,
  route: Boolean(window.__map.getLayer("task-route-line")),
}));

check("U · Mapbox still renders", mapState.canvas);
check("V · the 3D model layer survives", mapState.modelAnchors > 0, `${mapState.modelAnchors} anchors`);
check("W · tasks appear on the map", mapState.taskMarkers > 0, `${mapState.taskMarkers} task markers`);
check("W · with a route between them", mapState.route);
check("· existing place markers still render", mapState.placeMarkers > 0, `${mapState.placeMarkers}`);

/* == 6 · The day panel =================================================== */
await page.click('button[aria-label="Mission panel"]');
await page.waitForSelector(".day__hero, .empty-state", { timeout: 20000 });
await wait(1500);
await shot("08-day");

const planState = await page.evaluate(() => ({
  heroTitle: document.querySelector(".day__hero-title")?.textContent?.trim() ?? null,
  rows: document.querySelectorAll(".day__row").length,
  taskRows: document.querySelectorAll(".day__row:not(.day__row--commitment)").length,
  commitmentRows: document.querySelectorAll(".day__row--commitment").length,
  chips: Array.from(document.querySelectorAll(".day__chip")).map((c) => c.textContent.trim()),
  summary: document.querySelector(".sheet__title")?.textContent?.trim() ?? null,
  hasScore: /\b\d{1,3}\b\s*(score|points? score)/i.test(document.body.innerText),
}));

check("J/K · a plan was generated", planState.taskRows >= 1, `${planState.taskRows} tasks`);
check("· the guest's own commitment appears in the timeline",
  planState.commitmentRows >= 1, `${planState.commitmentRows}`);
check("· the next task is given priority", Boolean(planState.heroTitle), String(planState.heroTitle));
check("Y · no engagement score is shown to the guest", !planState.hasScore);
check("· the plan is framed, not enumerated",
  !/^\d+ (attractions|results)/i.test(String(planState.summary)), String(planState.summary));

const hotelChip = planState.chips.some((c) => /at your hotel/i.test(c));
const partnerChip = planState.chips.some((c) => /min away/i.test(c));
check("· hotel and partner tasks are visually distinguished",
  hotelChip || partnerChip, planState.chips.join(" | "));

/* == 7 · Task interaction ================================================ */
const heroTitle = planState.heroTitle;
await page.waitForSelector(".day__hero-actions .btn--block", { timeout: 15000 });
await page.click(".day__hero-actions .btn--block"); // Start
await wait(900);
const started = await text(".day__hero-actions .btn--block");
check("· a task can be started", /complete/i.test(String(started)), String(started));
await shot("09-started");

// Poll rather than guess: the celebration is a timed state, so a fixed wait
// is a race against its own duration.
const celebrationSeen = await page.evaluate(async () => {
  const seen = [];
  const observer = new MutationObserver(() => {
    const title = document.querySelector(".day__hero-title")?.textContent?.trim();
    if (title) seen.push(title);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  Array.from(document.querySelectorAll(".day__hero-actions .btn--block"))[0]?.click();
  await new Promise((r) => setTimeout(r, 2500));
  observer.disconnect();
  return seen;
});
const celebrated = celebrationSeen.find((t) => /nice one/i.test(t)) ?? celebrationSeen.join(" → ");
check("· completing gives a satisfying state", /nice one/i.test(String(celebrated)), String(celebrated).slice(0, 90));
await shot("10-completed");

await wait(2200);

/* == 8 · Persistence ===================================================== */
const persisted = await page.evaluate((title) => {
  const events = JSON.parse(localStorage.getItem("atlas.activityEvents.v1") ?? "[]");
  const plans = JSON.parse(localStorage.getItem("atlas.dailyPlans.v1") ?? "[]");
  const done = plans[0]?.tasks?.filter((t) => t.state === "COMPLETED" || t.state === "VERIFIED") ?? [];
  return {
    suggested: events.filter((e) => e.eventType === "suggested").length,
    started: events.filter((e) => e.eventType === "started").length,
    completed: events.filter((e) => e.eventType === "completed").length,
    viewed: events.filter((e) => e.eventType === "viewed").length,
    completedTasks: done.length,
    completedTitle: done[0]?.title ?? null,
    hotelIdOnPlan: plans[0]?.hotelId ?? null,
    reservationHotel: JSON.parse(localStorage.getItem("atlas.reservations.v1") ?? "[]")[0]?.hotelId ?? null,
  };
}, heroTitle);

check("X · the suggestion was logged", persisted.suggested >= 1, `${persisted.suggested}`);
check("X · the start was logged", persisted.started >= 1, `${persisted.started}`);
check("X · the completion was logged", persisted.completed >= 1, `${persisted.completed}`);
check("X · the task is persisted as completed", persisted.completedTasks >= 1,
  `${persisted.completedTasks} (${persisted.completedTitle})`);
check("· the reservation is bound to the scanned hotel",
  persisted.reservationHotel === persisted.hotelIdOnPlan && Boolean(persisted.hotelIdOnPlan),
  `${persisted.reservationHotel}`);

/* == 9 · Task from the map =============================================== */
await page.keyboard.press("Escape");
await wait(900);

/*
 * Bring a task into view before tapping it.
 *
 * Which markers happen to be on screen depends on where the camera was left,
 * and that depends on the plan the engine generated — so requiring one to be
 * visible by luck made this step a coin toss. Centring first tests what this
 * step is actually about: tapping a task marker opens its sheet.
 */
await page.evaluate(() => {
  const plans = JSON.parse(localStorage.getItem("atlas.dailyPlans.v1") ?? "[]");
  const task = plans[0]?.tasks?.find((t) => t.state !== "SKIPPED" && t.state !== "EXPIRED");
  if (task) window.__map.jumpTo({ center: [task.longitude, task.latitude], zoom: 16, pitch: 0 });
});
await wait(2200);

const markerCount = await page.evaluate(() => document.querySelectorAll(".task-marker").length);
check("task markers survive a completed task", markerCount > 0, `${markerCount} markers`);

const tapped = await page.evaluate(() => {
  const marker = Array.from(document.querySelectorAll(".task-marker")).find((el) => {
    const r = el.getBoundingClientRect();
    return r.x > 8 && r.y > 8 && r.right < innerWidth - 8 && r.bottom < innerHeight - 8;
  });
  if (!marker) return false;
  marker.click();
  return true;
});
await wait(1800);

if (tapped) {
  const sheet = await page.evaluate(() => ({
    title: document.querySelector(".sheet__title")?.textContent?.trim() ?? null,
    badge: document.querySelector(".place-hero__badge")?.textContent?.trim() ?? null,
    reason: document.querySelector(".task__reason")?.textContent?.trim() ?? null,
    meta: Array.from(document.querySelectorAll(".place-meta__item")).map((e) => e.textContent.trim()),
    hasStart: Array.from(document.querySelectorAll(".place-actions .btn"))
      .some((b) => /start|complete/i.test(b.textContent)),
  }));

  check("W · a map task opens its details", Boolean(sheet.title), String(sheet.title));
  check("· the partner relationship is stated",
    /hotel partner|at your hotel/i.test(String(sheet.badge)), String(sheet.badge));
  check("· a short reason is given", Boolean(sheet.reason), String(sheet.reason).slice(0, 70));
  check("· time, duration and distance are shown", sheet.meta.length >= 3, sheet.meta.join(" | "));
  check("· it can be started from the map", sheet.hasStart);
  await shot("11-task-sheet");
} else {
  check("W · a map task opens its details", false, "no task marker on screen");
}

/* == 10 · Regeneration respects what is done ============================= */
await page.keyboard.press("Escape");
await wait(800);
await page.click('button[aria-label="Mission panel"]');
await page.waitForSelector(".day__timeline, .empty-state", { timeout: 15000 });
await wait(800);

await page.click('button[aria-label="Rebuild today\'s plan"]').catch(() => undefined);
await wait(4000);

const afterRegen = await page.evaluate(() => {
  const plans = JSON.parse(localStorage.getItem("atlas.dailyPlans.v1") ?? "[]");
  return {
    completed: plans[0]?.tasks?.filter((t) => t.state === "COMPLETED" || t.state === "VERIFIED").length ?? 0,
    total: plans[0]?.tasks?.length ?? 0,
  };
});
check("M · regenerating keeps what the guest already did",
  afterRegen.completed >= 1, `${afterRegen.completed} of ${afterRegen.total} still complete`);
await shot("12-regenerated");

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length, "of", results.length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)");

await browser.close();
