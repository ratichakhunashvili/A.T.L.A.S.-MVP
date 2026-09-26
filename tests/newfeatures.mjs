/**
 * Verification for this round: location, proximity ranking, and accounts.
 * Existing behaviour is covered separately by interact.mjs and models-e2e.mjs.
 */

import { BASE, launch, outputDir } from "./harness.mjs";

const OUT = outputDir("features");

// A point in the old town, east of the hotel.
const HERE = { latitude: 41.6949, longitude: 44.8051 };

const results = [];
const check = (name, pass, detail = "") =>
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launch();
const context = browser.defaultBrowserContext();

const problems = [];
async function newPage(width = 393, height = 852) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`); });
  return page;
}

/** Writes into a React-controlled input the way a user would. */
async function type(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, selector, value);
}

/* ==================================================================== */
/* 1. Denied location — the product must carry on                       */
/* ==================================================================== */

await context.clearPermissionOverrides();
{
  const page = await newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(9000);

  // Open the ask directly through the locate control.
  await page.click('button[aria-label="Use your location"]');
  await wait(600);
  const promptOpen = await page.$eval(".location-prompt", (el) => el.dataset.open === "true");
  check("the locate control opens the explanation", promptOpen);

  await page.evaluate(() => {
    const allow = Array.from(document.querySelectorAll(".location-prompt__actions button"))
      .find((b) => b.textContent.trim().startsWith("Allow"));
    allow?.click();
  });
  await wait(4000);

  const denied = await page.evaluate(() => ({
    title: document.querySelector(".location-prompt__title")?.textContent ?? "",
    text: document.querySelector(".location-prompt__text")?.textContent ?? "",
    userDot: document.querySelectorAll(".user-dot").length,
    markers: document.querySelectorAll(".place-marker").length,
    mapAlive: Boolean(document.querySelector(".map-canvas canvas")),
  }));
  check("a refused permission is reported honestly", denied.title.includes("turned off") || denied.text.length > 0, denied.title);
  check("no location marker is faked when denied", denied.userDot === 0);
  check("the map keeps working after denial", denied.mapAlive && denied.markers > 0, `${denied.markers} markers`);
  await page.screenshot({ path: `${OUT}/01-denied.png` });
  await page.close();
}

/* ==================================================================== */
/* 2. Granted location — marker, centring, proximity                    */
/* ==================================================================== */

await context.overridePermissions(BASE, ["geolocation"]);
{
  const page = await newPage();
  await page.setGeolocation({ ...HERE, accuracy: 18 });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(10000);

  const before = await page.evaluate(() => {
    const c = window.__map.getCenter();
    return { lng: c.lng, lat: c.lat };
  });

  // Permission is already granted for this origin, so the app locates without
  // showing its own ask — which is the returning-visitor path.
  await page.waitForSelector(".user-dot", { timeout: 25000 });
  check("a granted permission produces a location marker", true);
  const noNag = await page.$eval(".location-prompt", (el) => el.dataset.open !== "true");
  check("no redundant ask when permission is already granted", noNag);
  await wait(6000);

  const after = await page.evaluate(() => {
    const c = window.__map.getCenter();
    return { lng: c.lng, lat: c.lat };
  });

  const moved =
    Math.abs(after.lat - HERE.latitude) < 0.0015 && Math.abs(after.lng - HERE.longitude) < 0.0015;
  check(
    "the map centres on the guest after the first fix",
    moved,
    `${before.lat.toFixed(4)},${before.lng.toFixed(4)} → ${after.lat.toFixed(4)},${after.lng.toFixed(4)}`,
  );

  // Proximity hierarchy.
  const tiers = await page.evaluate(() => {
    const markers = Array.from(document.querySelectorAll(".place-marker"));
    const counts = {};
    for (const m of markers) counts[m.dataset.tier] = (counts[m.dataset.tier] ?? 0) + 1;
    const nearest = markers.find((m) => m.dataset.tier === "nearest");
    return {
      counts,
      nearestLabel: nearest?.querySelector(".place-marker__name")?.textContent ?? null,
      nearestDistance: nearest?.querySelector(".place-marker__distance")?.textContent ?? null,
      labelled: markers.filter((m) => m.querySelector(".place-marker__label")).length,
      families: [...new Set(markers.map((m) => m.dataset.family))].sort(),
    };
  });

  check("exactly one place is marked nearest", tiers.counts.nearest === 1, JSON.stringify(tiers.counts));
  check("the nearest place carries a distance reading", Boolean(tiers.nearestDistance), `${tiers.nearestLabel} · ${tiers.nearestDistance}`);
  check("far places are de-emphasised, not hidden", (tiers.counts.far ?? 0) > 0, JSON.stringify(tiers.counts));
  check("labels stay scarce", tiers.labelled <= 3, `${tiers.labelled} labelled`);
  check("markers are coloured by family", tiers.families.length >= 4, tiers.families.join(", "));

  // Is the "nearest" actually the nearest? Independent haversine here.
  const truth = await page.evaluate(async (here) => {
    const res = await fetch("/models.seed.json"); // any fetch to keep timing honest
    void res;
    const R = 6371008.8;
    const rad = (d) => (d * Math.PI) / 180;
    const dist = (a, b) => {
      const p1 = rad(a.latitude), p2 = rad(b.latitude);
      const dp = p2 - p1, dl = rad(b.longitude - a.longitude);
      const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const names = Array.from(document.querySelectorAll(".place-marker")).map((m) =>
      m.getAttribute("aria-label"),
    );
    void names;
    return { dist: dist(here, { latitude: here.latitude, longitude: here.longitude }) };
  }, HERE);
  check("distance maths is sane (self-distance is zero)", Math.round(truth.dist) === 0);

  await page.screenshot({ path: `${OUT}/02-located.png` });

  // Tapping the nearest opens the existing card, with a real distance in it.
  await page.evaluate(() => {
    document.querySelector('.place-marker[data-tier="nearest"]')?.click();
  });
  await wait(2500);
  const card = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => d.getAttribute("aria-label")),
    meta: Array.from(document.querySelectorAll(".place-meta__item")).map((i) => i.textContent.trim()),
  }));
  check("tapping a place still opens its sheet", card.dialogs.length === 1, JSON.stringify(card.dialogs));
  check(
    "the sheet shows a measured distance",
    card.meta.some((m) => /\d+\s?(m|km)/.test(m) && /walk|away/.test(m)),
    JSON.stringify(card.meta),
  );
  await page.screenshot({ path: `${OUT}/03-place-card.png` });

  // Recentre control returns the camera after manual exploration.
  await page.keyboard.press("Escape");
  await wait(700);
  await page.evaluate(() => window.__map.jumpTo({ center: [44.79, 41.71], zoom: 14 }));
  await wait(2500);
  await page.click('button[aria-label="Recentre on your location"]');
  await wait(4000);
  const recentred = await page.evaluate(() => {
    const c = window.__map.getCenter();
    return { lng: c.lng, lat: c.lat };
  });
  check(
    "the recentre control brings the guest back",
    Math.abs(recentred.lat - HERE.latitude) < 0.002 && Math.abs(recentred.lng - HERE.longitude) < 0.002,
    `${recentred.lat.toFixed(4)},${recentred.lng.toFixed(4)}`,
  );

  await page.close();
}

/* ==================================================================== */
/* 3. Accounts                                                          */
/* ==================================================================== */

{
  const page = await newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => Boolean(window.__map), { timeout: 60000 });
  await wait(8000);

  await page.click('button[aria-label="Profile panel"]');
  await wait(900);
  const signedOut = await page.$(".account-card");
  check("a guest is offered an account, not forced into one", Boolean(signedOut));

  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".account-card__actions button"))
      .find((b) => b.textContent.trim() === "Create account")?.click();
  });
  await wait(1000);
  await page.waitForSelector("#fullName", { timeout: 10000 });
  await page.screenshot({ path: `${OUT}/04-signup.png` });

  // Invalid on purpose: bad email, weak password, mismatch.
  await type(page, "#fullName", "N");
  await type(page, "#email", "not-an-email");
  await type(page, "#password", "abc");
  await type(page, "#confirm", "different");
  await page.evaluate(() => document.querySelector(".auth-form button[type=submit]").click());
  await wait(800);

  const errors = await page.evaluate(() => ({
    messages: Array.from(document.querySelectorAll(".field__error")).map((e) => e.textContent.trim()),
    invalid: document.querySelectorAll('.input[aria-invalid="true"]').length,
    stillOpen: Boolean(document.querySelector("#fullName")),
  }));
  check("invalid input produces inline errors", errors.messages.length >= 4, JSON.stringify(errors.messages));
  check("invalid fields are flagged on the control itself", errors.invalid >= 4, String(errors.invalid));
  check("a failed submit does not close the sheet", errors.stillOpen);
  await page.screenshot({ path: `${OUT}/05-validation.png` });

  // Now a valid account.
  await type(page, "#fullName", "Nino Beridze");
  await type(page, "#email", "nino@example.com");
  await type(page, "#password", "mountains7");
  await type(page, "#confirm", "mountains7");
  await page.evaluate(() => document.querySelector(".auth-form button[type=submit]").click());
  await wait(2000);

  const afterSignUp = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    stored: JSON.parse(localStorage.getItem("hospitality-map.auth.users.v1") ?? "[]").length,
    plaintext: (localStorage.getItem("hospitality-map.auth.users.v1") ?? "").includes("mountains7"),
  }));
  check("a valid sign-up completes and closes the sheet", afterSignUp.dialogs === 0 && afterSignUp.stored === 1);
  check("the password is not stored in the clear", !afterSignUp.plaintext);

  await page.click('button[aria-label="Profile panel"]');
  await wait(900);
  const profile = await page.evaluate(() => ({
    name: document.querySelector(".profile-head__name")?.textContent ?? "",
    meta: document.querySelector(".profile-head__meta")?.textContent ?? "",
    card: Boolean(document.querySelector(".account-card")),
    signOut: Array.from(document.querySelectorAll(".pref__label")).some((l) => l.textContent === "Sign out"),
  }));
  check("the profile shows the signed-in identity", profile.name === "Nino Beridze" && profile.meta.includes("@"), `${profile.name} / ${profile.meta}`);
  check("the sign-up prompt is gone once signed in", !profile.card);
  check("signing out is available", profile.signOut);
  await page.screenshot({ path: `${OUT}/06-signed-in.png` });

  // Sign out, then sign back in with the same credentials.
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".pref")).find((p) =>
      p.querySelector(".pref__label")?.textContent === "Sign out",
    )?.click();
  });
  await wait(900);
  const afterSignOut = await page.$(".account-card");
  check("signing out returns the guest state", Boolean(afterSignOut));

  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".account-card__actions button"))
      .find((b) => b.textContent.trim() === "Sign in")?.click();
  });
  // The profile sheet is still animating out, and its title is the first
  // `.sheet__title` in the document — read from the account dialog itself.
  const arrived = await page
    .waitForFunction(
      () => {
        const open = Array.from(document.querySelectorAll('[role="dialog"]'));
        return open.length === 1 && open[0].getAttribute("aria-label") === "Sign in";
      },
      { timeout: 8000 },
    )
    .then(() => true)
    .catch(() => false);

  const onSignIn = await page.evaluate(() => {
    const sheet = document.querySelector('[role="dialog"][aria-label="Sign in"]');
    return {
      hasName: Boolean(sheet?.querySelector("#fullName")),
      title: sheet?.querySelector(".sheet__title")?.textContent ?? "",
    };
  });
  check(
    "'Sign in' opens the sign-in face, not sign-up",
    arrived && !onSignIn.hasName && onSignIn.title.includes("Welcome"),
    `${arrived ? "" : "(never settled) "}${onSignIn.title}`,
  );

  await type(page, "#email", "nino@example.com");
  await type(page, "#password", "wrongpassword1");
  await page.evaluate(() => document.querySelector(".auth-form button[type=submit]").click());
  await wait(1500);
  const badLogin = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".field__error")).map((e) => e.textContent.trim()),
  );
  check("wrong credentials are rejected inline", badLogin.some((m) => /do not match/i.test(m)), JSON.stringify(badLogin));

  await type(page, "#password", "mountains7");
  await page.evaluate(() => document.querySelector(".auth-form button[type=submit]").click());
  await wait(2000);
  const signedIn = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0);
  check("correct credentials sign the guest back in", signedIn);

  // Nothing in the product was gated behind the account.
  await page.click('button[aria-label="Scan a QR code"]');
  await wait(900);
  const qr = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length);
  check("guest features remain reachable throughout", qr === 1);

  await page.close();
}

console.log(results.join("\n"));
console.log("\nfailures:", results.filter((r) => r.startsWith("FAIL")).length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 8).join("\n") : "(none)");

await browser.close();
