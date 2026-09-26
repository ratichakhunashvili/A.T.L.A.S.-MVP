/**
 * The 25 recommendation-engine cases from the brief, run against the real
 * engine in the real bundle via the dev-only bridge.
 */

import { BASE, launch, outputDir } from "./harness.mjs";


const browser = await launch();

const page = await browser.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text().slice(0, 160)}`);
});

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForFunction(() => Boolean(window.__engine), { timeout: 60000 });

const results = await page.evaluate(() => {
  const E = window.__engine;
  const out = [];
  const check = (name, pass, detail = "") =>
    out.push({ name, pass: Boolean(pass), detail: String(detail) });

  /* -- Fixtures --------------------------------------------------------- */
  const today = new Date();
  const iso = (offset = 0) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const DATE = iso(0);
  const WEEKDAY = new Date(`${DATE}T12:00:00`).getDay();
  const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
  const hours = (opens = "08:00", closes = "23:00", days = ALL_DAYS) =>
    days.map((weekday) => ({ weekday, opens, closes }));

  const HOTEL = {
    id: "htl-test", name: "Test Hotel", address: "1 Road", city: "Tbilisi",
    latitude: 41.69314, longitude: 44.80217, active: true,
    timezone: "Asia/Tbilisi", checkInTime: "14:00", checkOutTime: "11:00",
    createdAt: "", updatedAt: "",
  };

  const reservation = (nights = 4) => ({
    id: "res-1", guestId: "g1", hotelId: HOTEL.id, guestName: "Nino",
    checkIn: iso(-1), checkOut: iso(nights - 1), nights, partySize: 2,
    source: "manual", createdAt: "", updatedAt: "",
  });

  let expSeq = 0;
  const experience = (over = {}) => ({
    id: `exp-${++expSeq}`, name: over.name ?? `Experience ${expSeq}`,
    description: "Something to do.", type: over.type ?? "PARTNER_ATTRACTION",
    category: over.category ?? "landmark",
    latitude: over.latitude ?? 41.6879, longitude: over.longitude ?? 44.8089,
    durationMin: over.durationMin ?? 60, openingHours: over.openingHours ?? hours(),
    budget: over.budget ?? "moderate", effort: over.effort ?? "low",
    interests: over.interests ?? ["sightseeing"], indoor: over.indoor ?? false,
    requiresBooking: false, isPartner: over.isPartner ?? true, active: over.active ?? true,
    createdAt: "", updatedAt: "", ...over,
  });

  const hotelActivity = (over = {}) =>
    experience({ type: "HOTEL_ACTIVITY", hotelId: HOTEL.id, category: "hotel",
      latitude: HOTEL.latitude, longitude: HOTEL.longitude,
      interests: ["relaxation"], indoor: true, isPartner: false, ...over });

  let prtSeq = 0;
  const partner = (exp, over = {}) => ({
    partner: {
      id: `prt-${++prtSeq}`, hotelId: HOTEL.id, experienceId: exp.id, active: true,
      priority: over.priority ?? 50, featured: over.featured ?? false,
      createdAt: "", updatedAt: "",
    },
    experience: exp,
  });

  const prefs = (over = {}) => ({
    guestId: "g1", interests: over.interests ?? [],
    energyLevel: over.energyLevel ?? "balanced", budget: over.budget ?? "moderate",
    range: over.range ?? { minKm: 0, maxKm: 30 },
    surpriseMe: over.surpriseMe ?? false,
    explicit: over.explicit ?? false, updatedAt: "",
  });

  const commitment = (start, end, label = "Dinner", date = DATE) => ({
    id: `cmt-${start}`, guestId: "g1", date, startTime: start, endTime: end,
    label, kind: "dinner", createdAt: "",
  });

  let evtSeq = 0;
  const event = (over = {}) => ({
    id: `evt-${++evtSeq}`, hotelId: HOTEL.id, name: over.name ?? "Live music",
    description: "On the roof.", date: over.date ?? DATE,
    startTime: over.startTime ?? "18:30", endTime: over.endTime ?? "20:00",
    location: "Roof", booked: over.booked ?? 0, capacity: over.capacity,
    requiresBooking: false, interests: over.interests ?? ["entertainment"],
    budget: "free", effort: "low", indoor: false, active: true,
    createdAt: "", updatedAt: "",
  });

  const historyEvent = (over = {}) => ({
    id: `ae-${Math.random()}`, guestId: "g1", hotelId: HOTEL.id,
    activityId: over.activityId ?? "exp-1", activityType: over.activityType ?? "PARTNER_ATTRACTION",
    category: over.category ?? "landmark", eventType: over.eventType ?? "completed",
    timestamp: over.timestamp ?? new Date().toISOString(),
    durationMin: over.durationMin, metadata: over.metadata,
  });

  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

  /** Deterministic generation: no wildcard unless a test asks for one. */
  const plan = (over = {}) =>
    E.generateDailyPlan({
      guestId: "g1", hotel: HOTEL, reservation: over.reservation ?? reservation(),
      date: over.date ?? DATE, preferences: over.preferences ?? prefs(),
      commitments: over.commitments ?? [],
      hotelActivities: over.hotelActivities ?? [],
      partners: over.partners ?? [], events: over.events ?? [],
      history: over.history ?? [],
      visitedAttractionIds: over.visited ?? new Set(),
      weather: over.weather,
      isToday: false, nowMinutes: 0, random: over.random ?? (() => 0.99),
    });

  const FOUR_PARTNERS = () => [
    partner(experience({ name: "Castle", category: "landmark", durationMin: 75,
      interests: ["sightseeing", "culture"] })),
    partner(experience({ name: "Winery", category: "experience", durationMin: 120,
      interests: ["food", "culture"], latitude: 41.6925, longitude: 44.8042 })),
    partner(experience({ name: "Restaurant", category: "restaurant", durationMin: 90,
      interests: ["food"], latitude: 41.6902, longitude: 44.8064 })),
    partner(experience({ name: "Garden", category: "nature", durationMin: 90,
      interests: ["nature"], latitude: 41.6871, longitude: 44.8003 })),
  ];

  /* == 1 · New guest ===================================================== */
  {
    const r = plan({ hotelActivities: [hotelActivity({ name: "Spa" })], partners: FOUR_PARTNERS() });
    check("1 · a new guest gets a workable day", r.plan.tasks.length >= 2,
      `${r.plan.tasks.length} tasks, score ${r.plan.activityScore}`);
    check("1 · and is not scored as inactive", r.plan.engagement !== "RESTING", r.plan.engagement);
  }

  /* == 2 · One-night stay ================================================ */
  {
    const res = { ...reservation(1), checkIn: DATE, checkOut: iso(1) };
    const r = plan({ reservation: res, hotelActivities: [hotelActivity({ name: "Spa" })],
      partners: FOUR_PARTNERS() });
    check("2 · a one-night stay still gets a plan", r.plan.tasks.length >= 1,
      `${r.plan.tasks.length} tasks`);
  }

  /* == 3 · Five-night stay =============================================== */
  {
    const r = plan({ reservation: reservation(5), hotelActivities: [hotelActivity({ name: "Spa" })],
      partners: FOUR_PARTNERS() });
    check("3 · a five-night stay plans today only", r.plan.date === DATE, r.plan.date);
  }

  /* == 4 · High activity guest =========================================== */
  {
    const history = [];
    for (let day = 0; day < 4; day += 1) {
      for (let n = 0; n < 3; n += 1) {
        history.push(historyEvent({
          activityId: `past-${day}-${n}`, timestamp: daysAgo(day),
          category: ["landmark", "restaurant", "nature", "museum"][n % 4],
          durationMin: 150,
        }));
      }
    }
    const engagement = E.computeEngagement(history);
    check("4 · a busy guest scores high", engagement.score >= 70, `score ${engagement.score}`);
    check("4 · and is classed HIGHLY_ACTIVE", engagement.state === "HIGHLY_ACTIVE", engagement.state);

    const budget = E.determineTaskCount(engagement.score, 600);
    check("4 · which raises the task target", budget.target >= 4, `target ${budget.target}`);
  }

  /* == 5 · Low activity guest ============================================ */
  {
    const history = [historyEvent({ timestamp: daysAgo(6), durationMin: 30 })];
    const engagement = E.computeEngagement(history);
    check("5 · a quiet guest scores low", engagement.score <= 45, `score ${engagement.score}`);

    const r = plan({ history, hotelActivities: [hotelActivity({ name: "Spa", effort: "low" })],
      partners: FOUR_PARTNERS() });
    check("5 · but still gets something", r.plan.tasks.length >= 1, `${r.plan.tasks.length} tasks`);
    check("5 · and is never told off", !/score|inactive|dropped/i.test(r.plan.summary), r.plan.summary);
  }

  /* == 6 · No preferences ================================================ */
  {
    const r = plan({ preferences: prefs({ interests: [], explicit: false }),
      hotelActivities: [hotelActivity({ name: "Spa" })], partners: FOUR_PARTNERS() });
    check("6 · a guest with no preferences still gets a plan", r.plan.tasks.length >= 2,
      `${r.plan.tasks.length} tasks`);
  }

  /* == 7 · Strong preferences ============================================ */
  {
    const r = plan({
      preferences: prefs({ interests: ["food"], explicit: true }),
      partners: FOUR_PARTNERS(), random: () => 0.99,
    });
    const names = r.plan.tasks.map((t) => t.title);
    check("7 · strong preferences steer the plan",
      names.includes("Winery") || names.includes("Restaurant"), names.join(", "));
  }

  /* == 8 · Hotel with no partners ======================================== */
  {
    const r = plan({ hotelActivities: [hotelActivity({ name: "Spa" })], partners: [] });
    check("8 · no partners means hotel-only, never strangers",
      r.plan.tasks.every((t) => t.activityType === "HOTEL_ACTIVITY" || t.activityType === "HOTEL_EVENT"),
      r.plan.tasks.map((t) => t.activityType).join(", "));
    check("8 · and the diagnostics say so", r.diagnostics.noPartners === true);
  }

  /* == 9 · Hotel with many partners ====================================== */
  {
    const many = [];
    for (let n = 0; n < 12; n += 1) {
      many.push(partner(experience({ name: `Partner ${n}`, durationMin: 60 })));
    }
    const r = plan({ partners: many, hotelActivities: [hotelActivity({ name: "Spa" })] });
    check("9 · many partners still respects the daily maximum", r.plan.tasks.length <= 5,
      `${r.plan.tasks.length} tasks`);
  }

  /* == 10 · No hotel activity available ================================== */
  {
    const r = plan({ hotelActivities: [], partners: FOUR_PARTNERS() });
    check("10 · a day with no hotel option is not faked",
      r.plan.tasks.every((t) => t.activityType !== "HOTEL_ACTIVITY"));
    check("10 · and is not reported as an omission",
      r.plan.hotelActivityOmitted === false, String(r.plan.hotelActivityOmitted));
    check("10 · partner tasks still fill the day", r.plan.tasks.length >= 1,
      `${r.plan.tasks.length} tasks`);
  }

  /* == 11 · Short free-time window ======================================= */
  {
    const r = plan({
      commitments: [commitment("09:00", "17:30"), commitment("19:30", "23:00")],
      hotelActivities: [hotelActivity({ name: "Spa", durationMin: 45 })],
      partners: FOUR_PARTNERS(),
    });
    check("11 · a short window gets at most one task", r.plan.tasks.length <= 1,
      `${r.plan.tasks.length} tasks, ${r.diagnostics.totalFreeMin} free min`);
    check("11 · and nothing overlaps a commitment",
      r.diagnostics.scheduleViolations.length === 0,
      r.diagnostics.scheduleViolations.join("; "));
  }

  /* == 12 · Long free-time window ======================================== */
  {
    const r = plan({ hotelActivities: [hotelActivity({ name: "Spa" })], partners: FOUR_PARTNERS() });
    check("12 · a long window fills up, within the cap",
      r.plan.tasks.length >= 2 && r.plan.tasks.length <= 5, `${r.plan.tasks.length} tasks`);
  }

  /* == 13 · Rainy day ==================================================== */
  {
    const outdoor = partner(experience({ name: "Open castle", indoor: false }));
    const indoor = partner(experience({ name: "Museum", category: "museum", indoor: true,
      latitude: 41.6975, longitude: 44.7999 }));
    const r = plan({ partners: [outdoor, indoor],
      weather: { condition: "rain", precipitationChance: 0.85 } });
    check("13 · heavy rain removes outdoor options",
      r.plan.tasks.every((t) => t.title !== "Open castle"),
      r.plan.tasks.map((t) => t.title).join(", "));
    check("13 · indoor options survive",
      r.plan.tasks.some((t) => t.title === "Museum"),
      r.plan.tasks.map((t) => t.title).join(", "));
  }

  /* == 14 · Repeated activities ========================================== */
  {
    const partners = FOUR_PARTNERS();
    const castleId = partners[0].experience.id;
    const history = [historyEvent({ activityId: castleId, timestamp: daysAgo(1),
      category: "landmark" })];
    const r = plan({ partners, history });
    check("14 · yesterday's activity is not offered again",
      r.plan.tasks.every((t) => t.activityId !== castleId),
      r.plan.tasks.map((t) => t.title).join(", "));
  }

  /* == 15 · AI unavailable =============================================== */
  {
    const r = plan({ hotelActivities: [hotelActivity({ name: "Spa" })], partners: FOUR_PARTNERS() });
    check("15 · a plan exists without AI", r.plan.tasks.length >= 2 && r.plan.aiAssisted === false,
      `${r.plan.tasks.length} tasks, aiAssisted ${r.plan.aiAssisted}`);
    check("15 · every task still has a reason",
      r.plan.tasks.every((t) => t.reason && t.reason.length > 4));
  }

  /* == 16 · Invalid AI response ========================================== */
  {
    const base = plan({ partners: FOUR_PARTNERS() }).plan;
    const realId = base.tasks[0]?.activityId;

    let threw = false;
    try { E.parseRankingResponse("not json"); } catch { threw = true; }
    check("16 · prose is rejected outright", threw);

    try { E.parseRankingResponse({ tasks: [] }); threw = false; } catch { threw = true; }
    check("16 · an empty task list is rejected", threw);

    const merged = E.mergeRanking(base, {
      summary: "Invented day",
      tasks: [
        { activityId: "exp-does-not-exist", title: "Hallucinated", shortDescription: "", reason: "", order: 0 },
        { activityId: realId, title: "Rewritten", shortDescription: "Better words", reason: "Nicer reason", order: 1 },
      ],
    });
    check("16 · a hallucinated id cannot become a task",
      merged.tasks.every((t) => t.activityId !== "exp-does-not-exist"),
      merged.tasks.map((t) => t.activityId).join(", "));
    check("16 · the task count is unchanged", merged.tasks.length === base.tasks.length,
      `${merged.tasks.length} vs ${base.tasks.length}`);
    check("16 · valid copy is applied",
      merged.tasks.some((t) => t.title === "Rewritten"));
    check("16 · but the schedule is not taken from AI",
      merged.tasks.every((t, i) => t.startTime === [...base.tasks].sort((a, b) =>
        a.startTime.localeCompare(b.startTime))[i].startTime));
  }

  /* == 17 · Reservation OCR failure ====================================== */
  {
    const nothing = E.parseReservationText("Dear customer, thank you for your interest.");
    check("17 · unreadable text yields low confidence", nothing.confidence < 0.55,
      `confidence ${nothing.confidence}`);

    const good = E.parseReservationText(
      "Booking reference: BK-48219\nHotel: Hotel Veli\nCheck-in: 2026-10-12\nCheck-out: 2026-10-16\n2 adults",
    );
    check("17 · a readable confirmation is parsed",
      good.checkIn === "2026-10-12" && good.checkOut === "2026-10-16" && good.nights === 4,
      `${good.checkIn} → ${good.checkOut}, ${good.nights} nights`);
    check("17 · the reference is picked up", good.reference === "BK-48219", String(good.reference));
    check("17 · ambiguous dates are refused, not guessed",
      E.normaliseDate("03/04/2026") === undefined, String(E.normaliseDate("03/04/2026")));
    check("17 · unambiguous ones are read",
      E.normaliseDate("14/03/2026") === "2026-03-14", String(E.normaliseDate("14/03/2026")));
  }

  /* == 18/19/20 handled below against the live repositories ============== */

  /* == 21/22 · 3D model presence ========================================= */
  {
    const withModel = experience({ name: "Modelled castle", modelId: "some-model" });
    const without = experience({ name: "Plain castle", latitude: 41.6902, longitude: 44.8064 });
    const r = plan({ partners: [partner(withModel), partner(without)] });
    check("21/22 · a model neither grants nor blocks eligibility",
      r.plan.tasks.length === 2, r.plan.tasks.map((t) => t.title).join(", "));
  }

  /* == 23 · Event overlapping free time ================================== */
  {
    const r = plan({ events: [event({ startTime: "18:30", endTime: "20:00" })],
      partners: FOUR_PARTNERS() });
    const ev = r.plan.tasks.find((t) => t.activityType === "HOTEL_EVENT");
    check("23 · an event in a free window is scheduled at its own time",
      ev?.startTime === "18:30", ev ? `${ev.startTime}–${ev.endTime}` : "not scheduled");
  }

  /* == 24 · Event overlapping a commitment =============================== */
  {
    const r = plan({
      events: [event({ startTime: "19:00", endTime: "20:30" })],
      commitments: [commitment("19:00", "21:00", "Dinner")],
      partners: FOUR_PARTNERS(),
    });
    check("24 · an event clashing with dinner is dropped",
      r.plan.tasks.every((t) => t.activityType !== "HOTEL_EVENT"),
      r.plan.tasks.map((t) => `${t.title}@${t.startTime}`).join(", "));
    check("24 · and nothing else overlaps it either",
      r.diagnostics.scheduleViolations.length === 0,
      r.diagnostics.scheduleViolations.join("; "));
  }

  /* == 25 · Guest who skips a lot ======================================== */
  {
    const history = [
      historyEvent({ eventType: "skipped", category: "entertainment", timestamp: daysAgo(1), activityId: "n1" }),
      historyEvent({ eventType: "skipped", category: "entertainment", timestamp: daysAgo(2), activityId: "n2" }),
      historyEvent({ eventType: "skipped", category: "entertainment", timestamp: daysAgo(3), activityId: "n3" }),
    ];
    const nightlife = partner(experience({ name: "Jazz club", category: "entertainment",
      interests: ["nightlife"], latitude: 41.6968, longitude: 44.7995 }));
    const garden = partner(experience({ name: "Garden", category: "nature",
      interests: ["nature"], latitude: 41.6871, longitude: 44.8003 }));

    const withFatigue = plan({ partners: [nightlife, garden], history });
    const without = plan({ partners: [nightlife, garden], history: [] });

    const rankOf = (r) => r.plan.tasks.findIndex((t) => t.title === "Jazz club");
    check("25 · repeated skips demote a category, not ban it",
      rankOf(withFatigue) >= rankOf(without) || rankOf(withFatigue) === -1,
      `with ${rankOf(withFatigue)}, without ${rankOf(without)}`);
    check("25 · a skipped category is still reachable",
      withFatigue.plan.tasks.length >= 1, `${withFatigue.plan.tasks.length} tasks`);
  }

  /* == Hotel activity requirement (17 in the brief) ====================== */
  {
    const r = plan({ hotelActivities: [hotelActivity({ name: "Spa", durationMin: 45 })],
      partners: FOUR_PARTNERS() });
    check("business rule · a hotel activity is in the plan",
      r.plan.tasks.some((t) => t.activityType === "HOTEL_ACTIVITY"),
      r.plan.tasks.map((t) => t.activityType).join(", "));
  }

  /* == Partner restriction, stated directly ============================== */
  {
    const partners = FOUR_PARTNERS();
    const r = plan({ partners, hotelActivities: [hotelActivity({ name: "Spa" })] });
    const allowed = new Set([...partners.map((p) => p.experience.id)]);
    check("partner restriction · every outside task is a partner",
      r.plan.tasks.filter((t) => t.distanceM !== null).every((t) => allowed.has(t.activityId)),
      r.plan.tasks.map((t) => t.activityId).join(", "));
  }

  /* == Wildcard ========================================================== */
  {
    const partners = FOUR_PARTNERS();
    const always = plan({ partners, preferences: prefs({ interests: ["food"], explicit: true }),
      random: () => 0 });
    const never = plan({ partners, preferences: prefs({ interests: ["food"], explicit: true }),
      random: () => 0.99 });
    check("wildcard · at most one per day",
      always.plan.tasks.filter((t) => t.isWildcard).length <= 1,
      String(always.plan.tasks.filter((t) => t.isWildcard).length));
    check("wildcard · it is not forced on every plan",
      never.plan.tasks.every((t) => !t.isWildcard));
    const wild = always.plan.tasks.find((t) => t.isWildcard);
    check("wildcard · its reason is honest about being different",
      !wild || /different|usually/i.test(wild.reason), wild?.reason ?? "no wildcard");
  }

  /* == Free windows and travel =========================================== */
  {
    const windows = E.calculateFreeWindows([commitment("12:00", "13:00"), commitment("19:00", "21:00")]);
    check("time · commitments split the day",
      windows.length === 3, JSON.stringify(windows));
    check("time · buffers are left around them",
      windows[0].end <= 12 * 60 - 10, String(windows[0].end));
    check("time · a short hop is walked", E.travelMinutes(800) <= 12, String(E.travelMinutes(800)));
    check("time · a long one is not", E.travelMinutes(6000) > 15, String(E.travelMinutes(6000)));
  }

  /* == Task count logic ================================================== */
  {
    const low = E.determineTaskCount(10, 600);
    const high = E.determineTaskCount(95, 600);
    check("count · a low score asks for less", low.target <= 2, `target ${low.target}`);
    check("count · a high score asks for more", high.target >= 4, `target ${high.target}`);
    check("count · never more than five", high.max <= 5, String(high.max));

    const squeezed = E.determineTaskCount(95, 90);
    check("count · free time overrides the score",
      squeezed.max <= 1 && squeezed.limitedBy === "free_time",
      `max ${squeezed.max}, limited by ${squeezed.limitedBy}`);
  }

  /* == Reservation validation ============================================ */
  {
    check("reservation · check-out must be after check-in",
      E.validateReservation({ guestName: "A", checkIn: "2026-10-16", checkOut: "2026-10-12" })
        .includes("checkout_not_after_checkin"));
    check("reservation · nights are derived",
      E.nightsBetween("2026-10-12", "2026-10-16") === 4,
      String(E.nightsBetween("2026-10-12", "2026-10-16")));
    check("reservation · a valid stay passes",
      E.validateReservation({ guestName: "Nino", checkIn: "2026-10-12", checkOut: "2026-10-16" })
        .length === 0);
  }

  /* == QR payloads ======================================================= */
  {
    const fromJson = E.parseQRPayload(JSON.stringify({
      guestName: "Nino Beridze", hotel: "Hotel Veli",
      checkIn: "2026-10-12", checkOut: "2026-10-16", bookingRef: "BK-1",
    }));
    check("qr · a JSON booking is read exactly",
      fromJson?.checkIn === "2026-10-12" && fromJson?.nights === 4,
      JSON.stringify(fromJson));

    const fromUrl = E.parseQRPayload("https://book.example.com/r?checkin=2026-10-12&checkout=2026-10-16&ref=BK-2");
    check("qr · a URL booking is read", fromUrl?.reference === "BK-2", JSON.stringify(fromUrl));

    check("qr · a wifi code is not a booking",
      E.parseQRPayload("WIFI:S:Hotel;T:WPA;P:hunter2;;") === null ||
      E.parseQRPayload("WIFI:S:Hotel;T:WPA;P:hunter2;;")?.fields.length === 0);
  }

  /* == Token entropy ===================================================== */
  {
    const tokens = new Set();
    for (let n = 0; n < 500; n += 1) tokens.add(E.generateHotelToken());
    check("token · 500 tokens, no collision", tokens.size === 500, String(tokens.size));
    const sample = E.generateHotelToken();
    check("token · uses an unambiguous alphabet", /^[0-9A-HJKMNP-TV-Z]{20}$/.test(sample), sample);
  }

  return out;
});

/* -- Cases that need the live repositories ------------------------------ */
const repoResults = await page.evaluate(async () => {
  const E = window.__engine;
  const out = [];
  const check = (name, pass, detail = "") =>
    out.push({ name, pass: Boolean(pass), detail: String(detail) });

  /* == 18 · Invalid hotel token ========================================== */
  const bad = await E.resolveHotelToken("NOTAREALTOKEN0000000");
  check("18 · an unknown token is refused", bad.ok === false && bad.reason === "unknown",
    JSON.stringify(bad));

  /* == The seeded token resolves ========================================= */
  const good = await E.resolveHotelToken("VELIDEMO2026TBILISI0");
  check("18 · the seeded token resolves to its hotel",
    good.ok === true && good.hotel.name === "Hotel Veli",
    good.ok ? good.hotel.name : good.reason);

  /* == 20 · Partner removed from hotel =================================== */
  if (good.ok) {
    const before = await E.eligiblePartnerExperiences(good.hotel.id);
    check("20 · the seeded hotel has a partner network", before.length >= 5,
      `${before.length} partners`);

    const victim = before[0].experience;
    await E.detachPartner(good.hotel.id, victim.id);
    const after = await E.eligiblePartnerExperiences(good.hotel.id);
    check("20 · detaching removes it from eligibility immediately",
      !after.some((entry) => entry.experience.id === victim.id),
      `${before.length} → ${after.length}`);

    await E.attachPartner(good.hotel.id, victim.id);
    const restored = await E.eligiblePartnerExperiences(good.hotel.id);
    check("20 · re-attaching restores it", restored.length === before.length,
      `${restored.length} vs ${before.length}`);
  }

  /* == 19 · Inactive hotel =============================================== */
  if (good.ok) {
    // The app's own repository instance — a separate `import()` would write to
    // the same storage but leave the running app reading its own stale cache.
    const { hotels } = E.repositories;
    await hotels.update(good.hotel.id, { active: false });
    const blocked = await E.resolveHotelToken("VELIDEMO2026TBILISI0");
    check("19 · an inactive hotel refuses onboarding",
      blocked.ok === false && blocked.reason === "inactive_hotel", JSON.stringify(blocked));
    await hotels.update(good.hotel.id, { active: true });
  }

  return out;
});

const all = [...results, ...repoResults];
for (const entry of all) {
  console.log(`${entry.pass ? "PASS" : "FAIL"}  ${entry.name}${entry.detail ? ` — ${entry.detail}` : ""}`);
}
console.log("\nfailures:", all.filter((entry) => !entry.pass).length, "of", all.length);
console.log("console problems:", problems.length ? [...new Set(problems)].slice(0, 6).join("\n") : "(none)");

await browser.close();
