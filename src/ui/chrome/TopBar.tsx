/**
 * The floating header: two controls and a status pill, over the map.
 *
 * Deliberately not an app bar — there is no title, no background plate and no
 * border. Three objects float; the map runs underneath them.
 */

import { Bell, Sparkles } from "lucide-react";

import { useGuest } from "../../state/guest";
import { useOverlay } from "../../state/overlay";
import { STAY } from "../../data/seed";

interface TopBarProps {
  unreadCount: number;
}

/** Whole days from today until check-out. */
function nightsRemaining(checkOut: string): number {
  const end = Date.parse(`${checkOut}T00:00:00`);
  if (!Number.isFinite(end)) return 0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((end - now.getTime()) / 86_400_000));
}

export function TopBar({ unreadCount }: TopBarProps) {
  const { toggle, isOpen } = useOverlay();
  const { hotel, reservation } = useGuest();

  const notificationsOpen = isOpen("notifications");
  const chatOpen = isOpen("chatbot");
  const stayOpen = isOpen("stay");

  /*
   * What the pill says.
   *
   * A real stay reports the nights left in it; a guest with no dates yet is
   * invited to add them, which is the whole reason the pill became a button.
   */
  const hotelName = hotel?.name ?? STAY.hotelName;
  const daysLeft = reservation ? nightsRemaining(reservation.checkOut) : null;
  const meta =
    daysLeft === null
      ? "Add your dates"
      : daysLeft <= 0
        ? "Last day"
        : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`;

  return (
    <header className="topbar on-dark">
      <button
        type="button"
        className="fab"
        data-active={notificationsOpen}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={notificationsOpen}
        onClick={() => toggle("notifications")}
      >
        <Bell size={19} strokeWidth={2} aria-hidden="true" />
        {unreadCount > 0 ? <span className="fab__badge" /> : null}
      </button>

      <button
        type="button"
        className="guest-pill"
        data-active={stayOpen}
        aria-label="Your stay dates"
        aria-expanded={stayOpen}
        onClick={() => toggle("stay")}
      >
        <span className="guest-pill__dot" aria-hidden="true" />
        Guest Mode
        <span className="guest-pill__sep" aria-hidden="true">
          ·
        </span>
        <span className="guest-pill__meta">
          {hotelName} · {meta}
        </span>
      </button>

      <button
        type="button"
        className="fab"
        data-active={chatOpen}
        aria-label="Open the assistant"
        aria-expanded={chatOpen}
        onClick={() => toggle("chatbot")}
      >
        <Sparkles size={19} strokeWidth={2} aria-hidden="true" />
      </button>
    </header>
  );
}
