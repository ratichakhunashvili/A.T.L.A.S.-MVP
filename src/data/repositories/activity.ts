/**
 * The behaviour log and everything derived from it.
 *
 * One append-only stream of `UserActivityEvent` is the source of truth for
 * personalisation, recommendation memory and hotel analytics. Deriving all
 * three from the same log rather than from separate counters is what keeps
 * them consistent: a completion cannot show up in the analytics and be missing
 * from the guest's history.
 */

import { createLocalCollection, type Collection } from "./collection";
import { nowIso } from "./collection";
import type {
  ActivityEventType,
  ActivityType,
  DayStamp,
  Instant,
  UserActivityEvent,
  UserActivityEventDraft,
} from "../domain";
import type { PlaceCategory } from "../types";

export const activityEvents: Collection<UserActivityEvent, UserActivityEventDraft> =
  createLocalCollection<UserActivityEvent, UserActivityEventDraft>({
    name: "activityEvents",
    prefix: "ae",
    timestamps: false,
  });

/** Appends one event. The only write path into the behaviour log. */
export async function logActivityEvent(input: {
  guestId: string;
  hotelId: string;
  activityId: string;
  activityType: ActivityType;
  category: PlaceCategory;
  eventType: ActivityEventType;
  durationMin?: number;
  metadata?: Record<string, string | number | boolean>;
}): Promise<UserActivityEvent> {
  return activityEvents.create({ ...input, timestamp: nowIso() });
}

/** Everything this guest has done, newest first. */
export async function historyFor(guestId: string): Promise<UserActivityEvent[]> {
  const events = await activityEvents.list();
  return events
    .filter((event) => event.guestId === guestId)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

/** Everything that happened at a hotel — the analytics input. */
export async function historyForHotel(hotelId: string): Promise<UserActivityEvent[]> {
  const events = await activityEvents.list();
  return events.filter((event) => event.hotelId === hotelId);
}

/* ------------------------------------------------------------------------ */
/* Recommendation memory                                                     */
/* ------------------------------------------------------------------------ */

/** How recently an activity has to have been done to suppress it again. */
export const REPEAT_WINDOW_DAYS = 3;
/** How many skips before the engine takes the hint about a category. */
export const SKIP_FATIGUE_THRESHOLD = 3;

function daysAgo(timestamp: Instant, reference: number): number {
  return (reference - Date.parse(timestamp)) / 86_400_000;
}

/**
 * Activity ids the guest has finished recently enough that offering them again
 * today would read as the system not paying attention.
 */
export function recentlyCompleted(
  history: UserActivityEvent[],
  windowDays = REPEAT_WINDOW_DAYS,
  now = Date.now(),
): Set<string> {
  const ids = new Set<string>();
  for (const event of history) {
    if (event.eventType !== "completed" && event.eventType !== "verified") continue;
    if (daysAgo(event.timestamp, now) <= windowDays) ids.add(event.activityId);
  }
  return ids;
}

/** Activities the guest explicitly disliked. Suppressed for the whole stay. */
export function dislikedActivities(history: UserActivityEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of history) {
    if (event.eventType === "disliked") ids.add(event.activityId);
  }
  return ids;
}

/**
 * Categories the guest keeps passing over.
 *
 * Skipping nightlife three times is a preference the guest expressed with
 * their behaviour rather than with the onboarding cards, and it is treated the
 * same way — as a signal to turn down, not as a ban. A later completion in
 * that category cancels the fatigue.
 */
export function categoryFatigue(history: UserActivityEvent[]): Map<PlaceCategory, number> {
  const skips = new Map<PlaceCategory, number>();
  const completions = new Set<PlaceCategory>();

  // Oldest first, so a recent completion can clear an older run of skips.
  for (const event of [...history].reverse()) {
    if (event.eventType === "completed" || event.eventType === "verified") {
      completions.add(event.category);
      skips.set(event.category, 0);
    }
    if (event.eventType === "skipped") {
      skips.set(event.category, (skips.get(event.category) ?? 0) + 1);
    }
  }

  const fatigued = new Map<PlaceCategory, number>();
  for (const [category, count] of skips) {
    if (count >= SKIP_FATIGUE_THRESHOLD && !completions.has(category)) {
      fatigued.set(category, count);
    }
  }
  return fatigued;
}

/** Categories the guest has actually finished, strongest first. */
export function affinityByCategory(
  history: UserActivityEvent[],
  now = Date.now(),
): Map<PlaceCategory, number> {
  const scores = new Map<PlaceCategory, number>();

  for (const event of history) {
    const weight =
      event.eventType === "liked"
        ? 1.5
        : event.eventType === "completed" || event.eventType === "verified"
          ? 1
          : event.eventType === "disliked"
            ? -1.5
            : 0;
    if (weight === 0) continue;

    // Recent behaviour counts for more, on the same half-life the engagement
    // score uses, so the two never disagree about what "recent" means.
    const decay = Math.pow(0.5, daysAgo(event.timestamp, now) / 2);
    scores.set(event.category, (scores.get(event.category) ?? 0) + weight * decay);
  }

  return scores;
}

/* ------------------------------------------------------------------------ */
/* Hotel analytics                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Aggregate figures only.
 *
 * A hotel administrator gets counts and rates, never a named guest's
 * itinerary. `activeGuests` is a distinct count of anonymous ids, which is the
 * operational number they actually need.
 */
export interface HotelAnalytics {
  activeGuests: number;
  suggested: number;
  started: number;
  completed: number;
  skipped: number;
  booked: number;
  verified: number;
  completionRate: number;
  hotelActivityUses: number;
  partnerActivityUses: number;
  eventAttendance: number;
  wildcardsSuggested: number;
  wildcardsAccepted: number;
  wildcardAcceptance: number;
  averageTasksPerGuestDay: number;
  topCategories: { category: PlaceCategory; count: number }[];
}

const COUNTED_AS_USE: ActivityEventType[] = ["started", "completed", "verified"];

export function summariseHotel(events: UserActivityEvent[]): HotelAnalytics {
  const guests = new Set<string>();
  const guestDays = new Set<string>();
  const categories = new Map<PlaceCategory, number>();

  let suggested = 0;
  let started = 0;
  let completed = 0;
  let skipped = 0;
  let booked = 0;
  let verified = 0;
  let hotelActivityUses = 0;
  let partnerActivityUses = 0;
  let eventAttendance = 0;
  let wildcardsSuggested = 0;
  let wildcardsAccepted = 0;

  for (const event of events) {
    guests.add(event.guestId);

    const day = event.timestamp.slice(0, 10);
    if (event.eventType === "suggested") {
      suggested += 1;
      guestDays.add(`${event.guestId}|${day}`);
      if (event.metadata?.wildcard === true) wildcardsSuggested += 1;
    }
    if (event.eventType === "started") started += 1;
    if (event.eventType === "skipped") skipped += 1;
    if (event.eventType === "booked") booked += 1;
    if (event.eventType === "verified") verified += 1;

    if (event.eventType === "completed" || event.eventType === "verified") {
      completed += 1;
      categories.set(event.category, (categories.get(event.category) ?? 0) + 1);
      if (event.metadata?.wildcard === true) wildcardsAccepted += 1;
    }

    if (COUNTED_AS_USE.includes(event.eventType)) {
      if (event.activityType === "HOTEL_ACTIVITY") hotelActivityUses += 1;
      else if (event.activityType === "HOTEL_EVENT") eventAttendance += 1;
      else partnerActivityUses += 1;
    }
  }

  return {
    activeGuests: guests.size,
    suggested,
    started,
    completed,
    skipped,
    booked,
    verified,
    completionRate: suggested === 0 ? 0 : completed / suggested,
    hotelActivityUses,
    partnerActivityUses,
    eventAttendance,
    wildcardsSuggested,
    wildcardsAccepted,
    wildcardAcceptance: wildcardsSuggested === 0 ? 0 : wildcardsAccepted / wildcardsSuggested,
    averageTasksPerGuestDay: guestDays.size === 0 ? 0 : suggested / guestDays.size,
    topCategories: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

/** Scans per day for a hotel's QR, derived from the session start events. */
export function scansByDay(events: UserActivityEvent[]): Map<DayStamp, number> {
  const byDay = new Map<DayStamp, number>();
  for (const event of events) {
    if (event.eventType !== "suggested") continue;
    const day = event.timestamp.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}
