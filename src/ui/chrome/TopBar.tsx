/**
 * The floating header: two controls and a status pill, over the map.
 *
 * Deliberately not an app bar — there is no title, no background plate and no
 * border. Three objects float; the map runs underneath them.
 */

import { Bell, Sparkles } from "lucide-react";

import { useOverlay } from "../../state/overlay";
import { STAY } from "../../data/seed";

interface TopBarProps {
  unreadCount: number;
}

export function TopBar({ unreadCount }: TopBarProps) {
  const { toggle, isOpen } = useOverlay();

  const notificationsOpen = isOpen("notifications");
  const chatOpen = isOpen("chatbot");

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

      <p className="guest-pill">
        <span className="guest-pill__dot" aria-hidden="true" />
        Guest Mode
        <span className="guest-pill__sep" aria-hidden="true">
          ·
        </span>
        <span className="guest-pill__meta">
          {STAY.hotelName} · {STAY.daysLeft} days left
        </span>
      </p>

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
