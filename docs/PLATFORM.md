# The hotel experience platform

> "You're already here. Tell us when you're free — we'll figure out what you can do."

This document covers the guest onboarding, hotel QR system, partner network,
recommendation engine and admin console that sit on top of the existing
map-first guest app. The map, the 3D model registry and the design system are
unchanged; everything here was added around them.

---

## 1 · Architecture at a glance

```
src/
  data/
    domain.ts              every platform entity
    repositories/
      collection.ts        the storage seam (local + HTTP implementations)
      hotels.ts            hotels, QR codes, token resolution
      catalogue.ts         experiences, HotelPartner join, hotel events
      guests.ts            session, reservation, preferences, commitments
      activity.ts          behaviour log + hotel analytics
      plans.ts             daily plans + the task state machine
  engine/
    config.ts              every weight, limit and threshold
    time.ts                free windows, travel, opening hours, slot finding
    engagement.ts          the 0–100 activity score
    candidates.ts          normalises Experience / HotelEvent for the engine
    rules.ts               LAYER 1 — what is allowed
    scoring.ts             LAYER 2 — what makes sense
    plan.ts                the pipeline
    service.ts             repositories + engine + AI, wired together
  ai/
    provider.ts            LAYER 3 — the AI seam, with strict validation
    enhance.ts             applying AI output safely
  join/                    the public onboarding flow
  admin/hotels/            the operator console
api/
  _ai.ts                   provider plumbing (the only place a key is read)
  ai/status.ts             GET  — is AI configured?
  ai/rank.ts               POST — rank and rewrite a validated shortlist
  ai/parse-reservation.ts  POST — extract fields from reservation text
```

**Storage.** There is no database. The existing `ModelRepository` pattern —
an interface, a browser-local implementation, and a documented HTTP swap — was
generalised into `Collection<T, D>` and every new entity uses it. Records live
in `localStorage` under `atlas.*`, seeded once from `public/platform.seed.json`.
`createHttpCollection("/api/hotels")` is a drop-in replacement per entity, so
the migration to a real backend can be done one entity at a time.

**Routing.** Three surfaces, no router library:

| Path | Surface |
|---|---|
| `/join/hotel/:token` | public onboarding, reached by scanning |
| `/admin` (or `#/admin`) | the operator console |
| everything else | the guest map, still routeless |

`vercel.json` rewrites everything except `/api/*` to `index.html` so a printed
QR link resolves on a fresh load.

---

## 2 · Data model

| Entity | Notes |
|---|---|
| `Hotel` | name, location, timezone, check-in/out times, `active` |
| `HotelQRCode` | `token`, `active`, `expiresAt`, `scanCount`; many per hotel over time |
| `Experience` | one record for hotel activities *and* partner experiences; `type` says which |
| `HotelPartner` | **the join**: `hotelId` × `experienceId`, `active`, `priority`, `featured`, `commissionPct` |
| `HotelEvent` | fixed date/time, optional capacity |
| `Reservation` | `hotelId` always stamped from the resolved token |
| `GuestPreferences` | interests, energy, budget, `explicit` |
| `Commitment` | a hard constraint in the guest's day |
| `UserActivityEvent` | append-only behaviour log |
| `DailyPlan` / `Task` | a day, with its tasks embedded; carries the hotel's reward |
| `Achievement` | one per attraction, themed on it |
| `UserAchievement` | a guest holds one once; `featured` marks the profile three |
| `GuestSession` | device-local guest identity; works with no hotel at all |

### The partner relationship

```
Hotel ──< HotelPartner >── Experience ──> MapModel (optional)
```

Many-to-many by design: one castle can be sold by four hotels, each with its
own priority, its own description and its own commission.

A 3D model is attached to an `Experience` and is **purely visual**. It confers
no partner status. `Experience.modelId` points at a `MapModel`; nothing points
back. A model with no experience still renders — it is simply decorative and
cannot become a task.

---

## 3 · The QR flow

```
printed QR  →  /join/hotel/{token}
                     │
                     ├─ resolveHotelToken(token)
                     │     unknown / inactive_code / expired_code /
                     │     inactive_hotel / missing_hotel → a specific screen
                     │
                     ├─ startSession(hotel.id, token)   guest id created here
                     ├─ recordScan(code.id)             once per arrival
                     │
                     ├─ Welcome  → hotel named, never searched for
                     ├─ Reservation: scan/upload  OR  manual
                     ├─ Confirm "here's what we found" — always editable
                     ├─ Interests (multi-select) → Energy → Budget
                     ├─ Commitments already in the diary
                     └─ Plan generated, guest lands on the map
```

**Tokens.** 20 characters of Crockford base32 from `crypto.getRandomValues` —
100 bits, no sequential ids in the URL, and no I/L/O/U so a token read off a
card cannot be mistyped into another valid one. Regenerating retires every
earlier code for that hotel immediately but keeps the records, so scan history
survives.

**Reservation parsing** tries three strategies in order of trust:

1. a QR code in the image (JSON, URL query, or `key=value`) — read exactly
2. deterministic text patterns — dates, reference, party size
3. the AI parser, for prose the patterns cannot reach

Nothing is ever saved without the guest confirming it. Ambiguous dates
(`03/04/2026`) are deliberately **not** interpreted — they are left blank for
the guest to type. Uploaded files never leave the browser; only extracted text
is sent to `/api/ai/parse-reservation`, and nothing is persisted there.

---

## 4 · The recommendation engine

Three layers, in a fixed order. The whole design exists so that the product's
promises are true by construction rather than by luck.

### Layer 1 — rules (`rules.ts`)

Decides what is **allowed**. Every rejection carries a named reason.

- partnered with this hotel? (the pool is built from `HotelPartner` rows only)
- within the guest's chosen distance? (a hard limit, not a preference)
- somewhere they have already collected? (a place you have been is not a task)
- open on this weekday?
- already done in the last 3 days? explicitly disliked?
- does it fit inside any free window?
- is an event already over, or full?
- is the weather prohibitive for an outdoor activity?

`validateSchedule` then checks the *finished* plan independently of how it was
built: no overlaps, nothing over a commitment, nothing outside a free window,
nothing over the daily cap.

### Layer 2 — scoring (`scoring.ts`)

Decides what **makes sense**. Eleven factors, each 0–1, each weighted in
`config.ts`:

`preferenceMatch · timeFit · distanceEfficiency · novelty · recentInterest ·
energyFit · budgetFit · hotelPriority · partnerPriority · variety · weather`

plus a bounded `hotelActivityBonus` / `hotelEventBonus` — a thumb on the scale,
not a thumb through it — and a fatigue multiplier for categories the guest
keeps skipping.

Deterministic and total: same inputs, same order, every time.

### Layer 3 — AI (`ai/`)

Ranks and rewrites. It **cannot add**. The model receives a shortlist the rules
already approved and may only reorder it and improve its copy. Two independent
gates enforce this:

- `api/ai/rank.ts` filters the response against the ids it sent
- `mergeRanking` filters again against the tasks already in the plan

Times are never taken from the model. Presentation order may follow it; the
schedule may not.

**Failure is a non-event.** Unconfigured, offline, slow, malformed, or
hallucinating — every path returns the deterministic plan unchanged, and the
only observable difference is `plan.aiAssisted === false`.

### Pipeline order (`plan.ts`)

```
1 reservation   2 free time     3 hotel activity   4 partner restriction
5 opening hrs   6 travel time   7 commitments      8 history
9 preferences  10 budget       11 energy          12 engagement score
13 variety     14 exploration  15 AI ranking
```

Step 3 is taken **before** partner activities, so "at least one hotel activity
when a suitable one exists" holds by construction rather than by hoping the
scores work out.

### Engagement score (`engagement.ts`)

0–100, from four time-decayed factors: completion 40%, consistency 25%,
difficulty 20%, variety 15%. Half-life is 2 days, so yesterday dominates.

It is **never shown to the guest** and never framed as a judgement. A guest
with no history starts at the baseline (45), not at zero. A resting guest gets
"Slow day? Something easy" and shorter, closer, lower-effort suggestions — not
an emptier day and never a scolding.

| Score | State | Task target |
|---|---|---|
| 0–25 | RESTING | 1–2 |
| 26–50 | CASUAL | 2–3 |
| 51–75 | ENGAGED | 3–4 |
| 76–100 | HIGHLY_ACTIVE | 4–5 |

On top of that, **momentum** reads the last three days: clear everything and
tomorrow offers one more, miss most of it and tomorrow offers one fewer.
Bounded to one step, so a day never doubles or collapses.

Available free time always overrides both, and nothing exceeds 5 a day.

### Exploration

Configured as a **share** rather than a per-day chance, because the share is
what the product cares about: roughly a quarter of what a guest is offered
should be something they did not ask for. `wildcardChance` turns the share into
a probability, so the target holds whether the day has two tasks or five.

| Situation | Discovery share |
|---|---|
| Stated interests | 25% |
| No stated interests | 40% |
| "Surprise me" on | 50% |

At most one per day. It is the one thing allowed to reach past the guest's
stated distance, and only by `rangeSlackKm`. It is drawn from categories the
plan has not used, must clear every hard rule, and must score at least 45% of
the best candidate. Its copy is honest: *"You usually go for food and
sightseeing — this one's a little different."* It never claims other guests
liked it.

---

## 4b · Achievements, codes and rewards

### Attraction codes

```
printed sign  →  /scan/attraction/{attractionId}
                       │
                       ├─ an anonymous guest is created if there isn't one
                       ├─ the achievement for that attraction is resolved
                       ├─ already held?  →  nothing happens at all
                       └─ otherwise      →  unlocked, toast slides down, map
```

Unlocking is **by attraction, never by achievement id**. `unlockByAttraction`
is the only write path, so a crafted achievement id in a URL has nowhere to
go. A second scan returns `already` and produces no row, no event and no
notification.

Unlike a hotel token, the code carries the record's own id. That is a
deliberate trade: the id names a public place, and the worst a guessed one
does is give someone a sticker for a place they did not stand in. A hotel
token grants a stay, which is why that one is 100 bits of entropy.

### The three on the profile

`featured` is a flag on the guest's own row, so "exactly three" is a local
invariant rather than a rule kept in two places. The first three unlock
automatically so the stack is never empty; after that the guest chooses, and
the interface refuses a fourth rather than evicting one silently.

### Stickers

Real art is used when an admin uploads it. Until then a themed placeholder is
drawn from the palette, so the system works end to end before a single sticker
exists — and swapping in the real assets changes nothing but the image.

### The development account

`ratichakhunashvili@gmail.com` holds every active achievement. It is a
**read-time grant**, not rows in storage: a new achievement created in the
admin is available immediately with nothing to backfill, and the grant
disappears the moment the address changes rather than leaving fake unlock
records behind.

### The daily reward

One concrete thing the hotel offers for finishing the day — not a balance, not
a tier, not something that accumulates. `rewardUnlocked` is recomputed on every
task transition, so skipping the last task locks it again and completing it
unlocks it, with nothing to remember. **There are no points anywhere in the
product.**

---

## 4c · The day

The active day is the current calendar day in the hotel's timezone. At local
midnight a single timeout fires: the plan becomes history, today starts empty
and is generated fresh. Yesterday's incomplete tasks are **not** carried
forward — they stay on yesterday's plan.

Changing a preference never rebuilds the day. Settings save immediately and
take effect on the next plan; **Regenerate route** in the profile, and
**Regenerate today** in the stay panel, are the only things that replace it.

---

## 5 · Task lifecycle

```
AVAILABLE ──▶ STARTED ──▶ COMPLETED ──▶ VERIFIED
    │  │           └────▶ SKIPPED / MISSED
    │  └────▶ BOOKED ────▶ STARTED
    └───────▶ SKIPPED / MISSED / EXPIRED / LOCKED
```

Transitions go through `transitionTask`, which checks a legal-move table and
writes to the behaviour log in the same call — so a completion cannot appear in
the guest's history and be missing from the hotel's analytics.

**Verification.** `manual` today. The architecture supports `hotel_qr`,
`partner_qr`, `location` and `booking`, and the in-app scanner already handles
`atlas:activity:<id>` codes — matched against the guest's own plan, so a
partner's code can only complete a task that was actually scheduled.

---

## 6 · Environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `VITE_MAPBOX_TOKEN` | client | yes | Mapbox GL. Must be **Config**, not Secret, on Vercel |
| `AI_PROVIDER` | server | no | `anthropic` or `openai`. Unset disables AI entirely |
| `ANTHROPIC_API_KEY` | server | if anthropic | |
| `OPENAI_API_KEY` | server | if openai | |
| `AI_MODEL` | server | no | model id override |
| `AI_BASE_URL` | server | no | for an OpenAI-compatible or local endpoint |

Only `VITE_`-prefixed variables reach the browser. Provider keys are read in
`api/_ai.ts` and nowhere else.

---

## 7 · Privacy and security

- Reservation documents are **never uploaded**. Parsing happens in the browser;
  only extracted text reaches the server, and nothing is written to disk, a log
  or a database.
- `/api/ai/*` responses are `no-store`.
- `Reservation.hotelId` is always taken from the resolved QR token, never from
  client input — a guest cannot attach themselves to a hotel they did not scan.
- Hotel analytics are aggregate only: counts, rates and category totals. No
  guest names, reservations or itineraries.
- QR tokens are high-entropy and revocable; hotel ids never appear in a public
  URL.

**Known limitation.** With no server-side database, "validate all server-side
relationships" is only partly achievable: token resolution and the partner
restriction are enforced in code that runs in the browser, and a determined
user with devtools can edit their own `localStorage`. This affects only their
own device and their own plan. Moving the repositories to
`createHttpCollection` puts the same checks behind an API, which is the
intended next step.

---

## 8 · Admin guide

Open `/admin`. Two sections: **Hotels** and **3D models**.

1. **Create a hotel** — Hotels → New hotel. Name, address, coordinates,
   check-in/out times. A QR code is issued automatically on creation.
2. **Generate / manage the QR** — Hotels → *hotel* → QR. Preview, copy the
   link, download PNG or SVG for print, deactivate, or regenerate. Scan count
   and active guest count are shown. Regenerating kills the current code
   immediately — reprint first.
3. **Add partners** — Hotels → *hotel* → Partners → Add partner. Pick from the
   shared catalogue. Set priority (0–100) and mark favourites as featured.
   Detaching is reversible and keeps the negotiated terms.
4. **Attach a 3D model** — Hotels → *hotel* → Activities → edit an experience →
   *3D model*. Choose from models already in the library; you never upload one
   twice. Attaching a model does **not** make anything a partner.
5. **Hotel activities and events** — Activities for the spa, the rooftop,
   breakfast; Events for anything with a fixed date and time and optional
   capacity.
6. **Test the guest flow** — QR tab → copy link → open it in a private window.
   Or use the seeded demo token `VELIDEMO2026TBILISI0` →
   `/join/hotel/VELIDEMO2026TBILISI0`.
7. **Give an attraction its achievement and code** — Hotels → *hotel* →
   Activities → edit an attraction. The achievement (name, description, icon,
   colour, optional art) and its printed code are on the same screen, because
   to an operator they are one thing. One achievement per attraction.
8. **Place something on the map** — every hotel and attraction form opens a
   map: search, click or drag. Coordinates fill themselves in, and typing them
   is the advanced option behind "Type coordinates instead".
9. **Hide the basemap building under a model** — 3D models → edit → *Hide
   building underneath*. Tap *Pick another* to add a second footprint. Only
   the buildings you name are hidden; the rest of the city stays.
10. **Set the daily reward** — Hotels → *hotel* → Overview → Daily reward.
11. **Diagnose an empty day** — Hotels → *hotel* → Overview → *Dry-run the
   engine*. Reports eligible counts, free minutes, what limited the day and
   which rules filtered what.
8. **Close a property for a season** — Overview → turn off *Taking guests*.
   The QR refuses new onboarding; nothing is lost and existing guests keep
   their plans.
9. **Delete a property** — Overview → *Delete property*. The confirmation
   states the real counts before anything happens.

### What deleting a hotel removes

| Goes with it | Survives |
|---|---|
| the hotel record | partner **experiences** (shared catalogue — other hotels may still sell them) |
| its QR codes (printed cards stop working at once) | 3D models (assets, not property records) |
| the activities and events it runs itself | every other hotel's records |
| its partner **links** | |
| reservations, daily plans and behaviour-log entries for that stay | |

Guest records go because a reservation for a property that no longer exists is
a record nobody can act on, and keeping someone's behaviour after the business
relationship ends is not data worth holding. Dependents are cleared before the
hotel, so an interrupted run can be re-run and never leaves a row pointing at a
hotel that is gone.

---

## 9 · Testing

```bash
npm run dev            # http://localhost:5180
npm run typecheck      # app + api projects
npm run build
```

Two Puppeteer suites live in the session scratchpad:

- `enginetests.mjs` — 70 assertions covering all 25 cases from the brief,
  driving the real engine through a dev-only bridge (`window.__engine`, tree-
  shaken from production builds).
- `journey.mjs` — 33 assertions walking the complete guest journey through the
  real UI, with a frozen clock so the plan does not depend on time of day.
- `achievements.mjs` — 45 assertions on achievements, attraction codes, the
  activity range, momentum, the development account and the profile stack.
- `hoteldelete.mjs` — 21 assertions on deleting a property and its cascade.
- `review.mjs` — captures the whole product for visual review.

Existing suites (`interact`, `newfeatures`, `locationtests`, `ladder`,
`models-e2e`, `adminpick`, `editor-drag`, `perfprobe`) all still pass.

### Manual walkthrough

1. `/join/hotel/VELIDEMO2026TBILISI0`
2. Enter a stay covering today, pick a few interests, add a 20:00 dinner
3. Land on the map: numbered task markers joined by a dashed route
4. Mission → your day, with the next task first and dinner in the timeline
5. Start, then Complete — the plan advances
6. Tap a task marker → details, partner badge, reason, Start
7. `/admin` → Hotels → Hotel Veli → Partners → detach one → regenerate the
   plan and watch it disappear from the options
8. `/scan/attraction/exp-narikala` — the achievement slides down from the top;
   open it again and nothing happens, which is the point
9. Profile → the three-sticker stack → the collection sheet → choose three
10. Finish every task in the day and the hotel's reward turns green
