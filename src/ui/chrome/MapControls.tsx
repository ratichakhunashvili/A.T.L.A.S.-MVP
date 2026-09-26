/**
 * The only map controls the product shows: zoom, and find me.
 *
 * Mapbox's default control cluster is not used — it would compete with the
 * navigation for the same corner and carry a visual language that is not this
 * product's. Rotation and tilt stay available through gestures.
 *
 * The locate button does one of two things depending on what the browser has
 * told us: fly back to a known position, or open the explanation of why we
 * would like one. It never silently triggers a permission dialog.
 */

import { Locate, LocateFixed, Minus, Plus } from "lucide-react";
import { useCallback } from "react";

import { useMap } from "../../map/MapProvider";
import { useLocation } from "../../state/location";

interface MapControlsProps {
  /** Hidden while an overlay owns the screen. */
  hidden: boolean;
  /** Raised while the location card occupies the same corner. */
  shifted?: boolean;
  /** Opens the in-app explanation when we have no position to fly to. */
  onAskLocation: () => void;
  /** Frames the current fix. Owned by the app so the camera rule lives once. */
  onRecentre: () => void;
}

export function MapControls({
  hidden,
  shifted = false,
  onAskLocation,
  onRecentre,
}: MapControlsProps) {
  const map = useMap();
  const { status, position } = useLocation();

  const zoom = useCallback(
    (delta: number) => {
      map?.easeTo({ zoom: (map.getZoom() ?? 15) + delta, duration: 420 });
    },
    [map],
  );

  const located = status === "granted" && position !== null;

  const recentre = useCallback(() => {
    // With no fix there is nothing to return to — explain instead.
    if (!located) {
      onAskLocation();
      return;
    }
    onRecentre();
  }, [located, onAskLocation, onRecentre]);

  return (
    <div className="map-controls" data-hidden={hidden} data-shifted={shifted}>
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
        data-tracking={status === "locating"}
        data-located={located}
        aria-label={located ? "Recentre on your location" : "Use your location"}
        onClick={recentre}
      >
        {located ? (
          <LocateFixed size={16} strokeWidth={2.2} aria-hidden="true" />
        ) : (
          <Locate size={16} strokeWidth={2.2} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
