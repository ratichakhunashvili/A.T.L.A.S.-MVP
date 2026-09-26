/**
 * Choosing a place on the map.
 *
 * Used for hotels and attractions alike. Search for somewhere, click the map,
 * or drag the pin — the coordinates follow, and they are shown but never
 * *required*. Typing latitude and longitude by hand stays available for
 * someone who has exact figures, and is the advanced option rather than the
 * only one.
 *
 * Built on the same `MapProvider` and `MapMarker` the guest map uses, so the
 * basemap an admin places against is the basemap a guest will see it on.
 */

import { Crosshair, Loader2, MapPin, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MapMarker } from "../map/MapMarker";
import { MapProvider, useMap } from "../map/MapProvider";
import { useLocation } from "../state/location";
import "./location-picker.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export interface Coordinate {
  latitude: number;
  longitude: number;
}

interface LocationPickerProps {
  value: Coordinate;
  onChange: (value: Coordinate) => void;
  /** Rendered inside the pin. Defaults to a map pin. */
  label?: string;
  /** Other points to draw for context, e.g. the hotel while placing partners. */
  reference?: { latitude: number; longitude: number; name: string }[];
  height?: number;
}

export function LocationPicker(props: LocationPickerProps) {
  return (
    <div className="picker" style={{ height: props.height ?? 320 }}>
      <MapProvider
        variant="embedded"
        intro={false}
        camera={{
          center: [props.value.longitude, props.value.latitude],
          zoom: 16,
          pitch: 0,
          bearing: 0,
        }}
      >
        <PickerSurface {...props} />
      </MapProvider>
    </div>
  );
}

function PickerSurface({ value, onChange, label, reference = [] }: LocationPickerProps) {
  const map = useMap();
  const { position, request, status } = useLocation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const dragging = useRef(false);

  /* -- Clicking the map moves the pin ------------------------------------ */
  useEffect(() => {
    if (!map) return;
    const onClick = (event: mapboxgl.MapMouseEvent) => {
      if (dragging.current) return;
      onChange({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map, onChange]);

  /* -- Dragging the pin -------------------------------------------------- */
  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!map) return;
      event.stopPropagation();
      event.preventDefault();
      dragging.current = true;
      map.dragPan.disable();

      const move = (pointer: PointerEvent) => {
        const rect = map.getContainer().getBoundingClientRect();
        const point = { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top };
        const lngLat = map.unproject([point.x, point.y]);
        onChange({ latitude: lngLat.lat, longitude: lngLat.lng });
      };

      const end = () => {
        // Cleared on the next frame so the map's own click handler, which
        // fires after pointerup, does not treat the drop as a fresh click.
        requestAnimationFrame(() => {
          dragging.current = false;
        });
        map.dragPan.enable();
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
      };

      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
    },
    [map, onChange],
  );

  /* -- Search ------------------------------------------------------------ */
  async function search(event: React.FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term || !MAPBOX_TOKEN) return;

    setSearching(true);
    try {
      setResults(await geocode(term, value));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function choose(result: GeocodeResult) {
    onChange({ latitude: result.latitude, longitude: result.longitude });
    map?.flyTo({ center: [result.longitude, result.latitude], zoom: 17, duration: 900 });
    setResults([]);
    setQuery(result.name);
  }

  function centreHere() {
    map?.flyTo({ center: [value.longitude, value.latitude], zoom: 17, duration: 700 });
  }

  function useMyLocation() {
    if (!position) {
      request();
      return;
    }
    onChange({ latitude: position.latitude, longitude: position.longitude });
    map?.flyTo({ center: [position.longitude, position.latitude], zoom: 17, duration: 900 });
  }

  return (
    <>
      <form className="picker__search" onSubmit={(event) => void search(event)}>
        <Search size={14} strokeWidth={2.2} aria-hidden="true" />
        <input
          className="picker__input"
          value={query}
          placeholder="Search for a place or address"
          aria-label="Search for a place"
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className="picker__clear"
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            aria-label="Clear search"
          >
            <X size={13} aria-hidden="true" />
          </button>
        ) : null}
        <button type="submit" className="btn btn--sm" disabled={searching || !query.trim()}>
          {searching ? <Loader2 size={13} className="day__spin" aria-hidden="true" /> : "Search"}
        </button>
      </form>

      {results.length > 0 ? (
        <ul className="picker__results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude},${result.name}`}>
              <button type="button" className="picker__result" onClick={() => choose(result)}>
                <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                <span>
                  <strong>{result.name}</strong>
                  {result.context ? <em>{result.context}</em> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Context, not targets: these are why an admin can tell whether the pin
          landed on the right side of the street. */}
      {reference.map((point) => (
        <MapMarker
          key={`${point.name}-${point.latitude}`}
          longitude={point.longitude}
          latitude={point.latitude}
          interactive={false}
          zIndex={5}
        >
          <span className="picker__reference">
            <span className="picker__reference-dot" />
            <span className="picker__reference-label">{point.name}</span>
          </span>
        </MapMarker>
      ))}

      <MapMarker longitude={value.longitude} latitude={value.latitude} zIndex={40}>
        <button
          type="button"
          className="picker__pin"
          onPointerDown={startDrag}
          aria-label="Drag to move the location"
        >
          <MapPin size={17} strokeWidth={2.4} aria-hidden="true" />
          {label ? <span className="picker__pin-label">{label}</span> : null}
        </button>
      </MapMarker>

      <div className="picker__tools">
        <button type="button" className="picker__tool" onClick={centreHere}>
          <Crosshair size={13} strokeWidth={2.2} aria-hidden="true" />
          Centre on pin
        </button>
        <button type="button" className="picker__tool" onClick={useMyLocation}>
          <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
          {status === "locating" ? "Finding…" : "My location"}
        </button>
      </div>

      <p className="picker__readout">
        {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Geocoding                                                                 */
/* ------------------------------------------------------------------------ */

interface GeocodeResult {
  name: string;
  context?: string;
  latitude: number;
  longitude: number;
}

/**
 * Mapbox forward geocoding, biased toward where the map already is.
 *
 * The proximity bias matters more than it looks: an admin adding "Botanical
 * Garden" to a Tbilisi hotel wants the one down the road, not the one in
 * Singapore.
 */
async function geocode(query: string, near: Coordinate): Promise<GeocodeResult[]> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("proximity", `${near.longitude},${near.latitude}`);
  url.searchParams.set("access_token", MAPBOX_TOKEN ?? "");

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return [];

  const body = (await response.json()) as {
    features?: {
      properties?: {
        name?: string;
        place_formatted?: string;
        coordinates?: { latitude?: number; longitude?: number };
      };
    }[];
  };

  const out: GeocodeResult[] = [];
  for (const feature of body.features ?? []) {
    const properties = feature.properties ?? {};
    const coordinates = properties.coordinates ?? {};
    if (typeof coordinates.latitude !== "number" || typeof coordinates.longitude !== "number") {
      continue;
    }
    out.push({
      name: properties.name ?? query,
      context: properties.place_formatted,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });
  }
  return out;
}
