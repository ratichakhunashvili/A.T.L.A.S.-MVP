/**
 * The fog standing over every attraction this guest has not yet earned.
 *
 * Read `fog.ts` first — it carries the two rendering constraints that decide
 * the whole shape of this (layer-wide extrusion opacity, and the early draped
 * pass that puts plain 2D fills underneath all 3D content).
 *
 * The concealment is not a curtain over a drawn model. A locked attraction is
 * never added to the model layer and its asset is never fetched, so there is
 * nothing behind the fog to leak while bytes arrive. What clears the fog is
 * therefore not "the unlock happened" but "the unlock happened *and* the
 * geometry that replaces it is ready" — otherwise there would be a hole where
 * the model should be for as long as the download takes.
 */

import { useEffect, useRef } from "react";
import type { GeoJSONSource } from "mapbox-gl";

import {
  FOG_COLOR,
  FOG_IN_MS,
  FOG_LAYER,
  FOG_SOURCE,
  REVEAL_MS,
  fogFeatureId,
  fogFeatures,
  FOG_TIERS,
} from "./fog";
import { MODEL_LAYER_ID } from "./ModelLayer";
import { MODEL_MIN_ZOOM, prefersReducedMotion } from "../config";
import { useMap } from "../MapProvider";
import type { MapModel } from "../../data/types";

type FogModel = Pick<MapModel, "id" | "longitude" | "latitude">;

interface FogLayerProps {
  /** Every model that could be fogged — locked or not. */
  models: FogModel[];
  /** Which of them this guest has not unlocked. */
  lockedModelIds: Set<string>;
}

export function FogLayer({ models, lockedModelIds }: FogLayerProps) {
  const map = useMap();

  /** Model id → its dome features, for everything currently in the source. */
  const shown = useRef(new Map<string, GeoJSON.Feature[]>());
  /**
   * The authoritative fog level per feature.
   *
   * Feature state does not survive a style reload, so this is replayed after
   * every install rather than written once — the same lesson `ModelLayer`
   * learned for its data and its selection.
   */
  const levels = useRef(new Map<string, number>());
  /** Reveals in flight, so a re-lock mid-animation does not orphan a dome. */
  const clearing = useRef(new Map<string, number>());

  useEffect(() => {
    if (!map) return;

    const source = () => map.getSource(FOG_SOURCE) as GeoJSONSource | undefined;

    const paint = () => {
      source()?.setData({
        type: "FeatureCollection",
        features: [...shown.current.values()].flat(),
      });
    };

    /** Applies every remembered level. Cheap, and correct after a reload. */
    const replayLevels = () => {
      for (const [id, fog] of levels.current) {
        map.setFeatureState({ source: FOG_SOURCE, id }, { fog });
      }
    };

    /**
     * Transition duration is a layer property, not a per-feature one, so it
     * is set immediately before the writes it should apply to.
     */
    const setDuration = (ms: number) => {
      if (!map.getLayer(FOG_LAYER)) return;
      const duration = prefersReducedMotion() ? 0 : ms;
      map.setPaintProperty(FOG_LAYER, "fill-extrusion-height-transition", { duration, delay: 0 });
      map.setPaintProperty(FOG_LAYER, "fill-extrusion-base-transition", { duration, delay: 0 });
    };

    const install = () => {
      try {
        if (!map.getSource(FOG_SOURCE)) {
          map.addSource(FOG_SOURCE, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
            // Never set `generateId` here: it overwrites the string feature
            // ids the reveal addresses by, and every `setFeatureState` below
            // would silently stop matching anything.
          });
        }

        if (!map.getLayer(FOG_LAYER)) {
          // Below the model layer, so an unlocked model standing in front of a
          // still-fogged one is not blended through its haze.
          const beforeId = map.getLayer(MODEL_LAYER_ID) ? MODEL_LAYER_ID : undefined;
          map.addLayer(
            {
              id: FOG_LAYER,
              type: "fill-extrusion",
              source: FOG_SOURCE,
              minzoom: MODEL_MIN_ZOOM,
              paint: {
                "fill-extrusion-color": FOG_COLOR,
                // Layer-wide — the property is not data-driven. This is why
                // the reveal animates height rather than opacity.
                "fill-extrusion-opacity": 0.82,
                // Both data-driven, so one attraction can clear without
                // touching any other. Scaling base and top by the same factor
                // keeps base <= height at every frame of the animation.
                "fill-extrusion-base": [
                  "*",
                  ["get", "base"],
                  ["coalesce", ["feature-state", "fog"], 0],
                ],
                "fill-extrusion-height": [
                  "*",
                  ["get", "top"],
                  ["coalesce", ["feature-state", "fog"], 0],
                ],
                "fill-extrusion-vertical-gradient": true,
                // A fog bank that casts a hard shadow reads as a building.
                "fill-extrusion-cast-shadows": false,
                "fill-extrusion-ambient-occlusion-intensity": 0,
                "fill-extrusion-emissive-strength": 0.28,
              },
            },
            beforeId,
          );
        }
      } catch {
        // Too early: the style is mid-load and has no room for a custom layer
        // yet. `installed` stays false and the `idle` retry below picks it up.
        return;
      }

      paint();
      replayLevels();
      setDuration(REVEAL_MS);
    };

    /*
     * Installing is deliberately *not* gated on `isStyleLoaded()`.
     *
     * With the Standard style that flag stays false while the basemap import
     * resolves — which is long after `style.load` has fired and long after
     * `useMap()` starts handing out the map. Gating on it means the first
     * attempt always bails, and the whole layer then depends on an `idle`
     * that may not arrive while the basemap is still streaming its own 3D
     * content. Adding the source directly is what `BuildingMask` has always
     * done, and it works; `install` is idempotent and guarded, so a genuinely
     * early call simply throws, is swallowed, and is retried below.
     */
    const ensure = () => {
      install();
      if (map.getSource(FOG_SOURCE) && map.getLayer(FOG_LAYER)) map.off("idle", ensure);
    };

    ensure();
    map.on("style.load", install);
    map.on("idle", ensure);

    /* -- Reconcile against what should be fogged -------------------------- */

    const wanted = models.filter((model) => lockedModelIds.has(model.id));
    const wantedIds = new Set(wanted.map((model) => model.id));

    for (const model of wanted) {
      // A reveal that had not finished when the attraction was locked again:
      // cancel it and let the dome simply stay.
      const pending = clearing.current.get(model.id);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        clearing.current.delete(model.id);
      }

      if (shown.current.has(model.id)) continue;

      shown.current.set(model.id, fogFeatures(model.id, model));
      for (let tier = 0; tier < FOG_TIERS.length; tier += 1) {
        levels.current.set(fogFeatureId(model.id, tier), 0);
      }
      paint();

      // Painted flat first, then raised on the next frame — the two have to be
      // separate writes or the transition has nothing to animate between.
      requestAnimationFrame(() => {
        if (!map.getLayer(FOG_LAYER)) return;
        setDuration(FOG_IN_MS);
        for (let tier = 0; tier < FOG_TIERS.length; tier += 1) {
          const id = fogFeatureId(model.id, tier);
          levels.current.set(id, 1);
          map.setFeatureState({ source: FOG_SOURCE, id }, { fog: 1 });
        }
        map.triggerRepaint();
      });
    }

    for (const modelId of [...shown.current.keys()]) {
      if (wantedIds.has(modelId)) continue;
      if (clearing.current.has(modelId)) continue;

      setDuration(REVEAL_MS);
      for (let tier = 0; tier < FOG_TIERS.length; tier += 1) {
        const id = fogFeatureId(modelId, tier);
        levels.current.set(id, 0);
        map.setFeatureState({ source: FOG_SOURCE, id }, { fog: 0 });
      }
      map.triggerRepaint();

      // Removed only once the collapse has actually finished, or the dome
      // would vanish mid-animation instead of sinking into the ground.
      const delay = prefersReducedMotion() ? 0 : REVEAL_MS + 60;
      const timer = window.setTimeout(() => {
        shown.current.delete(modelId);
        clearing.current.delete(modelId);
        for (let tier = 0; tier < FOG_TIERS.length; tier += 1) {
          levels.current.delete(fogFeatureId(modelId, tier));
        }
        paint();
      }, delay);
      clearing.current.set(modelId, timer);
    }

    return () => {
      map.off("style.load", install);
      map.off("idle", ensure);
    };
  }, [map, models, lockedModelIds]);

  // Torn down wholesale on unmount: nothing left standing once the guest map
  // or the editor preview goes away.
  useEffect(() => {
    if (!map) return;
    const timers = clearing.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      shown.current.clear();
      levels.current.clear();
      try {
        if (map.getLayer(FOG_LAYER)) map.removeLayer(FOG_LAYER);
        if (map.getSource(FOG_SOURCE)) map.removeSource(FOG_SOURCE);
      } catch {
        /* the style may already be gone — nothing left to clean up */
      }
    };
  }, [map]);

  return null;
}
