/**
 * Renders geo-anchored 3D assets with Mapbox's native model layer.
 *
 * The models live inside the map's own scene, which is the whole point: they
 * are lit by the style's lighting, cast and receive its shadows, are occluded
 * by buildings and terrain, and they pan, zoom, tilt and rotate with the camera
 * because the camera is the only thing moving. There is no second canvas over
 * the map, and nothing about a model is a DOM element.
 *
 * Nothing here knows which models exist, and nothing here fetches anything. It
 * receives records and their already-resolved assets, and writes a single
 * GeoJSON source — so an administrator adding a model is indistinguishable,
 * from this component's point of view, from the page loading.
 *
 * A record whose asset is still arriving, or failed to arrive, is simply
 * absent from the source. That is deliberate: a feature pointing at an asset
 * that turns out not to be a glTF is a blank patch on the map with nothing
 * connecting it back to a record, and a locked attraction must never have its
 * geometry fetched at all.
 */

import type { Feature, Point } from "geojson";
import type { GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import { useEffect, useMemo, useRef } from "react";

import type { ModelAsset } from "./useModelAssets";
import { MODEL_MIN_ZOOM } from "../config";
import { useMap } from "../MapProvider";
import type { MapModel } from "../../data/types";

const SOURCE_ID = "app-models";
export const MODEL_LAYER_ID = "app-models";

type ModelFeature = Feature<Point>;

interface ModelLayerProps {
  models: MapModel[];
  /** Resolved assets, keyed by `MapModel.modelUrl`. */
  assets: Map<string, ModelAsset>;
  selectedId: string | null;
  /** Tapping the model itself — real 3D hit-testing, not a DOM proxy. */
  onSelect?: (id: string) => void;
}

/**
 * Turns a record into a feature the layer can draw. Transforms travel as
 * three-number arrays because that is the shape Mapbox's model paint
 * properties expect.
 */
function toFeature(model: MapModel, url: string): ModelFeature {
  return {
    type: "Feature",
    id: model.id,
    geometry: { type: "Point", coordinates: [model.longitude, model.latitude] },
    properties: {
      id: model.id,
      name: model.name,
      url,
      scale: [model.scale, model.scale, model.scale],
      rotation: [model.rotationX, model.rotationY, model.rotationZ],
      // x east, y north, z up — altitude is a vertical offset in metres.
      translation: [0, 0, model.altitude],
    },
  };
}

export function ModelLayer({ models, assets, selectedId, onSelect }: ModelLayerProps) {
  const map = useMap();

  const features = useMemo(
    () =>
      models.flatMap((model) => {
        const asset = assets.get(model.modelUrl);
        return asset?.status === "ready" ? [toFeature(model, asset.url)] : [];
      }),
    [models, assets],
  );

  // Mirrors of the props, so the install path can restore the layer's full
  // state after a style reload without waiting for a React render.
  const featuresRef = useRef(features);
  featuresRef.current = features;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  /* -- Create the layer, and re-create it if the style reloads ------------ */
  useEffect(() => {
    if (!map) return;

    const pushData = () => {
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: featuresRef.current });
    };

    const pushSelection = () => {
      if (!map.getLayer(MODEL_LAYER_ID)) return;
      const id = selectedRef.current ?? "";
      const isSelected = ["==", ["get", "id"], id];

      try {
        // Tint the selected asset toward the accent and lift it out of the
        // dark, rather than moving it — the model stays where it was placed.
        map.setPaintProperty(MODEL_LAYER_ID, "model-color", [
          "case",
          isSelected,
          "#D9ED92",
          "#FFFFFF",
        ]);
        map.setPaintProperty(MODEL_LAYER_ID, "model-color-mix-intensity", [
          "case",
          isSelected,
          0.32,
          0,
        ]);
        map.setPaintProperty(MODEL_LAYER_ID, "model-emissive-strength", [
          "case",
          isSelected,
          1.0,
          0.55,
        ]);
      } catch {
        /* layer not installed in this build */
      }
    };

    const install = () => {
      try {
        // Source *and* layer are checked separately. Guarding on the source
        // alone strands the layer permanently if a style diff ever drops one
        // without the other, because the guard then short-circuits forever.
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
        }

        if (!map.getLayer(MODEL_LAYER_ID)) {
          map.addLayer({
            id: MODEL_LAYER_ID,
            type: "model",
            source: SOURCE_ID,
            // Below this the assets would be sub-pixel; skipping the draw also
            // stops Mapbox fetching geometry the guest cannot see.
            minzoom: MODEL_MIN_ZOOM,
            layout: {
              "model-id": ["get", "url"],
            },
            paint: {
              "model-scale": ["array", "number", 3, ["get", "scale"]],
              "model-rotation": ["array", "number", 3, ["get", "rotation"]],
              "model-translation": ["array", "number", 3, ["get", "translation"]],
              "model-emissive-strength": 0.55,
              // Shadows and contact occlusion are what stop a model looking
              // stuck on top of the city rather than standing in it.
              "model-cast-shadows": true,
              "model-receive-shadows": true,
              "model-ambient-occlusion-intensity": 0.9,
              // Altitude is measured from the terrain, not from sea level.
              "model-elevation-reference": "ground",
              "model-opacity": 1,
            },
          });
        }
      } catch (error) {
        console.warn(
          "[models] native model layer unavailable in this Mapbox build; " +
            "ground anchors remain interactive",
          error,
        );
        return;
      }

      // A style reload drops every custom layer. Re-installing is not enough —
      // the data and the selection have to be written back too, or the layer
      // comes back empty and stays that way until a prop happens to change.
      pushData();
      pushSelection();
    };

    /*
     * Installing is a race, and losing it silently is how a layer goes
     * missing.
     *
     * Deliberately not gated on `isStyleLoaded()`: with the Standard style
     * that flag stays false while the basemap import resolves, which is long
     * after `style.load` has fired and long after `useMap()` starts handing
     * out the map. Gating on it means the first attempt always bails and the
     * layer then depends on an `idle` that may not arrive while the basemap is
     * still streaming its own 3D content. `install` is idempotent and guarded,
     * so calling it directly is safe, and `idle` is kept only as a retry.
     */
    const ensure = () => {
      install();
      if (map.getSource(SOURCE_ID) && map.getLayer(MODEL_LAYER_ID)) map.off("idle", ensure);
    };

    /* -- Tapping the model itself ---------------------------------------- */
    const onClick = (event: MapMouseEvent) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: [MODEL_LAYER_ID] })[0];
      const id = hit?.properties?.id;
      if (typeof id === "string") onSelectRef.current?.(id);
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    ensure();
    map.on("style.load", install);
    map.on("idle", ensure);
    map.on("click", MODEL_LAYER_ID, onClick);
    map.on("mouseenter", MODEL_LAYER_ID, onEnter);
    map.on("mouseleave", MODEL_LAYER_ID, onLeave);

    return () => {
      map.off("style.load", install);
      map.off("idle", ensure);
      map.off("click", MODEL_LAYER_ID, onClick);
      map.off("mouseenter", MODEL_LAYER_ID, onEnter);
      map.off("mouseleave", MODEL_LAYER_ID, onLeave);
      // The map may already be torn down during unmount; guard every call.
      try {
        if (map.getLayer(MODEL_LAYER_ID)) map.removeLayer(MODEL_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        /* style already gone */
      }
    };
  }, [map]);

  /* -- Push data ---------------------------------------------------------- */
  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features });
  }, [map, features]);

  /* -- Selection highlight ------------------------------------------------ */
  useEffect(() => {
    if (!map || !map.getLayer(MODEL_LAYER_ID)) return;
    const isSelected = ["==", ["get", "id"], selectedId ?? ""];

    try {
      map.setPaintProperty(MODEL_LAYER_ID, "model-color", ["case", isSelected, "#D9ED92", "#FFFFFF"]);
      map.setPaintProperty(MODEL_LAYER_ID, "model-color-mix-intensity", ["case", isSelected, 0.32, 0]);
      map.setPaintProperty(MODEL_LAYER_ID, "model-emissive-strength", ["case", isSelected, 1.0, 0.55]);
    } catch {
      /* layer not installed in this build */
    }
  }, [map, selectedId, features]);

  return null;
}
