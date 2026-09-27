/**
 * Fog of war: the constants and the geometry.
 *
 * A locked attraction is concealed under a dome of haze standing where its
 * model would be. The model itself is never added to the map and its asset is
 * never fetched, so there is nothing to see through the fog and nothing that
 * can flash into view while bytes arrive — the fog is what is there, not a
 * curtain over something already drawn.
 *
 * Two rendering facts shape the whole design, both learned the hard way in
 * `BuildingMask`:
 *
 *   1. `fill-extrusion-opacity` is **not** data-driven. It applies to the
 *      whole layer, so the reveal cannot be an opacity fade per attraction.
 *      `fill-extrusion-base` and `fill-extrusion-height` *are* data-driven, so
 *      the dome collapses to the ground instead — which reads as dissipating
 *      rather than being switched off, and is the better animation anyway.
 *
 *   2. Plain 2D layers (`fill`, `line`, `background`) are batched into an
 *      early "draped" pass that always renders beneath 3D content, whatever
 *      the layer order. So the fog has to be an extrusion, or the city's
 *      buildings would stand in front of it.
 *
 * A translucent extrusion does not write depth, which means any two fog
 * volumes that overlap in 3D within one layer will z-flicker against each
 * other. The tiers below are therefore *stacked, never nested*: each one's
 * base is the previous one's top, so the dome is built from pieces that never
 * intersect.
 */

import { accuracyRing, type Coordinates } from "../../data/geo";

export const FOG_SOURCE = "app-fog";
export const FOG_LAYER = "app-fog-dome";

/**
 * Ground radius of the concealment, in metres.
 *
 * Deliberately close to `SEARCH_M` in `BuildingMask` (26): the dome must cover
 * the attraction without overhanging neighbouring buildings that are still
 * standing. Keep the two within a few metres of each other.
 */
export const FOG_RADIUS_M = 28;

/**
 * The dome, as stacked tiers. `base[n]` must equal `top[n-1]` exactly — see
 * the depth note above. `radius` is a fraction of `FOG_RADIUS_M`.
 */
export const FOG_TIERS = [
  { radius: 1, base: 0, top: 13 },
  { radius: 0.72, base: 13, top: 21 },
  { radius: 0.4, base: 21, top: 27 },
] as const;

/** The map's own aerial haze — `DAY_FOG.color` in `map/config.ts`. */
export const FOG_COLOR = "#DDEFF2";

/** Must match `--dur-reveal` in `styles/tokens.css`. */
export const REVEAL_MS = 900;
/** Must match `--dur-fog-in` in `styles/tokens.css`. */
export const FOG_IN_MS = 420;

/** A stable, readable feature id. Strings survive geojson-vt untouched. */
export function fogFeatureId(modelId: string, tier: number): string {
  return `fog:${modelId}:${tier}`;
}

/**
 * The dome for one locked attraction, as one feature per tier.
 *
 * Geometry comes from the stored coordinate, never from `queryRenderedFeatures`
 * — a locked attraction is by definition one the guest has not walked to, so
 * it is routinely off-screen, and a screen-space query would silently find
 * nothing exactly when it matters most.
 */
export function fogFeatures(modelId: string, at: Coordinates): GeoJSON.Feature[] {
  return FOG_TIERS.map((tier, index) => ({
    type: "Feature" as const,
    id: fogFeatureId(modelId, index),
    properties: { modelId, base: tier.base, top: tier.top },
    geometry: {
      type: "Polygon" as const,
      // Fewer points on the smaller tiers: at this radius the silhouette is
      // already smooth and the vertices are not free. `accuracyRing` closes
      // the ring itself, so it goes straight in as the outer ring.
      coordinates: [accuracyRing(at, FOG_RADIUS_M * tier.radius, index === 0 ? 56 : 40)],
    },
  }));
}
