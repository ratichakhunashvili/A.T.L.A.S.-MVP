/**
 * Owns the single Mapbox instance for the app's lifetime, and art-directs it.
 *
 * The map is created once, in an effect with no dependencies, and handed to
 * the tree through context. React never re-renders it — layers and markers
 * subscribe to the instance and mutate it imperatively, which is the only way
 * to keep a WebGL map smooth on a phone.
 */

import mapboxgl from "mapbox-gl";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  BASEMAP_CONFIG,
  CAMERA_LIMITS,
  ENABLE_3D_FACADES,
  INTRO,
  LABEL_ZOOM_RULES,
  MAPBOX_STYLE,
  MAPBOX_TOKEN,
  NIGHT_FOG,
  NIGHT_LIGHTS,
  TERRAIN,
  shouldAntialias,
} from "./config";
import { INITIAL_CAMERA } from "../data/seed";

interface MapContextValue {
  map: mapboxgl.Map | null;
  /** True once the style has loaded and layers may be added. */
  ready: boolean;
  error: string | null;
}

const MapContext = createContext<MapContextValue>({ map: null, ready: false, error: null });

/** Returns the map only when it is safe to add sources and layers to it. */
export function useMap(): mapboxgl.Map | null {
  const { map, ready } = useContext(MapContext);
  return ready ? map : null;
}

export function useMapStatus(): MapContextValue {
  return useContext(MapContext);
}

/**
 * Whether the camera is closer in than `threshold`.
 *
 * Used to thin the map out in the wide view: a dozen markers that read as
 * curation at street zoom become a pile of overlapping discs over the whole
 * city. React bails out of identical state, so this re-renders only on the
 * two frames where the threshold is actually crossed.
 */
export function useMapZoomAbove(threshold: number): boolean {
  const { map, ready } = useContext(MapContext);
  const [above, setAbove] = useState(true);

  useEffect(() => {
    if (!map || !ready) return;
    const update = () => setAbove(map.getZoom() >= threshold);
    update();
    map.on("zoom", update);
    return () => {
      map.off("zoom", update);
    };
  }, [map, ready, threshold]);

  return above;
}

export interface MapCamera {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
}

interface MapProviderProps {
  children: ReactNode;
  /** `embedded` fills its positioned parent instead of the viewport. */
  variant?: "fullscreen" | "embedded";
  /** Opening camera. Read once, on creation. */
  camera?: MapCamera;
  /** The arrival move. Off in the admin editor, where it would just be in the way. */
  intro?: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MapProvider({
  children,
  variant = "fullscreen",
  camera,
  intro = variant === "fullscreen",
}: MapProviderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  // Captured once: later changes are the camera API's job, not a remount's.
  const initialCamera = useRef(camera ?? INITIAL_CAMERA);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(MAPBOX_TOKEN ? null : "missing-token");

  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const target = initialCamera.current;
    const withIntro = intro && !prefersReducedMotion();

    // Starting the map *at* the pulled-back camera and easing in from there
    // avoids the jump a post-load `jumpTo` would produce.
    const start: MapCamera = withIntro
      ? {
          center: target.center,
          zoom: target.zoom + INTRO.zoomOffset,
          pitch: Math.max(target.pitch + INTRO.pitchOffset, 0),
          bearing: target.bearing + INTRO.bearingOffset,
        }
      : target;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAPBOX_STYLE,
      center: start.center,
      zoom: start.zoom,
      pitch: start.pitch,
      bearing: start.bearing,
      minZoom: CAMERA_LIMITS.minZoom,
      maxZoom: CAMERA_LIMITS.maxZoom,
      maxPitch: CAMERA_LIMITS.maxPitch,
      antialias: shouldAntialias(),
      // The default attribution is replaced below with a compact one, which
      // keeps the required credit without a bar across the bottom of the map.
      attributionControl: false,
      logoPosition: "bottom-left",
      dragRotate: true,
      pitchWithRotate: true,
      touchPitch: true,
      fadeDuration: 180,
    });

    mapRef.current = map;
    // Bottom-left, beside the wordmark — the right corner belongs to the
    // product's own map controls.
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-left");

    // A handle for the console and for end-to-end tests that need to drive the
    // camera. Development only — it never reaches a production bundle.
    if (import.meta.env.DEV) {
      (window as Window & { __map?: mapboxgl.Map }).__map = map;
    }

    /** Applies one config property, tolerating styles that lack it. */
    const setConfig = (property: string, value: unknown) => {
      try {
        map.setConfigProperty("basemap", property, value);
      } catch {
        /* property not present in this style */
      }
    };

    /* -- Zoom-driven label hierarchy ------------------------------------- */
    let labelBucket = -1;
    const applyLabelRules = () => {
      const zoom = map.getZoom();
      const next = LABEL_ZOOM_RULES.findIndex((rule) => zoom < rule.maxZoom);
      const index = next === -1 ? LABEL_ZOOM_RULES.length - 1 : next;
      if (index === labelBucket) return;
      labelBucket = index;

      const rule = LABEL_ZOOM_RULES[index];
      setConfig("showRoadLabels", rule.showRoadLabels);
      setConfig("densityPointOfInterestLabels", rule.densityPointOfInterestLabels);
    };

    const applyStyleConfiguration = () => {
      // Standard exposes its configuration through the `basemap` import. Older
      // or custom styles do not, so each property is applied defensively —
      // a style without these knobs should still render, just unconfigured.
      for (const [property, value] of Object.entries(BASEMAP_CONFIG)) setConfig(property, value);

      setConfig("show3dFacades", ENABLE_3D_FACADES);

      labelBucket = -1;
      applyLabelRules();

      try {
        // Standard already declares `mapbox-dem`; this only adds one if the
        // style is something else. The exaggeration curve is ours either way.
        if (!map.getSource(TERRAIN.sourceId)) map.addSource(TERRAIN.sourceId, TERRAIN.source);
        map.setTerrain({
          source: TERRAIN.sourceId,
          exaggeration: TERRAIN.exaggeration as unknown as number,
        });
      } catch {
        /* terrain is a nicety, not a requirement */
      }

      try {
        map.setFog(NIGHT_FOG);
      } catch {
        /* style without atmosphere support */
      }

      try {
        map.setLights(NIGHT_LIGHTS as Parameters<mapboxgl.Map["setLights"]>[0]);
      } catch {
        /* fall back to the preset's own lighting */
      }

      setReady(true);
    };

    map.on("style.load", applyStyleConfiguration);
    map.on("zoom", applyLabelRules);

    /* -- The arrival move ------------------------------------------------- */
    if (withIntro) {
      const cancelIntro = () => map.stop();
      // Any intent to drive the map wins over the animation immediately.
      const events = ["mousedown", "touchstart", "wheel", "dragstart"] as const;
      for (const event of events) map.once(event, cancelIntro);

      map.once("style.load", () => {
        map.easeTo({
          center: target.center,
          zoom: target.zoom,
          pitch: target.pitch,
          bearing: target.bearing,
          duration: INTRO.duration,
          easing: (t) => 1 - Math.pow(1 - t, 3),
          essential: false,
        });
      });
    }

    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      // A bad token is the one failure worth surfacing to the person looking
      // at the screen; everything else is a tile hiccup the map recovers from.
      if (/401|Unauthorized|access token/i.test(message)) {
        setError("invalid-token");
      } else if (message) {
        console.warn("[map]", message);
      }
    });

    return () => {
      try {
        map.remove();
      } catch {
        // Tearing down mid-style-load throws in some builds; nothing to do.
      }
      mapRef.current = null;
      if (import.meta.env.DEV) delete (window as Window & { __map?: mapboxgl.Map }).__map;
      setReady(false);
    };
  }, [intro]);

  /**
   * iOS changes the visual viewport when the URL bar collapses or the keyboard
   * opens, and the canvas has to be told. ResizeObserver covers layout
   * changes; visualViewport covers the browser chrome sliding away.
   */
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => map.resize());
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.visualViewport?.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [ready]);

  const value = useMemo<MapContextValue>(
    () => ({ map: mapRef.current, ready, error }),
    [ready, error],
  );

  return (
    <MapContext.Provider value={value}>
      <div className={variant === "embedded" ? "map-root map-root--embedded" : "map-root"}>
        <div className="map-canvas" ref={containerRef} />
        {/* Non-interactive grade: a vignette for UI contrast plus the faintest
            green cast, so the basemap sits in the same world as the chrome. */}
        <div className="map-grade" aria-hidden="true" />
      </div>
      {/* The UI mounts immediately and stays mounted. Layers and markers ask
          for the map through `useMap`, which hands back nothing until the
          style has loaded — so nothing has to wait on the map to render. */}
      {children}
    </MapContext.Provider>
  );
}
