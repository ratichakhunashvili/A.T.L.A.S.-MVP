/**
 * Every overlay in the product, in one place.
 *
 * Each panel is handed a single `open` boolean derived from the one piece of
 * overlay state, which is what guarantees the rules hold: at most one panel is
 * ever up, opening one closes the last, and no panel can decide on its own to
 * appear. Adding a sixth overlay means adding a line here and a case to
 * `OverlayId` — nothing else.
 */

import { ChatPanel } from "./ChatPanel";
import { MissionPanel } from "./MissionPanel";
import { NotificationPanel } from "./NotificationPanel";
import { PlaceDetailsSheet } from "./PlaceDetailsSheet";
import { ProfilePanel } from "./ProfilePanel";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { useOverlay } from "../state/overlay";
import type { MapModel, Mission, NotificationItem, Place } from "../data/types";

interface OverlayManagerProps {
  notifications: NotificationItem[];
  onReadNotification: (id: string) => void;
  onClearNotifications: () => void;
  missions: Mission[];
  places: Place[];
  models: MapModel[];
  onGoToPlace: (placeId: string) => void;
  onRoute: (longitude: number, latitude: number) => void;
}

export function OverlayManager({
  notifications,
  onReadNotification,
  onClearNotifications,
  missions,
  places,
  models,
  onGoToPlace,
  onRoute,
}: OverlayManagerProps) {
  const { activeOverlay, selection, close } = useOverlay();

  return (
    <>
      <NotificationPanel
        open={activeOverlay === "notifications"}
        onClose={close}
        items={notifications}
        onRead={onReadNotification}
        onClearAll={onClearNotifications}
      />

      <ChatPanel open={activeOverlay === "chatbot"} onClose={close} />

      <MissionPanel
        open={activeOverlay === "mission"}
        onClose={close}
        missions={missions}
        onGoToPlace={onGoToPlace}
      />

      <ProfilePanel open={activeOverlay === "profile"} onClose={close} />

      <PlaceDetailsSheet
        open={activeOverlay === "place"}
        onClose={close}
        selection={selection}
        places={places}
        models={models}
        onRoute={onRoute}
      />

      <QRScannerOverlay open={activeOverlay === "qr"} onClose={close} />
    </>
  );
}
