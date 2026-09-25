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
      attempts += 1;
      const centre = map.project([hotel.longitude, hotel.latitude]);

      // Work out what 45 m is in pixels at the current camera, so the search
      // covers the same piece of ground whatever the zoom.
      const metreOffset = map.project([hotel.longitude + 0.00045, hotel.latitude]);
      const pixelsPerMetre = Math.abs(metreOffset.x - centre.x) / 37.5;
      const radius = Math.min(Math.max(BUILDING_SEARCH_M * pixelsPerMetre, 14), 130);

      const box: [[number, number], [number, number]] = [
        [centre.x - radius, centre.y - radius],
        [centre.x + radius, centre.y + radius],
      ];

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
          if (attempts >= 10) map.off("idle", tryHighlight);
          return;
        }

        highlighted = best;
        map.setFeatureState(highlighted, { highlight: true });
        map.off("idle", tryHighlight);
      } else if (attempts >= 10) {
        // The hotel may simply not sit on a mapped building. Stop looking.
        map.off("idle", tryHighlight);
      }
    };

    map.on("idle", tryHighlight);
    return () => {
      map.off("idle", tryHighlight);
      if (highlighted) {
        try {
          map.removeFeatureState(highlighted);
        } catch {
          /* map already torn down */
        }
      }
    };
  }, [map, hotel.longitude, hotel.latitude]);

  /* -- Hide basemap POIs that our markers already speak for --------------- */
  useEffect(() => {
    if (!map) return;
    const hidden: TargetFeature[] = [];
    let frame = 0;

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
        if (pois.length === 0) return;

        // Screen space, not ground distance: what matters is whether the two
        // labels overlap in the view, and that changes with zoom and pitch.
        const markers = places.map((place) => map.project([place.longitude, place.latitude]));

        for (const poi of pois) {
          if (poi.geometry?.type !== "Point") continue;
          const point = map.project(poi.geometry.coordinates as [number, number]);

          const collides = markers.some(
            (marker) =>
              Math.abs(marker.x - point.x) < KEEP_OUT_X &&
              Math.abs(marker.y - point.y) < KEEP_OUT_Y,
          );
          if (!collides) continue;

          map.setFeatureState(poi, { hide: true });
          hidden.push(poi);
        }
      });
    };

    map.on("idle", suppress);
    return () => {
      cancelAnimationFrame(frame);
      map.off("idle", suppress);
      for (const poi of hidden) {
        try {
          map.removeFeatureState(poi);
        } catch {
          /* map already torn down */
        }
      }
    };
  }, [map, places]);

  return null;
}
