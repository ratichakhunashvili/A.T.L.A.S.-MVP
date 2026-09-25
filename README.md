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
them to pull the map into the product's palette.

**Colour.** `theme` stays `default` rather than `faded` or `monochrome`: those
are generic LUTs, and with the real colour API available it is better to state
the palette than to desaturate someone else's. Land is a deep green-charcoal in
the same family as `--green-900`; water is pushed cold and a step lighter so
the Mtkvari reads as a shape rather than a hole; buildings are a green-slate
mass. The land-use tints ship as pale pastels for daylight and would bloom into
blotches at night, so each is pulled into the dark green family.

**Road hierarchy.** Roads are the one place the map is allowed to be warm:
motorways read as lit arteries in gold, trunks a step down, everything else
recedes into a cool grey-green. `roadsBrightness` is raised from 0.4 to 0.82 —
at night the whole network otherwise sinks into the land and the hierarchy
disappears with it.

**Labels arrive as you come in.** Rather than choosing a density once, the label
configuration is driven by zoom: geography only in the wide view, street names
at street zoom, a few POIs closer still. On top of that, individual basemap POI
labels that would collide with the product's own markers are hidden through
Standard's `poi` featureset — the alternative is switching every POI label off,
which is what makes a map feel dead.

**The hotel is a lit volume.** The guest's own building is found through the
`buildings` featureset and tinted gold with `colorBuildingHighlight`, so the
place they are standing in is part of the city rather than a pin hovering over
an anonymous block.

**Terrain.** Standard fades its own exaggeration to zero by zoom 13.7, because
terrain under dense buildings causes artefacts. Tbilisi sits in a valley
between two ridges, so that throws away the thing that makes the place legible.
The curve here keeps the ridges dramatic in the wide view, holds a trace of
slope through street zoom, and releases to flat before buildings get close
enough to tear.

**Light and atmosphere.** Standard's night ambient is a flat blue; shifting it
green seats the whole scene in the brand without touching a colour value. A low
warm directional from the south-west gives buildings a lit face and a long
shadow — which is also what makes an uploaded model look like it is standing in
the city. The fog dissolves the far edge into the same deep green the UI sits
on, so the map meets the interface at the horizon rather than at the bezel.

**3D content.** Buildings, trees and landmarks are all on; Standard's own 3D
landmark models are what give Rustaveli and Freedom Square their presence.
Per-building facades are the most expensive thing Standard can draw, so they
are enabled only where there is hardware to spend.

**Camera.** The map opens high, wide and rotated, then settles into a pitched
exploration view over three seconds. Any touch cancels it, and it is skipped
under `prefers-reduced-motion`. Markers thin out below zoom 13.4 — a dozen pins
that read as curation at street zoom become a pile of discs over the whole city.

Mapbox's default control cluster is not used; the product draws its own zoom and
locate controls. The wordmark and attribution stay — they are required — pushed
clear of the navigation and toned down to the weight of a caption.

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
