/**
 * Layer 1 — the rule engine.
 *
 * Decides what is *allowed*. Every function here answers a yes/no question
 * with a named reason, and nothing downstream — not the scoring engine, not
 * the AI — may overturn a `no`. This is the layer that makes the product's
 * promises true rather than likely:
 *
 *   · only this hotel's partners are ever offered
 *   · nothing is scheduled over a commitment
 *   · nothing is scheduled when it is shut
 *   · nothing is offered that the guest just did
 *
 * Reasons are retained rather than discarded because the admin's diagnostics
 * and the "no tasks available" screens both need to say *why* a day is empty.
 */

import { REPEAT_WINDOW_DAYS } from "../data/repositories/activity";
import { hasCapacity } from "../data/repositories/catalogue";
import type { Candidate } from "./candidates";
import type { ActivityRange, HotelEvent, UserActivityEvent } from "../data/domain";
import type { PlaceCategory } from "../data/types";
import { isOpenOn } from "./time";

export type RejectionReason =
  | "not_partnered"
  | "inactive"
  | "closed_today"
  | "recently_completed"
  | "already_visited"
  | "disliked"
  | "event_full"
  | "event_past"
  | "no_slot"
  | "weather_unsuitable"
  | "out_of_range"
  | "duration_exceeds_free_time";

export const REJECTION_COPY: Record<RejectionReason, string> = {
  not_partnered: "Not part of this hotel's partner network",
  inactive: "Currently unavailable",
  closed_today: "Closed today",
  recently_completed: "Already done in the last few days",
  disliked: "The guest asked not to see this",
  event_full: "Fully booked",
  event_past: "Already finished today",
  no_slot: "No free window long enough",
  weather_unsuitable: "Weather is against it today",
  out_of_range: "Beyond the guest's chosen distance",
  already_visited: "The guest has already been there",
  duration_exceeds_free_time: "Longer than any free window",
};

export interface Screened {
  candidate: Candidate;
  /** Null when the candidate survived every rule. */
  rejected: RejectionReason | null;
}

export interface EligibilityContext {
  weekday: number;
  /** Minutes since midnight; events ending before this are gone. */
  nowMinutes: number;
  /** Only relevant when the plan is for today. */
  isToday: boolean;
  history: UserActivityEvent[];
  recentlyCompletedIds: Set<string>;
  dislikedIds: Set<string>;
  /** Longest single free window, in minutes. */
  longestWindowMin: number;
  /** Events, by id, for capacity checks. */
  eventsById: Map<string, HotelEvent>;
  /** How far the guest said they are willing to go. */
  range: ActivityRange;
  /**
   * Attractions whose achievement the guest already holds.
   *
   * A place they have been is not a task — the product is asking what to do
   * next, and answering with somewhere they stood yesterday is not an answer.
   */
  visitedAttractionIds: Set<string>;
  weather?: WeatherContext;
}

export interface WeatherContext {
  condition: "clear" | "cloudy" | "rain" | "snow" | "storm" | "hot" | "cold";
  temperatureC?: number;
  /** 0–1. Above `WET_THRESHOLD` outdoor candidates are dropped, not demoted. */
  precipitationChance?: number;
}

/** Above this chance of rain, an outdoor activity stops being a good plan. */
const WET_THRESHOLD = 0.7;
/** Above this, standing outside for an hour is genuinely unpleasant. */
const HOT_THRESHOLD_C = 34;

/**
 * Runs every hard rule over a set of candidates.
 *
 * The candidate list must already be the eligible set for this hotel — this
 * function does not fetch anything, so there is no way for it to accidentally
 * widen the pool. What it receives is what it screens.
 */
export function screenCandidates(
  candidates: Candidate[],
  context: EligibilityContext,
): Screened[] {
  return candidates.map((candidate) => ({
    candidate,
    rejected: firstFailure(candidate, context),
  }));
}

function firstFailure(candidate: Candidate, context: EligibilityContext): RejectionReason | null {
  // 8 · The guest's chosen distance is a hard limit, not a preference. The
  // one exception is a discovery pick, and that is granted in `plan.ts` by
  // screening it against a widened range rather than by ignoring this.
  if (!candidate.onProperty && candidate.distanceM > context.range.maxKm * 1000) {
    return "out_of_range";
  }

  // 17 · Somewhere already collected is somewhere already seen.
  if (context.visitedAttractionIds.has(candidate.id)) return "already_visited";

  // 5 · Opening hours.
  if (candidate.kind === "experience" && !isOpenOn(candidate.openingHours, context.weekday)) {
    return "closed_today";
  }

  // Events are fixed points: a finished one is not a suggestion.
  if (candidate.kind === "event") {
    const event = context.eventsById.get(candidate.id);
    if (event && !hasCapacity(event)) return "event_full";
    if (context.isToday && candidate.fixedEnd) {
      const [hours, minutes] = candidate.fixedEnd.split(":").map(Number);
      if (hours * 60 + minutes <= context.nowMinutes) return "event_past";
    }
  }

  // 8 · Previous activity history.
  if (context.dislikedIds.has(candidate.id)) return "disliked";
  if (context.recentlyCompletedIds.has(candidate.id)) return "recently_completed";

  // 2 · It has to physically fit somewhere in the day.
  if (candidate.durationMin > context.longestWindowMin) {
    return "duration_exceeds_free_time";
  }

  // 13 · Weather, as a hard rule only at the extremes.
  if (context.weather && !candidate.indoor && isWeatherProhibitive(context.weather)) {
    return "weather_unsuitable";
  }

  return null;
}

function isWeatherProhibitive(weather: WeatherContext): boolean {
  if (weather.condition === "storm") return true;
  if ((weather.precipitationChance ?? 0) >= WET_THRESHOLD) return true;
  if ((weather.temperatureC ?? 0) >= HOT_THRESHOLD_C) return true;
  return false;
}

/** Only the candidates that survived. */
export function eligible(screened: Screened[]): Candidate[] {
  return screened.filter((entry) => entry.rejected === null).map((entry) => entry.candidate);
}

/** Why the rest did not, counted — the admin's "empty day" explanation. */
export function rejectionSummary(screened: Screened[]): Map<RejectionReason, number> {
  const counts = new Map<RejectionReason, number>();
  for (const entry of screened) {
    if (!entry.rejected) continue;
    counts.set(entry.rejected, (counts.get(entry.rejected) ?? 0) + 1);
  }
  return counts;
}

/* ------------------------------------------------------------------------ */
/* Post-schedule validation                                                  */
/* ------------------------------------------------------------------------ */

export interface ScheduledCandidate {
  candidate: Candidate;
  start: number;
  end: number;
  travelMin: number;
}

/**
 * The final gate, run over a complete schedule.
 *
 * Everything before this builds a plan one item at a time and could, in
 * principle, have a bug that produces an overlap. This checks the finished
 * article: no two tasks overlap, none collides with a commitment, none exceeds
 * the daily cap, and every one is still inside a free window. It is
 * deliberately independent of how the schedule was produced — which is exactly
 * what makes it a usable check on AI output as well.
 */
export function validateSchedule(
  scheduled: ScheduledCandidate[],
  constraints: {
    windows: { start: number; end: number }[];
    commitments: { start: number; end: number }[];
    maxTasks: number;
    bufferMin: number;
  },
): { valid: ScheduledCandidate[]; violations: string[] } {
  const violations: string[] = [];
  const ordered = [...scheduled].sort((a, b) => a.start - b.start);
  const valid: ScheduledCandidate[] = [];

  for (const entry of ordered) {
    if (valid.length >= constraints.maxTasks) {
      violations.push(`${entry.candidate.name}: exceeds the daily maximum`);
      continue;
    }

    const travelStart = entry.start - entry.travelMin;

    const insideWindow = constraints.windows.some(
      (window) => travelStart >= window.start && entry.end <= window.end,
    );
    if (!insideWindow) {
      violations.push(`${entry.candidate.name}: falls outside every free window`);
      continue;
    }

    const clashesCommitment = constraints.commitments.some(
      (commitment) => travelStart < commitment.end && entry.end > commitment.start,
    );
    if (clashesCommitment) {
      violations.push(`${entry.candidate.name}: overlaps a commitment`);
      continue;
    }

    const clashesTask = valid.some(
      (other) =>
        travelStart < other.end + constraints.bufferMin &&
        entry.end + constraints.bufferMin > other.start - other.travelMin,
    );
    if (clashesTask) {
      violations.push(`${entry.candidate.name}: overlaps another task`);
      continue;
    }

    valid.push(entry);
  }

  return { valid, violations };
}

/* ------------------------------------------------------------------------ */
/* Category fatigue                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Skipping is a signal, not a verdict.
 *
 * A category the guest keeps passing over is turned *down*, never off — the
 * brief is explicit that repeated skips should reduce nightlife, not ban it,
 * because a guest's third evening is not always like their first.
 */
export function fatigueMultiplier(
  category: PlaceCategory,
  fatigue: Map<PlaceCategory, number>,
): number {
  const skips = fatigue.get(category) ?? 0;
  if (skips === 0) return 1;
  return Math.max(0.25, 1 - skips * 0.2);
}

export { REPEAT_WINDOW_DAYS };
