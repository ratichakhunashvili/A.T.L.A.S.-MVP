/**
 * Free-window arithmetic.
 *
 * Everything the engine does about *when* is here, in minutes-since-midnight,
 * with no dates and no timezones — the caller resolves the day first. Keeping
 * it that simple is what makes the scheduling rules testable and what stops
 * off-by-one-hour bugs from hiding inside the recommendation logic.
 */

import { TIME } from "./config";
import { clockToMinutes, minutesToClock } from "../data/repositories/guests";
import type { Commitment, DayStamp, Experience, HotelEvent, OpeningInterval } from "../data/domain";

/** A stretch of the day with nothing in it. */
export interface FreeWindow {
  /** Minutes since local midnight. */
  start: number;
  end: number;
}

export function windowLength(window: FreeWindow): number {
  return window.end - window.start;
}

export function describeWindow(window: FreeWindow): string {
  return `${minutesToClock(window.start)}–${minutesToClock(window.end)}`;
}

/**
 * Subtracts commitments from the usable day.
 *
 * Commitments are hard: the engine never plans across one, and it leaves a
 * buffer on each side so a guest is not expected to walk out of a museum and
 * into a dinner reservation in the same minute.
 */
export function calculateFreeWindows(
  commitments: Commitment[],
  options: {
    /** Earliest usable minute — `now` on the current day, day start otherwise. */
    from?: number;
    to?: number;
    bufferMin?: number;
    minimumMin?: number;
  } = {},
): FreeWindow[] {
  const from = options.from ?? clockToMinutes(TIME.dayStart);
  const to = options.to ?? clockToMinutes(TIME.dayEnd);
  const buffer = options.bufferMin ?? TIME.bufferMin;
  const minimum = options.minimumMin ?? TIME.minimumWindowMin;

  if (to <= from) return [];

  const blocked = commitments
    .map((commitment) => ({
      start: clockToMinutes(commitment.startTime) - buffer,
      end: clockToMinutes(commitment.endTime) + buffer,
    }))
    .sort((a, b) => a.start - b.start);

  const merged: FreeWindow[] = [];
  for (const block of blocked) {
    const last = merged[merged.length - 1];
    if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
    else merged.push({ ...block });
  }

  const windows: FreeWindow[] = [];
  let cursor = from;

  for (const block of merged) {
    if (block.start > cursor) windows.push({ start: cursor, end: Math.min(block.start, to) });
    cursor = Math.max(cursor, block.end);
    if (cursor >= to) break;
  }
  if (cursor < to) windows.push({ start: cursor, end: to });

  return windows.filter((window) => windowLength(window) >= minimum);
}

/** Total usable minutes in a day. Drives how many tasks are realistic. */
export function totalFreeMinutes(windows: FreeWindow[]): number {
  return windows.reduce((sum, window) => sum + windowLength(window), 0);
}

/* ------------------------------------------------------------------------ */
/* Travel                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * How long it takes to get somewhere, one way.
 *
 * Short hops are walked; anything beyond `walkableMetres` is assumed to be a
 * taxi, with a fixed overhead for finding one. On-property activities cost
 * nothing — that is much of why hotel activities fit where partner ones do
 * not.
 */
export function travelMinutes(distanceM: number | null): number {
  if (distanceM === null || distanceM <= 0) return 0;
  if (distanceM <= TIME.walkableMetres) {
    return Math.ceil(distanceM / TIME.walkMetresPerMin);
  }
  return TIME.taxiOverheadMin + Math.ceil(distanceM / TIME.driveMetresPerMin);
}

/** Whether the guest would walk or ride. Used for the task's copy. */
export function travelMode(distanceM: number | null): "none" | "walk" | "ride" {
  if (distanceM === null || distanceM <= 0) return "none";
  return distanceM <= TIME.walkableMetres ? "walk" : "ride";
}

/* ------------------------------------------------------------------------ */
/* Opening hours                                                             */
/* ------------------------------------------------------------------------ */

/**
 * When an experience is actually open on a given weekday.
 *
 * An empty schedule means no published hours, which is treated as always open
 * rather than never open — a park with no listed hours should not silently
 * vanish from every plan.
 */
export function openIntervalsOn(
  hours: OpeningInterval[],
  weekday: number,
): { start: number; end: number }[] {
  if (hours.length === 0) return [{ start: 0, end: 24 * 60 }];

  return hours
    .filter((interval) => interval.weekday === weekday)
    .map((interval) => {
      const start = clockToMinutes(interval.opens);
      let end = clockToMinutes(interval.closes);
      // A venue closing at 02:00 closes after midnight; clamp to the day.
      if (end <= start) end = 24 * 60;
      return { start, end };
    })
    .sort((a, b) => a.start - b.start);
}

export function isOpenOn(hours: OpeningInterval[], weekday: number): boolean {
  return openIntervalsOn(hours, weekday).length > 0;
}

/* ------------------------------------------------------------------------ */
/* Slot finding                                                              */
/* ------------------------------------------------------------------------ */

export interface Slot {
  start: number;
  end: number;
  /** Travel minutes already reserved before `start`. */
  travelMin: number;
  window: FreeWindow;
}

/**
 * Finds the earliest slot that genuinely fits.
 *
 * "Fits" means all of it: the travel there, the activity itself, and the
 * return buffer, inside one free window, inside the venue's opening hours. If
 * no such slot exists the activity is simply not scheduled — the engine never
 * shortens an experience or pretends a journey is instant to make a day look
 * fuller.
 */
export function findSlot(
  windows: FreeWindow[],
  occupied: { start: number; end: number }[],
  input: {
    durationMin: number;
    travelMin: number;
    openIntervals: { start: number; end: number }[];
    /** For fixed-time things such as events, the only acceptable start. */
    fixedStart?: number;
    bufferMin?: number;
  },
): Slot | null {
  const buffer = input.bufferMin ?? TIME.bufferMin;
  const needed = input.travelMin + input.durationMin;

  for (const window of windows) {
    // Respect what is already scheduled inside this window.
    const busy = occupied
      .filter((block) => block.end > window.start && block.start < window.end)
      .sort((a, b) => a.start - b.start);

    let cursor = window.start;
    const gaps: FreeWindow[] = [];
    for (const block of busy) {
      if (block.start - buffer > cursor) gaps.push({ start: cursor, end: block.start - buffer });
      cursor = Math.max(cursor, block.end + buffer);
    }
    if (cursor < window.end) gaps.push({ start: cursor, end: window.end });

    for (const gap of gaps) {
      for (const open of input.openIntervals) {
        // The activity must run entirely within opening hours; travel may not.
        const earliestStart = Math.max(gap.start + input.travelMin, open.start);
        const latestStart = Math.min(gap.end, open.end) - input.durationMin;

        if (input.fixedStart !== undefined) {
          const fits =
            input.fixedStart >= earliestStart &&
            input.fixedStart <= latestStart &&
            input.fixedStart - input.travelMin >= gap.start;
          if (!fits) continue;
          return {
            start: input.fixedStart,
            end: input.fixedStart + input.durationMin,
            travelMin: input.travelMin,
            window,
          };
        }

        if (earliestStart > latestStart) continue;
        if (earliestStart + input.durationMin > gap.end) continue;
        if (gap.end - gap.start < needed) continue;

        return {
          start: earliestStart,
          end: earliestStart + input.durationMin,
          travelMin: input.travelMin,
          window,
        };
      }
    }
  }

  return null;
}

/* ------------------------------------------------------------------------ */
/* Day resolution                                                            */
/* ------------------------------------------------------------------------ */

/** `YYYY-MM-DD` for a Date, in local time. */
export function toDayStamp(date: Date): DayStamp {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayStamp(): DayStamp {
  return toDayStamp(new Date());
}

/** Minutes since local midnight, right now. */
export function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** 0 = Sunday … 6 = Saturday, for a `YYYY-MM-DD` stamp. */
export function weekdayOf(date: DayStamp): number {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date().getDay() : parsed.getDay();
}

/** Turns an event's fixed window into minutes. */
export function eventWindow(event: HotelEvent): { start: number; end: number } {
  return { start: clockToMinutes(event.startTime), end: clockToMinutes(event.endTime) };
}

/** An experience's duration, floored so nothing schedules a zero-length task. */
export function durationOf(experience: Pick<Experience, "durationMin">): number {
  return Math.max(15, Math.round(experience.durationMin));
}
