/**
 * Deleting a property: the cascade, what survives it, and the console UI.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("console");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, p, d = "") => results.push(`${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
const problems = [];

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 150)}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 150)}`); });

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__engine), { timeout: 60000 });

/* == The cascade ========================================================= */
const cascade = await page.evaluate(async () => {
  // The application's own instances, via the bridge. A separate `import()`
  // under Vite dev yields a second module with its own cache.
  const E = window.__engine;
  const R = E.repositories;
  const H = { ...R, issueQRCode: null, previewHotelDeletion: E.previewHotelDeletion,
              deleteHotel: E.deleteHotel, resolveHotelToken: E.resolveHotelToken,
              codesForHotel: async (id) =>
                (await R.hotelQRCodes.list()).filter((c) => c.hotelId === id) };
  const C = { ...R, attachPartner: E.attachPartner, eligiblePartnerExperiences: E.eligiblePartnerExperiences };
  const G = R;
  const P = R;
  const A = { ...R, logActivityEvent: (input) =>
    R.activityEvents.create({ ...input, timestamp: new Date().toISOString() }) };

  // A doomed property with one of everything attached.
  const doomed = await H.hotels.create({
    name: "Doomed Hotel", address: "1 Nowhere", city: "Tbilisi",
    latitude: 41.7, longitude: 44.8, active: true,
    timezone: "Asia/Tbilisi", checkInTime: "14:00", checkOutTime: "11:00",
  });
  await R.hotelQRCodes.create({ hotelId: doomed.id, token: E.generateHotelToken(),
    active: true, expiresAt: null, scanCount: 0, lastScannedAt: null, label: "Reception" });

  const ownActivity = await C.experiences.create({
    name: "Doomed spa", description: "Gone soon.", type: "HOTEL_ACTIVITY",
    category: "hotel", latitude: 41.7, longitude: 44.8, hotelId: doomed.id,
    durationMin: 45, openingHours: [], budget: "moderate", effort: "low",
    interests: ["relaxation"], indoor: true, requiresBooking: false, active: true,
  });

  await C.hotelEvents.create({
    hotelId: doomed.id, name: "Doomed party", description: "x",
    date: "2026-12-01", startTime: "19:00", endTime: "21:00", location: "Bar",
    booked: 0, requiresBooking: false, interests: [], budget: "free",
    effort: "low", indoor: true, active: true,
  });

  // A SHARED partner experience, also sold by the seeded hotel.
  const shared = (await C.experiences.list()).find((e) => e.name === "Narikala Fortress");
  await C.attachPartner(doomed.id, shared.id, { priority: 60 });

  const survivor = (await H.hotels.list()).find((h) => h.name === "Hotel Veli");
  const seededLinksBefore = (await C.eligiblePartnerExperiences(survivor.id)).length;

  // A guest staying there.
  await G.reservations.create({
    guestId: "doomed-guest", hotelId: doomed.id, guestName: "Nino",
    checkIn: "2026-12-01", checkOut: "2026-12-03", nights: 2, partySize: 1,
    source: "manual",
  });
  await A.logActivityEvent({
    guestId: "doomed-guest", hotelId: doomed.id, activityId: ownActivity.id,
    activityType: "HOTEL_ACTIVITY", category: "hotel", eventType: "completed",
  });
  await P.dailyPlans.create({
    guestId: "doomed-guest", hotelId: doomed.id, date: "2026-12-01", tasks: [],
    summary: "x", engagement: "CASUAL", activityScore: 40, aiAssisted: false,
    hotelActivityOmitted: false, generatedAt: new Date().toISOString(),
  });

  const impact = await H.previewHotelDeletion(doomed.id);
  await H.deleteHotel(doomed.id);

  const after = {
    hotelGone: (await H.hotels.get(doomed.id)) === null,
    codesGone: (await H.codesForHotel(doomed.id)).length === 0,
    ownActivityGone: (await C.experiences.get(ownActivity.id)) === null,
    eventsGone: (await C.hotelEvents.list()).filter((e) => e.hotelId === doomed.id).length === 0,
    linksGone: (await C.hotelPartners.list()).filter((r) => r.hotelId === doomed.id).length === 0,
    reservationsGone: (await G.reservations.list()).filter((r) => r.hotelId === doomed.id).length === 0,
    plansGone: (await P.dailyPlans.list()).filter((p) => p.hotelId === doomed.id).length === 0,
    logGone: (await A.activityEvents.list()).filter((e) => e.hotelId === doomed.id).length === 0,
    sharedSurvives: (await C.experiences.get(shared.id)) !== null,
    seededLinksAfter: (await C.eligiblePartnerExperiences(survivor.id)).length,
    seededLinksBefore,
    survivorIntact: (await H.hotels.get(survivor.id)) !== null,
    tokenDead: (await H.resolveHotelToken((await H.hotelQRCodes.list())
      .find((c) => c.hotelId === doomed.id)?.token ?? "NOPE")).ok === false,
    impact,
  };
  return after;
});

check("the property is gone", cascade.hotelGone);
check("its QR codes go with it", cascade.codesGone);
check("its own activities go with it", cascade.ownActivityGone);
check("its events go with it", cascade.eventsGone);
check("its partner links go with it", cascade.linksGone);
check("guest reservations for it are removed", cascade.reservationsGone);
check("guest plans for it are removed", cascade.plansGone);
check("its behaviour log is removed", cascade.logGone);
check("the SHARED partner experience survives", cascade.sharedSurvives);
check("and another hotel still sells it",
  cascade.seededLinksAfter === cascade.seededLinksBefore,
  `${cascade.seededLinksBefore} → ${cascade.seededLinksAfter}`);
check("the other hotel is untouched", cascade.survivorIntact);
check("the deleted property's token no longer resolves", cascade.tokenDead);
check("the impact was reported before deleting",
  cascade.impact.qrCodes === 1 && cascade.impact.ownedActivities === 1 &&
  cascade.impact.events === 1 && cascade.impact.partnerLinks === 1 &&
  cascade.impact.reservations === 1 && cascade.impact.guests === 1,
  JSON.stringify(cascade.impact));

/* == The console UI ====================================================== */
await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForSelector(".admin__sections", { timeout: 40000 });
await wait(1500);

// Create a throwaway property through the UI so the real flow is exercised.
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".btn--accent"))
    .find((b) => /New hotel/.test(b.textContent))?.click();
});
await page.waitForSelector("#h-name", { timeout: 20000 });

const setInput = (sel, val) =>
  page.evaluate((s, v) => {
    const el = document.querySelector(s);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, sel, val);

await setInput("#h-name", "Throwaway Inn");
await setInput("#h-city", "Tbilisi");
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".hp__actions .btn"))
    .find((b) => /Create hotel/.test(b.textContent))?.click();
});
await page.waitForSelector(".hp__tabs", { timeout: 20000 });
await wait(1200);

const hasDelete = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".hp__actions .btn"))
    .some((b) => /Delete property/.test(b.textContent)));
check("the overview offers Delete property", hasDelete);

const guidance = await page.evaluate(() => document.body.innerText);
check("deactivating is offered as the softer option",
  /Taking guests/.test(guidance) && /instead/.test(guidance));

await page.evaluate(() => {
  Array.from(document.querySelectorAll(".hp__actions .btn"))
    .find((b) => /Delete property/.test(b.textContent))?.click();
});
await page.waitForSelector(".confirm", { timeout: 15000 });
await wait(600);
await page.screenshot({ path: `${OUT}/08-delete-confirm.png` });

const dialog = await page.evaluate(() => ({
  title: document.querySelector(".confirm__title")?.textContent?.trim() ?? "",
  body: document.querySelector(".confirm__body")?.textContent?.trim() ?? "",
}));
check("the dialog names the property", /Throwaway Inn/.test(dialog.title), dialog.title);
check("and warns the codes stop working",
  /cannot be undone/i.test(dialog.body) && /stop working/i.test(dialog.body),
  dialog.body.slice(0, 110));

// Cancelling must not delete.
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".confirm__actions button"))
    .find((b) => !/Delete/.test(b.textContent))?.click();
});
await wait(900);
const stillThere = await page.evaluate(async () => {
  const { hotels } = window.__engine.repositories;
  return (await hotels.list()).some((h) => h.name === "Throwaway Inn");
});
check("cancelling leaves the property alone", stillThere);

// Now actually delete.
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".hp__actions .btn"))
    .find((b) => /Delete property/.test(b.textContent))?.click();
});
await page.waitForSelector(".confirm", { timeout: 15000 });
await wait(400);
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".confirm__actions button"))
    .find((b) => /Delete property/.test(b.textContent))?.click();
});
await wait(1800);

const afterUi = await page.evaluate(async () => {
  const { hotels } = window.__engine.repositories;
  // localStorage is what actually persisted; the module is a cache over it.
  const stored = JSON.parse(localStorage.getItem("atlas.hotels.v1") ?? "[]");
  return {
    stored: stored.map((h) => h.name),
    viaModule: (await hotels.list()).map((h) => h.name),
    gone: !stored.some((h) => h.name === "Throwaway Inn"),
    backOnList: Boolean(document.querySelector(".hp__list")) &&
      !document.querySelector(".hp__tabs"),
    listed: Array.from(document.querySelectorAll(".hp__row-title")).map((e) => e.textContent.trim()),
  };
});
check("confirming deletes it", afterUi.gone, `stored: [${afterUi.stored}] module: [${afterUi.viaModule}]`);
check("and returns to the property list", afterUi.backOnList,
  afterUi.listed.join(", "));
check("the surviving property is still listed",
  afterUi.listed.some((t) => /Hotel Veli/.test(t)), afterUi.listed.join(", "));
await page.screenshot({ path: `${OUT}/09-after-delete.png` });

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length, "of", results.length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 5).join("\n") : "(none)");

await browser.close();
