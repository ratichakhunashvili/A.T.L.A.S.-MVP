/**
 * Location debug readout — development only.
 *
 * Exists to answer one question without guesswork: at which step does a
 * coordinate go wrong? It shows what the browser handed us, what the map is
 * centred on, and what the nearby ranking measured from, side by side, so a
 * swap, a stale fix or a bad fallback is visible rather than inferred.
 *
 * `import.meta.env.DEV` is a compile-time constant, so the whole component and
 * its import are dropped from a production build — it cannot ship by accident.
 */

import { useEffect, useState } from "react";

import { useMap } from "../../map/MapProvider";
import { useLocation } from "../../state/location";
import { ACCURACY_THRESHOLDS, formatDistance, type Coordinates } from "../../data/geo";

interface LocationDebugProps {
  /** What the nearby ranking is actually measuring from. */
  rankingOrigin: Coordinates | null;
  /** Name and distance of whatever came out nearest. */
  nearest: { name: string; metres: number } | null;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "warn" | "bad" }) {
  return (
    <div className="locdbg__row">
      <span className="locdbg__label">{label}</span>
      <span className="locdbg__value" data-tone={tone}>
        {value}
      </span>
    </div>
  );
}

export function LocationDebug({ rankingOrigin, nearest }: LocationDebugProps) {
  const map = useMap();
  const { fix, status, permission, quality, accuracy, fixCount, errorCode, secureContext, attempts } =
    useLocation();
  const [open, setOpen] = useState(false);
  const [centre, setCentre] = useState<{ lng: number; lat: number } | null>(null);

  // Track the camera so the map's coordinates can be compared with the fix.
  useEffect(() => {
    if (!map || !open) return;
    const update = () => {
      const c = map.getCenter();
      setCentre({ lng: c.lng, lat: c.lat });
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map, open]);

  if (!open) {
    return (
      <button type="button" className="locdbg__toggle" onClick={() => setOpen(true)}>
        GPS
      </button>
    );
  }

  const age = fix ? Date.now() - fix.timestamp : null;
  // The one number that proves the marker and the ranking agree.
  const drift =
    fix && rankingOrigin
      ? Math.abs(fix.latitude - rankingOrigin.latitude) +
        Math.abs(fix.longitude - rankingOrigin.longitude)
      : null;

  return (
    <div className="locdbg">
      <div className="locdbg__head">
        <span className="locdbg__title">Location debug</span>
        <button type="button" className="locdbg__close" onClick={() => setOpen(false)}>
          ×
        </button>
      </div>

      <Row label="Permission" value={permission} tone={permission === "denied" ? "bad" : undefined} />
      <Row label="Status" value={status} />
      <Row label="Last error" value={errorCode ?? "none"} tone={errorCode ? "bad" : undefined} />
      <Row
        label="Secure context"
        value={secureContext ? "yes" : "NO — geolocation blocked"}
        tone={secureContext ? undefined : "bad"}
      />
      <Row label="Source" value={fix ? "navigator.geolocation (device)" : "—"} />
      <Row label="IP / city fallback" value="none" />
      <Row label="Fixes accepted" value={String(fixCount)} />
      {attempts.length > 0 ? <Row label="Attempts" value={attempts.join(" → ")} /> : null}

      <div className="locdbg__rule" />

      <Row label="Latitude" value={fix ? fix.latitude.toFixed(6) : "—"} />
      <Row label="Longitude" value={fix ? fix.longitude.toFixed(6) : "—"} />
      <Row
        label="Accuracy"
        value={accuracy === null ? "—" : `±${Math.round(accuracy)} m`}
        tone={quality === "coarse" ? "bad" : quality === "approximate" ? "warn" : undefined}
      />
      <Row
        label="Quality"
        value={
          quality
            ? `${quality} (precise ≤${ACCURACY_THRESHOLDS.precise} m, approx ≤${ACCURACY_THRESHOLDS.approximate} m)`
            : "—"
        }
        tone={quality === "coarse" ? "bad" : quality === "approximate" ? "warn" : undefined}
      />
      <Row label="Fix age" value={age === null ? "—" : `${(age / 1000).toFixed(1)} s`} />

      <div className="locdbg__rule" />

      <Row
        label="Map centre"
        value={centre ? `${centre.lat.toFixed(6)}, ${centre.lng.toFixed(6)}` : "—"}
      />
      <Row label="Map order" value="[lng, lat]" />
      <Row
        label="Ranking origin"
        value={
          rankingOrigin
            ? `${rankingOrigin.latitude.toFixed(6)}, ${rankingOrigin.longitude.toFixed(6)}`
            : "not measuring (fix too coarse)"
        }
        tone={!rankingOrigin && fix ? "warn" : undefined}
      />
      <Row
        label="Marker vs ranking"
        value={drift === null ? "—" : drift === 0 ? "identical" : `differ by ${drift.toExponential(1)}°`}
        tone={drift !== null && drift !== 0 ? "bad" : undefined}
      />
      <Row
        label="Nearest"
        value={nearest ? `${nearest.name} · ${formatDistance(nearest.metres)}` : "—"}
      />
    </div>
  );
}
