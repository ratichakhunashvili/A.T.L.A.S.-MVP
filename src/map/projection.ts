/**
 * Screen-space measurement against the live camera.
 *
 * Several layers need to search a patch of *ground* — "the building within 26 m
 * of this point" — but `queryRenderedFeatures` only speaks pixels. Converting
 * between the two depends on zoom, on latitude, and on where in a pitched view
 * the point happens to sit, so it has to be measured against the camera rather
 * than assumed.
 */

import type { Map as MapboxMap } from "mapbox-gl";

import type { Coordinates } from "../data/geo";

/** Metres per degree of latitude. Constant enough at city scale. */
const METRES_PER_DEGREE_LAT = 111_320;

/** The baseline used for the probe. Long enough to avoid rounding noise. */
const PROBE_M = 10;

/**
 * How many screen pixels one ground metre covers at a point.
 *
 * Sampled north *and* east, taking the larger. Callers build an axis-aligned
 * box in screen space, so the larger of the two axes is the radius that
 * actually covers the intended piece of ground — under rotation or pitch the
 * two differ substantially.
 *
 * This replaces two hand-tuned constants that were each calibrated for one
 * city's latitude and silently wrong anywhere else.
 */
export function pixelsPerMetre(map: MapboxMap, at: Coordinates): number {
  const origin = map.project([at.longitude, at.latitude]);

  const northLat = at.latitude + PROBE_M / METRES_PER_DEGREE_LAT;
  const north = map.project([at.longitude, northLat]);

  // A degree of longitude shrinks with latitude; without the cosine this is
  // the approximation the old constants were baked around.
  const metresPerDegreeLng =
    METRES_PER_DEGREE_LAT * Math.cos((at.latitude * Math.PI) / 180);
  const east = map.project([
    at.longitude + PROBE_M / Math.max(metresPerDegreeLng, 1),
    at.latitude,
  ]);

  const northPx = Math.hypot(north.x - origin.x, north.y - origin.y);
  const eastPx = Math.hypot(east.x - origin.x, east.y - origin.y);

  return Math.max(northPx, eastPx) / PROBE_M;
}

/**
 * A square screen-space box of `metres` radius around a coordinate, clamped so
 * a wide view cannot produce a one-pixel box and a close one cannot produce a
 * box that swallows the neighbours.
 */
export function searchBox(
  map: MapboxMap,
  at: Coordinates,
  metres: number,
  clamp: { min: number; max: number },
): [[number, number], [number, number]] {
  const centre = map.project([at.longitude, at.latitude]);
  const radius = Math.min(Math.max(metres * pixelsPerMetre(map, at), clamp.min), clamp.max);
  return [
    [centre.x - radius, centre.y - radius],
    [centre.x + radius, centre.y + radius],
  ];
}

/** True when a projected point is within `margin` pixels of the canvas. */
export function isOnScreen(map: MapboxMap, at: Coordinates, margin = 0): boolean {
  const point = map.project([at.longitude, at.latitude]);
  const canvas = map.getCanvas();
  return (
    point.x > -margin &&
    point.y > -margin &&
    point.x < canvas.clientWidth + margin &&
    point.y < canvas.clientHeight + margin
  );
}
