/**
 * Every overlay in the product, in one place.
 *
 * Each panel is handed a single `open` boolean derived from the one piece of
 * overlay state, which is what guarantees the rules hold: at most one panel is
 * ever up, opening one closes the last, and no panel can decide on its own to
 * appear. Adding a sixth overlay means adding a line here and a case to
 * `OverlayId` — nothing else.
 *
 * Two of the slots are now polymorphic. The "mission" slot shows the guest's
 * day once they have a stay and the original mission list before that; the
 * "place" slot shows a task, a place or a 3D model depending on what was
 * tapped. Both branches exist so that a guest who has not been through
 * onboarding keeps exactly the product they had.
 */

import { AchievementsSheet } from "./AchievementsSheet";
import { AuthPanel } from "./AuthPanel";
import { ChatPanel } from "./ChatPanel";
import { DayPanel } from "./DayPanel";
import { MissionPanel } from "./MissionPanel";
import { NotificationPanel } from "./NotificationPanel";
import { PlaceDetailsSheet } from "./PlaceDetailsSheet";
import { ProfilePanel } from "./ProfilePanel";
import { QRScannerOverlay } from "./QRScannerOverlay";
import { StaySheet } from "./StaySheet";
import { TaskSheet } from "./TaskSheet";
import { useGuest } from "../state/guest";
import { useOverlay } from "../state/overlay";
import type { MapModel, Mission, NotificationItem, Place } from "../data/types";
import type { Coordinates } from "../data/geo";

interface OverlayManagerProps {
  notifications: NotificationItem[];
  onReadNotification: (id: string) => void;
  onClearNotifications: () => void;
  missions: Mission[];
  places: Place[];
  models: MapModel[];
  /** The guest's position, when known — drives real distances in the card. */
  origin: Coordinates | null;
  /** True when that position is only accurate to a neighbourhood. */
  originApproximate: boolean;
  onGoToPlace: (placeId: string) => void;
  onRoute: (longitude: number, latitude: number) => void;
  /** Opens a planned task on the map. */
  onShowTask: (taskId: string) => void;
  /** Opens an experience's 3D model on the map. */
  onShowModel: (modelId: string) => void;
}

export function OverlayManager({
  notifications,
  onReadNotification,
  onClearNotifications,
  missions,
  places,
  models,
  origin,
  originApproximate,
  onGoToPlace,
  onRoute,
  onShowTask,
  onShowModel,
}: OverlayManagerProps) {
  const { activeOverlay, selection, close } = useOverlay();
  const { plan, session } = useGuest();

  const hasStay = Boolean(session?.onboarded);
  const selectedTask =
    selection?.kind === "task" ? (plan?.tasks.find((task) => task.id === selection.id) ?? null) : null;

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

      <StaySheet open={activeOverlay === "stay"} onClose={close} />

      {hasStay ? (
        <DayPanel
          open={activeOverlay === "mission"}
          onClose={close}
          onShowTask={(task) => onShowTask(task.id)}
        />
      ) : (
        <MissionPanel
          open={activeOverlay === "mission"}
          onClose={close}
          missions={missions}
          onGoToPlace={onGoToPlace}
        />
      )}

      <ProfilePanel open={activeOverlay === "profile"} onClose={close} />

      {selection?.kind === "task" ? (
        <TaskSheet
          open={activeOverlay === "place"}
          onClose={close}
          task={selectedTask}
          onShowModel={onShowModel}
        />
      ) : (
        <PlaceDetailsSheet
          open={activeOverlay === "place"}
          onClose={close}
          selection={selection}
          places={places}
          models={models}
          origin={origin}
          originApproximate={originApproximate}
          onRoute={onRoute}
        />
      )}

      <QRScannerOverlay open={activeOverlay === "qr"} onClose={close} />

      <AchievementsSheet open={activeOverlay === "achievements"} onClose={close} />

      <AuthPanel open={activeOverlay === "auth"} onClose={close} />
    </>
  );
}
