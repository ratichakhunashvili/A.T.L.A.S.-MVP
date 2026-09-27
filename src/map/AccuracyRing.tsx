/**
 * The uncertainty around the guest's position, drawn to scale.
 *
 * A dot on a map is a claim of precision. When the browser only knows the
 * neighbourhood — or the city — this ring is what keeps that claim honest: the
 * guest is somewhere inside it, and it is the right size on the ground at
 * every zoom because it is a geodesic polygon rather than a pixel radius.
 *
 * It appears only when the fix is not precise. A ten-metre ring under a
 * ten-metre dot would be noise.
 */

import type { FeatureCollection } from "geojson";
import type { GeoJSONSource } from "mapbox-gl";
import { useEffect, useRef } from "react";

import { useMap } from "./MapProvider";
import { accuracyRing, type Fix, type FixQuality } from "../data/geo";

const SOURCE_ID = "guest-accuracy";
const FILL_ID = "guest-accuracy-fill";
const LINE_ID = "guest-accuracy-line";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

interface AccuracyRingProps {
  fix: Fix | null;
  quality: FixQuality | null;
}

export function AccuracyRing({ fix, quality }: AccuracyRingProps) {
  const map = useMap();
  const dataRef = useRef<FeatureCollection>(EMPTY as FeatureCollection);

  // A precise fix needs no caveat; anything looser does.
  const visible = Boolean(fix) && quality !== null && quality !== "precise";

  dataRef.current = (visible && fix
    ? {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [accuracyRing(fix, fix.accuracy)],
            },
          },
        ],
      }
    : EMPTY) as FeatureCollection;

  useEffect(() => {
    if (!map) return;

    const push = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(dataRef.current);
    };

    const install = () => {
      try {
        // Source and layers are guarded separately. Checking only the source
        // strands the layers permanently if a style diff ever drops one
        // without the other, because the guard then short-circuits forever.
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, { type: "geojson", data: EMPTY });
        }
        if (!map.getLayer(FILL_ID)) {
          map.addLayer({
            id: FILL_ID,
            type: "fill",
            source: SOURCE_ID,
            paint: { "fill-color": "#184E77", "fill-opacity": 0.1 },
          });
        }
        if (!map.getLayer(LINE_ID)) {
          map.addLayer({
            id: LINE_ID,
            type: "line",
            source: SOURCE_ID,
            paint: {
              "line-color": "#184E77",
              "line-width": 1.5,
              "line-opacity": 0.5,
              "line-dasharray": [2, 2],
            },
          });
        }
      } catch {
        // A style without these layer types is not worth failing the map over.
        return;
      }
      // A style reload drops custom layers; the data has to go back too.
      push();
    };

    /*
     * Deliberately not gated on `isStyleLoaded()`: with the Standard style
     * that flag stays false while the basemap import resolves, long after
     * `style.load` has fired and long after `useMap()` starts handing out the
     * map. Gating on it means the first call always bails and the layers then
     * depend on an `idle` that may not arrive while the basemap is still
     * streaming. `install` is idempotent and guarded, so `idle` is only a retry.
     */
    const ensure = () => {
      install();
      if (map.getSource(SOURCE_ID) && map.getLayer(FILL_ID) && map.getLayer(LINE_ID)) {
        map.off("idle", ensure);
      }
    };

    ensure();
    map.on("style.load", install);
    map.on("idle", ensure);

    return () => {
      map.off("style.load", install);
      map.off("idle", ensure);
      try {
        if (map.getLayer(LINE_ID)) map.removeLayer(LINE_ID);
        if (map.getLayer(FILL_ID)) map.removeLayer(FILL_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* style already gone */
      }
    };
  }, [map]);

  // Only the source data changes as the guest moves — never the layers.
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData(dataRef.current);
  }, [map, fix, quality]);

  return null;
}
