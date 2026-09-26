/**
 * "Your day" — the guest's plan.
 *
 * Takes the place of the mission list once a guest has a stay, and is the
 * product's answer to its own promise: the guest opens it and something is
 * already planned. The next task has the most weight on screen; everything
 * else is supporting detail.
 *
 * Commitments the guest told us about appear inline, greyed, because a plan
 * that pretends dinner is not happening is not a plan.
 */

import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Footprints,
  Gift,
  Hotel as HotelIcon,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { CATEGORY_ICON } from "../ui/icons";
import { useGuest } from "../state/guest";
import { BLOCKED_COPY } from "../engine/service";
import { commitmentsOn, clockToMinutes } from "../data/repositories/guests";
import { nowMinutes, todayStamp } from "../engine/time";
import { nextTask, planProgress } from "../data/repositories/plans";
import { isTerminal, type Commitment, type Task } from "../data/domain";
import "./day.css";

interface DayPanelProps {
  open: boolean;
  onClose: () => void;
  /** Opens the task's location on the map. */
  onShowTask: (task: Task) => void;
}

export function DayPanel({ open, onClose, onShowTask }: DayPanelProps) {
  const { plan, hotel, blocked, planning, regenerate, moveTask, claim, session, events } =
    useGuest();
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  /*
   * Owned here, not by the task card.
   *
   * Completing a task immediately replaces that card with the next one, so a
   * "Nice one" held inside it is unmounted before anyone reads it. The
   * celebration belongs to the day.
   */
  const [celebrating, setCelebrating] = useState(false);
  const minutes = nowMinutes();

  useEffect(() => {
    if (!open || !session) return;
    void commitmentsOn(session.guestId, todayStamp()).then(setCommitments);
  }, [open, session, plan]);

  const upNext = useMemo(() => (plan ? nextTask(plan, minutes) : null), [plan, minutes]);
  const progress = useMemo(() => (plan ? planProgress(plan) : null), [plan]);

  /** Tasks and commitments interleaved into one timeline. */
  const timeline = useMemo(() => {
    const entries: ({ kind: "task"; task: Task } | { kind: "commitment"; commitment: Commitment })[] =
      [
        ...(plan?.tasks ?? []).map((task) => ({ kind: "task" as const, task })),
        ...commitments
          .filter((commitment) => commitment.kind !== "checkin" && commitment.kind !== "checkout")
          .map((commitment) => ({ kind: "commitment" as const, commitment })),
      ];

    return entries.sort((a, b) => {
      const aTime = a.kind === "task" ? a.task.startTime : a.commitment.startTime;
      const bTime = b.kind === "task" ? b.task.startTime : b.commitment.startTime;
      return clockToMinutes(aTime) - clockToMinutes(bTime);
    });
  }, [plan, commitments]);

  const todaysEvents = events.filter((event) => event.date === todayStamp());

  /** How much of the day is still outstanding, for the reward line. */
  const remaining = plan
    ? (() => {
        const left = plan.tasks.filter((task) => !isTerminal(task.state)).length;
        return left === 1 ? "1 task" : `${left} tasks`;
      })()
    : "";

  return (
    <BottomSheet open={open} onClose={onClose} label="Your day">
      <SheetHeader
        eyebrow={hotel ? hotel.name : "Today"}
        title={plan?.summary || "Your day"}
        onClose={onClose}
        action={
          plan ? (
            <button
              type="button"
              className="icon-btn"
              onClick={() => void regenerate()}
              disabled={planning}
              aria-label="Rebuild today's plan"
            >
              {planning ? (
                <Loader2 size={15} className="day__spin" aria-hidden="true" />
              ) : (
                <RefreshCw size={15} aria-hidden="true" />
              )}
            </button>
          ) : undefined
        }
      />

      <div className="sheet__scroll scroll-region">
        {blocked ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <CalendarClock size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="empty-state__title">{BLOCKED_COPY[blocked].title}</p>
            <p className="empty-state__body">{BLOCKED_COPY[blocked].body}</p>
          </div>
        ) : null}

        {!blocked && !plan ? (
          <div className="empty-state">
            {planning ? (
              <>
                <Loader2 size={22} className="day__spin" aria-hidden="true" />
                <p className="empty-state__title">Putting your day together</p>
                <p className="empty-state__body">Checking what's open and what fits.</p>
              </>
            ) : (
              <>
                <span className="empty-state__icon">
                  <Sparkles size={22} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <p className="empty-state__title">No plan yet</p>
                <p className="empty-state__body">Tell us when you're free and we'll fill it in.</p>
                <button type="button" className="btn btn--sm" onClick={() => void regenerate()}>
                  Build my day
                </button>
              </>
            )}
          </div>
        ) : null}

        {plan && plan.tasks.length > 0 ? (
          <>
            {/* Progress, framed as momentum rather than as a score. */}
            {progress && progress.total > 0 ? (
              <div className="day__progress">
                <div className="progress-head">
                  <span className="section-label">Today</span>
                  <span className="progress-count">
                    {progress.done} / {progress.total}
                  </span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{ width: `${Math.round(progress.fraction * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}

            {celebrating ? (
              <div className="day__hero day__hero--done" role="status">
                <span className="day__hero-tick">
                  <Check size={26} strokeWidth={3} aria-hidden="true" />
                </span>
                <p className="day__hero-title">Nice one.</p>
                <p className="day__hero-sub">
                  {upNext ? "What's next?" : "That's your day done."}
                </p>
              </div>
            ) : upNext ? (
              <NextUp
                task={upNext}
                onShow={() => onShowTask(upNext)}
                onMove={moveTask}
                onCelebrate={() => {
                  setCelebrating(true);
                  window.setTimeout(() => setCelebrating(false), 1900);
                }}
              />
            ) : null}

            <p className="section-label day__section">The whole day</p>

            <ol className="day__timeline">
              {timeline.map((entry) =>
                entry.kind === "task" ? (
                  <TaskRow
                    key={entry.task.id}
                    task={entry.task}
                    current={entry.task.id === upNext?.id}
                    onShow={() => onShowTask(entry.task)}
                  />
                ) : (
                  <li key={entry.commitment.id} className="day__row day__row--commitment">
                    <span className="day__time">{entry.commitment.startTime}</span>
                    <span className="day__mark day__mark--commitment">
                      <CalendarClock size={13} strokeWidth={2.2} aria-hidden="true" />
                    </span>
                    <span className="day__body">
                      <span className="day__title">{entry.commitment.label}</span>
                      <span className="day__meta">Your own plan</span>
                    </span>
                  </li>
                ),
              )}
            </ol>

            {/*
              The hotel's reward.

              All or nothing, and stated plainly: what it is, where to get it,
              and how much of the day is left before it is yours. It is not a
              balance and not a score — it is one coffee.
            */}
            {plan.reward ? (
              <div
                className="day__reward"
                data-unlocked={plan.rewardUnlocked}
                data-claimed={Boolean(plan.rewardClaimedAt)}
              >
                <span className="day__reward-icon">
                  {plan.rewardUnlocked ? (
                    <Gift size={18} strokeWidth={2.2} aria-hidden="true" />
                  ) : (
                    <Lock size={16} strokeWidth={2.2} aria-hidden="true" />
                  )}
                </span>

                <span className="day__reward-text">
                  <span className="day__reward-label">
                    {plan.rewardClaimedAt
                      ? "Collected"
                      : plan.rewardUnlocked
                        ? "Today's reward is yours"
                        : `${remaining} to go for today's reward`}
                  </span>
                  <span className="day__reward-title">{plan.reward.title}</span>
                  {plan.reward.location ? (
                    <span className="day__reward-where">at {plan.reward.location}</span>
                  ) : null}
                </span>

                {plan.rewardUnlocked && !plan.rewardClaimedAt ? (
                  <button type="button" className="btn btn--sm" onClick={() => void claim()}>
                    Collect
                  </button>
                ) : null}
              </div>
            ) : null}

            {plan.hotelActivityOmitted ? (
              <p className="day__note">
                No hotel activity fits your schedule today. We've filled the day with partner
                experiences instead.
              </p>
            ) : null}
          </>
        ) : null}

        {plan && plan.tasks.length === 0 && !blocked ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Clock size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="empty-state__title">Nothing fits today</p>
            <p className="empty-state__body">
              What's open doesn't line up with the time you have free. Try again tomorrow, or free
              up a window and rebuild.
            </p>
          </div>
        ) : null}

        {todaysEvents.length > 0 ? (
          <>
            <p className="section-label day__section">On at your hotel</p>
            <ul className="day__events">
              {todaysEvents.map((event) => (
                <li key={event.id} className="day__event">
                  <span className="day__time">{event.startTime}</span>
                  <span className="day__body">
                    <span className="day__title">{event.name}</span>
                    <span className="day__meta">
                      {event.location}
                      {event.capacity ? ` · ${event.capacity - event.booked} places left` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}

/* ------------------------------------------------------------------------ */
/* Next up                                                                   */
/* ------------------------------------------------------------------------ */

interface NextUpProps {
  task: Task;
  onShow: () => void;
  onMove: (taskId: string, to: Task["state"]) => Promise<Task | null>;
  onCelebrate: () => void;
}

function NextUp({ task, onShow, onMove, onCelebrate }: NextUpProps) {
  const Icon = CATEGORY_ICON[task.category];
  const started = task.state === "STARTED";

  async function complete() {
    await onMove(task.id, "COMPLETED");
    onCelebrate();
  }

  return (
    <div className="day__hero">
      <div className="day__hero-head">
        <span className="day__hero-icon">
          <Icon size={19} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="day__hero-text">
          <p className="eyebrow">{started ? "In progress" : "Up next"}</p>
          <p className="day__hero-title">{task.title}</p>
        </div>
      </div>

      <p className="day__hero-reason">{task.reason}</p>

      <div className="day__hero-meta">
        <span className="day__chip">
          <Clock size={12} strokeWidth={2.4} aria-hidden="true" />
          {task.startTime}–{task.endTime}
        </span>
        <span className="day__chip">{formatDuration(task.durationMin)}</span>
        <span className="day__chip" data-tone={task.distanceM === null ? "hotel" : "partner"}>
          {task.distanceM === null ? (
            <>
              <HotelIcon size={12} strokeWidth={2.4} aria-hidden="true" />
              At your hotel
            </>
          ) : (
            <>
              <Footprints size={12} strokeWidth={2.4} aria-hidden="true" />
              {task.travelMin} min away
            </>
          )}
        </span>
        {task.isWildcard ? (
          <span className="day__chip" data-tone="wild">
            <Sparkles size={12} strokeWidth={2.4} aria-hidden="true" />
            Something different
          </span>
        ) : null}
      </div>

      <div className="day__hero-actions">
        {started ? (
          <button type="button" className="btn btn--block" onClick={() => void complete()}>
            <Check size={16} strokeWidth={2.6} aria-hidden="true" />
            Complete
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--block"
            onClick={() => void onMove(task.id, "STARTED")}
          >
            Start
          </button>
        )}
        <button type="button" className="btn btn--ghost" onClick={onShow} aria-label="Show on map">
          <MapPin size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onMove(task.id, "SKIPPED")}
          aria-label="Skip this"
        >
          <X size={15} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Timeline row                                                              */
/* ------------------------------------------------------------------------ */

function TaskRow({ task, current, onShow }: { task: Task; current: boolean; onShow: () => void }) {
  const Icon = CATEGORY_ICON[task.category];
  const done = task.state === "COMPLETED" || task.state === "VERIFIED";
  const dropped = task.state === "SKIPPED" || task.state === "MISSED" || task.state === "EXPIRED";

  return (
    <li className="day__row" data-done={done} data-dropped={dropped} data-current={current}>
      <span className="day__time">{task.startTime}</span>
      <span className="day__mark" data-done={done} data-family={task.category}>
        {done ? (
          <Check size={13} strokeWidth={3} aria-hidden="true" />
        ) : (
          <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
        )}
      </span>
      <button type="button" className="day__body day__body--button" onClick={onShow}>
        <span className="day__title">{task.title}</span>
        <span className="day__meta">
          {formatDuration(task.durationMin)}
          {task.distanceM === null ? " · Inside your hotel" : ` · ${task.travelMin} min away`}
          {dropped ? ` · ${task.state === "SKIPPED" ? "Skipped" : "Missed"}` : ""}
        </span>
      </button>
      <ChevronRight size={15} className="day__chevron" aria-hidden="true" />
    </li>
  );
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export { isTerminal };
