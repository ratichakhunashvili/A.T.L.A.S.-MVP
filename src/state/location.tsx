/**
 * The guest's real position — the single source of truth.
 *
 * Geolocation is a permission *and* an estimate, not a fact. Two things follow
 * from that, and both were missing before:
 *
 *  1. Every state the browser can put us in is represented, and the UI never
 *     implies we know where someone is standing when we do not. Denial is a
 *     normal outcome: the map keeps working and the ask stays available.
 *
 *  2. A fix carries an accuracy radius, and that radius decides what the fix
 *     is allowed to be used for. A phone with GPS reports 5–30 m. A desktop on
 *     Ethernet has no GPS and often no usable Wi-Fi scan, so the browser falls
 *     back to an IP lookup and reports thousands of metres — a point that is
 *     the internet provider, not the person. Drawing that as "you are here",
 *     flying the camera to it at street zoom, and measuring walking distances
 *     from it is how a map ends up confidently wrong.
 *
 * Nothing else in the app keeps its own copy of the position. The marker, the
 * accuracy ring, the camera, the recentre control and the nearby ranking all
 * read the `fix` below.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  classifyAccuracy,
  distanceMetres,
  isPlausibleFix,
  type Coordinates,
  type Fix,
  type FixQuality,
} from "../data/geo";

export type LocationStatus =
  /** Never asked. The browser would show its prompt if we did. */
  | "idle"
  /** A request is in flight — either our prompt or the fix itself. */
  | "locating"
  /** We have a position we are willing to stand behind. */
  | "granted"
  /** The guest, or the browser, said no. */
  | "denied"
  /** No geolocation API, or an insecure context that forbids it. */
  | "unavailable"
  /** The device could not produce a fix: no signal, or it timed out. */
  | "error";

export type PermissionState = "granted" | "denied" | "prompt" | "unknown";

/** Why the last attempt failed, when one did. */
export type LocationErrorCode = "permission" | "timeout" | "unavailable" | "insecure";

interface LocationContextValue {
  status: LocationStatus;
  /** The whole fix: coordinates, accuracy, timestamp, source. */
  fix: Fix | null;
  /** Coordinates only, for consumers that need nothing else. */
  position: Coordinates | null;
  accuracy: number | null;
  /** How much the fix can be trusted. `null` when there is no fix. */
  quality: FixQuality | null;
  /**
   * The position, but only when it is good enough to measure from. A coarse
   * fix is still reported — it is just not allowed to drive distances.
   */
  usablePosition: Coordinates | null;
  permission: PermissionState;
  message: string | null;
  /** True when asking could still succeed — drives whether we offer it. */
  canAsk: boolean;
  /** The guest chose "Not now" in this browser. */
  dismissed: boolean;
  /** Counts accepted fixes, so the camera can follow the first one only. */
  fixCount: number;
  /** Why the last attempt failed, when one did. */
  errorCode: LocationErrorCode | null;
  /** Geolocation is refused outright outside a secure context. */
  secureContext: boolean;
  /** Short log of what was tried, for diagnostics. */
  attempts: string[];
  request: () => void;
  dismiss: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

const DISMISS_KEY = "hospitality-map.location.dismissed";

/**
 * Always ask the device for a NEW reading. `maximumAge: 0` everywhere — a
 * cached fix may predate the guest walking anywhere.
 *
 * Two rungs, because a high-accuracy request is the one most likely to time
 * out on a desktop: it waits on a GPS or Wi-Fi scan that may never arrive. If
 * it does time out, the same device provider is asked a softer question rather
 * than the app declaring it has no location. Both rungs are
 * `navigator.geolocation` — neither is an IP lookup.
 */
const GEO_HIGH: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 0,
};

const GEO_STANDARD: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 20_000,
  maximumAge: 0,
};

/** Below this, a new fix is not worth a re-render. */
const MIN_MOVE_M = 5;

/** Past this gap, a newer reading wins outright however accurate the old one was. */
const SIGNIFICANTLY_NEWER_MS = 20_000;

/** A newer fix may be this much less accurate and still be preferred. */
const TOLERATED_ACCURACY_LOSS_M = 120;

const MESSAGES: Partial<Record<LocationStatus, string>> = {
  denied:
    "Location is blocked for this site. Turn it back on in your browser's site settings, then try again.",
  unavailable: "This browser cannot share a location here.",
  error: "Could not get a fix. Move somewhere with a clearer view of the sky and try again.",
};

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Dev-only tracing, so the whole chain can be checked against the browser. */
function trace(label: string, detail: unknown): void {
  if (import.meta.env.DEV) console.info(`[location] ${label}`, detail);
}

export function LocationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LocationStatus>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [fixCount, setFixCount] = useState(0);
  const [dismissed, setDismissed] = useState(readDismissed);
  const [errorCode, setErrorCode] = useState<LocationErrorCode | null>(null);
  /** A short log of what was tried, for the diagnostic panel. */
  const [attempts, setAttempts] = useState<string[]>([]);

  /** The one watcher. Null means "none running". */
  const watchRef = useRef<number | null>(null);
  /** Mirror of the current fix, so the accept logic never needs a re-render. */
  const fixRef = useRef<Fix | null>(null);

  const supported =
    typeof navigator !== "undefined" &&
    "geolocation" in navigator &&
    (typeof window === "undefined" || window.isSecureContext);

  /**
   * Decides whether an incoming reading replaces the one we have.
   *
   * Rejects the impossible outright, then refuses to let a markedly worse fix
   * overwrite a good recent one — which is what happens when a GPS lock drops
   * and the browser falls back to Wi-Fi or IP mid-session.
   */
  const acceptFix = useCallback((reading: GeolocationPosition) => {
    const candidate: Fix = {
      latitude: reading.coords.latitude,
      longitude: reading.coords.longitude,
      accuracy: reading.coords.accuracy,
      timestamp: reading.timestamp,
      source: "device",
    };

    if (!isPlausibleFix(candidate)) {
      trace("rejected implausible reading", candidate);
      setStatus((current) => (current === "granted" ? current : "error"));
      return;
    }

    const previous = fixRef.current;
    if (previous) {
      /*
       * Which reading is better?
       *
       * Weighing accuracy alone is a trap: it pins the marker to an old
       * position while the guest walks away from it. Time has to count too —
       * a clearly newer reading wins even if it is a little looser, and only
       * a *much* looser one is turned away.
       */
      const newerBy = candidate.timestamp - previous.timestamp;
      const accuracyLoss = candidate.accuracy - previous.accuracy;

      const decisivelyNewer = newerBy > SIGNIFICANTLY_NEWER_MS;
      const moreAccurate = accuracyLoss < 0;
      const newerAndCloseEnough = newerBy > 0 && accuracyLoss <= TOLERATED_ACCURACY_LOSS_M;

      if (!decisivelyNewer && !moreAccurate && !newerAndCloseEnough) {
        trace("kept the better existing fix", {
          keptAccuracy: previous.accuracy,
          rejectedAccuracy: candidate.accuracy,
          newerByMs: newerBy,
        });
        return;
      }

      // Standing still should not churn React or the map.
      const moved = distanceMetres(previous, candidate);
      const accuracyChanged = Math.abs(accuracyLoss) > 1;
      if (moved < MIN_MOVE_M && !accuracyChanged) return;
    }

    trace("accepted", {
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      accuracy: `${Math.round(candidate.accuracy)} m`,
      quality: classifyAccuracy(candidate.accuracy),
      age: `${Date.now() - candidate.timestamp} ms`,
    });

    fixRef.current = candidate;
    setFix(candidate);
    setStatus("granted");
    setFixCount((count) => count + 1);
  }, []);

  const onFailure = useCallback((failure: GeolocationPositionError, attempt: string) => {
    const code: LocationErrorCode =
      failure.code === failure.PERMISSION_DENIED
        ? "permission"
        : failure.code === failure.TIMEOUT
          ? "timeout"
          : "unavailable";

    setErrorCode(code);
    setAttempts((log) => [...log.slice(-4), `${attempt}: ${code}`]);

    if (code === "permission") {
      setPermission("denied");
      setStatus("denied");
    } else {
      // Timed out or no signal. If we already have a fix, keep showing it.
      setStatus((current) => (current === "granted" ? current : "error"));
    }
    trace("failure", { attempt, code, message: failure.message });
  }, []);

  /**
   * Exactly one watcher, ever.
   *
   * The id is cleared *and* the ref reset together — clearing without
   * resetting leaves the ref looking occupied, and then no watcher is ever
   * started again and the position silently freezes at the first fix.
   */
  const startWatching = useCallback(
    (options: PositionOptions) => {
      if (!supported || watchRef.current !== null) return;
      watchRef.current = navigator.geolocation.watchPosition(
        acceptFix,
        (failure) => onFailure(failure, "watch"),
        options,
      );
      trace("watch started", { id: watchRef.current, options });
    },
    [acceptFix, onFailure, supported],
  );

  const stopWatching = useCallback(() => {
    if (watchRef.current === null) return;
    navigator.geolocation.clearWatch(watchRef.current);
    trace("watch cleared", { id: watchRef.current });
    watchRef.current = null;
  }, []);

  /**
   * Ask the device, and if the precise question times out, ask the softer one.
   *
   * A high-accuracy request waits on a GPS or Wi-Fi scan that a desktop may
   * never produce, and a timeout there is not the same as "this device has no
   * location". Both rungs are the browser's own provider; at no point does
   * this reach for an IP service.
   */
  const locate = useCallback(() => {
    setStatus((current) => (current === "granted" ? current : "locating"));
    setErrorCode(null);

    const succeed = (reading: GeolocationPosition, options: PositionOptions, rung: string) => {
      setAttempts((log) => [...log.slice(-4), `${rung}: ±${Math.round(reading.coords.accuracy)} m`]);
      acceptFix(reading);
      // Keep watching in whichever mode actually answered.
      startWatching(options);
    };

    navigator.geolocation.getCurrentPosition(
      (reading) => succeed(reading, GEO_HIGH, "high accuracy"),
      (failure) => {
        if (failure.code === failure.PERMISSION_DENIED) {
          onFailure(failure, "high accuracy");
          return;
        }

        trace("high accuracy failed, trying standard", { code: failure.code });
        setAttempts((log) => [...log.slice(-4), "high accuracy: timeout, retrying"]);

        navigator.geolocation.getCurrentPosition(
          (reading) => succeed(reading, GEO_STANDARD, "standard accuracy"),
          (second) => onFailure(second, "standard accuracy"),
          GEO_STANDARD,
        );
      },
      GEO_HIGH,
    );
  }, [acceptFix, onFailure, startWatching]);

  const request = useCallback(() => {
    if (!supported) {
      setStatus("unavailable");
      setErrorCode(
        typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "unavailable",
      );
      return;
    }
    locate();
  }, [locate, supported]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode — the ask simply returns next session */
    }
  }, []);

  /* -- What does the browser already think? ------------------------------ */
  useEffect(() => {
    if (!supported) {
      setStatus("unavailable");
      setPermission("denied");
      setErrorCode(
        typeof window !== "undefined" && !window.isSecureContext ? "insecure" : "unavailable",
      );
      return;
    }
    if (!navigator.permissions?.query) {
      setPermission("unknown");
      return;
    }

    let cancelled = false;
    let handle: PermissionStatus | null = null;

    const sync = () => {
      if (cancelled || !handle) return;
      setPermission(handle.state as PermissionState);

      if (handle.state === "granted") {
        // Already allowed on a previous visit: no second prompt, just locate.
        locate();
      } else if (handle.state === "denied") {
        setStatus("denied");
        stopWatching();
      }
    };

    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        handle = result;
        result.addEventListener("change", sync);
        sync();
      })
      .catch(() => {
        /* Safari and friends: fall back to asking when the guest asks. */
        setPermission("unknown");
      });

    return () => {
      cancelled = true;
      handle?.removeEventListener("change", sync);
    };
  }, [locate, stopWatching, supported]);

  /* -- One teardown, and it resets the ref ------------------------------- */
  useEffect(() => stopWatching, [stopWatching]);

  const value = useMemo<LocationContextValue>(() => {
    const quality = fix ? classifyAccuracy(fix.accuracy) : null;
    const position = fix ? { longitude: fix.longitude, latitude: fix.latitude } : null;

    return {
      status,
      fix,
      position,
      accuracy: fix?.accuracy ?? null,
      quality,
      // A coarse fix is shown and explained, but never measured from.
      usablePosition: quality && quality !== "coarse" ? position : null,
      permission,
      message: MESSAGES[status] ?? null,
      canAsk: supported && status !== "denied" && status !== "unavailable",
      dismissed,
      fixCount,
      errorCode,
      secureContext: typeof window === "undefined" ? true : window.isSecureContext,
      attempts,
      request,
      dismiss,
    };
  }, [status, fix, permission, supported, dismissed, fixCount, errorCode, attempts, request, dismiss]);

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const value = useContext(LocationContext);
  if (!value) throw new Error("useLocation must be used inside <LocationProvider>");
  return value;
}
