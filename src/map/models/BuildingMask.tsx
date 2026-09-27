/**
 * Hiding the basemap building underneath a custom model.
 *
 * A 3D asset placed on a mapped building fights with it: two roofs at slightly
 * different heights, z-fighting on the walls, and a silhouette that belongs to
 * neither.
 *
 * Two things happen together, because neither is enough alone:
 *
 *   1. `setFeatureState(feature, { hide: true })` on the buildings featureset.
 *      This is the one lever Mapbox Standard actually exposes here, and it
 *      does exactly one thing: it flattens the building's extrusion height to
 *      zero. It does *not* change its fill colour, and it cannot reach a
 *      colour applied for an unrelated reason — the guest's own hotel, for
 *      instance, is independently tinted navy by `BasemapAnnotations` so the
 *      guest can find it, and `hide` has no way to know that tint exists, let
 *      alone remove it. Standard's building layers live inside an opaque
 *      style import; there is no public API to inspect or repaint them
 *      per-feature beyond the documented feature-state keys.
 *
 *   2. A cover: our own flat polygon, in the app's own land colour, drawn over
 *      the now-flattened footprint. This is what actually makes the building
 *      disappear rather than merely go flat and stay whatever colour it was.
 *      It works only because step 1 already brought the building down to
 *      ground level — a flat 2D patch cannot hide an extruded 3D box from
 *      every viewing angle, only a flattened one.
 *
 *      The cover is a `fill-extrusion`, not a plain `fill`, and that is load
 *      bearing rather than decorative: GL JS batches ordinary 2D layers
 *      (`fill`, `line`, `background`, `hillshade`, `raster`) into an early
 *      "draped" pass that always renders before 3D content, regardless of
 *      layer order or slot. A flattened Standard building is still a 3D-pass
 *      layer at zero height, so a plain fill cover — however it's ordered —
 *      gets painted first and then drawn over. Giving the cover a small
 *      fixed extrusion height puts it in that same later pass, where normal
 *      insertion order actually decides what's on top.
 *
 * The cover fades in and out (`fill-extrusion-opacity-transition`) rather than
 * popping, because a shape that appears mid-frame while an admin is looking
 * right at it reads as a glitch even when it is working correctly.
 * `fill-extrusion-opacity` cannot be data-driven (no per-feature feature-state
 * the way `fill-opacity` allows), so each masked building gets its own tiny
 * layer — filtered to its one feature — rather than sharing one layer whose
 * opacity would apply to every cover at once.
 *
 * Positions are stored rather than feature ids. A feature id is only stable
 * within a tileset version, and a model that loses its mask after a basemap
 * update is a bug nobody would think to look for — so the mask is re-resolved
 * from coordinates each time the style loads.
 */

import { useEffect, useRef } from "react";
import type { GeoJSONSource, TargetFeature } from "mapbox-gl";

import { MODEL_LAYER_ID } from "./ModelLayer";
import { useMap } from "../MapProvider";
import { isOnScreen, searchBox } from "../projection";
import type { MapModel } from "../../data/types";

const BUILDINGS = { featuresetId: "buildings", importId: "basemap" } as const;

const COVER_SOURCE = "building-mask-cover";
const coverLayerId = (key: string) => `building-mask-cover:${key}`;

/**
 * The system's own land tone (`LAND` in `map/config.ts`, `--map-land` in
 * `tokens.css`). Duplicated here rather than imported: this is a rendering
 * constant for a Mapbox paint expression, not a design token consumed by CSS,
 * and the two are kept in sync by being this one unmistakable hex.
 */
const COVER_COLOR = "#F3EEDB";

/**
 * Just tall enough to sit clear of the flattened building's own cap and
 * avoid z-fighting with it — not tall enough to read as a raised platform.
 */
const COVER_HEIGHT_M = 0.6;

/** How long the cover takes to fade in or out. */
const FADE_MS = 300;

/** How far from the recorded point to look, in metres. */
const SEARCH_M = 26;

/**
 * Give up on a point after this many *fair* attempts — passes where the point
 * was actually on screen at a zoom that draws footprints. A point that was
 * never looked at does not spend its budget.
 */
const MAX_ATTEMPTS = 12;

/**
 * Standard does not draw building footprints below roughly this zoom, so a
 * query there is guaranteed to come back empty. Without this gate a guest who
 * opens the app zoomed out burns every attempt on nothing and the mask never
 * appears once they zoom in.
 */
const BUILDING_ZOOM = 15;

type MaskModel = Pick<MapModel, "id" | "longitude" | "latitude" | "hiddenBuildings">;

/**
 * Which coordinates to mask under a model.
 *
 * `undefined` means "work it out": the building under the model's own
 * position, which is what is wanted almost every time and previously had to be
 * asked for by hand — an admin who placed a model on a mapped building and did
 * not find the toggle got a model sunk into a roof. `[]` is an explicit "leave
 * the building standing", and a populated array is exactly those points.
 */
function pointsFor(model: MaskModel) {
  return model.hiddenBuildings ?? [{ longitude: model.longitude, latitude: model.latitude }];
}

interface BuildingMaskProps {
  /**
   * Only models whose asset has actually loaded. A mask under a model that is
   * still arriving — or that turned out to be a 404 — is a hole in the city
   * where a building used to be.
   */
  models: MaskModel[];
}

export function BuildingMask({ models }: BuildingMaskProps) {
  const map = useMap();

  /** Cover features currently shown, so a fade-out only touches what changed. */
  const shown = useRef(new Map<string, GeoJSON.Feature>());
  /** Fade-outs in flight, so a mask re-toggled mid-fade doesn't get orphaned. */
  const removing = useRef(new Map<string, number>());
  /** Per-key cover layers currently on the map, for cleanup on unmount. */
  const layers = useRef(new Set<string>());

  useEffect(() => {
    if (!map) return;

    // One key per configured point, stable across passes regardless of which
    // underlying tile feature currently answers the query — this is what a
    // fade-out keys off, not Mapbox's own (tileset-scoped) feature id.
    const points = models.flatMap((model, modelIndex) =>
      pointsFor(model).map((point, pointIndex) => ({
        key: `${model.id}:${modelIndex}:${pointIndex}`,
        point,
      })),
    );

    /**
     * The flattened features, keyed so a long session cannot accumulate the
     * same feature hundreds of times — `apply` runs on every idle, and pushing
     * to an array here used to mean the cleanup loop re-removed a duplicate
     * for every pass the camera had ever settled from.
     */
    const hiddenFeatures = new Map<string, TargetFeature>();

    /** Fair attempts spent per point, and the ones that have given up. */
    const attemptsByKey = new Map<string, number>();
    const retired = new Set<string>();
    // A `setFeatureState` write occasionally does not make it into the very
    // next paint — the state reads back correctly, but the flattened height
    // it should have produced doesn't show until the *same* write is issued a
    // second time. Rather than chase that engine quirk, one confirmed pass is
    // treated as provisional: `apply` keeps listening for one more full
    // resolution (which `triggerRepaint` below guarantees by scheduling the
    // idle event that drives it) before it stops re-asserting.
    let confirmedPasses = 0;

    const ensureSource = () => {
      if (map.getSource(COVER_SOURCE)) return;
      map.addSource(COVER_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    };

    /** Creates the one small layer for a given key's cover, if not already there. */
    const ensureCoverLayer = (key: string) => {
      const id = coverLayerId(key);
      if (map.getLayer(id)) return;

      // Inserted below the model layer so a placed GLB still draws on top of
      // its own ground patch, and above everything Standard draws for the
      // basemap import, which is the whole point of adding it.
      const beforeId = map.getLayer(MODEL_LAYER_ID) ? MODEL_LAYER_ID : undefined;
      map.addLayer(
        {
          id,
          type: "fill-extrusion",
          source: COVER_SOURCE,
          filter: ["==", ["id"], key],
          paint: {
            "fill-extrusion-color": COVER_COLOR,
            "fill-extrusion-height": COVER_HEIGHT_M,
            "fill-extrusion-base": 0,
            "fill-extrusion-height-alignment": "flat",
            "fill-extrusion-base-alignment": "flat",
            // Layer-wide rather than per-feature — `fill-extrusion-opacity`
            // isn't data-driven — which is exactly why this key gets its own
            // layer instead of sharing one across every masked building.
            "fill-extrusion-opacity": 0,
            "fill-extrusion-opacity-transition": { duration: FADE_MS, delay: 0 },
          },
        },
        beforeId,
      );
      layers.current.add(id);
    };

    const removeCoverLayer = (key: string) => {
      const id = coverLayerId(key);
      if (map.getLayer(id)) map.removeLayer(id);
      layers.current.delete(id);
    };

    const source = () => map.getSource(COVER_SOURCE) as GeoJSONSource | undefined;

    /** Applies the current `shown` map to the cover source in one write. */
    const paintCover = () => {
      source()?.setData({
        type: "FeatureCollection",
        features: [...shown.current.values()],
      });
    };

    /** Removes a cover feature once its fade-out has actually finished. */
    const scheduleRemoval = (key: string) => {
      const existing = removing.current.get(key);
      if (existing !== undefined) window.clearTimeout(existing);

      if (map.getLayer(coverLayerId(key))) {
        map.setPaintProperty(coverLayerId(key), "fill-extrusion-opacity", 0);
      }
      const timer = window.setTimeout(() => {
        shown.current.delete(key);
        removing.current.delete(key);
        removeCoverLayer(key);
        paintCover();
      }, FADE_MS + 60);
      removing.current.set(key, timer);
    };

    /**
     * Finds the building nearest each recorded point and masks it: flattened
     * via feature-state, then covered by our own patch.
     *
     * Runs on `idle` because `queryRenderedFeatures` only sees what has been
     * drawn — asking before a tile has arrived finds nothing — and once
     * immediately, because toggling the mask does not move the camera and
     * `idle` would otherwise never refire at all.
     */
    const apply = () => {
      if (points.length === 0) {
        for (const key of shown.current.keys()) scheduleRemoval(key);
        map.off("idle", apply);
        return;
      }

      ensureSource();
      let found = 0;
      const resolvedThisPass = new Set<string>();

      for (const { key, point } of points) {
        if (retired.has(key)) continue;

        /*
         * Already masked: no second query.
         *
         * The feature state is still re-asserted for the first couple of
         * settled passes — see `confirmedPasses` — but re-running the
         * expensive screen-space query for a building that was resolved long
         * ago would run on every camera stop for the life of the session.
         */
        const already = hiddenFeatures.get(key);
        if (already) {
          resolvedThisPass.add(key);
          if (confirmedPasses < 2) {
            map.setFeatureState(already, { hide: true });
            found += 1;
          }
          continue;
        }

        const centre = map.project([point.longitude, point.latitude]);
        const box = searchBox(map, point, SEARCH_M, { min: 10, max: 140 });

        /*
         * `queryRenderedFeatures` only sees what has actually been drawn, so a
         * point off the edge of the canvas, or at a zoom where Standard draws
         * no footprints, has not had a fair chance at all. Skipping without
         * spending the budget is what lets a mask still resolve for a model
         * the guest has not walked to yet — which, once attractions start out
         * fogged, is most of them.
         */
        if (map.getZoom() < BUILDING_ZOOM) continue;
        if (!isOnScreen(map, point, box[1][0] - centre.x)) continue;

        let hits: TargetFeature[] = [];
        try {
          hits = map.queryRenderedFeatures(box, { target: BUILDINGS });
        } catch {
          // A style without the featureset is a supported state, not an error.
          map.off("idle", apply);
          return;
        }

        if (hits.length === 0) {
          const spent = (attemptsByKey.get(key) ?? 0) + 1;
          attemptsByKey.set(key, spent);
          // Not every model stands on a mapped building. After enough real
          // looks, stop looking for this one — but only this one.
          if (spent >= MAX_ATTEMPTS) retired.add(key);
          continue;
        }

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

        const polygon = footprintPolygon(nearest);
        if (!polygon) continue;

        found += 1;
        resolvedThisPass.add(key);

        map.setFeatureState(nearest, { hide: true });
        hiddenFeatures.set(key, nearest);

        const alreadyShown = shown.current.has(key);
        shown.current.set(key, {
          type: "Feature",
          id: key,
          properties: {},
          geometry: polygon,
        });

        // A fade-toggle-off arriving before its timer fired is cancelled —
        // the mask is back on, so what was mid-fade-out should simply stay.
        const pendingRemoval = removing.current.get(key);
        if (pendingRemoval !== undefined) {
          window.clearTimeout(pendingRemoval);
          removing.current.delete(key);
        }

        if (!alreadyShown) {
          ensureCoverLayer(key);
          // Painted at opacity 0 first (the layer default above), then faded
          // to 1 on the next frame — the two have to be separate writes or
          // there is nothing for the transition to animate between.
          requestAnimationFrame(() => {
            if (map.getLayer(coverLayerId(key))) {
              map.setPaintProperty(coverLayerId(key), "fill-extrusion-opacity", 1);
            }
          });
        } else {
          // Defensive: a layer that somehow went missing (e.g. a style diff
          // that dropped it without a full reload) gets recreated already
          // visible, rather than the building silently reappearing.
          if (!map.getLayer(coverLayerId(key))) {
            ensureCoverLayer(key);
            map.setPaintProperty(coverLayerId(key), "fill-extrusion-opacity", 1);
          }
        }
      }

      // Anything that used to be masked but is not wanted this pass (mask
      // turned off, or the model/point was removed) fades back out.
      for (const key of shown.current.keys()) {
        if (!resolvedThisPass.has(key) && !removing.current.has(key)) scheduleRemoval(key);
      }

      paintCover();

      // `setFeatureState` schedules a re-render on its own, but forcing the
      // issue here is cheap insurance against the one case that matters most:
      // an admin who just toggled the mask with the camera sitting still,
      // where nothing else would prompt a repaint at all.
      if (found > 0) map.triggerRepaint();

      /*
       * `idle` is never detached once everything has settled.
       *
       * It used to be, and that was fatal for anything the camera had not
       * reached: a point that was off-screen for twelve passes gave up
       * permanently and never re-armed when the guest finally walked to it.
       * A settled pass now costs one projection per point and no query at
       * all, which is cheap enough to simply keep running.
       */
      const outstanding = points.some(
        ({ key }) => !resolvedThisPass.has(key) && !retired.has(key),
      );
      confirmedPasses = outstanding ? 0 : confirmedPasses + 1;
    };

    const reset = () => {
      // A style reload drops every feature state and every custom layer, so
      // both the flatten and the cover are re-resolved from scratch rather
      // than assumed to have survived. The old per-key layers are already
      // gone with the old style; only the bookkeeping needs clearing.
      hiddenFeatures.clear();
      shown.current.clear();
      layers.current.clear();
      for (const timer of removing.current.values()) window.clearTimeout(timer);
      removing.current.clear();
      attemptsByKey.clear();
      retired.clear();
      confirmedPasses = 0;
      apply();
    };

    map.on("idle", apply);
    map.on("style.load", reset);
    apply();

    return () => {
      map.off("idle", apply);
      map.off("style.load", reset);
      for (const feature of hiddenFeatures.values()) {
        try {
          map.removeFeatureState(feature);
        } catch {
          /* the style may already be gone */
        }
      }
      hiddenFeatures.clear();
      for (const timer of removing.current.values()) window.clearTimeout(timer);
      removing.current.clear();
    };
    // `shown` and `removing` are refs: intentionally excluded, their
    // identities never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, models]);

  // The layers and their cover patches are removed entirely on unmount —
  // nothing left standing once the guest map or the editor preview goes away.
  useEffect(() => {
    if (!map) return;
    return () => {
      try {
        for (const id of layers.current) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(COVER_SOURCE)) map.removeSource(COVER_SOURCE);
      } catch {
        /*
         * The editor preview and the guest map are both unmounted wholesale,
         * and this can run after `map.remove()` has torn the style down — at
         * which point `getLayer` throws from inside Mapbox. There is nothing
         * left to clean up in that case, which is the outcome we wanted.
         */
      }
      layers.current.clear();
    };
  }, [map]);

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

/** The footprint itself, for the cover polygon. Only real polygons qualify. */
function footprintPolygon(
  feature: TargetFeature,
): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  const geometry = feature.geometry;
  if (!geometry) return null;
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") return geometry;
  return null;
}
