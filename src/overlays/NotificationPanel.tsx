/**
 * Notifications — a top sheet, not a page.
 *
 * Content is contextual to the stay: what is happening in the hotel, what was
 * booked, and what the map has opened up nearby.
 */

import { BellOff } from "lucide-react";

import { SheetHeader, TopSheet } from "../ui/sheets/Sheets";
import { NOTIFICATION_ICON } from "../ui/icons";
import type { NotificationItem } from "../data/types";

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  items: NotificationItem[];
  onRead: (id: string) => void;
  onClearAll: () => void;
}

export function NotificationPanel({
  open,
  onClose,
  items,
  onRead,
  onClearAll,
}: NotificationPanelProps) {
  const unread = items.filter((item) => item.unread).length;

  return (
    <TopSheet open={open} onClose={onClose} label="Notifications">
      <SheetHeader
        eyebrow="Your stay"
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : "You are all caught up"}
        action={
          items.length > 0 ? (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClearAll}>
              Clear
            </button>
          ) : undefined
        }
        onClose={onClose}
      />

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <BellOff size={19} strokeWidth={2} aria-hidden="true" />
          </span>
          <p className="empty-state__title">Nothing new</p>
          <p className="empty-state__body">
            Events, bookings and nearby missions will land here during your stay.
          </p>
        </div>
      ) : (
        <div className="sheet__scroll scroll-region">
          <ul className="notif-list">
            {items.map((item) => {
              const Icon = NOTIFICATION_ICON[item.kind];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className="notif"
                    data-unread={item.unread}
                    onClick={() => onRead(item.id)}
                  >
                    <span className="notif__icon">
                      <Icon size={17} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="notif__body">
                      <span className="notif__title">{item.title}</span>
                      <span className="notif__desc">{item.description}</span>
                    </span>
                    <span className="notif__aside">
                      <span className="notif__time">{item.time}</span>
                      {item.unread ? (
                        <span className="notif__dot" aria-label="Unread" role="img" />
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </TopSheet>
  );
}
