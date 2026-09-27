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

import {
  ArrowLeft,
  Box,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Crosshair,
  Eye,
  EyeOff,
  LocateFixed,
  MapPin,
} from "lucide-react";
import type { Map as MapboxMap, MapMouseEvent, MapTouchEvent } from "mapbox-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelUploader } from "./ModelUploader";
import { MAPBOX_TOKEN } from "../map/config";
import { MapMarker } from "../map/MapMarker";
import { MapProvider, useMap } from "../map/MapProvider";
import { AccuracyRing } from "../map/AccuracyRing";
import { CATEGORY_FAMILY } from "../ui/icons";
import { useLocation } from "../state/location";
import { PLACES } from "../data/seed";
import { BuildingMask } from "../map/models/BuildingMask";
import { MODEL_LAYER_ID, ModelLayer } from "../map/models/ModelLayer";
import { useModelAssets } from "../map/models/useModelAssets";
import { distanceMetres } from "../data/geo";
import { modelRepository } from "../data/modelRepository";
import { useModels } from "../data/useModels";
import { STAY } from "../data/seed";
import {
  CATEGORY_LABEL,
  PLACE_CATEGORIES,
  type MapModel,
  type MapModelDraft,
  type ModelStatus,
  type PlaceCategory,
} from "../data/types";

/**
 * How close two models have to be before they are treated as overlapping.
 *
 * Deliberately generous: most placed assets are buildings, so anything inside
 * about a dozen metres is going to intersect visibly even if the coordinates
 * are technically distinct.
 */
const COLLISION_M = 12;

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

/**
 * The administrator's own position, inside the editor.
 *
 * Placing a model is often done standing in front of the thing being modelled,
 * so seeing yourself on the editor map — and what is around you — is the
 * difference between hunting for a rooftop and recognising it.
 */
function AdminLocation() {
  const { position, quality, fix } = useLocation();
  if (!position) return null;

  return (
    <>
      <AccuracyRing fix={fix} quality={quality} />
      <MapMarker
        longitude={position.longitude}
        latitude={position.latitude}
        anchor="center"
        zIndex={45}
      >
        <div
          className="user-dot"
          data-quality={quality ?? "precise"}
          role="img"
          aria-label="Your location"
        />
      </MapMarker>
    </>
  );
}

/**
 * Curated places and the other models, drawn quietly.
 *
 * Context, not content: an administrator needs to see what is already nearby
 * so a new model lands beside the right doorway and not on top of an existing
 * one. Deliberately muted and non-interactive so it never competes with the
 * thing being placed.
 */
function ReferenceMarkers({ others }: { others: MapModel[] }) {
  return (
    <>
      {PLACES.map((place) => (
        <MapMarker
          key={`place-${place.id}`}
          longitude={place.longitude}
          latitude={place.latitude}
          anchor="center"
          zIndex={2}
          interactive={false}
        >
          <div className="editor-ref" data-family={CATEGORY_FAMILY[place.category]} aria-hidden="true">
            <span className="editor-ref__dot" />
            <span className="editor-ref__label">{place.name}</span>
          </div>
        </MapMarker>
      ))}

      {others.map((other) => (
        <MapMarker
          key={`model-${other.id}`}
          longitude={other.longitude}
          latitude={other.latitude}
          anchor="center"
          zIndex={3}
          interactive={false}
        >
          <div className="editor-ref editor-ref--model" aria-hidden="true">
            <span className="editor-ref__dot" />
            <span className="editor-ref__label">{other.name}</span>
          </div>
        </MapMarker>
      ))}
    </>
  );
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
  /** True while the next map tap adds a building to the mask. */
  const [pickingBuilding, setPickingBuilding] = useState(false);
  /*
   * Three states, not two. `undefined` means "work it out" — the renderer
   * masks whatever building the model is standing on, which is what is wanted
   * almost every time. `[]` is an explicit "leave the building alone". A
   * populated array is exactly those footprints.
   */
  const maskAutomatic = draft.hiddenBuildings === undefined;
  const maskOff = draft.hiddenBuildings?.length === 0;
  const masked = draft.hiddenBuildings ?? [];
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

  const { position: myPosition, status: locationStatus, request: requestLocation } = useLocation();
  const { models: allModels } = useModels("all");

  /** Everything except the model being edited, for context on the map. */
  const otherModels = useMemo(
    () => allModels.filter((candidate: MapModel) => candidate.id !== recordId),
    [allModels, recordId],
  );

  /**
   * Drop the model wherever the map is currently aimed.
   *
   * Panning a map under a fixed crosshair is far easier to do accurately than
   * tapping a precise point — especially on a phone, where a fingertip covers
   * the very thing being aimed at.
   */
  const placeAtCentre = useCallback(() => {
    const centre = mapRef.current?.getCenter();
    if (centre) place(centre.lng, centre.lat);
  }, [place]);

  /** Take the camera to the administrator, asking for permission if needed. */
  const goToMyLocation = useCallback(() => {
    if (!myPosition) {
      requestLocation();
      return;
    }
    mapRef.current?.flyTo({
      center: [myPosition.longitude, myPosition.latitude],
      zoom: Math.max(mapRef.current.getZoom(), 17),
      duration: 1200,
      essential: true,
    });
  }, [myPosition, requestLocation]);

  /** Put the model exactly where the administrator is standing. */
  const placeAtMyLocation = useCallback(() => {
    if (!myPosition) {
      requestLocation();
      return;
    }
    place(myPosition.longitude, myPosition.latitude);
  }, [myPosition, place, requestLocation]);

  /**
   * Accepts a pasted "41.6949, 44.8051" — the form coordinates arrive from a
   * spreadsheet or a maps app far more often than they are typed by hand.
   */
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const applyPasted = useCallback(() => {
    const match = pasted.trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) {
      setPasteError("Expected two numbers, latitude first — for example 41.6949, 44.8051");
      return;
    }
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      setPasteError("Those are outside the valid range for latitude and longitude.");
      return;
    }
    setPasteError(null);
    setPasted("");
    place(longitude, latitude);
  }, [pasted, place]);


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

  /*
   * The draft plus its live neighbours, as real geometry.
   *
   * The preview used to show only the model being placed, so an admin
   * dropping a second model onto an occupied footprint got no warning at all
   * — every other model was a muted 2D dot. Drawing the neighbours means the
   * overlap is visible at the moment it is created. The draft stays selected,
   * so `ModelLayer`'s existing selection tint is what tells them apart.
   */
  const previewModels = useMemo(
    () => [previewModel, ...otherModels.filter((other) => other.visible && other.status === "published")],
    [previewModel, otherModels],
  );
  const previewAssets = useModelAssets(previewModels);

  /** Only what actually loaded — a mask under a pending asset is a hole. */
  const loadedPreviewModels = useMemo(
    () => previewModels.filter((m) => previewAssets.get(m.modelUrl)?.status === "ready"),
    [previewModels, previewAssets],
  );

  /**
   * Anything close enough that the two will visibly intersect. Measured from
   * stored coordinates, never from where things happen to land on screen.
   */
  const collisions = useMemo(
    () => otherModels.filter((other) => distanceMetres(draft, other) < COLLISION_M),
    [otherModels, draft],
  );

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
          {draft.modelUrl ? (
            <ModelLayer
              models={previewModels}
              assets={previewAssets}
              selectedId={previewModel.id}
            />
          ) : null}
          {/* So "Hide building underneath" shows its effect right where the
             admin is working, instead of only on the published guest map. */}
          <BuildingMask models={loadedPreviewModels} />
          <ReferenceMarkers others={otherModels} />
          <AdminLocation />
          <ModelPlacement
            onPlace={(longitude, latitude) => {
              if (!pickingBuilding) {
                place(longitude, latitude);
                return;
              }
              // Tapping while picking adds a footprint to the mask instead of
              // moving the model — which is what the admin just asked for.
              patch({ hiddenBuildings: [...masked, { longitude, latitude }] });
              setPickingBuilding(false);
            }}
          />
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

        {/* Fixed to the centre of the map: pan to aim, then drop. */}
        <div className="editor__crosshair" aria-hidden="true">
          <span className="editor__crosshair-ring" />
        </div>

        <div className="editor__tools">
          <button type="button" className="btn btn--sm" onClick={placeAtCentre}>
            <Crosshair size={13} strokeWidth={2.4} aria-hidden="true" />
            Place here
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost editor__tool"
            data-active={Boolean(myPosition)}
            onClick={goToMyLocation}
            title={myPosition ? "Go to your location" : "Show your location"}
          >
            <LocateFixed size={13} strokeWidth={2.4} aria-hidden="true" />
            {locationStatus === "locating" ? "Locating…" : "My location"}
          </button>
        </div>

        <p className="editor__hint">
          Pan the map and press <strong>Place here</strong>, or drag the model itself
        </p>
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

          <div className="field">
            <span className="field__label">Paste coordinates</span>
            <div className="field__control">
              <input
                className="input"
                value={pasted}
                placeholder="41.6949, 44.8051"
                aria-invalid={Boolean(pasteError)}
                onChange={(event) => {
                  setPasted(event.target.value);
                  setPasteError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyPasted();
                  }
                }}
              />
              <button
                type="button"
                className="field__reveal"
                aria-label="Apply pasted coordinates"
                onClick={applyPasted}
              >
                <ClipboardPaste size={15} aria-hidden="true" />
              </button>
            </div>
            {pasteError ? (
              <p className="field__error" role="alert">
                {pasteError}
              </p>
            ) : (
              <p className="field__hint">Latitude first, as most maps copy it.</p>
            )}
          </div>

          <div className="editor__place-actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={frameModel}>
              <Crosshair size={13} strokeWidth={2.2} aria-hidden="true" />
              Centre on model
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={placeAtMyLocation}>
              <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
              Put it where I am
            </button>
          </div>

          {/*
            The basemap building underneath.

            Automatic matching is done at render time from the stored point,
            so the usual case is one tap: "the building under this model".
            When the model sits between footprints, or covers two, the admin
            adds them by tapping the map — which is why this stores a list of
            points rather than a single flag.
          */}
          <div className="field">
            <span className="field__label">Basemap building</span>

            <div className="editor__place-actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-pressed={!maskOff}
                onClick={() =>
                  // Back to automatic rather than to an explicit point: the
                  // model may be moved after this, and a stored coordinate
                  // would then mask whatever it was left pointing at.
                  patch({ hiddenBuildings: maskOff ? undefined : [] })
                }
              >
                {maskOff ? (
                  <EyeOff size={13} strokeWidth={2.2} aria-hidden="true" />
                ) : (
                  <Eye size={13} strokeWidth={2.2} aria-hidden="true" />
                )}
                {maskOff ? "Hide building underneath" : "Show building again"}
              </button>

              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-active={pickingBuilding}
                onClick={() => setPickingBuilding((current) => !current)}
              >
                <Crosshair size={13} strokeWidth={2.2} aria-hidden="true" />
                {pickingBuilding ? "Tap the map…" : "Pick another"}
              </button>
            </div>

            <p className="field__hint">
              {maskAutomatic
                ? "The Mapbox building under this model is hidden automatically. Pick another to add more, or show it again to leave the city untouched."
                : maskOff
                  ? "The Mapbox building under this model is left visible, so the two may overlap."
                  : `${masked.length} ${masked.length === 1 ? "building" : "buildings"} hidden under this model. Only these — the rest of the city stays.`}
            </p>
          </div>

          {collisions.length > 0 ? (
            <p className="field__error">
              {collisions.length === 1
                ? `${collisions[0].name} is ${Math.round(distanceMetres(draft, collisions[0]))} m away — they will overlap.`
                : `${collisions.length} other models are within ${COLLISION_M} m — they will overlap.`}
            </p>
          ) : null}

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
