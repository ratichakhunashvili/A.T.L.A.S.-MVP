/**
 * The whole guest experience: one screen.
 *
 * The map is mounted once and never unmounted. Everything else — header,
 * navigation, and the panels — floats above it and is driven by a single
 * piece of overlay state. There are no routes, and nothing here ever replaces
 * what is on screen; it only layers over it.
 *
 * A guest who has been through onboarding also has a day: their tasks are
 * drawn over the same map, in order, and the mission panel becomes their
 * plan. A guest who has not is unaffected — the map, the markers and the 3D
 * models all behave exactly as before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AccuracyRing } from "./map/AccuracyRing";
import { BasemapAnnotations } from "./map/BasemapAnnotations";
import { MapProvider, useMap, useMapZoomAbove } from "./map/MapProvider";
import { MarkerLayer } from "./map/markers/MarkerLayer";
import { BuildingMask } from "./map/models/BuildingMask";
import { ModelLayer } from "./map/models/ModelLayer";
import { TaskLayer } from "./map/TaskLayer";
import { OverlayManager } from "./overlays/OverlayManager";
import { BottomNav } from "./ui/chrome/BottomNav";
import { LocationPrompt } from "./ui/chrome/LocationPrompt";
import { MapControls } from "./ui/chrome/MapControls";
import { TopBar } from "./ui/chrome/TopBar";
import { TokenNotice } from "./ui/TokenNotice";
import { AuthProvider } from "./auth/AuthProvider";
import { AchievementProvider, useAchievements } from "./state/achievements";
import { AchievementToast } from "./ui/achievements/AchievementToast";
import { GuestProvider, useGuest } from "./state/guest";
import { ensureGuestSession } from "./data/repositories/guests";
import { LocationProvider, useLocation } from "./state/location";
import { OverlayProvider, useOverlay, type Selection } from "./state/overlay";
import { useModels } from "./data/useModels";
import { accuracyRing, rankPlacesByDistance } from "./data/geo";
import { MISSIONS, NOTIFICATIONS, PLACES, STAY } from "./data/seed";
import { LocationDebug } from "./ui/debug/LocationDebug";
import type { NotificationItem } from "./data/types";

/** How long after load to offer the location ask, if it is still relevant. */
const ASK_DELAY_MS = 4200;

/** Below this zoom the curated markers thin out to just the hotel. */
const NEIGHBOURHOOD_ZOOM = 13.4;

interface GuestExperienceProps {
  /** Set when the app was opened by scanning an attraction's printed code. */
  scanAttractionId?: string;
}

function GuestExperience({ scanAttractionId }: GuestExperienceProps) {
  const map = useMap();
  const { activeOverlay, selection, select } = useOverlay();
  const { models } = useModels("published");
  const { status, fix, position, quality, usablePosition, canAsk, dismissed, fixCount } =
    useLocation();
  const { plan, hotel } = useGuest();
  const { unlock, collection } = useAchievements();

  /*
   * Which models stand on somewhere the guest has already been.
   *
   * The collection is keyed by attraction; the map draws models. Joining the
   * two here means a visited place goes green on the map without the marker
   * layer needing to know anything about achievements.
   */
  const visitedModelIds = useMemo(() => {
    const byAttraction = new Set(collection.map((entry) => entry.attraction?.modelId));
    return new Set(
      models.filter((model) => byAttraction.has(model.id)).map((model) => model.id),
    );
  }, [collection, models]);

  const [notifications, setNotifications] = useState<NotificationItem[]>(NOTIFICATIONS);
  const [askLocation, setAskLocation] = useState(false);
  const [scanProblem, setScanProblem] = useState<string | null>(null);

  /**
   * Zoomed out past the neighbourhood, the curated markers stop being curation
   * and become clutter over the whole city. Only the hotel stays — it is the
   * one thing that orients the guest at any zoom.
   */
  const neighbourhoodZoom = useMapZoomAbove(NEIGHBOURHOOD_ZOOM);

  /** Today's tasks, in the order they run. */
  const tasks = useMemo(() => plan?.tasks ?? [], [plan]);

  /**
   * Distance ranking drives the whole marker hierarchy.
   *
   * With a real position this measures from the guest; without one it falls
   * back to the hotel, because "near your hotel" is the next most useful frame
   * and the product already knows where that is. The ranking never *implies* a
   * position it does not have — distances only reach the UI when the fix is
   * real.
   */
  const rankedPlaces = useMemo(() => {
    // `usablePosition` is null while the fix is too coarse to measure from, so
    // a ±25 km guess never produces a "280 m away" claim.
    const ranked = rankPlacesByDistance(PLACES, usablePosition);
    const visible = neighbourhoodZoom
      ? ranked
      : ranked.filter((entry) => entry.place.category === "hotel");

    // Anything already on the map as a task is not also drawn as a browsable
    // place — one pin per location, and the task pin is the more useful one.
    if (tasks.length === 0) return visible;
    const plannedIds = new Set(tasks.map((task) => task.activityId));
    return visible.filter(
      (entry) => entry.place.category === "hotel" || !plannedIds.has(entry.place.id),
    );
  }, [usablePosition, neighbourhoodZoom, tasks]);

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
        pitch: Math.max(map.getPitch(), 46),
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
          : next.kind === "task"
            ? tasks.find((task) => task.id === next.id)
            : models.find((model) => model.id === next.id);
      if (target) focusOn(target.longitude, target.latitude);
    },
    [focusOn, models, select, tasks],
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

  /** Opens a task from the plan panel and flies to it. */
  const handleShowTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      select({ kind: "task", id: taskId });
      focusOn(task.longitude, task.latitude, { long: true });
    },
    [focusOn, select, tasks],
  );

  /** Opens the 3D model attached to an experience. */
  const handleShowModel = useCallback(
    (modelId: string) => {
      const model = models.find((candidate) => candidate.id === modelId);
      if (!model) return;
      select({ kind: "model", id: modelId });
      focusOn(model.longitude, model.latitude, { long: true });
    },
    [focusOn, models, select],
  );

  /* -- Offer the location ask, once, and only when it could help ---------- */
  useEffect(() => {
    if (!canAsk || dismissed || status !== "idle") return;
    const timer = window.setTimeout(() => setAskLocation(true), ASK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [canAsk, dismissed, status]);

  /**
   * Frames a fix at a zoom its accuracy can actually support.
   *
   * A precise fix earns street zoom. A looser one is framed to its own
   * uncertainty circle, so the view says "somewhere in here" rather than
   * pretending to a doorway. A coarse fix does not move the camera at all.
   */
  const frameFix = useCallback(() => {
    if (!map || !fix || !quality) return;

    if (quality === "precise") {
      map.flyTo({
        center: [fix.longitude, fix.latitude],
        zoom: Math.max(map.getZoom(), 16.2),
        duration: 1600,
        curve: 1.3,
        essential: true,
      });
      return;
    }

    // Fit the accuracy circle, so the zoom is derived from the uncertainty —
    // but floored, because zooming out far enough to frame a wide circle also
    // zooms past the point where the curated markers thin out, and an empty
    // map is a worse answer than a slightly cropped circle.
    const ring = accuracyRing(fix, fix.accuracy, 16);
    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);
    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ];

    const camera = map.cameraForBounds(bounds, { padding: 56 });
    const fitted = camera?.zoom ?? 15;
    map.flyTo({
      center: [fix.longitude, fix.latitude],
      zoom: Math.min(Math.max(fitted, NEIGHBOURHOOD_ZOOM + 0.4), 15.5),
      duration: 1600,
      curve: 1.3,
      essential: true,
    });
  }, [map, fix, quality]);

  /**
   * The camera follows the *first* trustworthy fix and never again.
   *
   * After that the guest is in charge: a moving position updates the marker
   * but not the view, and the recentre control is the only thing that moves
   * the camera back. A coarse fix is never flown to — being dragged to the
   * wrong side of the city is worse than not moving.
   */
  const centredOnGuest = useRef(false);
  useEffect(() => {
    if (!map || !fix || fixCount === 0 || centredOnGuest.current) return;
    if (quality === "coarse") return;
    centredOnGuest.current = true;
    frameFix();
  }, [map, fix, fixCount, quality, frameFix]);

  /**
   * A fix too coarse to use is not a silent failure. The guest gets a hollow
   * dot and a large ring, and they are owed the sentence that explains why —
   * once, not on every update.
   */
  const explainedCoarse = useRef(false);
  useEffect(() => {
    if (quality !== "coarse" || explainedCoarse.current) return;
    explainedCoarse.current = true;
    setAskLocation(true);
  }, [quality]);

  /**
   * A failed attempt is not silence either. Without this the map simply sits
   * on the seeded hotel and looks like it has decided the guest is in Tbilisi.
   */
  const explainedFailure = useRef(false);
  useEffect(() => {
    if (status !== "error" || explainedFailure.current) return;
    explainedFailure.current = true;
    setAskLocation(true);
  }, [status]);

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

  /**
   * Consumes a scanned attraction, once.
   *
   * The URL is rewritten to the map immediately so a reload does not re-run
   * the unlock, and an anonymous guest is created on the spot — scanning a
   * sign should never open a sign-up form.
   */
  const scanHandled = useRef(false);
  useEffect(() => {
    if (!scanAttractionId || scanHandled.current) return;
    scanHandled.current = true;

    ensureGuestSession();
    window.history.replaceState(null, "", "/");

    void unlock(scanAttractionId).then((outcome) => {
      // `already` is deliberately silent: the guest has been here before and
      // a second notification would only tell them something they know.
      if (outcome.status === "unknown_attraction" || outcome.status === "inactive") {
        setScanProblem("That code isn't one of ours.");
        window.setTimeout(() => setScanProblem(null), 4200);
      }
    });
  }, [scanAttractionId, unlock]);

  const markRead = useCallback((id: string) => {
    setNotifications((current) =>
      current.map((item) => (item.id === id ? { ...item, unread: false } : item)),
    );
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  /** Tasks still worth drawing. A skipped one leaves the map. */
  const mapTasks = useMemo(
    () => tasks.filter((task) => task.state !== "SKIPPED" && task.state !== "EXPIRED"),
    [tasks],
  );

  return (
    <>
      <MarkerLayer
        places={rankedPlaces}
        models={models}
        selection={selection}
        highlightPlaceId={nextStepPlaceId}
        onSelect={handleSelect}
        userLocation={position}
        userQuality={quality}
        visitedModelIds={visitedModelIds}
      />
      <TaskLayer
        tasks={mapTasks}
        selectedTaskId={selection?.kind === "task" ? selection.id : null}
        onSelect={(id) => handleSelect({ kind: "task", id })}
        hidden={!neighbourhoodZoom}
      />
      <AccuracyRing fix={fix} quality={quality} />
      {/* Takes the basemap building out from under each custom model. */}
      <BuildingMask models={models} />
      <ModelLayer
        models={models}
        selectedId={selection?.kind === "model" ? selection.id : null}
        onSelect={(id) => handleSelect({ kind: "model", id })}
      />
      <BasemapAnnotations hotel={hotel ? { ...STAY, hotelName: hotel.name } : STAY} places={PLACES} />

      <TopBar unreadCount={unreadCount} />
      <MapControls
        hidden={activeOverlay !== null}
        shifted={askLocation && activeOverlay === null}
        onAskLocation={() => setAskLocation(true)}
        onRecentre={frameFix}
      />
      <BottomNav />

      {/* A card, not an overlay: it never enters the one-at-a-time state
          machine, and it steps aside whenever a panel needs the room. */}
      <LocationPrompt
        open={askLocation && activeOverlay === null}
        onClose={() => setAskLocation(false)}
        onShowArea={frameFix}
      />

      <OverlayManager
        notifications={notifications}
        onReadNotification={markRead}
        onClearNotifications={clearNotifications}
        missions={MISSIONS}
        places={PLACES}
        models={models}
        origin={usablePosition}
        originApproximate={quality === "approximate"}
        onGoToPlace={handleGoToPlace}
        onRoute={(longitude, latitude) => focusOn(longitude, latitude)}
        onShowTask={handleShowTask}
        onShowModel={handleShowModel}
      />

      {/* Above every overlay: an unlock should not wait for a sheet to close. */}
      <AchievementToast />

      {scanProblem ? (
        <div className="ach-toast" data-active="true" role="status">
          <div className="ach-toast__body">
            <p className="ach-toast__title">{scanProblem}</p>
            <p className="ach-toast__where">Check you scanned the code at the attraction itself.</p>
          </div>
        </div>
      ) : null}

      <TokenNotice />

      {/* Compile-time constant: the whole branch, and the component with it,
          is dropped from a production build. */}
      {import.meta.env.DEV ? (
        <LocationDebug
          rankingOrigin={usablePosition}
          nearest={
            rankedPlaces[0]?.metres != null
              ? { name: rankedPlaces[0].place.name, metres: rankedPlaces[0].metres }
              : null
          }
        />
      ) : null}
    </>
  );
}

export default function App({ scanAttractionId }: { scanAttractionId?: string }) {
  return (
    <AuthProvider>
      <LocationProvider>
        <GuestProvider>
          <AchievementProvider>
            <OverlayProvider>
              <MapProvider>
                <GuestExperience scanAttractionId={scanAttractionId} />
              </MapProvider>
            </OverlayProvider>
          </AchievementProvider>
        </GuestProvider>
      </LocationProvider>
    </AuthProvider>
  );
}
