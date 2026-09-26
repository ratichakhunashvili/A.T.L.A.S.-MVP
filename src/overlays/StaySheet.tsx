/**
 * Your stay — the panel behind the header's status pill.
 *
 * Falls down from the top, shows the days of the stay as a strip, and lets the
 * guest correct their check-in and check-out. It works before onboarding too:
 * a guest in pure guest mode can set dates here and get a plan without ever
 * having scanned a reservation.
 *
 * Today is always the active day. Selecting another day in the strip shows
 * what happened on it rather than planning ahead — the product plans the day
 * you are in, not the week you might have.
 */

import { CalendarDays, Check, Loader2, MoonStar } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { TopSheet, SheetHeader } from "../ui/sheets/Sheets";
import { useGuest } from "../state/guest";
import {
  nightsBetween,
  RESERVATION_PROBLEM_COPY,
  saveReservation,
  validateReservation,
  type ReservationProblem,
} from "../data/repositories/guests";
import { todayStamp, toDayStamp } from "../engine/time";
import "./stay.css";

interface StaySheetProps {
  open: boolean;
  onClose: () => void;
}

export function StaySheet({ open, onClose }: StaySheetProps) {
  const { session, hotel, reservation, refresh, regenerate, planning } = useGuest();

  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [problems, setProblems] = useState<ReservationProblem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-seed from the stored stay each time it opens, so closing is cancelling.
  useEffect(() => {
    if (!open) return;
    setCheckIn(reservation?.checkIn ?? todayStamp());
    setCheckOut(reservation?.checkOut ?? "");
    setProblems([]);
    setSaved(false);
  }, [open, reservation]);

  const nights = useMemo(
    () => (checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0),
    [checkIn, checkOut],
  );

  /** Every day of the stay, for the strip. */
  const days = useMemo(() => {
    if (!checkIn || !checkOut) return [];
    const out: string[] = [];
    const cursor = new Date(`${checkIn}T12:00:00`);
    const end = new Date(`${checkOut}T12:00:00`);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];

    // A stay is bounded; the cap is a guard against a typo, not a policy.
    for (let guard = 0; cursor <= end && guard < 90; guard += 1) {
      out.push(toDayStamp(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }, [checkIn, checkOut]);

  const today = todayStamp();
  const dirty = checkIn !== reservation?.checkIn || checkOut !== reservation?.checkOut;

  async function save() {
    const name = reservation?.guestName?.trim() || "Guest";
    const found = validateReservation({ guestName: name, checkIn, checkOut });
    setProblems(found);
    if (found.length > 0 || !session) return;

    setSaving(true);
    try {
      await saveReservation({
        guestId: session.guestId,
        // Always the hotel this session belongs to; never anything typed.
        hotelId: session.hotelId,
        guestName: name,
        checkIn,
        checkOut,
        partySize: reservation?.partySize ?? 1,
        reference: reservation?.reference,
        roomNumber: reservation?.roomNumber,
        source: reservation?.source ?? "manual",
      });
      await refresh();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TopSheet open={open} onClose={onClose} label="Your stay">
      <SheetHeader
        eyebrow={hotel?.name ?? "Guest mode"}
        title="Your stay"
        subtitle={
          nights > 0
            ? `${nights} ${nights === 1 ? "night" : "nights"}`
            : "Add your dates and we'll build your days around them."
        }
        onClose={onClose}
      />

      <div className="stay">
        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="stay-in">Check-in</label>
            <input
              id="stay-in"
              className="input"
              type="date"
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="stay-out">Check-out</label>
            <input
              id="stay-out"
              className="input"
              type="date"
              min={checkIn || undefined}
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          </div>
        </div>

        {days.length > 0 ? (
          <>
            <p className="section-label stay__label">
              <span className="eyebrow">Your days</span>
              <span className="eyebrow">
                <MoonStar size={11} strokeWidth={2.4} aria-hidden="true" /> {nights}
              </span>
            </p>

            {/*
              The strip is a picture of the stay, not a planner. Today is the
              day the product works on; the rest are context.
            */}
            <ol className="stay__strip">
              {days.map((day) => {
                const past = day < today;
                const isToday = day === today;
                return (
                  <li
                    key={day}
                    className="stay__day"
                    data-today={isToday}
                    data-past={past}
                    aria-current={isToday ? "date" : undefined}
                  >
                    <span className="stay__weekday">{weekdayLabel(day)}</span>
                    <span className="stay__date">{Number(day.slice(8))}</span>
                    {isToday ? <span className="stay__dot" aria-hidden="true" /> : null}
                  </li>
                );
              })}
            </ol>

            <p className="stay__note">
              {days.includes(today)
                ? "Today is your active day. Tasks are generated for it, and reset at midnight."
                : "This stay doesn't cover today, so there's nothing to plan right now."}
            </p>
          </>
        ) : null}

        {problems.length > 0 ? (
          <p className="field__error" role="alert">
            {RESERVATION_PROBLEM_COPY[problems[0]]}
          </p>
        ) : null}

        <div className="stay__actions">
          <button
            type="button"
            className="btn btn--block"
            disabled={saving || (!dirty && !saved)}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 size={16} className="day__spin" aria-hidden="true" />
            ) : saved ? (
              <Check size={16} strokeWidth={2.6} aria-hidden="true" />
            ) : (
              <CalendarDays size={16} strokeWidth={2.2} aria-hidden="true" />
            )}
            {saved ? "Saved" : "Save dates"}
          </button>

          {/*
            Changing dates does not silently rebuild the day. The guest asks
            for it, which keeps the plan predictable.
          */}
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={planning || !days.includes(today)}
            onClick={() => void regenerate().then(onClose)}
          >
            {planning ? "Building…" : "Regenerate today"}
          </button>
        </div>
      </div>
    </TopSheet>
  );
}

function weekdayLabel(day: string): string {
  const parsed = new Date(`${day}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, { weekday: "narrow" });
}
