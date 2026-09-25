/**
 * The whole guest experience: one screen.
 *
 * The map is mounted once and never unmounted. Everything else — header,
 * navigation, and the five panels — floats above it and is driven by a single
 * piece of overlay state. There are no routes, and nothing here ever replaces
 * what is on screen; it only layers over it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BasemapAnnotations } from "./map/BasemapAnnotations";
import { MapProvider, useMap, useMapZoomAbove } from "./map/MapProvider";
import { MarkerLayer } from "./map/markers/MarkerLayer";
import { ModelLayer } from "./map/models/ModelLayer";
import { OverlayManager } from "./overlays/OverlayManager";
import { BottomNav } from "./ui/chrome/BottomNav";
import { MapControls } from "./ui/chrome/MapControls";
import { TopBar } from "./ui/chrome/TopBar";
import { TokenNotice } from "./ui/TokenNotice";
import { OverlayProvider, useOverlay, type Selection } from "./state/overlay";
import { useModels } from "./data/useModels";
import { MISSIONS, NOTIFICATIONS, PLACES, STAY } from "./data/seed";
import type { NotificationItem } from "./data/types";

interface Coordinates {
  longitude: number;
  latitude: number;
}

function GuestExperience() {
  const map = useMap();
  const { activeOverlay, selection, select } = useOverlay();
  const { models } = useModels("published");

  const [notifications, setNotifications] = useState<NotificationItem[]>(NOTIFICATIONS);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);

  /**
   * Zoomed out past the neighbourhood, the curated markers stop being curation
   * and become clutter over the whole city. Only the hotel stays — it is the
   * one thing that orients the guest at any zoom.
   */
  const neighbourhoodZoom = useMapZoomAbove(13.4);
  const visiblePlaces = useMemo(
    () => (neighbourhoodZoom ? PLACES : PLACES.filter((place) => place.category === "hotel")),
    [neighbourhoodZoom],
  );

  const unreadCount = notifications.filter((item) => item.unread).length;

  /** The step the running mission points at next — it gets the halo. */
  const nextStepPlaceId = useMemo(() => {
    const active = MISSIONS.find((mission) => mission.active);
    return active?.steps.find((step) => !step.done)?.placeId;
  }, []);

  /**
   * Brings a coordinate into view above whatever sheet is covering the lower
   * half of the screen. `offset` moves the target up rather than moving the
   * centre, so the camera still lands where the guest expects.
   */
  const focusOn = useCallback(
    (longitude: number, latitude: number, { long = false }: { long?: boolean } = {}) => {
      if (!map) return;

      const offsetY = -Math.round(window.innerHeight * 0.17);
      const camera = {
        center: [longitude, latitude] as [number, number],
        zoom: Math.max(map.getZoom(), 16.2),
        pitch: Math.max(map.getPitch(), 52),
        offset: [0, offsetY] as [number, number],
        essential: true,
      };

      // A jump across the city deserves the arc; nudging to a neighbour does not.
      if (long) map.flyTo({ ...camera, duration: 1500, curve: 1.3 });
      else map.easeTo({ ...camera, duration: 780 });
    },
    [map],
  );

  const handleSelect = useCallback(
    (next: Selection) => {
      select(next);
      const target =
        next.kind === "place"
          ? PLACES.find((place) => place.id === next.id)
          : models.find((model) => model.id === next.id);
      if (target) focusOn(target.longitude, target.latitude);
    },
    [focusOn, models, select],
  );

  const handleGoToPlace = useCallback(
    (placeId: string) => {
      const place = PLACES.find((candidate) => candidate.id === placeId);
      if (!place) return;
      select({ kind: "place", id: placeId });
      focusOn(place.longitude, place.latitude, { long: true });
    },
    [focusOn, select],
  );

  /**
   * `#model=<id>` opens the guest map on one model. It is how the admin's
   * "preview" button hands a record back to the real map, and it is consumed
   * once so a reload does not keep re-opening the card.
   */
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current || !map || models.length === 0) return;

    const id = window.location.hash.match(/^#model=(.+)$/)?.[1];
    if (!id) return;

    const target = models.find((model) => model.id === id);
    deepLinkHandled.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    if (!target) return;

    select({ kind: "model", id });
    focusOn(target.longitude, target.latitude, { long: true });
  }, [focusOn, map, models, select]);

  const markRead = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, unread: false } : item)),
    );
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  return (
    <>
      <MarkerLayer
        places={visiblePlaces}
        models={models}
        selection={selection}
        highlightPlaceId={nextStepPlaceId}
        onSelect={handleSelect}
        userLocation={userLocation}
      />
      <ModelLayer
        models={models}
        selectedId={selection?.kind === "model" ? selection.id : null}
        onSelect={(id) => handleSelect({ kind: "model", id })}
      />
      <BasemapAnnotations hotel={STAY} places={PLACES} />

      <TopBar unreadCount={unreadCount} />
      <MapControls hidden={activeOverlay !== null} onLocated={setUserLocation} />
      <BottomNav />

      <OverlayManager
        notifications={notifications}
        onReadNotification={markRead}
        onClearNotifications={clearNotifications}
        missions={MISSIONS}
        places={PLACES}
        models={models}
        onGoToPlace={handleGoToPlace}
        onRoute={(longitude, latitude) => focusOn(longitude, latitude)}
      />

      <TokenNotice />
    </>
  );
}

export default function App() {
  return (
    <OverlayProvider>
      <MapProvider>
        <GuestExperience />
      </MapProvider>
    </OverlayProvider>
  );
}
