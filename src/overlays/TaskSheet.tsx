/**
 * A task, opened from its marker on the map.
 *
 * Shows what the brief asks a task marker to show: what it is, how long, how
 * far, when it was planned for, why it was chosen, whether it belongs to the
 * hotel or to a partner, and a way to start it. The partner relationship is
 * stated explicitly, because a guest should be able to tell at a glance which
 * recommendations their hotel stands behind.
 */

import {
  Box,
  Check,
  Clock,
  ExternalLink,
  Footprints,
  Hotel as HotelIcon,
  Handshake,
  Sparkles,
  Ticket,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { formatDuration } from "./DayPanel";
import { CATEGORY_ICON } from "../ui/icons";
import { useGuest } from "../state/guest";
import { experiences } from "../data/repositories/catalogue";
import { logActivityEvent } from "../data/repositories/activity";
import { formatDistance } from "../data/geo";
import { ACTIVITY_TYPE_LABEL, isInsideHotel, type Experience, type Task } from "../data/domain";

interface TaskSheetProps {
  open: boolean;
  onClose: () => void;
  task: Task | null;
  /** Opens the attached 3D model on the map, when there is one. */
  onShowModel: (modelId: string) => void;
}

export function TaskSheet({ open, onClose, task, onShowModel }: TaskSheetProps) {
  const { moveTask } = useGuest();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  /* The underlying record carries the booking link and the model reference. */
  useEffect(() => {
    if (!task || task.activityKind !== "experience") {
      setExperience(null);
      return;
    }
    let cancelled = false;
    void experiences.get(task.activityId).then((found) => {
      if (!cancelled) setExperience(found);
    });
    return () => {
      cancelled = true;
    };
  }, [task]);

  /* Opening a task is itself a signal — it says the guest considered it. */
  useEffect(() => {
    if (!open || !task) return;
    void logActivityEvent({
      guestId: task.guestId,
      hotelId: task.hotelId,
      activityId: task.activityId,
      activityType: task.activityType,
      category: task.category,
      eventType: "viewed",
      metadata: { taskId: task.id },
    });
  }, [open, task]);

  if (!task) {
    return (
      <BottomSheet open={open} onClose={onClose} label="Task">
        <SheetHeader title="Task" onClose={onClose} />
      </BottomSheet>
    );
  }

  const Icon = CATEGORY_ICON[task.category];
  const onProperty = isInsideHotel(task.activityType);
  const done = task.state === "COMPLETED" || task.state === "VERIFIED";
  const started = task.state === "STARTED";

  async function complete() {
    await moveTask(task!.id, "COMPLETED");
    setCelebrating(true);
    window.setTimeout(() => {
      setCelebrating(false);
      onClose();
    }, 1600);
  }

  return (
    <BottomSheet open={open} onClose={onClose} label={task.title}>
      <SheetHeader
        eyebrow={ACTIVITY_TYPE_LABEL[task.activityType]}
        title={task.title}
        onClose={onClose}
      />

      <div className="sheet__scroll scroll-region">
        <div className="place-hero">
          {/* The badge the brief asks for, verbatim, so the relationship is
              never ambiguous. */}
          <span className="place-hero__badge">
            {onProperty ? (
              <>
                <HotelIcon size={11} strokeWidth={2.6} aria-hidden="true" />
                At your hotel
              </>
            ) : (
              <>
                <Handshake size={11} strokeWidth={2.6} aria-hidden="true" />
                Hotel partner
              </>
            )}
          </span>

          {task.isWildcard ? (
            <span className="place-hero__mission">
              <Sparkles size={11} strokeWidth={2.6} aria-hidden="true" />
              Something different
            </span>
          ) : null}

          <Icon size={54} strokeWidth={1} aria-hidden="true" />
        </div>

        <div className="place-body">
          <ul className="place-meta">
            <li className="place-meta__item">
              <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
              <strong>
                {task.startTime}–{task.endTime}
              </strong>
            </li>
            <li className="place-meta__item">
              <strong>{formatDuration(task.durationMin)}</strong>
            </li>
            <li className="place-meta__item">
              {task.distanceM === null ? (
                <>
                  <HotelIcon size={13} strokeWidth={2.2} aria-hidden="true" />
                  <strong>Inside your hotel</strong>
                </>
              ) : (
                <>
                  <Footprints size={13} strokeWidth={2.2} aria-hidden="true" />
                  <strong>{formatDistance(task.distanceM)}</strong>
                  <span>· {task.travelMin} min</span>
                </>
              )}
            </li>
            {experience?.price ? (
              <li className="place-meta__item">
                <strong>{experience.price} ₾</strong>
                <span>per person</span>
              </li>
            ) : null}
          </ul>

          <p>{task.shortDescription}</p>

          {/* The short "why this" line. Never a score, never an algorithm. */}
          <p className="task__reason">
            <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
            {task.reason}
          </p>

          {task.requiresBooking ? (
            <p className="task__notice">
              <Ticket size={13} strokeWidth={2.2} aria-hidden="true" />
              Needs booking ahead — reception can do it for you.
            </p>
          ) : null}

          {celebrating ? (
            <div className="task__done" role="status">
              <Check size={20} strokeWidth={3} aria-hidden="true" />
              Nice one.
            </div>
          ) : (
            <div className="place-actions">
              {done ? (
                <span className="btn btn--block btn--ghost" aria-disabled="true">
                  <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                  Completed
                </span>
              ) : started ? (
                <button type="button" className="btn btn--block" onClick={() => void complete()}>
                  <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                  Complete
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--block"
                  onClick={() => void moveTask(task.id, "STARTED")}
                >
                  Start
                </button>
              )}

              {!done ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void moveTask(task.id, "SKIPPED")}
                  aria-label="Skip this"
                >
                  <X size={15} strokeWidth={2.2} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}

          <div className="task__links">
            {experience?.modelId ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => onShowModel(experience.modelId!)}
              >
                <Box size={14} strokeWidth={2.2} aria-hidden="true" />
                See it in 3D
              </button>
            ) : null}

            {experience?.bookingUrl ? (
              <a
                className="btn btn--sm btn--ghost"
                href={experience.bookingUrl}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() =>
                  void logActivityEvent({
                    guestId: task.guestId,
                    hotelId: task.hotelId,
                    activityId: task.activityId,
                    activityType: task.activityType,
                    category: task.category,
                    eventType: "booked",
                    metadata: { taskId: task.id },
                  })
                }
              >
                <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />
                Book
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
