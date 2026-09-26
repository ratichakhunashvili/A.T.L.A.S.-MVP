/**
 * The recommendation pipeline.
 *
 * Runs the algorithm hierarchy in the order the product brief fixes, and the
 * order matters more than any single step:
 *
 *    1 reservation  2 free time      3 hotel activity  4 partner restriction
 *    5 opening hrs  6 travel time    7 commitments     8 history
 *    9 preferences 10 budget        11 energy         12 engagement score
 *   13 variety     14 exploration   15 AI ranking
 *
 * Steps 1–14 are deterministic and produce a complete, valid plan on their
 * own. Step 15 may reorder and rewrite that plan; it may not add to it, and
 * anything it returns is re-validated against steps 1–7 before a guest sees
 * it. That is the whole contract between the rules and the model.
 */

import { EXPLORATION, MAX_TASKS_PER_DAY, TIME, wildcardChance } from "./config";
import {
  computeEngagement,
  computeMomentum,
  determineTaskCount,
  planHeadline,
} from "./engagement";
import { explainChoice, explainWildcard, scoreAll, type ScoringContext } from "./scoring";
import {
  eligible,
  rejectionSummary,
  screenCandidates,
  validateSchedule,
  type EligibilityContext,
  type RejectionReason,
  type ScheduledCandidate,
  type WeatherContext,
} from "./rules";
import {
  calculateFreeWindows,
  durationOf,
  findSlot,
  totalFreeMinutes,
  travelMinutes,
  weekdayOf,
  type FreeWindow,
} from "./time";
import {
  candidateFromEvent,
  candidateFromHotelActivity,
  candidateFromPartner,
  type Candidate,
} from "./candidates";
import {
  affinityByCategory,
  categoryFatigue,
  dislikedActivities,
  recentlyCompleted,
} from "../data/repositories/activity";
import { clockToMinutes, minutesToClock } from "../data/repositories/guests";
import { makeId, nowIso } from "../data/repositories/collection";
import type {
  Commitment,
  DailyPlan,
  DayStamp,
  Experience,
  GuestPreferences,
  Hotel,
  HotelEvent,
  Reservation,
  Task,
  UserActivityEvent,
} from "../data/domain";
import type { PartnerExperience } from "../data/repositories/catalogue";

/* ------------------------------------------------------------------------ */
/* Inputs and outputs                                                        */
/* ------------------------------------------------------------------------ */

export interface PlanInput {
  guestId: string;
  hotel: Hotel;
  reservation: Reservation;
  date: DayStamp;
  preferences: GuestPreferences;
  commitments: Commitment[];
  /** Hotel-owned activities. No partner row needed — the hotel owns them. */
  hotelActivities: Experience[];
  /** The hotel's partner network. The ONLY source of outside candidates. */
  partners: PartnerExperience[];
  events: HotelEvent[];
  history: UserActivityEvent[];
  /** Attractions the guest has already collected. Never offered as tasks. */
  visitedAttractionIds?: Set<string>;
  weather?: WeatherContext;
  /** Minutes since midnight. Only consulted when `date` is today. */
  nowMinutes?: number;
  isToday?: boolean;
  /** Injectable for deterministic tests. */
  random?: () => number;
}

export interface PlanDiagnostics {
  freeWindows: FreeWindow[];
  totalFreeMin: number;
  activityScore: number;
  taskBudget: ReturnType<typeof determineTaskCount>;
  candidatesConsidered: number;
  eligibleCount: number;
  rejections: Map<RejectionReason, number>;
  scheduleViolations: string[];
  /** True when a hotel option existed but nothing fit the guest's windows. */
  hotelActivityOmitted: boolean;
  /** True when this hotel simply has no partner network yet. */
  noPartners: boolean;
}

export interface PlanResult {
  plan: DailyPlan;
  diagnostics: PlanDiagnostics;
}

/* ------------------------------------------------------------------------ */
/* The pipeline                                                              */
/* ------------------------------------------------------------------------ */

export function generateDailyPlan(input: PlanInput): PlanResult {
  const random = input.random ?? Math.random;
  const isToday = input.isToday ?? false;
  const now = input.nowMinutes ?? 0;

  /* -- 1 · Reservation constraints -------------------------------------- */
  // A day outside the stay has no plan at all. Check-out day is bounded by the
  // check-out commitment rather than excluded, so a late flight still gets a
  // morning.
  const withinStay = input.date >= input.reservation.checkIn && input.date <= input.reservation.checkOut;

  /* -- 2 · Available free time ------------------------------------------ */
  const dayStart = clockToMinutes(TIME.dayStart);
  const dayEnd = clockToMinutes(TIME.dayEnd);
  const from = isToday ? Math.max(dayStart, now + TIME.leadTimeMin) : dayStart;

  const freeWindows = withinStay
    ? calculateFreeWindows(input.commitments, { from, to: dayEnd })
    : [];

  const totalFreeMin = totalFreeMinutes(freeWindows);
  const longestWindowMin = freeWindows.reduce(
    (longest, window) => Math.max(longest, window.end - window.start),
    0,
  );

  /* -- 3 & 4 · Candidate pool: hotel first, then partners only ---------- */
  // This is the partner restriction in code: outside candidates are built from
  // `input.partners`, which the caller derived from HotelPartner rows. There
  // is no branch here that can reach the wider experience catalogue.
  const hotelCandidates: Candidate[] = input.hotelActivities.map((experience) =>
    candidateFromHotelActivity(experience),
  );
  const eventCandidates: Candidate[] = input.events.map((event) =>
    candidateFromEvent(event, input.hotel),
  );
  const partnerCandidates: Candidate[] = input.partners.map((entry) =>
    candidateFromPartner(entry.experience, entry.partner, input.hotel),
  );

  /* -- 5–8 · Hard rules -------------------------------------------------- */
  const engagement = computeEngagement(input.history);
  const eligibilityContext: EligibilityContext = {
    weekday: weekdayOf(input.date),
    nowMinutes: now,
    isToday,
    history: input.history,
    recentlyCompletedIds: recentlyCompleted(input.history),
    dislikedIds: dislikedActivities(input.history),
    longestWindowMin,
    eventsById: new Map(input.events.map((event) => [event.id, event])),
    range: input.preferences.range,
    visitedAttractionIds: input.visitedAttractionIds ?? new Set(),
    weather: input.weather,
  };

  const screenedHotel = screenCandidates([...hotelCandidates, ...eventCandidates], eligibilityContext);
  const screenedPartner = screenCandidates(partnerCandidates, eligibilityContext);

  /*
   * Discovery gets a slightly wider net.
   *
   * The guest's range is a hard rule for everything they asked for. A wildcard
   * is by definition not something they asked for, and the one concession it
   * gets is a little more distance — granted by screening it against a widened
   * range rather than by skipping the rule, so every other check still applies.
   */
  const screenedDiscovery = screenCandidates(partnerCandidates, {
    ...eligibilityContext,
    range: {
      ...input.preferences.range,
      maxKm: input.preferences.range.maxKm + EXPLORATION.rangeSlackKm,
    },
  });

  const allowedHotel = eligible(screenedHotel);
  const allowedPartner = eligible(screenedPartner);
  const allowedDiscovery = eligible(screenedDiscovery);

  /* -- 12 · How much day is realistic ------------------------------------ */
  const averageTaskMin = estimateAverageTaskMinutes([...allowedHotel, ...allowedPartner]);
  const taskBudget = determineTaskCount(engagement.score, totalFreeMin, {
    averageTaskMin,
    // 31 · Yesterday nudges today, by one step at most.
    momentum: computeMomentum(input.history),
  });
  const maxTasks = Math.min(taskBudget.max, MAX_TASKS_PER_DAY);

  /* -- 9–13 · Scoring and selection -------------------------------------- */
  const scoringContext: ScoringContext = {
    preferences: input.preferences,
    engagement: engagement.state,
    affinity: affinityByCategory(input.history),
    fatigue: categoryFatigue(input.history),
    usedCategories: new Set(),
    longestWindowMin,
    totalFreeMin,
    weather: input.weather,
  };

  const scheduled: ScheduledCandidate[] = [];
  const occupied: { start: number; end: number }[] = [];
  const reasons = new Map<string, string>();
  let wildcardId: string | null = null;
  let hotelActivityScheduled = false;

  /**
   * Places one candidate, if a real slot exists for it. Returns false when it
   * does not fit — which is a normal outcome, not a failure.
   */
  function place(candidate: Candidate, reason: string, isWildcard = false): boolean {
    if (scheduled.length >= maxTasks) return false;

    const travel = travelMinutes(candidate.distanceM);
    const slot = findSlot(freeWindows, occupied, {
      durationMin: candidate.durationMin,
      travelMin: travel,
      openIntervals: openIntervalsFor(candidate, eligibilityContext.weekday),
      fixedStart: candidate.fixedStart ? clockToMinutes(candidate.fixedStart) : undefined,
    });
    if (!slot) return false;

    scheduled.push({ candidate, start: slot.start, end: slot.end, travelMin: travel });
    occupied.push({ start: slot.start - travel, end: slot.end });
    scoringContext.usedCategories.add(candidate.category);
    reasons.set(candidate.id, reason);
    if (isWildcard) wildcardId = candidate.id;
    if (candidate.onProperty) hotelActivityScheduled = true;
    return true;
  }

  /* -- 3 · The hotel activity requirement, taken first ------------------- */
  // Taken before partner activities so the business rule is satisfied by
  // construction rather than by hoping the scores work out. Events are
  // considered alongside activities because both serve the same purpose.
  const hotelRanked = scoreAll(allowedHotel, scoringContext);
  for (const entry of hotelRanked) {
    if (place(entry.candidate, explainChoice(entry, scoringContext))) break;
  }

  /* -- Fill the rest from the partner network ---------------------------- */
  // Re-scored each round: `usedCategories` has changed, so variety is
  // genuinely applied rather than computed once against an empty plan.
  while (scheduled.length < maxTasks) {
    const remaining = allowedPartner.filter(
      (candidate) => !scheduled.some((entry) => entry.candidate.id === candidate.id),
    );
    if (remaining.length === 0) break;

    const ranked = scoreAll(remaining, scoringContext);
    const placed = ranked.some((entry) =>
      place(entry.candidate, explainChoice(entry, scoringContext)),
    );
    if (!placed) break;
  }

  /* -- 14 · Exploration -------------------------------------------------- */
  /*
   * One deliberate step outside the pattern.
   *
   * The chance is derived from the configured *share* rather than set
   * directly, so "roughly a quarter of what we offer should be discovery"
   * stays true whether the day holds two tasks or five.
   */
  const share = input.preferences.surpriseMe
    ? EXPLORATION.discoveryShareSurpriseMe
    : input.preferences.explicit
      ? EXPLORATION.discoveryShare
      : EXPLORATION.discoveryShareWithoutPreferences;

  if (scheduled.length < maxTasks && random() < wildcardChance(maxTasks, share)) {
    const chosen = pickWildcard(allowedDiscovery, scheduled, scoringContext, random);
    if (chosen) place(chosen, explainWildcard(input.preferences), true);
  }

  /* -- Final validation -------------------------------------------------- */
  const commitmentBlocks = input.commitments.map((commitment) => ({
    start: clockToMinutes(commitment.startTime),
    end: clockToMinutes(commitment.endTime),
  }));

  const { valid, violations } = validateSchedule(scheduled, {
    windows: freeWindows,
    commitments: commitmentBlocks,
    maxTasks,
    bufferMin: TIME.bufferMin,
  });

  /* -- Materialise --------------------------------------------------- */
  const planId = makeId("plan");
  const tasks = valid
    .sort((a, b) => a.start - b.start)
    .map((entry) =>
      toTask(entry, {
        planId,
        guestId: input.guestId,
        hotelId: input.hotel.id,
        reason: reasons.get(entry.candidate.id) ?? "Fits your day.",
        isWildcard: entry.candidate.id === wildcardId,
      }),
    );

  const hotelOptionExisted = allowedHotel.length > 0;

  const plan: DailyPlan = {
    id: planId,
    guestId: input.guestId,
    hotelId: input.hotel.id,
    date: input.date,
    tasks,
    summary: planHeadline(engagement.state, tasks.length),
    engagement: engagement.state,
    activityScore: engagement.score,
    aiAssisted: false,
    // 55 · Only claim a hotel activity was omitted when one was genuinely
    // available and simply did not fit. No hotel options at all is a
    // different, quieter state.
    hotelActivityOmitted: hotelOptionExisted && !hotelActivityScheduled,
    reward: input.hotel.dailyReward,
    rewardUnlocked: false,
    generatedAt: nowIso(),
  };

  return {
    plan,
    diagnostics: {
      freeWindows,
      totalFreeMin,
      activityScore: engagement.score,
      taskBudget,
      candidatesConsidered:
        hotelCandidates.length + eventCandidates.length + partnerCandidates.length,
      eligibleCount: allowedHotel.length + allowedPartner.length,
      rejections: mergeCounts(rejectionSummary(screenedHotel), rejectionSummary(screenedPartner)),
      scheduleViolations: violations,
      hotelActivityOmitted: plan.hotelActivityOmitted,
      noPartners: input.partners.length === 0,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------ */

function openIntervalsFor(candidate: Candidate, weekday: number): { start: number; end: number }[] {
  if (candidate.kind === "event") {
    // An event's own window is its opening hours.
    const start = clockToMinutes(candidate.fixedStart ?? "00:00");
    return [{ start, end: start + candidate.durationMin }];
  }
  if (candidate.openingHours.length === 0) return [{ start: 0, end: 24 * 60 }];
  return candidate.openingHours
    .filter((interval) => interval.weekday === weekday)
    .map((interval) => {
      const start = clockToMinutes(interval.opens);
      let end = clockToMinutes(interval.closes);
      if (end <= start) end = 24 * 60;
      return { start, end };
    });
}

/** Typical cost of a task, so the budget maths reflects the actual catalogue. */
function estimateAverageTaskMinutes(candidates: Candidate[]): number {
  if (candidates.length === 0) return 95;
  const total = candidates.reduce(
    (sum, candidate) =>
      sum + candidate.durationMin + travelMinutes(candidate.distanceM) * 2 + TIME.bufferMin,
    0,
  );
  return Math.max(45, Math.round(total / candidates.length));
}

/**
 * Chooses the exploration pick.
 *
 * Deliberately *not* the highest scorer — that would just be another
 * recommendation. It is drawn from candidates in categories the plan has not
 * used, which still clear every hard rule and still score respectably, so a
 * wildcard is a surprise rather than a downgrade.
 */
function pickWildcard(
  candidates: Candidate[],
  scheduled: ScheduledCandidate[],
  context: ScoringContext,
  random: () => number,
): Candidate | null {
  const takenIds = new Set(scheduled.map((entry) => entry.candidate.id));
  const ranked = scoreAll(
    candidates.filter((candidate) => !takenIds.has(candidate.id)),
    context,
  );
  if (ranked.length === 0) return null;

  const best = ranked[0].score;
  const offPattern = ranked.filter(
    (entry) =>
      !context.usedCategories.has(entry.candidate.category) &&
      entry.score >= best * EXPLORATION.minimumQualityRatio,
  );

  // Skip the obvious first choice; the point is the road not taken.
  const pool = offPattern.length > 1 ? offPattern.slice(1) : offPattern;
  if (pool.length === 0) return null;

  return pool[Math.floor(random() * pool.length)].candidate;
}

function toTask(
  entry: ScheduledCandidate,
  meta: { planId: string; guestId: string; hotelId: string; reason: string; isWildcard: boolean },
): Task {
  const { candidate } = entry;
  const stamp = nowIso();

  return {
    id: makeId("task", candidate.name),
    planId: meta.planId,
    guestId: meta.guestId,
    hotelId: meta.hotelId,
    activityId: candidate.id,
    activityKind: candidate.kind,
    activityType: candidate.activityType,
    category: candidate.category,
    title: candidate.name,
    shortDescription: candidate.sourceDescription,
    reason: meta.reason,
    startTime: minutesToClock(entry.start),
    endTime: minutesToClock(entry.end),
    durationMin: candidate.durationMin,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    distanceM: candidate.onProperty ? null : candidate.distanceM,
    travelMin: entry.travelMin,
    state: "AVAILABLE",
    isWildcard: meta.isWildcard,
    requiresBooking: candidate.requiresBooking,
    verification: candidate.onProperty ? "hotel_qr" : "partner_qr",
    // Every task counts toward the day's reward; the hotel one is flagged so
    // the UI can explain why it is always there.
    required: candidate.activityType === "HOTEL_ACTIVITY",
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function mergeCounts(
  a: Map<RejectionReason, number>,
  b: Map<RejectionReason, number>,
): Map<RejectionReason, number> {
  const merged = new Map(a);
  for (const [reason, count] of b) merged.set(reason, (merged.get(reason) ?? 0) + count);
  return merged;
}

/** Durations, exported for tests that build synthetic experiences. */
export { durationOf };
