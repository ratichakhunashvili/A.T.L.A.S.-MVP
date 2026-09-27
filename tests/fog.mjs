/**
 * Fog of war.
 *
 * The promise is narrow and worth testing literally: an attraction starts
 * concealed for every new guest, nothing except a real unlock reveals it, and
 * while it is concealed its 3D asset is never even fetched — because an asset
 * that is fetched is an asset that can flash into view.
 *
 * The fixture is built through the application's own repositories, reached via
 * `window.__engine` rather than a fresh `import()`: under Vite dev an imported
 * module is a second instance with its own cache, so the running app would
 * never see the writes.
 */

import { launch, reporter, wait, BASE } from "./harness.mjs";

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1 });

const { check, watch, finish } = reporter();
watch(page);

/** The location card offers itself a few seconds in and sits over the map. */
async function dismissLocationCard() {
  await page.evaluate(() => {
    const notNow = Array.from(document.querySelectorAll(".location-prompt__actions button")).find(
      (b) => b.textContent.trim() === "Not now",
    );
    notNow?.click();
  });
  await wait(500);
}

/** Where the fixture model stands — the hotel's own block, so it is in view. */
const SITE = { longitude: 44.8025, latitude: 41.6932 };

/**
 * The fixture's asset.
 *
 * Deliberately *not* the tower the seed already publishes: the strongest claim
 * here is that a locked model's bytes are never fetched, and that is only
 * measurable if no other model on the map shares the URL. The seed's only
 * other user of this file is a `draft` record, which never reaches the map.
 */
const FIXTURE_GLB =
  "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/Lantern/glTF-Binary/Lantern.glb";
const CONTROL_GLB = "https://docs.mapbox.com/mapbox-gl-js/assets/tower.glb";

await page.goto(BASE, { waitUntil: "networkidle2" });

// A clean slate, so a previous run's fixtures cannot be counted as this one's.
await page.evaluate(() => {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("atlas.") || key.startsWith("hospitality-map.")) {
      localStorage.removeItem(key);
    }
  }
});
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForFunction(() => Boolean(window.__engine && window.__map), { timeout: 30000 });

/* ------------------------------------------------------------------ */
/* Fixture: one attraction, with a model and a live achievement        */
/* ------------------------------------------------------------------ */

const fixture = await page.evaluate(async (site, glb) => {
  const E = window.__engine;

  const model = await E.repositories.models.create({
    name: "Fog Fixture",
    modelUrl: glb,
    longitude: site.longitude,
    latitude: site.latitude,
    altitude: 0,
    scale: 0.2,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    visible: true,
    status: "published",
    category: "landmark",
    description: "Fixture for the fog test.",
  });

  const attraction = await E.repositories.experiences.create({
    name: "Fog Fixture Site",
    description: "Fixture for the fog test.",
    type: "PARTNER_ATTRACTION",
    category: "landmark",
    latitude: site.latitude,
    longitude: site.longitude,
    durationMin: 45,
    openingHours: [],
    budget: "free",
    effort: "low",
    interests: ["sightseeing"],
    indoor: false,
    requiresBooking: false,
    isPartner: true,
    active: true,
    modelId: model.id,
  });

  const achievement = await E.repositories.achievements.create({
    attractionId: attraction.id,
    name: "Fog Fixture",
    description: "Reached the fixture.",
    icon: "Castle",
    tone: "highlight",
    active: true,
  });

  return { modelId: model.id, attractionId: attraction.id, achievementId: achievement.id };
}, SITE, FIXTURE_GLB);

check("fixture built", Boolean(fixture.modelId && fixture.attractionId), JSON.stringify(fixture));

/* ------------------------------------------------------------------ */
/* 1. A new guest sees it locked                                       */
/* ------------------------------------------------------------------ */

// Reload so the map builds its layers with the fixture already present.
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await page.evaluate((site) => {
  window.__map.jumpTo({ center: [site.longitude, site.latitude], zoom: 17, pitch: 55 });
}, SITE);
await dismissLocationCard();
await wait(4000);

/*
 * `querySourceFeatures` returns a feature once per tile it appears in, so a
 * polygon straddling a boundary comes back two or three times. Everything
 * below counts distinct ids rather than rows.
 */
await page.evaluate(() => {
  window.__fogged = () =>
    new Set(
      window.__map.querySourceFeatures("app-fog").map((f) => f.properties?.modelId),
    );
  window.__drawn = () =>
    new Set(window.__map.querySourceFeatures("app-models").map((f) => f.properties?.id));
});

const locked = await page.evaluate((f) => {
  const map = window.__map;
  const marker = document.querySelector('.model-anchor[data-locked="true"]');

  return {
    fogLayerExists: Boolean(map.getLayer("app-fog-dome")),
    foggedModels: [...window.__fogged()],
    modelDrawn: window.__drawn().has(f.modelId),
    lockedMarkers: document.querySelectorAll('.model-anchor[data-locked="true"]').length,
    markerStage: marker?.getAttribute("data-stage") ?? null,
    markerLabel: marker?.getAttribute("aria-label") ?? null,
  };
}, fixture);

check("the fog layer is installed", locked.fogLayerExists);
check(
  "the attraction is under fog",
  locked.foggedModels.includes(fixture.modelId),
  locked.foggedModels.join(", ") || "(nothing fogged)",
);
check(
  "only the locked attraction is fogged",
  locked.foggedModels.length === 1,
  locked.foggedModels.join(", "),
);
check("its model is NOT drawn while locked", locked.modelDrawn === false);
check("a locked marker is on the map", locked.lockedMarkers >= 1, String(locked.lockedMarkers));
check("the locked marker says so", /locked/i.test(locked.markerLabel ?? ""), String(locked.markerLabel));

/* ------------------------------------------------------------------ */
/* 2. The locked asset was never fetched                               */
/* ------------------------------------------------------------------ */
/*
 * The strongest version of "no flash while assets load" is that the bytes
 * never leave the network stack at all. A locked model is filtered out before
 * `useModelAssets` sees it, so nothing should ever have requested the GLB.
 */

const fetchedFixtureAsset = await page.evaluate(
  (glb) =>
    performance.getEntriesByType("resource").some((entry) => entry.name === glb),
  FIXTURE_GLB,
);
check("the locked model's asset was never requested", fetchedFixtureAsset === false);

/* ------------------------------------------------------------------ */
/* 3. Opening it does not unlock it                                    */
/* ------------------------------------------------------------------ */

await page.evaluate(() => {
  document.querySelector('.model-anchor[data-locked="true"]')?.click();
});
await wait(900);

const afterOpen = await page.evaluate(
  (f) => ({
    sheetOpen: document.querySelectorAll('[role="dialog"]').length > 0,
    stillFogged: window.__fogged().has(f.modelId),
    stillNotDrawn: !window.__drawn().has(f.modelId),
  }),
  fixture,
);

check("opening the details sheet works while locked", afterOpen.sheetOpen);
check("opening it does not clear the fog", afterOpen.stillFogged);
check("opening it does not draw the model", afterOpen.stillNotDrawn);

await page.keyboard.press("Escape");
await wait(500);

/* ------------------------------------------------------------------ */
/* 4. A real unlock reveals it — and only it                           */
/* ------------------------------------------------------------------ */

const second = await page.evaluate(async (f, CONTROL_GLB) => {
  const E = window.__engine;
  // A second attraction and model, to prove the reveal is not global.
  const model = await E.repositories.models.create({
    name: "Fog Control",
    modelUrl: CONTROL_GLB,
    longitude: 44.803,
    latitude: 41.6936,
    altitude: 0,
    scale: 0.2,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    visible: true,
    status: "published",
    category: "landmark",
    description: "Control for the fog test.",
  });
  const attraction = await E.repositories.experiences.create({
    name: "Fog Control Site",
    description: "Control.",
    type: "PARTNER_ATTRACTION",
    category: "landmark",
    latitude: 41.6936,
    longitude: 44.803,
    durationMin: 45,
    openingHours: [],
    budget: "free",
    effort: "low",
    interests: ["sightseeing"],
    indoor: false,
    requiresBooking: false,
    isPartner: true,
    active: true,
    modelId: model.id,
  });
  await E.repositories.achievements.create({
    attractionId: attraction.id,
    name: "Fog Control",
    description: "Control.",
    icon: "Castle",
    tone: "highlight",
    active: true,
  });

  // Vite serves the app's own modules, so this is the same instance the page
  // is running — see the note on `repositories` in the engine bridge.
  const { ensureGuestSession } = await import("/src/data/repositories/guests.ts");
  const guest = ensureGuestSession();

  const outcome = await E.unlockByAttraction(guest.guestId, f.attractionId, "granted");
  return { controlModelId: model.id, outcome: outcome.status, guestId: guest.guestId };
}, fixture, CONTROL_GLB);

check("the fixture unlocked", second.outcome === "unlocked", second.outcome);

// The reveal waits on the asset, then runs for --dur-reveal.
await wait(6000);

const revealed = await page.evaluate(
  (f, controlId) => ({
    fixtureStillFogged: window.__fogged().has(f.modelId),
    controlStillFogged: window.__fogged().has(controlId),
    fixtureDrawn: window.__drawn().has(f.modelId),
    lockedMarkers: document.querySelectorAll('.model-anchor[data-locked="true"]').length,
  }),
  fixture,
  second.controlModelId,
);

check("the unlocked attraction's fog has cleared", revealed.fixtureStillFogged === false);
check("its model is now drawn", revealed.fixtureDrawn);
check("the other attraction is still fogged", revealed.controlStillFogged);
check("exactly one locked marker remains", revealed.lockedMarkers === 1, String(revealed.lockedMarkers));

/* ------------------------------------------------------------------ */
/* 5. The unlock survives a reload; a different guest does not inherit */
/* ------------------------------------------------------------------ */

await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await page.evaluate((site) => {
  window.__map.jumpTo({ center: [site.longitude, site.latitude], zoom: 17, pitch: 55 });
}, SITE);
await dismissLocationCard();
await wait(4500);

const afterReload = await page.evaluate(
  (f) => ({
    fogged: window.__map
      .querySourceFeatures("app-fog")
      .some((x) => x.properties?.modelId === f.modelId),
    drawn: window.__map
      .querySourceFeatures("app-models")
      .some((x) => x.properties?.id === f.modelId),
  }),
  fixture,
);

check("the unlock survives a reload", afterReload.fogged === false);
check("the model is still drawn after a reload", afterReload.drawn);

// A different guest: same browser, new identity.
await page.evaluate(() => {
  const session = JSON.parse(localStorage.getItem("atlas.session.v1") ?? "{}");
  session.guestId = `gst-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("atlas.session.v1", JSON.stringify(session));
});
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.waitForFunction(() => Boolean(window.__map), { timeout: 30000 });
await page.evaluate((site) => {
  window.__map.jumpTo({ center: [site.longitude, site.latitude], zoom: 17, pitch: 55 });
}, SITE);
await dismissLocationCard();
await wait(4500);

const otherGuest = await page.evaluate(
  (f) => ({
    fogged: window.__map
      .querySourceFeatures("app-fog")
      .some((x) => x.properties?.modelId === f.modelId),
    drawn: window.__map
      .querySourceFeatures("app-models")
      .some((x) => x.properties?.id === f.modelId),
  }),
  fixture,
);

check("a different guest still sees it locked", otherGuest.fogged);
check("a different guest does not see the model", otherGuest.drawn === false);

const failures = finish();
await browser.close();
process.exit(failures === 0 ? 0 : 1);
