/**
 * Two pieces of art direction that need the rendered map, not the style sheet.
 *
 * Standard exposes its basemap content as *featuresets* — addressable groups
 * of buildings, POIs and place labels that carry feature state. That makes two
 * things possible that a style config cannot do on its own:
 *
 *  1. The guest's own hotel building is tinted on the map, so the place they
 *     are standing in is a lit volume in the city rather than a pin floating
 *     above an anonymous block.
 *
 *  2. Basemap POI labels that would collide with the product's own markers are
 *     hidden individually. The alternative is switching every POI label off,
 *     which is what makes a map feel dead — this keeps the city's own detail
 *     everywhere except directly underneath our annotations.
 */

import { useEffect } from "react";
import type { TargetFeature } from "mapbox-gl";

import { useMap } from "./MapProvider";
import { isOnScreen, searchBox } from "./projection";
import type { Place } from "../data/types";

const BUILDINGS = { featuresetId: "buildings", importId: "basemap" } as const;
const POI = { featuresetId: "poi", importId: "basemap" } as const;

/** How far from the hotel point to look for its building, in metres. */
const BUILDING_SEARCH_M = 45;

/**
 * Screen-space keep-out around each of our markers. A marker is a 34px pin
 * that may also carry a label pill, so the box is wider than it is tall.
 */
const KEEP_OUT_X = 82;
const KEEP_OUT_Y = 38;

/** Below this the labels are too sparse for collisions to matter. */
const MIN_ZOOM = 13.5;

/** Standard draws no building footprints below about here. */
const BUILDING_ZOOM = 15;

/**
 * Give up after this many *fair* looks — passes where the hotel was actually
 * on screen at a zoom that draws footprints. A pass that never had a chance
 * does not count, or a guest who opens the app zoomed out permanently loses
 * the tint on their own hotel.
 */
const MAX_ATTEMPTS = 10;

/**
 * Centre of a building footprint.
 *
 * Buildings come back as polygons, so there is no single coordinate to compare
 * against — this averages the outer ring, which is close enough to a centroid
 * for picking the nearest of a handful of neighbours.
 */
function footprintCentre(feature: TargetFeature): [number, number] | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  let ring: number[][] | undefined;
  if (geometry.type === "Polygon") ring = geometry.coordinates[0];
  else if (geometry.type === "MultiPolygon") ring = geometry.coordinates[0]?.[0];
  else if (geometry.type === "Point") return geometry.coordinates as [number, number];
  if (!ring || ring.length === 0) return null;

  let longitude = 0;
  let latitude = 0;
  for (const [x, y] of ring) {
    longitude += x;
    latitude += y;
  }
  return [longitude / ring.length, latitude / ring.length];
}

interface BasemapAnnotationsProps {
  hotel: { longitude: number; latitude: number };
  places: Place[];
}

export function BasemapAnnotations({ hotel, places }: BasemapAnnotationsProps) {
  const map = useMap();

  /* -- Tint the hotel building ------------------------------------------- */
  useEffect(() => {
    if (!map) return;
    let highlighted: TargetFeature | null = null;
    let attempts = 0;

    const tryHighlight = () => {
      if (highlighted) return;

      /*
       * A pass only counts against the budget if it had a real chance.
       *
       * The hotel may be off the edge of the canvas, or the camera may be
       * wider than the zoom at which Standard draws footprints at all — in
       * both cases the query is guaranteed to come back empty. Counting those
       * used to exhaust the ten attempts before the guest had finished the
       * opening camera move, after which the tint never appeared and never
       * retried.
       */
      if (map.getZoom() < BUILDING_ZOOM) return;
      if (!isOnScreen(map, hotel, 160)) return;

      attempts += 1;
      const centre = map.project([hotel.longitude, hotel.latitude]);
      const box = searchBox(map, hotel, BUILDING_SEARCH_M, { min: 14, max: 130 });

      let hits: TargetFeature[] = [];
      try {
        hits = map.queryRenderedFeatures(box, { target: BUILDINGS });
      } catch {
        /* style without featuresets */
      }

      if (hits.length > 0) {
        // A hotel entrance is rarely dead centre of its footprint, so take the
        // building nearest the marker rather than whichever came back first.
        // Buildings arrive as polygons, so this compares footprint centroids.
        let best: TargetFeature | null = null;
        let bestDistance = Infinity;

        for (const hit of hits) {
          const centroid = footprintCentre(hit);
          if (!centroid) continue;
          const point = map.project(centroid);
          const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = hit;
          }
        }

        if (!best) {
          if (attempts >= MAX_ATTEMPTS) map.off("idle", tryHighlight);
          return;
        }

        highlighted = best;
        map.setFeatureState(highlighted, { highlight: true });
      } else if (attempts >= MAX_ATTEMPTS) {
        // The hotel may simply not sit on a mapped building. Stop looking.
        map.off("idle", tryHighlight);
      }
    };

    /** A style reload drops feature state, so the tint is re-resolved. */
    const reset = () => {
      highlighted = null;
      attempts = 0;
      map.on("idle", tryHighlight);
    };

    map.on("idle", tryHighlight);
    map.on("style.load", reset);
    return () => {
      map.off("idle", tryHighlight);
      map.off("style.load", reset);
      if (highlighted) {
        try {
          map.removeFeatureState(highlighted);
        } catch {
          /* map already torn down */
        }
      }
    };
  }, [map, hotel.longitude, hotel.latitude, hotel]);

  /* -- Hide basemap POIs that our markers already speak for --------------- */
  useEffect(() => {
    if (!map) return;

    /**
     * What is currently suppressed, keyed so it can be released again.
     *
     * This used to be an append-only array, which had two consequences: a POI
     * hidden because it once sat behind a marker stayed hidden forever, even
     * after the camera moved and nothing overlapped any more; and a style
     * reload left the array holding features that no longer existed, so the
     * cleanup on unmount was removing state from ghosts.
     *
     * The coordinate is kept alongside the feature because a hidden label
     * stops being *rendered*, so it never comes back from a query — the only
     * way to re-test it for a collision is to have remembered where it was.
     */
    const hidden = new Map<string, { feature: TargetFeature; at: [number, number] }>();
    let frame = 0;

    const keyOf = (poi: TargetFeature, at: [number, number]) =>
      poi.id !== undefined && poi.id !== null
        ? String(poi.id)
        : `${at[0].toFixed(6)},${at[1].toFixed(6)}`;

    const release = (key: string) => {
      const entry = hidden.get(key);
      if (!entry) return;
      try {
        map.removeFeatureState(entry.feature);
      } catch {
        /* the style may already be gone */
      }
      hidden.delete(key);
    };

    const suppress = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (map.getZoom() < MIN_ZOOM) return;

        let pois: TargetFeature[] = [];
        try {
          pois = map.queryRenderedFeatures({ target: POI });
        } catch {
          return;
        }

        // Screen space, not ground distance: what matters is whether the two
        // labels overlap in the view, and that changes with zoom and pitch.
        const markers = places.map((place) => map.project([place.longitude, place.latitude]));
        const collides = (at: [number, number]) => {
          const point = map.project(at);
          return markers.some(
            (marker) =>
              Math.abs(marker.x - point.x) < KEEP_OUT_X &&
              Math.abs(marker.y - point.y) < KEEP_OUT_Y,
          );
        };

        for (const poi of pois) {
          if (poi.geometry?.type !== "Point") continue;
          const at = poi.geometry.coordinates as [number, number];
          if (!collides(at)) continue;

          const key = keyOf(poi, at);
          if (hidden.has(key)) continue;
          map.setFeatureState(poi, { hide: true });
          hidden.set(key, { feature: poi, at });
        }

        // Give back anything the markers have moved off.
        for (const [key, entry] of [...hidden]) {
          if (!collides(entry.at)) release(key);
        }
      });
    };

    /** A style reload drops every feature state; the bookkeeping goes with it. */
    const reset = () => {
      hidden.clear();
    };

    map.on("idle", suppress);
    map.on("style.load", reset);
    return () => {
      cancelAnimationFrame(frame);
      map.off("idle", suppress);
      map.off("style.load", reset);
      for (const key of [...hidden.keys()]) release(key);
    };
  }, [map, places]);

  return null;
}
