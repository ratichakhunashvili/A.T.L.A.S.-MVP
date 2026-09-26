/**
 * Achievements, attraction codes, activity range, rewards and the day roll —
 * the systems added on top of the recommendation engine.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("ach");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
const problems = [];

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2, isMobile: true });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 150)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 150)}`); });

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => Boolean(window.__engine), { timeout: 60000 });

/* == Data-layer behaviour ================================================ */
const data = await page.evaluate(async () => {
  const E = window.__engine;
  const R = E.repositories;
  const out = {};

  const { ensureGuestSession, savePreferences, readPreferences } =
    await import("/src/data/repositories/guests.ts");

  const guest = ensureGuestSession();
  out.guestId = guest.guestId;
  out.anonymousWithoutHotel = guest.hotelId === "";

  const narikala = (await R.experiences.list()).find((e) => e.name === "Narikala Fortress");
  out.attractionId = narikala.id;

  /* -- Unlocking ---------------------------------------------------------- */
  const first = await E.unlockByAttraction(guest.guestId, narikala.id);
  out.firstStatus = first.status;
  out.firstName = first.achievement?.name;

  const second = await E.unlockByAttraction(guest.guestId, narikala.id);
  out.secondStatus = second.status;

  const rows = await R.userAchievements.list();
  out.rowCount = rows.filter((r) => r.guestId === guest.guestId).length;

  const log = await R.activityEvents.list();
  out.unlockEvents = log.filter(
    (e) => e.guestId === guest.guestId && e.eventType === "unlocked",
  ).length;

  out.bogus = (await E.unlockByAttraction(guest.guestId, "exp-does-not-exist")).status;

  /* -- Collection and featured ------------------------------------------- */
  const more = ["exp-qvevri", "exp-riverside", "exp-botanical"];
  for (const id of more) await E.unlockByAttraction(guest.guestId, id);

  const collection = await E.collectionFor(guest.guestId);
  out.collectionSize = collection.length;

  const featuredAuto = await E.featuredFor(guest.guestId);
  out.featuredAuto = featuredAuto.length;

  // Ask for four; exactly three should stick.
  await E.setFeatured(guest.guestId, collection.map((c) => c.achievement.id).slice(0, 4));
  const featured = await E.featuredFor(guest.guestId);
  out.featuredAfterFour = featured.length;

  const chosen = [collection[0].achievement.id, collection[2].achievement.id];
  await E.setFeatured(guest.guestId, chosen);
  out.featuredChosen = (await E.featuredFor(guest.guestId)).map((c) => c.achievement.id);
  out.chosenWanted = chosen;

  out.visited = [...(await E.visitedAttractions(guest.guestId))].length;

  /* -- The development account ------------------------------------------- */
  out.devRecognised = E.isDevelopmentAccount("ratichakhunashvili@gmail.com");
  out.devCaseInsensitive = E.isDevelopmentAccount("  RatiChakhunashvili@Gmail.com ");
  out.notDev = E.isDevelopmentAccount("someone@else.com");

  const total = (await R.achievements.list()).filter((a) => a.active).length;
  out.totalAchievements = total;

  const devCollection = await E.collectionFor("brand-new-guest", "ratichakhunashvili@gmail.com");
  out.devHoldsAll = devCollection.length === total;

  // A new achievement reaches the development account with no backfill.
  const pottery = (await R.experiences.list()).find((e) => e.name.includes("Clay studio"));
  await R.achievements.create({
    attractionId: pottery.id, name: "Brand New", description: "Just added.",
    icon: "Award", tone: "highlight", active: true,
  });
  const devAfter = await E.collectionFor("brand-new-guest", "ratichakhunashvili@gmail.com");
  out.devPicksUpNew = devAfter.length === total + 1;

  const plainAfter = await E.collectionFor("brand-new-guest");
  out.plainGuestHasNone = plainAfter.length === 0;

  /* -- Preferences: range and discovery ---------------------------------- */
  await savePreferences(guest.guestId, { range: { minKm: 0, maxKm: 1 } });
  out.savedRange = (await readPreferences(guest.guestId)).range;

  const defaults = await readPreferences("never-seen-guest");
  out.defaultRange = defaults.range;

  /* -- Momentum ----------------------------------------------------------- */
  const day = (n) => {
    const d = new Date(Date.now() - n * 86400000);
    return d.toISOString();
  };
  const ev = (type, when, id) => ({
    id: `m-${Math.random()}`, guestId: "m", hotelId: "h", activityId: id ?? "a",
    activityType: "PARTNER_ATTRACTION", category: "landmark", eventType: type,
    timestamp: when,
  });

  out.momentumUp = E.computeMomentum([
    ev("suggested", day(1), "a"), ev("suggested", day(1), "b"),
    ev("completed", day(1), "a"), ev("completed", day(1), "b"),
  ]);
  out.momentumDown = E.computeMomentum([
    ev("suggested", day(1), "a"), ev("suggested", day(1), "b"),
    ev("suggested", day(1), "c"), ev("completed", day(1), "a"),
  ]);
  out.momentumFlat = E.computeMomentum([]);

  return out;
});

check("anonymous guests exist without a hotel", data.anonymousWithoutHotel);
check("scanning an attraction unlocks its achievement",
  data.firstStatus === "unlocked", `${data.firstStatus} → ${data.firstName}`);
check("the achievement is themed on the place",
  /Narikala/i.test(String(data.firstName)), String(data.firstName));
check("scanning it again does nothing", data.secondStatus === "already", data.secondStatus);
check("and creates no second record", data.rowCount === 1, `${data.rowCount} rows`);
check("and logs no second unlock", data.unlockEvents === 1, `${data.unlockEvents} events`);
check("an unknown attraction unlocks nothing",
  data.bogus === "unknown_attraction", data.bogus);
check("the collection grows", data.collectionSize === 4, `${data.collectionSize}`);
check("the first three feature automatically", data.featuredAuto === 3, `${data.featuredAuto}`);
check("asking for four keeps exactly three",
  data.featuredAfterFour === 3, `${data.featuredAfterFour}`);
check("the chosen achievements are the ones shown",
  JSON.stringify(data.featuredChosen) === JSON.stringify(data.chosenWanted),
  `${data.featuredChosen} vs ${data.chosenWanted}`);
check("visited places are tracked", data.visited === 4, `${data.visited}`);

check("the development account is recognised", data.devRecognised);
check("case and spacing don't matter", data.devCaseInsensitive);
check("other accounts are not", !data.notDev);
check("it holds every achievement without scanning",
  data.devHoldsAll, `${data.totalAchievements} total`);
check("a newly created achievement reaches it immediately", data.devPicksUpNew);
check("an ordinary guest gets none of that", data.plainGuestHasNone);

check("the activity range is saved",
  data.savedRange.maxKm === 1, JSON.stringify(data.savedRange));
check("and defaults to 2–4 km",
  data.defaultRange.minKm === 2 && data.defaultRange.maxKm === 4,
  JSON.stringify(data.defaultRange));

check("finishing everything nudges tomorrow up", data.momentumUp === 1, String(data.momentumUp));
check("finishing little nudges it down", data.momentumDown === -1, String(data.momentumDown));
check("no history changes nothing", data.momentumFlat === 0, String(data.momentumFlat));

/* == Range and visited places as hard rules ============================== */
const engine = await page.evaluate(() => {
  const E = window.__engine;
  const out = {};

  const HOTEL = {
    id: "htl-r", name: "Range Hotel", address: "", city: "Tbilisi",
    latitude: 41.69314, longitude: 44.80217, active: true,
    timezone: "Asia/Tbilisi", checkInTime: "14:00", checkOutTime: "11:00",
    createdAt: "", updatedAt: "",
  };
  const iso = (n) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  let n = 0;
  const exp = (over) => ({
    id: `x-${++n}`, name: over.name, description: "", type: "PARTNER_ATTRACTION",
    category: over.category ?? "landmark", latitude: over.latitude, longitude: over.longitude,
    durationMin: 60, openingHours: [], budget: "free", effort: "low",
    interests: over.interests ?? ["sightseeing"], indoor: false,
    requiresBooking: false, isPartner: true, active: true, createdAt: "", updatedAt: "",
  });
  const partner = (e) => ({
    partner: { id: `p-${e.id}`, hotelId: HOTEL.id, experienceId: e.id, active: true,
      priority: 50, featured: false, createdAt: "", updatedAt: "" },
    experience: e,
  });

  // ~0.4 km, ~2.5 km and ~9 km from the hotel.
  const near = exp({ name: "Near", latitude: 41.6965, longitude: 44.8022 });
  const mid = exp({ name: "Mid", latitude: 41.7155, longitude: 44.8022 });
  const far = exp({ name: "Far", latitude: 41.7740, longitude: 44.8022 });

  const base = (over = {}) => E.generateDailyPlan({
    guestId: "g", hotel: HOTEL,
    reservation: { id: "r", guestId: "g", hotelId: HOTEL.id, guestName: "N",
      checkIn: iso(-1), checkOut: iso(3), nights: 4, partySize: 1,
      source: "manual", createdAt: "", updatedAt: "" },
    date: iso(0),
    preferences: {
      guestId: "g", interests: [], energyLevel: "balanced", budget: "moderate",
      range: over.range ?? { minKm: 2, maxKm: 4 },
      surpriseMe: false, explicit: true, updatedAt: "",
    },
    commitments: [], hotelActivities: [], partners: [near, mid, far].map(partner),
    events: [], history: [],
    visitedAttractionIds: over.visited ?? new Set(),
    isToday: false, nowMinutes: 0, random: over.random ?? (() => 0.99),
  });

  const tight = base({ range: { minKm: 0, maxKm: 1 } });
  out.tightNames = tight.plan.tasks.map((t) => t.title);
  out.tightRejections = [...tight.diagnostics.rejections.entries()];

  const wide = base({ range: { minKm: 0, maxKm: 30 } });
  out.wideNames = wide.plan.tasks.map((t) => t.title);

  const seen = base({ visited: new Set([near.id]) });
  out.visitedNames = seen.plan.tasks.map((t) => t.title);
  out.visitedRejections = [...seen.diagnostics.rejections.entries()];

  // A discovery pick may reach a little past the stated range.
  const discovering = base({ range: { minKm: 0, maxKm: 1 }, random: () => 0 });
  out.discoveryNames = discovering.plan.tasks.map((t) => t.title);
  out.discoveryWild = discovering.plan.tasks.filter((t) => t.isWildcard).length;

  return out;
});

check("a tight range excludes distant attractions",
  !engine.tightNames.includes("Far") && !engine.tightNames.includes("Mid"),
  engine.tightNames.join(", "));
check("and says why",
  engine.tightRejections.some(([r]) => r === "out_of_range"),
  JSON.stringify(engine.tightRejections));
check("a wide range includes them", engine.wideNames.length >= 2, engine.wideNames.join(", "));
check("somewhere already collected is not offered again",
  !engine.visitedNames.includes("Near"), engine.visitedNames.join(", "));
check("and that reason is recorded",
  engine.visitedRejections.some(([r]) => r === "already_visited"),
  JSON.stringify(engine.visitedRejections));
check("at most one discovery pick per day",
  engine.discoveryWild <= 1, String(engine.discoveryWild));

/* == The attraction code as a URL ======================================== */
await page.goto(`${BASE}/scan/attraction/${data.attractionId}`, {
  waitUntil: "domcontentloaded", timeout: 90000,
});
await page.waitForFunction(() => Boolean(window.__engine), { timeout: 60000 });
await wait(2500);

const scanned = await page.evaluate(() => ({
  path: window.location.pathname,
  toast: document.querySelector(".ach-toast__title")?.textContent?.trim() ?? null,
  onMap: Boolean(document.querySelector(".map-canvas")),
}));
check("an attraction link lands on the map, not a page", scanned.onMap && scanned.path === "/",
  scanned.path);
check("and is consumed, so a reload does not re-run it", scanned.path === "/");
// The guest already held this one, so nothing should appear.
check("a place already collected shows no notification", scanned.toast === null,
  String(scanned.toast));

/* == A fresh guest sees the notification ================================= */
await page.evaluate(() => localStorage.clear());
const fresh = (await page.evaluate(async () => {
  const R = window.__engine.repositories;
  return (await R.experiences.list()).find((e) => e.name === "Botanical Garden").id;
}));
await page.goto(`${BASE}/scan/attraction/${fresh}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.querySelector(".ach-toast__title"), { timeout: 30000 })
  .catch(() => undefined);
await wait(900);

const toast = await page.evaluate(() => ({
  title: document.querySelector(".ach-toast__title")?.textContent?.trim() ?? null,
  where: document.querySelector(".ach-toast__where")?.textContent?.trim() ?? null,
  sticker: Boolean(document.querySelector(".ach-toast .sticker")),
}));
check("a new place shows the achievement notification", Boolean(toast.title), String(toast.title));
check("it names where it was earned", /Botanical/i.test(String(toast.where)), String(toast.where));
check("and shows the sticker", toast.sticker);
await page.screenshot({ path: `${OUT}/01-toast.png` });

/* == The profile stack =================================================== */
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".location-prompt__actions button"))
    .find((b) => b.textContent.trim() === "Not now")?.click();
});
await wait(600);
await page.click('button[aria-label="Profile panel"]');
await page.waitForSelector(".ach-entry", { timeout: 20000 });
await wait(900);

const profile = await page.evaluate(() => ({
  slots: document.querySelectorAll(".sticker-stack__slot").length,
  filled: document.querySelectorAll(".sticker-stack .sticker:not(.sticker--empty)").length,
  count: document.querySelector(".ach-entry__count")?.textContent?.trim(),
  pointsAnywhere: /\bpoints?\b/i.test(document.body.innerText),
  hasRegenerate: Array.from(document.querySelectorAll("button"))
    .some((b) => /regenerate route/i.test(b.textContent)),
  hasRange: /How far you'll go/i.test(document.body.innerText),
  interestTiles: document.querySelectorAll(".prefs .join__tile").length,
}));
check("the profile shows three stack slots", profile.slots === 3, String(profile.slots));
check("with the collected one in it", profile.filled === 1, String(profile.filled));
check("and reports the collection", /1 collected/.test(String(profile.count)), String(profile.count));
check("no points anywhere in the profile", !profile.pointsAnywhere);
check("preferences are editable here", profile.interestTiles === 10, String(profile.interestTiles));
check("including how far to go", profile.hasRange);
check("and rebuilding is explicit", profile.hasRegenerate);
await page.screenshot({ path: `${OUT}/02-profile.png` });

/* == The collection sheet ================================================ */
await page.click(".ach-entry");
await page.waitForSelector(".ach-grid", { timeout: 20000 });
await wait(900);

const sheet = await page.evaluate(() => ({
  unlocked: document.querySelectorAll('.ach-card:not([data-locked="true"])').length,
  locked: document.querySelectorAll('.ach-card[data-locked="true"]').length,
  title: document.querySelector(".sheet__title")?.textContent?.trim(),
}));
check("the sheet lists what is collected", sheet.unlocked === 1, String(sheet.unlocked));
check("and what is still out there", sheet.locked >= 8, String(sheet.locked));
check("titled by the count", /1 achievement/.test(String(sheet.title)), String(sheet.title));
await page.screenshot({ path: `${OUT}/03-collection.png` });

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length, "of", results.length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)");

await browser.close();
