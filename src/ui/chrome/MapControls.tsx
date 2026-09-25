/**
 * The only map controls the product shows: zoom, and find me.
 *
 * Mapbox's default control cluster is not used — it would compete with the
 * navigation for the same corner and carry a visual language that is not this
 * product's. Rotation and tilt stay available through gestures.
 */

import { Locate, Minus, Plus } from "lucide-react";
import { useCallback, useState } from "react";

import { useMap } from "../../map/MapProvider";

interface MapControlsProps {
  /** Hidden while an overlay owns the screen. */
  hidden: boolean;
  onLocated: (position: { longitude: number; latitude: number } | null) => void;
}

export function MapControls({ hidden, onLocated }: MapControlsProps) {
  const map = useMap();
  const [locating, setLocating] = useState(false);

  const zoom = useCallback(
    (delta: number) => {
      map?.easeTo({ zoom: (map.getZoom() ?? 15) + delta, duration: 420 });
    },
    [map],
  );

  const locate = useCallback(() => {
    if (!map || !navigator.geolocation) return;
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        onLocated({ longitude: coords.longitude, latitude: coords.latitude });
        // Fly rather than jump: the guest should keep their bearings.
        map.flyTo({
          center: [coords.longitude, coords.latitude],
          zoom: Math.max(map.getZoom(), 16),
          pitch: 55,
          duration: 1600,
          essential: true,
        });
      },
      () => {
        setLocating(false);
        onLocated(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
    );
  }, [map, onLocated]);

  return (
    <div className="map-controls on-dark" data-hidden={hidden}>
      <div className="map-control-group">
        <button type="button" className="map-control" aria-label="Zoom in" onClick={() => zoom(1)}>
          <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
        <button type="button" className="map-control" aria-label="Zoom out" onClick={() => zoom(-1)}>
          <Minus size={16} strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="map-control map-control--solo"
        data-tracking={locating}
        aria-label="Find my location"
        onClick={locate}
      >
        <Locate size={16} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </div>
  );
}
