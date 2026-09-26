import { BASE, launch, outputDir } from "./harness.mjs";

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 1, isMobile: true, hasTouch: true });

const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});

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

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
await page.waitForFunction(
  () => window.__map.isStyleLoaded() && window.__map.areTilesLoaded(),
  { timeout: 90000, polling: 500 },
).catch(() => undefined);
await wait(1500);
await dismissLocationCard(page);

// How many dialogs are on screen, and which one.
const dialogs = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute("aria-label")),
  );

const results = [];
function check(name, pass, detail = "") {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// 1. Opens straight onto the map, nothing over it.
check("opens on the map with no overlay", (await dialogs()).length === 0);

// 2. Each control opens exactly one overlay.
const controls = [
  ['button[aria-label^="Notifications"]', "Notifications"],
  ['button[aria-label="Open the assistant"]', "Assistant"],
  ['button[aria-label="Mission panel"]', "Missions"],
  ['button[aria-label="Profile panel"]', "Profile"],
  ['button[aria-label="Scan a QR code"]', "Scan a QR code"],
];

/** Waits for the overlay count to settle rather than guessing a duration. */
async function waitForDialogs(page, count, timeout = 8000) {
  try {
    await page.waitForFunction(
      (n) => document.querySelectorAll('[role="dialog"]').length === n,
      { timeout },
      count,
    );
    return true;
  } catch {
    return false;
  }
}

for (const [selector, label] of controls) {
  await page.click(selector);
  const appeared = await waitForDialogs(page, 1);
  const open = await dialogs();
  check(`${label} opens`, appeared && open.length === 1 && open[0] === label, JSON.stringify(open));

  // Pressing the same control again closes it.
  await page.click(selector);
  check(`${label} toggles closed`, await waitForDialogs(page, 0));
}

// 3. Opening a second overlay replaces the first — never two at once.
await page.click('button[aria-label^="Notifications"]');
await waitForDialogs(page, 1);
await page.click('button[aria-label="Mission panel"]');
// The outgoing panel stays mounted while it animates away, and "one dialog"
// is briefly true of the *old* one. Wait for the new one to be the only one.
const settled = await page
  .waitForFunction(
    () => {
      const open = Array.from(document.querySelectorAll('[role="dialog"]'));
      return open.length === 1 && open[0].getAttribute("aria-label") === "Missions";
    },
    { timeout: 8000 },
  )
  .then(() => true)
  .catch(() => false);
const swapped = await dialogs();
check(
  "second overlay replaces the first",
  settled && swapped.length === 1 && swapped[0] === "Missions",
  JSON.stringify(swapped),
);

// 4. Backdrop click closes.
await page.evaluate(() => document.querySelector(".backdrop").click());
check("clicking outside closes", await waitForDialogs(page, 0));

// 5. Escape closes.
await page.click('button[aria-label="Profile panel"]');
await waitForDialogs(page, 1);
await page.keyboard.press("Escape");
check("Escape closes", await waitForDialogs(page, 0));

// 6. Tapping a marker opens its card, and the nav inverts over the sheet.
// Pick whichever non-hotel marker is actually on screen — which one that is
// depends on the camera, and hard-coding a category makes this flaky.
const tapped = await page.evaluate(() => {
  const marker = Array.from(document.querySelectorAll(".place-marker")).find((el) => {
    if (el.dataset.family === "hotel") return false;
    const r = el.getBoundingClientRect();
    return r.x > 8 && r.y > 8 && r.right < innerWidth - 8 && r.bottom < innerHeight - 8;
  });
  if (!marker) return null;
  // aria-label is "Name. Open details." or "Name, 280 m away. Open details."
  const name = (marker.getAttribute("aria-label") ?? "")
    .replace(/\.\s*Open details\.?$/i, "")
    .replace(/,\s*[\d.]+\s*(m|km)\s*away$/i, "")
    .trim() || null;
  marker.click();
  return name;
});
await wait(1600);
const afterMarker = await dialogs();
const inverted = await page.evaluate(
  () => document.querySelector(".bottom-nav")?.dataset.inverted === "true",
);
check(
  "marker opens its details card",
  Boolean(tapped) && afterMarker.length === 1 && afterMarker[0] === tapped,
  `tapped ${tapped} → ${JSON.stringify(afterMarker)}`,
);
check("navigation inverts over a bottom sheet", inverted);

// 7. Drag the sheet down to dismiss it. Wait for the open transition to
// actually finish first — under software WebGL the camera easeTo starves the
// compositor and the sheet can still be sliding a second later.
await page.waitForFunction(
  () => {
    const s = document.querySelector(".sheet--bottom");
    return s && getComputedStyle(s).transform === "matrix(1, 0, 0, 1, 0, 0)";
  },
  { timeout: 15000 },
);
const grabber = await page.$(".sheet__grabber");
const box = await grabber.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
for (let y = 10; y <= 180; y += 30) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + y);
  await wait(16);
}
await page.mouse.up();
await wait(600);
check("dragging the sheet down dismisses it", (await dialogs()).length === 0);

// 8. Mission step flies the camera and opens the place.
const before = await page.evaluate(() => null);
await page.click('button[aria-label="Mission panel"]');
await wait(500);
await page.evaluate(() => {
  const steps = Array.from(document.querySelectorAll(".step"));
  steps.find((s) => s.dataset.next === "true")?.click();
});
await wait(2200);
const afterStep = await dialogs();
check("a mission step opens that place", afterStep.length === 1 && afterStep[0] === "Narikala Fortress", JSON.stringify(afterStep));
void before;

// 9. Notifications empty state.
await page.keyboard.press("Escape");
await wait(500);
await page.click('button[aria-label^="Notifications"]');
await wait(500);
await page.evaluate(() => {
  const clear = Array.from(document.querySelectorAll(".sheet--top button")).find(
    (b) => b.textContent.trim() === "Clear",
  );
  clear?.click();
});
await wait(400);
const emptyText = await page.evaluate(
  () => document.querySelector(".empty-state__title")?.textContent ?? "",
);
check("notifications show an empty state", emptyText === "Nothing new", emptyText);

// 10. No routes were introduced.
const url = page.url();
check("URL never leaves the root", url === `${BASE}/` || url === BASE, url);

// 11. Admin writes reach the guest map.
await page.goto(`${BASE}#/admin`, { waitUntil: "domcontentloaded", timeout: 90000 });
// The console is lazy-loaded, so wait for it rather than guessing.
await page.waitForSelector(".admin__sections", { timeout: 30000 });
// It opens on Hotels; the model library is the second section.
await page.evaluate(() => {
  Array.from(document.querySelectorAll(".admin__section"))
    .find((b) => /3D models/.test(b.textContent))?.click();
});
await page.waitForSelector(".model-card, .empty-state", { timeout: 20000 });
await wait(600);
const liveBefore = await page.evaluate(
  () => document.querySelector(".admin__count")?.textContent ?? "",
);
// Publish the hidden record.
await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll(".model-card"));
  const hidden = cards.find((c) => c.querySelector('[data-status="hidden"]'));
  hidden?.querySelector('button[aria-label^="Publish"]')?.click();
});
await wait(900);
const liveAfter = await page.evaluate(
  () => document.querySelector(".admin__count")?.textContent ?? "",
);
check("publishing updates the library live", liveBefore !== liveAfter, `${liveBefore.trim()} → ${liveAfter.trim()}`);

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
await page.waitForFunction(() => document.querySelectorAll(".model-anchor").length > 0,
  { timeout: 40000, polling: 400 }).catch(() => undefined);
await wait(1200);
await dismissLocationCard(page);
const anchors = await page.evaluate(() => document.querySelectorAll(".model-anchor").length);
check("the newly published model reaches the guest map", anchors === 2, `${anchors} anchors`);

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
console.log("console problems:", problems.length ? problems.join("\n") : "(none)");

await browser.close();
