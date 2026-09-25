/**
 * The basemap is a designed surface, not a backdrop.
 *
 * Mapbox Standard exposes ~47 configuration properties — a full colour system,
 * a road hierarchy, label controls, and switches for its 3D content. This file
 * uses them to art-direct the map into the product's palette instead of
 * dropping a stock night style behind the UI.
 *
 * Everything resolves to the same four brand colours the interface uses:
 *   ivory #F5F1E7 · green-900 #12231B · green-700 #164735 · yellow #FFD75A
 */

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";

export const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE ?? "mapbox://styles/mapbox/standard";

/* ------------------------------------------------------------------------ */
/* Palette                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Ground plane and water.
 *
 * Land is a deep green-charcoal — the same family as `--green-900`, dark
 * enough that ivory chrome always has contrast against it. Water is pushed
 * cold and a touch lighter so the river reads as a shape rather than a hole,
 * which matters in Tbilisi where the Mtkvari is the city's main landmark.
 */
const LAND = "hsl(158, 16%, 12%)";
const WATER = "hsl(197, 40%, 21%)";
const GREENSPACE = "hsl(146, 22%, 15%)";
const BUILDINGS = "hsl(158, 10%, 30%)";

/**
 * Road hierarchy, warm to cool.
 *
 * Roads are the one place the map is allowed to be warm: motorways read as lit
 * arteries, trunks a step down, everything else recedes into a cool grey-green.
 * `roadsBrightness` is raised well above the 0.4 default because at night the
 * whole network otherwise sinks into the land and the hierarchy disappears.
 */
const MOTORWAY = "hsl(40, 60%, 56%)";
const TRUNK = "hsl(36, 38%, 42%)";
const ROAD = "hsl(165, 9%, 32%)";

/** Label ink, in the ivory family so type on the map matches type in the UI. */
const LABEL_PLACE = "hsl(40, 26%, 87%)";
const LABEL_ROAD = "hsl(40, 20%, 72%)";
const LABEL_POI = "hsl(158, 8%, 56%)";

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
  lightPreset: "night",
  theme: "default",

  colorLand: LAND,
  colorWater: WATER,
  colorGreenspace: GREENSPACE,
  colorBuildings: BUILDINGS,

  // Land-use tints ship as pale pastels for the day preset. Left alone they
  // bloom into blotches at night, so each is pulled into the dark green family.
  colorCommercial: "hsl(30, 12%, 16%)",
  colorMedical: "hsl(0, 10%, 16%)",
  colorEducation: "hsl(40, 12%, 16%)",
  colorIndustrial: "hsl(220, 8%, 16%)",

  colorMotorways: MOTORWAY,
  colorTrunks: TRUNK,
  colorRoads: ROAD,
  roadsBrightness: 0.82,
  showPedestrianRoads: true,

  colorPlaceLabels: LABEL_PLACE,
  colorRoadLabels: LABEL_ROAD,
  colorPointOfInterestLabels: LABEL_POI,
  colorAdminBoundaries: "hsl(158, 14%, 30%)",
  showAdminBoundaries: false,

  // POI labels stay, but flat and sparse: no circular backgrounds, one colour,
  // lowest density. They give the city life without arguing with our markers.
  showPointOfInterestLabels: true,
  backgroundPointOfInterestLabels: "none",
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

  // The hotel building is tinted through the `buildings` featureset.
  colorBuildingHighlight: "hsl(44, 60%, 52%)",
  colorBuildingSelect: "hsl(44, 60%, 52%)",
};

/**
 * Label density by zoom.
 *
 * A wide view wants to read as geography, a close view as a street you could
 * walk down. Rather than choosing once, labels arrive as the guest comes in:
 * road names at street zoom, a few POIs closer still.
 */
export const LABEL_ZOOM_RULES = [
  { maxZoom: 14.2, showRoadLabels: false, densityPointOfInterestLabels: 0 },
  { maxZoom: 15.8, showRoadLabels: false, densityPointOfInterestLabels: 1 },
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
 * This curve keeps the ridges dramatic in the wide view, holds a trace of slope
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
    1.35,
    12,
    1.2,
    14.5,
    0.7,
    16.5,
    0.22,
    17.6,
    0,
  ],
};

/* ------------------------------------------------------------------------ */
/* Atmosphere and light                                                      */
/* ------------------------------------------------------------------------ */

/**
 * Night atmosphere.
 *
 * The far edge of the city dissolves into the same deep green the UI sits on,
 * which is what ties the map to the interface at the horizon instead of at the
 * bezel. Stars are barely on — at a 56° pitch there is little sky, and the
 * point is a trace of depth, not a planetarium.
 */
export const NIGHT_FOG = {
  range: [1.4, 11] as [number, number],
  color: "hsl(160, 24%, 9%)",
  "high-color": "hsl(198, 36%, 15%)",
  "space-color": "hsl(200, 42%, 4%)",
  "horizon-blend": 0.045,
  "star-intensity": 0.1,
  "vertical-range": [20, 190] as [number, number],
};

/**
 * Lighting.
 *
 * Standard's night ambient is a flat blue. Shifting it green seats the whole
 * scene in the brand without touching a single colour value, and a low warm
 * directional from the south-west gives buildings a lit face and a long shadow
 * — which is also what makes an uploaded 3D model look like it is standing in
 * the city rather than pasted over it.
 */
export const NIGHT_LIGHTS = [
  {
    id: "ambient",
    type: "ambient" as const,
    properties: { color: "hsl(165, 30%, 18%)", intensity: 0.75 },
  },
  {
    id: "directional",
    type: "directional" as const,
    properties: {
      color: "hsl(40, 52%, 76%)",
      intensity: 0.42,
      direction: [205, 30] as [number, number],
      "cast-shadows": true,
      "shadow-intensity": 0.7,
    },
  },
];

/* ------------------------------------------------------------------------ */
/* Camera                                                                    */
/* ------------------------------------------------------------------------ */

/** Camera limits. Pitch stops short of the horizon — tilted, never vertiginous. */
export const CAMERA_LIMITS = {
  minZoom: 9,
  maxZoom: 19.5,
  maxPitch: 72,
};

/**
 * The opening move: the map starts high and wide, then settles into the
 * exploration view over about three seconds. It reads as arriving somewhere.
 * Any touch cancels it, and it is skipped entirely under reduced motion.
 */
export const INTRO = {
  zoomOffset: -2.1,
  pitchOffset: -26,
  bearingOffset: 34,
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
