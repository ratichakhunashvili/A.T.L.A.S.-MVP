# Guest Map

The guest-facing screen of the 3D Hospitality Experience Platform: a hotel guest
opens the app and is already standing on a night map of the city around their
hotel, with the experiences curated for them placed on it.

There is one screen. The map **is** the application — everything else is an
overlay above it, and nothing in the guest experience navigates anywhere.

```bash
npm install
npm run dev          # http://localhost:5180
```

The Mapbox token lives in `.env.local` (git-ignored); `.env.example` shows the
shape. Without it the app renders a short notice instead of a black screen.

| Command | What it does |
| --- | --- |
| `npm run dev` | dev server on port 5180 |
| `npm run build` | type-check, then production build |
| `npm run typecheck` | types only |
| `npm run preview` | serve the built output |

---

## The hotel platform

The guest map is one half of the product. The other half — hotel QR onboarding,
reservations, the partner network, the recommendation engine and the operator
console — is documented in **[docs/PLATFORM.md](docs/PLATFORM.md)**.

The short version:

- **`/join/hotel/:token`** — a guest scans the code at reception, the hotel is
  identified from the token, and four short screens later they have a plan.
- **`/admin`** — hotels, QR codes, partners, activities, events and aggregate
  analytics, beside the existing 3D model library.
- **The partner rule** — a guest is only ever recommended outside experiences
  their hotel has explicitly partnered with. A 3D model is a visual, not a
  permission.
- **Three layers** — deterministic rules decide what is allowed, a weighted
  score decides what makes sense, and AI only reranks and rewrites. If AI is
  unavailable the product is unaffected.

Try it with the seeded demo hotel:
`/join/hotel/VELIDEMO2026TBILISI0`

---

## The interaction model

One piece of state decides what is on screen:

```ts
activeOverlay: null | "notifications" | "chatbot" | "mission" | "profile" | "qr" | "place"
```

At most one overlay exists at a time. Opening one closes the last, pressing the
same control again closes it, and so do the backdrop and `Escape`. Because there
is only ever one, z-index never has to be negotiated between panels.

Overlays enter from three directions and nowhere else:

| Direction | Panels | Motion |
| --- | --- | --- |
| Top | Notifications, Assistant | `translateY(-100%) → 0`, clipped so they emerge from behind the header |
| Bottom | Mission, Profile, place/model details | `translateY(100%) → 0`, draggable downward to dismiss |
| Centre | QR scanner | scale and fade up |

Bottom sheets are ivory, and so is the navigation bar — so while a bottom sheet
is up the bar inverts to deep green. That keeps it legible against the sheet and
signals that the same button will close what it opened.

## Layout

```
src/
  App.tsx                  the one screen: map + chrome + overlays
  main.tsx                 mounts it; the only branch is #/admin
  state/overlay.tsx        which overlay is open, and what is selected

  map/
    MapProvider.tsx        creates the Mapbox instance once, shares it by context
    config.ts              Standard-style configuration, camera limits, token
    MapMarker.tsx          a Mapbox marker whose contents React renders
    markers/MarkerLayer    places, model anchors, the guest's own position
    models/ModelLayer      geo-anchored GLB assets, driven by the registry

  ui/
    chrome/                floating header, bottom navigation, map controls
    sheets/                TopSheet · BottomSheet · CenterModal, and their behaviour
    icons.ts               one category → one glyph, for every surface

  overlays/                the five panels plus the details card
  admin/                   the model library and map editor, behind #/admin
  data/                    types, seed content, the model registry and its storage
  styles/                  tokens, reset, and the single stylesheet entry point
```

## The map is part of the design

The basemap is Mapbox **Standard**, configured rather than replaced. Standard
exposes 47 configuration properties — a full colour system, a road hierarchy,
label controls and switches for its 3D content — and `src/map/config.ts` uses
them to pull the map into the product's palette. The direction is a bright
daytime travel map, not a dark one.

**Colour.** `theme` stays `default` rather than `faded` or `monochrome`: those
are generic LUTs, and with the real colour API available it is better to state
the palette than to desaturate someone else's. Land is a warm off-white rather
than full sand, so sand is free to work on buildings and land use without the
whole map going beige; water is a clear, slightly desaturated blue; parks are
mint. The land-use tints ship as pale pastels and are pulled a shade apart from
each other so districts read without the map becoming a choropleth.

**Road hierarchy.** Minor roads are near-white and recede; motorways carry a
warm amber so the arterial structure of the city is still the first thing you
read. `roadsBrightness` runs at 1 — daylight wants the network crisp.

**POIs stay, in one ink.** Mapbox's own category palette puts magenta and
lavender on the map, which fights a product that has a colour system of its
own, so POI chips are drawn in a single muted green. They are what makes the
city feel inhabited rather than blank. Individual POI labels that would collide
with our markers are hidden through Standard's `poi` featureset — far better
than switching every POI label off, which is what makes a map feel dead.

**Labels arrive as you come in.** Label density is driven by zoom rather than
chosen once: geography in the wide view, street names at street zoom, more POIs
closer still.

**The hotel is a lit volume.** The guest's own building is found through the
`buildings` featureset and tinted gold with `colorBuildingHighlight`.

**Terrain.** Standard fades its own exaggeration to zero by zoom 13.7, because
terrain under dense buildings causes artefacts. Tbilisi sits in a valley
between two ridges, so that throws away the thing that makes the place legible.
The curve here keeps the ridges readable wide-out, holds a trace of slope at
street zoom, and releases to flat before buildings get close enough to tear.

**Light and atmosphere.** Neutral daylight with a touch of warmth. A night
build can afford a coloured ambient; in daylight a tinted ambient reads as a
cast over everything, so the brand lives in the surfaces instead. The
directional gives buildings a lit face and a soft shadow — which is also what
makes an uploaded 3D model look like it is standing in the city. Fog supplies
aerial perspective, not weather.

**3D content.** Buildings, trees and landmarks are all on; Standard's own 3D
landmark models are what give Rustaveli and Freedom Square their presence.
Per-building facades are the most expensive thing Standard draws and have no
coverage in Tbilisi, so they are off behind a one-line flag.

**Camera.** The map opens higher and wider, then settles into a pitched
exploration view over three seconds. Pitch is deliberately moderate — enough
depth to read the 3D city, shallow enough that the street grid still reads as a
map. Any touch cancels the move, and it is skipped under `prefers-reduced-motion`.

Mapbox's default control cluster is not used; the product draws its own zoom and
locate controls. The wordmark and attribution stay — they are required — pushed
clear of the navigation and toned down to the weight of a caption.

## Location and proximity

Geolocation is a permission **and** an estimate, not a fact, so
`src/state/location.tsx` represents every state the browser can produce —
`idle`, `locating`, `granted`, `denied`, `unavailable`, `error` — plus *why* the
last attempt failed (`permission`, `timeout`, `unavailable`, `insecure`). It is
the single source of truth: the marker, the accuracy ring, the camera, the
recentre control and the nearby ranking all read the same `fix`.

**The source is `navigator.geolocation` and nothing else.** There is no IP
lookup, no city fallback, no geocoder in the location path, and no coordinate
is ever persisted between sessions.

**Two rungs, both device.** A high-accuracy request waits on a GPS or Wi-Fi
scan a desktop may never produce, and it times out often. A timeout there is
not the same as "this device has no location", so the app retries the same
provider with `enableHighAccuracy: false` before giving up. Both rungs use
`maximumAge: 0` — a cached fix may predate the guest walking anywhere. The
watch then runs in whichever mode actually answered.

**Accuracy decides what a fix may be used for** (`ACCURACY_THRESHOLDS`):

| Quality | Accuracy | Behaviour |
| --- | --- | --- |
| precise | ≤120 m | Camera flies to street zoom, solid dot, exact distances and walking times |
| approximate | ≤2000 m | Camera framed to the uncertainty circle, hollow dot, radius drawn, distances prefixed `≈`, no walking time |
| coarse | >2000 m | **Camera does not move.** Hollow dot and radius, nothing ranked as nearest, no distance claimed — and a card explains that this is a network estimate, offering "Show that area" and "Try again" |

Nothing is ever flown to automatically on a coarse fix, because being dragged
to the wrong side of the city is worse than not moving. But nothing goes quiet
either: a coarse fix, a timeout and a denial each raise an explanation naming
the likely cause, so the map is never left sitting on the seeded hotel looking
as though it has decided where you are.

Every reading is validated before it reaches the map — finite numbers,
latitude within ±90, longitude within ±180, Null Island rejected, no timestamps
from the future. Which of two readings wins weighs **time as well as accuracy**:
a decisively newer fix is preferred even if slightly looser, because ranking on
accuracy alone pins the marker in place while the guest walks away from it.

The camera follows the **first** trustworthy fix and never again. After that a
moving position updates the marker but not the view; the recentre control is
the only thing that moves the camera back.

Distances use the haversine formula (`src/data/geo.ts`) — never coordinate
subtraction. Places rank into three tiers:

| Tier | Treatment |
| --- | --- |
| nearest | Largest pin, a soft ring in its own colour, and a distance label |
| near (next 7) | Full-strength pin |
| far | Smaller and dimmed — de-emphasised, never removed |

Markers are coloured by **family** rather than by category: where you sleep,
eat, taste, look at, or do something. Nine categories would mean nine colours,
and nine colours on one map is noise.

**Diagnosing a wrong location.** `npm run dev` shows a **GPS** button at the
bottom-left. It reports the raw browser values (latitude, longitude, accuracy,
fix age), the permission and error state, whether the context is secure, what
was tried on each rung, what the map is centred on, what the ranking measured
from, and a drift readout proving the marker and the ranking agree. It is
behind `import.meta.env.DEV`, so it is dropped from production builds.

## Accounts

There was no authentication in the project, so `src/auth/authService.ts` adds
the same shape the model registry uses: an `AuthService` interface with a
browser-local implementation, swappable for Supabase, Firebase or a custom API
in one adapter file and one line at the bottom.

**The local implementation is a stand-in, not real authentication.** Accounts
live in this browser's `localStorage`. Passwords are salted and hashed rather
than stored in the clear, but that protects almost nothing when the hash sits
beside the data on the same device: no server, no rate limiting, no way to
revoke a session. It exists so the experience can be designed and tested end to
end. Connect a real provider before anyone's actual password is typed into it.

Sign up and sign in are a sheet over the map, in the same overlay state machine
as everything else. Validation is inline and per field; nothing calls `alert()`.
Guest access is never removed — "Continue as guest" closes the sheet, and the
map, missions, scanner and 3D models all work without an account.

## 3D models

Models are **data**, never code. Nothing in the renderer knows that a castle or
a hotel exists; it receives records and draws them. Even the starting registry
is fetched from `public/models.seed.json` rather than declared in JavaScript.

```ts
{ id, name, modelUrl, latitude, longitude, altitude,
  scale, rotationX, rotationY, rotationZ,
  visible, status, category, description, thumbnail, createdAt, updatedAt }
```

They are drawn with Mapbox's native **model layer**, so the assets live inside
the map's own scene: lit by the night lighting, casting and receiving its
shadows, occluded by buildings and terrain, elevation referenced to the ground
so they sit on the hillside rather than at sea level. They move correctly under
pan, zoom, rotate and pitch because the camera is the only thing moving. There
is no second canvas over the map, and no part of a model is a DOM element.

Tapping a model hit-tests the rendered 3D geometry. Each model also carries a
flattened contact ring on the ground — it grounds the object, keeps it
reachable by keyboard, and survives an asset that is slow or fails to load.
Below zoom 13.5 the layer is not drawn at all, which also stops Mapbox fetching
geometry nobody can see.

### Where the records and the bytes live

Two seams, both in `src/data/`:

- **`ModelRepository`** — `list`, `listPublished`, `get`, `create`, `update`,
  `remove`, `subscribe`. The active implementation keeps records in
  `localStorage`, seeded from the JSON file, and syncs across tabs.
  `createHttpModelRepository()` in the same file is the identical contract over
  `GET/POST/PATCH/DELETE /api/models`. Moving to a real backend is changing the
  last line of that file.
- **`ModelStorageService`** — `uploadModel`, `deleteModel`, `getModelUrl`. The
  local implementation keeps uploaded files in IndexedDB and hands back object
  URLs. A Supabase / R2 / S3 / Firebase adapter only has to satisfy those three
  methods. References that are not `local:` are treated as URLs and returned
  untouched, so records pointing at a CDN already work.

## Admin — `#/admin`

Code-split, so a guest never downloads it. It writes through the same repository
the public map reads from: publishing a model changes that map with no deploy
and no code edit.

- **Library** — every record with its status, and four actions: edit, preview on
  the guest map, hide/publish, delete behind a confirmation.
- **Editor** — search for a location, then place the model by clicking the map
  or by **dragging the model itself**: the drag is hit-tested against the
  rendered 3D geometry, so the administrator grabs the building rather than a
  proxy pin, and map panning is suspended while it moves. Altitude, scale and
  rotation are sliders, coordinates can be typed exactly, and a framing button
  recentres the camera. The preview is the same `ModelLayer` the public map
  uses, on the same basemap — what is approved here is what guests get.
- **Upload** — extension, size and container are all checked before a file is
  stored: a GLB whose header does not say `glTF`, or whose declared length
  disagrees with the file, is rejected here rather than becoming a blank patch on
  someone's map. States shown are the real ones — validating, uploading,
  processing, ready, error.

Position and transform change constantly during a drag, so persistence is
debounced: the preview updates every frame, the registry is written once the
hand stops moving.

## What is real and what is mocked

Real: the map and its configuration, the 3D model pipeline end to end, the
overlay system, drag-to-dismiss, the admin editor and uploader with validation,
location search (Mapbox Geocoding), geolocation, and QR decoding wherever the
browser ships `BarcodeDetector` — Chrome and Edge on desktop and Android. The
camera still opens everywhere else; only the decode step is missing, and
`detectFromVideo` in `QRScannerOverlay.tsx` is the one function a library such
as `zxing-wasm` would replace.

Mocked: places, missions, notifications and the profile are seed content in
`src/data/seed.ts`. The assistant's replies are a keyword match in
`ChatPanel.tsx` — `respondTo` is the single seam for a model call. Profile rows
that lead to sub-screens do not have sub-screens yet.

## Notes

- Verified in Chrome at 320×568, 393×852 and 1280×860. The guest experience:
  every control opens and closes its panel, only one overlay is ever mounted,
  the backdrop and `Escape` close, sheets drag away, a mission step flies the
  camera and opens that place, the URL never leaves the root, console clean.
- The model system is verified end to end without touching source: a real
  `Duck.glb` is uploaded through the admin file input, named, placed, published
  and then found on the public map. Anchoring is checked by projecting the
  model's coordinate under six cameras — rotated 140°, pitched 70°, zoomed
  15.5 to 18.6, panned off-centre — and hit-testing the rendered 3D geometry at
  that point. It hits in all six while landing on six different pixels, which
  is what separates *anchored to a coordinate* from *stuck to the screen*.
  Dragging the model in the editor moves it and the debounced autosave
  persists the new position.
- `100dvh` and `env(safe-area-inset-*)` throughout; the navigation clears the
  iPhone home indicator, and the guest-mode pill drops its tail under 360px.
- Animation is transform and opacity only. The backdrop is a graded scrim rather
  than a blur — blurring a full-screen WebGL map costs real frames on a phone
  and a scrim separates the panel just as well.
- The Mapbox chunk is ~1.9 MB. That is the map engine; it is isolated in its own
  chunk so the shell paints while it arrives.
