/**
 * The basemap is a designed surface, not a backdrop.
 *
 * Mapbox Standard exposes ~47 configuration properties — a full colour system,
 * a road hierarchy, label controls, and switches for its 3D content. This file
 * uses them to art-direct the map into the product's palette instead of
 * dropping a stock style behind the UI.
 *
 * The direction is a bright daytime travel map: warm neutral ground, clear
 * blue water, mint parks, sand-toned buildings, and a road hierarchy that runs
 * warm. Accents are spent sparingly — the map should read as somewhere you
 * would want to walk around, not as a dashboard or a game.
 */

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

export const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE ?? "mapbox://styles/mapbox/standard";

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * The map palette, from the product's colour system.
 *
 * Land carries tonal variation rather than one flat fill, water is bright and
 * clean without going neon, and green space is applied with restraint. The
 * whole basemap is warm and light, so the navy chrome and the coloured markers
 * on top of it are the only saturated things on screen.
 */
const LAND = "#F3EEDB";
const WATER = "#83DCEC";
/*
 * Parks use the palette's green rather than its teal park tones: Standard has
 * one greenspace colour, and the teals sit in the water's hue family, so a
 * teal park makes every square in the city read as a pond. Mirrored by
 * --map-green in tokens.css; change both together.
 */
const GREENSPACE = "#76C893";
const BUILDINGS = "#F2F0E8";

/**
 * Road hierarchy.
 *
 * Minor roads are the near-white road surface and recede into the land;
 * motorways carry the warmer underlay tone so the arterial structure still
 * reads first. Nothing on the road network is allowed to shout.
 */
const MOTORWAY = "#EFE3C2";
const TRUNK = "#F7EEDA";
const ROAD = "#FFFDF4";

/** Map typography, from the system's map-label and muted tokens. */
const LABEL_PLACE = "#506A67";
const LABEL_ROAD = "#758784";
const LABEL_POI = "#506A67";

/**
 * Static basemap configuration.
 *
 * `theme` stays "default" rather than "faded" or "monochrome": those are
 * generic LUTs, and with the full colour API available it is better to state
 * the palette outright than to desaturate someone else's.
 *
 * The font is deliberately left at Standard's DIN Pro. Tbilisi's labels are
 * partly Georgian script, and Mapbox's fallback chain covers it — swapping the
 * family risks losing those glyphs, which costs more than it gains.
 */
export const BASEMAP_CONFIG: Record<string, string | number | boolean> = {
  lightPreset: "day",
  theme: "default",

  colorLand: LAND,
  colorWater: WATER,
  colorGreenspace: GREENSPACE,
  colorBuildings: BUILDINGS,

  // Land use draws on the land range only, so districts vary in tone without
  // the map turning into a choropleth.
  colorCommercial: "#FFFAEA",
  colorMedical: "#F6EFE0",
  colorEducation: "#FFFAEA",
  colorIndustrial: "#F1EBD8",

  colorMotorways: MOTORWAY,
  colorTrunks: TRUNK,
  colorRoads: ROAD,
  // Daylight wants the network crisp; a night build has to fight to be seen.
  roadsBrightness: 1,
  showPedestrianRoads: true,

  colorPlaceLabels: LABEL_PLACE,
  colorRoadLabels: LABEL_ROAD,
  colorPointOfInterestLabels: LABEL_POI,
  showAdminBoundaries: false,

  // POIs keep their circular chip — that is what makes the city feel
  // inhabited rather than blank — but in one ink rather than Mapbox's own
  // category palette, which puts magenta and lavender on a map that has a
  // colour system of its own. The ones that would collide with our markers
  // are hidden individually by `BasemapAnnotations`.
  showPointOfInterestLabels: true,
  backgroundPointOfInterestLabels: "circle",
  colorModePointOfInterestLabels: "single",
  showTransitLabels: false,

  // The 3D world.
  show3dObjects: true,
  show3dBuildings: true,
  show3dTrees: true,
  show3dLandmarks: true,
  // Landmark *icons* are 2D pins for the same landmarks the 3D models already
  // show. One or the other, not both.
  showLandmarkIcons: false,

  // The guest's own building, tinted through the `buildings` featureset, in
  // the system's property blue — the same colour as the hotel marker above it.
  colorBuildingHighlight: "#1E6091",
  colorBuildingSelect: "#1E6091",
};

/**
 * Label density by zoom.
 *
 * A wide view wants to read as geography, a close view as a street you could
 * walk down. Rather than choosing once, labels arrive as the guest comes in:
 * road names at street zoom, more POIs closer still.
 */
export const LABEL_ZOOM_RULES = [
  { maxZoom: 13.6, showRoadLabels: false, densityPointOfInterestLabels: 0 },
  { maxZoom: 15.4, showRoadLabels: false, densityPointOfInterestLabels: 1 },
  { maxZoom: Infinity, showRoadLabels: true, densityPointOfInterestLabels: 2 },
] as const;

/**
 * Per-building facades.
 *
 * Standard can draw real building frontages at close zoom, and where the data
 * exists it is a genuine step up. It is off here for two reasons: the
 * `mapbox.procedural-buildings-v1` dataset has no coverage in Tbilisi, so every
 * pan fires a round of 404s for tiles that will never exist; and it is the most
 * expensive thing Standard draws, which a phone feels.
 *
 * Turn it on for a city with coverage by flipping this to `supportsHeavyBasemap()`.
 */
export const ENABLE_3D_FACADES = false;

/** True on hardware with frames to spare — desktops, not phones. */
export function supportsHeavyBasemap(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator.hardwareConcurrency ?? 2) >= 8 && !matchMedia("(pointer: coarse)").matches;
}

/* ------------------------------------------------------------------------ */
/* Terrain                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Standard declares `mapbox-dem` itself and fades its own exaggeration to zero
 * by zoom 13.7, because terrain under dense buildings causes artefacts. Tbilisi
 * sits in a valley between two ridges, so losing all relief at city zoom throws
 * away the thing that makes the place legible.
 *
 * This curve keeps the ridges readable in the wide view, holds a trace of slope
 * through street zoom so the old town still reads as built on a hill, and
 * releases to flat before buildings get close enough to tear.
 */
export const TERRAIN = {
  sourceId: "mapbox-dem",
  source: {
    type: "raster-dem" as const,
    url: "mapbox://mapbox.mapbox-terrain-dem-v1",
    tileSize: 512,
    maxzoom: 14,
  },
  exaggeration: [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    0,
    8.5,
    1.3,
    12,
    1.15,
    14.5,
    0.65,
    16.5,
    0.2,
    17.6,
    0,
  ],
};

/* ------------------------------------------------------------------------ */
/* Atmosphere and light                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Daytime atmosphere.
 *
 * A pale haze at the far edge and a clear sky above it. The point is aerial
 * perspective — distant city reading as further away — not weather.
 */
export const DAY_FOG = {
  range: [1.6, 14] as [number, number],
  color: "#DDEFF2",
  "high-color": "#B8EEF2",
  "space-color": "#83DCEC",
  "horizon-blend": 0.05,
  "star-intensity": 0,
  "vertical-range": [20, 220] as [number, number],
};

/**
 * Lighting.
 *
 * Kept close to neutral daylight with a touch of warmth. A night build can
 * afford a coloured ambient; in daylight a tinted ambient reads as a colour
 * cast over everything, so the brand lives in the surfaces instead. The
 * directional is what gives buildings a lit face, a soft shadow, and the sense
 * that an uploaded 3D model is standing in the city rather than on top of it.
 */
export const DAY_LIGHTS = [
  {
    id: "ambient",
    type: "ambient" as const,
    properties: { color: "hsl(44, 34%, 97%)", intensity: 0.78 },
  },
  {
    id: "directional",
    type: "directional" as const,
    properties: {
      color: "hsl(44, 46%, 98%)",
      intensity: 0.58,
      direction: [205, 42] as [number, number],
      "cast-shadows": true,
      // Daylight shadows are soft; a night-strength shadow here reads as grime.
      "shadow-intensity": 0.32,
    },
  },
];

/* ------------------------------------------------------------------------ */
/* Camera                                                                    */
/* ------------------------------------------------------------------------ */

/** Camera limits. Pitch stops well short of the horizon. */
export const CAMERA_LIMITS = {
  minZoom: 9,
  maxZoom: 19.5,
  maxPitch: 68,
};

/**
 * The opening move: the map starts higher and wider, then settles into the
 * exploration view over about three seconds. It reads as arriving somewhere.
 * Any touch cancels it, and it is skipped entirely under reduced motion.
 */
export const INTRO = {
  zoomOffset: -2.1,
  pitchOffset: -24,
  bearingOffset: 30,
  duration: 3000,
};

/** Below this zoom the 3D model layer is not drawn — it would be sub-pixel anyway. */
export const MODEL_MIN_ZOOM = 13.5;

/**
 * Antialiasing costs real frames on phones, where a 3x device pixel ratio is
 * already doing most of the smoothing. Spend it only where it shows.
 */
export function shouldAntialias(): boolean {
  if (typeof window === "undefined") return false;
  return (window.devicePixelRatio || 1) < 2;
}
