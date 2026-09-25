/**
 * The map editor.
 *
 * An administrator places a model the way anyone would expect: search for the
 * place, click the map or drag the model itself, then nudge altitude, scale
 * and rotation with the sliders while watching the real asset on the real
 * basemap. The preview is not a mock — it is the same `ModelLayer` the public
 * map uses, so what is approved here is what guests get.
 *
 * Positions and transforms change constantly during a drag, so persistence is
 * debounced: the preview updates on every frame, the registry is written once
 * the hand stops moving.
 */

import { ArrowLeft, Box, ChevronDown, ChevronUp, Crosshair } from "lucide-react";
import type { Map as MapboxMap, MapMouseEvent, MapTouchEvent } from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelUploader } from "./ModelUploader";
import { MAPBOX_TOKEN } from "../map/config";
import { MapMarker } from "../map/MapMarker";
import { MapProvider, useMap } from "../map/MapProvider";
import { MODEL_LAYER_ID, ModelLayer } from "../map/models/ModelLayer";
import { modelRepository } from "../data/modelRepository";
import { STAY } from "../data/seed";
import {
  CATEGORY_LABEL,
  PLACE_CATEGORIES,
  type MapModel,
  type MapModelDraft,
  type ModelStatus,
  type PlaceCategory,
} from "../data/types";

/* ------------------------------------------------------------------------ */
/* Small pieces                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Placement gestures on the editor map.
 *
 * Two ways to move a model, both direct: click anywhere on the map to drop it
 * there, or press the model itself and drag it. The drag is hit-tested against
 * the rendered 3D geometry — the administrator grabs the building, not a proxy
 * pin floating over it — and map panning is suspended for the duration so the
 * world stays still while the object moves.
 */
function ModelPlacement({ onPlace }: { onPlace: (lng: number, lat: number) => void }) {
  const map = useMap();
  const handlerRef = useRef(onPlace);
  handlerRef.current = onPlace;

  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvas();

    let dragging = false;
    let moved = false;

    const overModel = (point: MapMouseEvent["point"]) => {
      try {
        return map.queryRenderedFeatures(point, { layers: [MODEL_LAYER_ID] }).length > 0;
      } catch {
        return false;
      }
    };

    const begin = (point: MapMouseEvent["point"]) => {
      if (!overModel(point)) return false;
      dragging = true;
      moved = false;
      map.dragPan.disable();
      map.dragRotate.disable();
      canvas.style.cursor = "grabbing";
      return true;
    };

    const end = () => {
      if (!dragging) return;
      dragging = false;
      map.dragPan.enable();
      map.dragRotate.enable();
      canvas.style.cursor = "crosshair";
    };

    const onDown = (event: MapMouseEvent) => {
      if (begin(event.point)) event.preventDefault();
    };
    const onTouchStart = (event: MapTouchEvent) => {
      if (event.points.length === 1 && begin(event.point)) event.preventDefault();
    };
    const onMove = (event: MapMouseEvent | MapTouchEvent) => {
      if (!dragging) return;
      moved = true;
      handlerRef.current(event.lngLat.lng, event.lngLat.lat);
    };
    const onClick = (event: MapMouseEvent) => {
      // The click that ends a drag would otherwise re-place the model at the
      // release point, fighting the gesture that just finished.
      if (moved) {
        moved = false;
        return;
      }
      handlerRef.current(event.lngLat.lng, event.lngLat.lat);
    };
    const onEnter = () => {
      if (!dragging) canvas.style.cursor = "grab";
    };
    const onLeave = () => {
      if (!dragging) canvas.style.cursor = "crosshair";
    };

    canvas.style.cursor = "crosshair";
    map.on("mousedown", onDown);
    map.on("touchstart", onTouchStart);
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseup", end);
    map.on("touchend", end);
    map.on("click", onClick);
    map.on("mouseenter", MODEL_LAYER_ID, onEnter);
    map.on("mouseleave", MODEL_LAYER_ID, onLeave);

    return () => {
      map.off("mousedown", onDown);
      map.off("touchstart", onTouchStart);
      map.off("mousemove", onMove);
      map.off("touchmove", onMove);
      map.off("mouseup", end);
      map.off("touchend", end);
      map.off("click", onClick);
      map.off("mouseenter", MODEL_LAYER_ID, onEnter);
      map.off("mouseleave", MODEL_LAYER_ID, onLeave);
      map.dragPan.enable();
      map.dragRotate.enable();
      canvas.style.cursor = "";
    };
  }, [map]);

  return null;
}

/** Hands the live map instance up to the editor, for the framing control. */
function MapHandle({ onMap }: { onMap: (map: MapboxMap | null) => void }) {
  const map = useMap();
  useEffect(() => {
    onMap(map);
    return () => onMap(null);
  }, [map, onMap]);
  return null;
}

/**
 * Keeps the model in view without fighting the administrator.
 *
 * The rule is simply whether the model is still on screen. Dragging it or
 * clicking to place it keeps it in view by definition, so the camera holds
 * still; typing a coordinate or picking a search result can send it off the
 * edge, and then the camera follows. No distance threshold to tune.
 */
function CameraSync({ longitude, latitude }: { longitude: number; latitude: number }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (map.getBounds()?.contains([longitude, latitude])) return;
    map.easeTo({ center: [longitude, latitude], duration: 900 });
  }, [map, longitude, latitude]);

  return null;
}

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}

function SliderField({ label, value, min, max, step, suffix = "", onChange }: SliderFieldProps) {
  return (
    <div className="field slider-field">
      <div className="slider-field__head">
        <label className="field__label" htmlFor={`slider-${label}`} style={{ marginBottom: 0 }}>
          {label}
        </label>
        <span className="slider-field__value">
          {value}
          {suffix}
        </span>
      </div>
      <input
        id={`slider-${label}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Location search                                                           */
/* ------------------------------------------------------------------------ */

interface SearchResult {
  id: string;
  name: string;
  place: string;
  longitude: number;
  latitude: number;
}

function useLocationSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 3 || !MAPBOX_TOKEN) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
        url.searchParams.set("q", term);
        url.searchParams.set("limit", "5");
        url.searchParams.set("access_token", MAPBOX_TOKEN);

        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as {
          features: {
            id: string;
            properties: { name?: string; place_formatted?: string; coordinates?: { longitude: number; latitude: number } };
          }[];
        };

        setResults(
          body.features
            .filter((feature) => feature.properties.coordinates)
            .map((feature) => ({
              id: feature.id,
              name: feature.properties.name ?? term,
              place: feature.properties.place_formatted ?? "",
              longitude: feature.properties.coordinates!.longitude,
              latitude: feature.properties.coordinates!.latitude,
            })),
        );
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      }
    }, 320);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  return { query, setQuery, results, clear: () => setResults([]) };
}

/* ------------------------------------------------------------------------ */
/* Editor                                                                    */
/* ------------------------------------------------------------------------ */

function blankDraft(): MapModelDraft {
  return {
    name: "",
    modelUrl: "",
    longitude: STAY.longitude,
    latitude: STAY.latitude,
    altitude: 0,
    scale: 4,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    visible: true,
    status: "draft",
    category: "landmark",
    description: "",
  };
}

const STATUSES: ModelStatus[] = ["draft", "published", "hidden"];

interface ModelEditorProps {
  model: MapModel | null;
  onDone: () => void;
}

export function ModelEditor({ model, onDone }: ModelEditorProps) {
  const [draft, setDraft] = useState<MapModelDraft>(() => (model ? { ...model } : blankDraft()));
  const [recordId, setRecordId] = useState<string | null>(model?.id ?? null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [collapsed, setCollapsed] = useState(false);
  const touched = useRef(false);
  // Mirrors the draft so imperative handlers read the current position without
  // being rebuilt on every slider tick.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const search = useLocationSearch();
  const mapRef = useRef<MapboxMap | null>(null);

  const handleMap = useCallback((map: MapboxMap | null) => {
    mapRef.current = map;
  }, []);

  const frameModel = useCallback(() => {
    mapRef.current?.easeTo({
      center: [draftRef.current.longitude, draftRef.current.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 17),
      pitch: 55,
      duration: 700,
    });
  }, []);

  const patch = useCallback((changes: Partial<MapModelDraft>) => {
    touched.current = true;
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  /**
   * Coordinates from a gesture arrive at full float precision, which makes the
   * numeric fields unreadable. Six decimals is about 11 cm — far finer than
   * anyone can place a building by hand.
   */
  const place = useCallback(
    (longitude: number, latitude: number) =>
      patch({
        longitude: Number(longitude.toFixed(6)),
        latitude: Number(latitude.toFixed(6)),
      }),
    [patch],
  );

  /* Debounced persistence — only once a record exists and only after a real
     change, so opening the editor never writes to the registry. */
  useEffect(() => {
    if (!recordId || !touched.current) return;

    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void modelRepository
        .update(recordId, draft)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("idle"));
    }, 700);

    return () => window.clearTimeout(timer);
  }, [draft, recordId]);

  const create = async () => {
    const created = await modelRepository.create(draft);
    setRecordId(created.id);
    setSaveState("saved");
  };

  /** What the preview renders — the draft, exactly as the public map would. */
  const previewModel = useMemo<MapModel>(
    () => ({
      ...draft,
      id: recordId ?? "draft",
      visible: true,
      createdAt: model?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    [draft, model?.createdAt, recordId],
  );

  const canSave = draft.name.trim().length > 0 && draft.modelUrl.trim().length > 0;

  return (
    <div className="editor">
      <div className="editor__map">
        <MapProvider
          variant="embedded"
          camera={{
            center: [draft.longitude, draft.latitude],
            zoom: 17,
            pitch: 55,
            bearing: -20,
          }}
        >
          {draft.modelUrl ? <ModelLayer models={[previewModel]} selectedId={null} /> : null}
          <ModelPlacement onPlace={place} />
          <MapHandle onMap={handleMap} />
          <CameraSync longitude={draft.longitude} latitude={draft.latitude} />
          <MapMarker
            longitude={draft.longitude}
            latitude={draft.latitude}
            anchor="center"
            zIndex={50}
            draggable
            onDragEnd={({ longitude, latitude }) => place(longitude, latitude)}
          >
            <div className="editor-pin" title="Drag to move the model">
              <Box size={18} strokeWidth={2.2} aria-hidden="true" />
            </div>
          </MapMarker>
        </MapProvider>

        <p className="editor__hint">Drag the model, or click anywhere to move it</p>
      </div>

      <div className="editor__panel" data-collapsed={collapsed}>
        <div className="editor__panel-head">
          <button
            type="button"
            className="icon-btn"
            onClick={onDone}
            aria-label="Back to the model library"
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <span className="editor__panel-title">{model ? "Edit model" : "Add 3D model"}</span>
          {recordId ? (
            <span className="editor__save-state" data-state={saveState} role="status">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
            </span>
          ) : null}
          {/* Only meaningful once the panel is a bottom sheet on a phone. */}
          <button
            type="button"
            className="icon-btn editor__collapse"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand settings" : "Collapse settings"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="editor__form">
          <div className="field">
            <label className="field__label" htmlFor="model-name">
              Name
            </label>
            <input
              id="model-name"
              className="input"
              value={draft.name}
              placeholder="Ancient Castle"
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="model-category">
              Category
            </label>
            <select
              id="model-category"
              className="select"
              value={draft.category}
              onChange={(event) => patch({ category: event.target.value as PlaceCategory })}
            >
              {PLACE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="model-description">
              Description
            </label>
            <textarea
              id="model-description"
              className="textarea"
              value={draft.description}
              placeholder="What a guest sees when they tap it."
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <ModelUploader
            value={draft.modelUrl}
            onUploaded={(ref, filename) =>
              patch({ modelUrl: ref, name: draft.name || filename.replace(/\.[^.]+$/, "") })
            }
          />

          <div className="field">
            <label className="field__label" htmlFor="model-url">
              …or paste an asset URL
            </label>
            <input
              id="model-url"
              className="input"
              value={draft.modelUrl.startsWith("local:") ? "" : draft.modelUrl}
              placeholder="https://cdn.example.com/castle.glb"
              onChange={(event) => patch({ modelUrl: event.target.value })}
            />
          </div>

          <hr className="rule" style={{ margin: "18px 0 14px" }} />

          <div className="field">
            <label className="field__label" htmlFor="model-search">
              Find a location
            </label>
            <input
              id="model-search"
              className="input"
              value={search.query}
              placeholder="Narikala, Tbilisi"
              onChange={(event) => search.setQuery(event.target.value)}
            />
            {search.results.length > 0 ? (
              <ul className="pref-list" style={{ marginTop: 4 }}>
                {search.results.map((result) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      className="pref"
                      onClick={() => {
                        place(result.longitude, result.latitude);
                        search.setQuery("");
                        search.clear();
                      }}
                    >
                      <span className="step__body">
                        <span className="pref__label">{result.name}</span>
                        <span className="step__detail">{result.place}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="model-lat">
                Latitude
              </label>
              <input
                id="model-lat"
                className="input"
                type="number"
                step="0.00001"
                value={draft.latitude}
                onChange={(event) => patch({ latitude: Number(event.target.value) })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="model-lng">
                Longitude
              </label>
              <input
                id="model-lng"
                className="input"
                type="number"
                step="0.00001"
                value={draft.longitude}
                onChange={(event) => patch({ longitude: Number(event.target.value) })}
              />
            </div>
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ width: "100%", marginBottom: 14 }}
            onClick={frameModel}
          >
            <Crosshair size={13} strokeWidth={2.2} aria-hidden="true" />
            Centre the map on the model
          </button>

          <SliderField
            label="Altitude"
            value={draft.altitude}
            min={-20}
            max={200}
            step={1}
            suffix=" m"
            onChange={(altitude) => patch({ altitude })}
          />
          <SliderField
            label="Scale"
            value={draft.scale}
            min={0.1}
            max={80}
            step={0.1}
            suffix="×"
            onChange={(scale) => patch({ scale })}
          />
          <SliderField
            label="Rotation X"
            value={draft.rotationX}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(rotationX) => patch({ rotationX })}
          />
          <SliderField
            label="Rotation Y"
            value={draft.rotationY}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(rotationY) => patch({ rotationY })}
          />
          <SliderField
            label="Rotation Z"
            value={draft.rotationZ}
            min={-180}
            max={180}
            step={1}
            suffix="°"
            onChange={(rotationZ) => patch({ rotationZ })}
          />

          <hr className="rule" style={{ margin: "4px 0 14px" }} />

          <div className="field">
            <span className="field__label">Visibility</span>
            <div className="segmented" role="group" aria-label="Publication status">
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  data-active={draft.status === status}
                  onClick={() => patch({ status, visible: status === "published" })}
                >
                  {status[0].toUpperCase() + status.slice(1)}
                </button>
              ))}
            </div>
            <p className="field__hint">
              Only published models appear on the guest map. Hidden keeps the record but takes it
              down.
            </p>
          </div>
        </div>

        <div className="editor__foot">
          <button type="button" className="btn btn--ghost" onClick={onDone}>
            {recordId ? "Done" : "Cancel"}
          </button>
          {recordId ? null : (
            <button type="button" className="btn" disabled={!canSave} onClick={() => void create()}>
              Save model
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
