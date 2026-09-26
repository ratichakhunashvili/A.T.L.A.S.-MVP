/**
 * Hiding the basemap building underneath a custom model.
 *
 * A 3D asset placed on a mapped building fights with it: two roofs at slightly
 * different heights, z-fighting on the walls, and a silhouette that belongs to
 * neither. Mapbox Standard exposes its buildings as an addressable featureset
 * with a `hide` feature state, so the specific building can be taken out
 * without touching any other.
 *
 * Deliberately *not* a global switch. Turning off every building would flatten
 * the city that makes the map worth looking at; this removes one footprint and
 * leaves the rest standing.
 *
 * Positions are stored rather than feature ids. A feature id is only stable
 * within a tileset version, and a model that loses its mask after a basemap
 * update is a bug nobody would think to look for — so the mask is re-resolved
 * from coordinates each time the style loads.
 */

import { useEffect } from "react";
import type { TargetFeature } from "mapbox-gl";

import { useMap } from "../MapProvider";
import type { MapModel } from "../../data/types";

const BUILDINGS = { featuresetId: "buildings", importId: "basemap" } as const;

/** How far from the recorded point to look, in metres. */
const SEARCH_M = 26;

/** Give up after this many idle passes; the point may not be on a building. */
const MAX_ATTEMPTS = 12;

interface BuildingMaskProps {
  models: Pick<MapModel, "id" | "hiddenBuildings">[];
}

export function BuildingMask({ models }: BuildingMaskProps) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const points = models.flatMap((model) => model.hiddenBuildings ?? []);
    const hidden: TargetFeature[] = [];
    let attempts = 0;

    const release = () => {
      for (const feature of hidden) {
        try {
          map.removeFeatureState(feature);
        } catch {
          /* the style may already be gone */
        }
      }
      hidden.length = 0;
    };

    /**
     * Finds and hides the building nearest each recorded point.
     *
     * Runs on `idle` because `queryRenderedFeatures` only sees what has been
     * drawn: asking before the tile has arrived finds nothing, and a mask that
     * silently failed is worse than one that takes a second to appear.
     */
    const apply = () => {
      if (points.length === 0) {
        map.off("idle", apply);
        return;
      }

      attempts += 1;
      let found = 0;

      for (const point of points) {
        const centre = map.project([point.longitude, point.latitude]);

        // Convert the search radius to pixels at the current camera, so the
        // same patch of ground is covered whatever the zoom.
        const offset = map.project([point.longitude + 0.0003, point.latitude]);
        const pixelsPerMetre = Math.abs(offset.x - centre.x) / 25;
        const radius = Math.min(Math.max(SEARCH_M * pixelsPerMetre, 10), 140);

        let hits: TargetFeature[] = [];
        try {
          hits = map.queryRenderedFeatures(
            [
              [centre.x - radius, centre.y - radius],
              [centre.x + radius, centre.y + radius],
            ],
            { target: BUILDINGS },
          );
        } catch {
          // A style without the featureset is a supported state, not an error.
          map.off("idle", apply);
          return;
        }

        if (hits.length === 0) continue;
        found += 1;

        // Only the nearest footprint. A wide box on a dense block would
        // otherwise erase the neighbours too.
        const nearest = hits.reduce((best, hit) => {
          const score = (feature: TargetFeature) => {
            const centroid = footprintCentre(feature);
            if (!centroid) return Infinity;
            const projected = map.project(centroid);
            return Math.hypot(projected.x - centre.x, projected.y - centre.y);
          };
          return score(hit) < score(best) ? hit : best;
        });

        map.setFeatureState(nearest, { hide: true });
        hidden.push(nearest);
      }

      // `setFeatureState` schedules a re-render on its own, but forcing the
      // issue here is cheap insurance against the one case that matters most:
      // an admin who just toggled the mask with the camera sitting still,
      // where nothing else would prompt a repaint at all.
      if (found > 0) map.triggerRepaint();

      if (found === points.length || attempts >= MAX_ATTEMPTS) map.off("idle", apply);
    };

    const reset = () => {
      // A style reload drops every feature state, so the mask is re-resolved
      // from the same stored coordinates rather than assumed to have survived.
      hidden.length = 0;
      attempts = 0;
      map.on("idle", apply);
      apply();
    };

    /*
     * `idle` is the wrong sole trigger for this.
     *
     * It fires after the camera moves or tiles load — not when an admin
     * toggles the mask with the camera sitting still, which is the ordinary
     * way this gets turned on. Without a camera change afterward, `idle`
     * never refires, `apply` is never called, and the toggle silently does
     * nothing despite the UI reporting success. Running it once immediately,
     * every time the effect re-runs (mask toggled, model moved, list
     * changed), is what actually makes the toggle work rather than merely
     * arm a listener that might never fire again.
     */
    map.on("idle", apply);
    map.on("style.load", reset);
    apply();

    return () => {
      map.off("idle", apply);
      map.off("style.load", reset);
      release();
    };
  }, [map, models]);

  return null;
}

/** Average of a footprint's outer ring — close enough to a centroid here. */
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
