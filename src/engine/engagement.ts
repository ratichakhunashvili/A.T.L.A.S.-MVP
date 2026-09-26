/**
 * The engagement score.
 *
 * A 0–100 internal signal describing how much this guest has been doing
 * lately. It is a *recommendation input*, never a grade: nothing in the UI
 * renders the number, nothing tells a guest it went down, and a low score
 * makes the day gentler rather than emptier.
 *
 * Four weighted factors, all time-decayed so that yesterday matters far more
 * than four days ago:
 *
 *   completion (40%)  did they actually finish what was suggested
 *   consistency (25%)  do they do something most days, or once in a burst
 *   difficulty (20%)   how demanding the things they finish are
 *   variety (15%)      how many different kinds of thing they try
 */

import {
  ENGAGEMENT,
  ENGAGEMENT_BANDS,
  MAX_TASKS_PER_DAY,
  MOMENTUM,
  TASK_TARGETS,
} from "./config";
import type { EngagementState, Effort, UserActivityEvent } from "../data/domain";

/** Exponential decay on the configured half-life. */
export function decayFactor(timestamp: string, now: number, halfLifeDays = ENGAGEMENT.halfLifeDays): number {
  const ageDays = (now - Date.parse(timestamp)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays < 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

const EFFORT_VALUE: Record<Effort, number> = { low: 0.35, medium: 0.7, high: 1 };

export interface EngagementResult {
  /** 0–100. */
  score: number;
  state: EngagementState;
  /** Per-factor contributions, for the admin's analytics view and for tests. */
  factors: {
    completion: number;
    consistency: number;
    difficulty: number;
    variety: number;
  };
  /** How many completions fed the score. Zero means "no signal yet". */
  sampleSize: number;
}

/**
 * Computes the score from the behaviour log.
 *
 * A guest with no history is not scored at zero — that would read as "does
 * nothing" and would immediately throttle their first day. They start at the
 * configured baseline, which puts them in the middle band until they show the
 * system something.
 */
export function computeEngagement(
  history: UserActivityEvent[],
  options: { now?: number; effortOf?: (activityId: string) => Effort } = {},
): EngagementResult {
  const now = options.now ?? Date.now();
  const cutoff = now - ENGAGEMENT.windowDays * 86_400_000;

  const recent = history.filter((event) => Date.parse(event.timestamp) >= cutoff);
  const completions = recent.filter(
    (event) => event.eventType === "completed" || event.eventType === "verified",
  );

  if (completions.length === 0) {
    // No evidence either way. Start neutral rather than punishing a new guest
    // — or one who has simply been resting.
    const hasAnySignal = recent.length > 0;
    const score = hasAnySignal ? Math.round(ENGAGEMENT.baselineScore * 0.7) : ENGAGEMENT.baselineScore;
    return {
      score,
      state: stateForScore(score),
      factors: { completion: 0, consistency: 0, difficulty: 0, variety: 0 },
      sampleSize: 0,
    };
  }

  /* -- Completion: weighted completions against a realistic daily rate ---- */
  const weightedCompletions = completions.reduce(
    (sum, event) => sum + decayFactor(event.timestamp, now),
    0,
  );
  // The decayed sum of a guest doing `saturationPerDay` every day converges on
  // this, so the ratio is "how close to fully engaged", not an arbitrary cap.
  const saturation = ENGAGEMENT.saturationPerDay * (ENGAGEMENT.halfLifeDays / Math.LN2);
  const completion = clamp01(weightedCompletions / saturation);

  /* -- Consistency: how many of the recent days saw something happen ------ */
  const activeDays = new Set(completions.map((event) => event.timestamp.slice(0, 10)));
  const observedDays = Math.max(
    1,
    Math.min(
      ENGAGEMENT.windowDays,
      Math.ceil((now - Date.parse(oldestTimestamp(recent))) / 86_400_000) || 1,
    ),
  );
  const consistency = clamp01(activeDays.size / observedDays);

  /* -- Difficulty: how demanding the finished activities were ------------- */
  let difficultyWeighted = 0;
  let difficultyWeight = 0;
  for (const event of completions) {
    const weight = decayFactor(event.timestamp, now);
    const effort = options.effortOf?.(event.activityId) ?? inferEffort(event);
    difficultyWeighted += EFFORT_VALUE[effort] * weight;
    difficultyWeight += weight;
  }
  const difficulty = difficultyWeight === 0 ? 0 : clamp01(difficultyWeighted / difficultyWeight);

  /* -- Variety: how many different categories, against a sensible spread -- */
  const categories = new Set(completions.map((event) => event.category));
  const variety = clamp01(categories.size / 4);

  const score = Math.round(
    100 *
      (completion * ENGAGEMENT.weights.completion +
        consistency * ENGAGEMENT.weights.consistency +
        difficulty * ENGAGEMENT.weights.difficulty +
        variety * ENGAGEMENT.weights.variety),
  );

  return {
    score: Math.max(0, Math.min(100, score)),
    state: stateForScore(score),
    factors: { completion, consistency, difficulty, variety },
    sampleSize: completions.length,
  };
}

function oldestTimestamp(events: UserActivityEvent[]): string {
  return events.reduce(
    (oldest, event) => (Date.parse(event.timestamp) < Date.parse(oldest) ? event.timestamp : oldest),
    events[0]?.timestamp ?? new Date().toISOString(),
  );
}

/** Without a catalogue lookup, duration is a reasonable proxy for effort. */
function inferEffort(event: UserActivityEvent): Effort {
  const minutes = event.durationMin ?? 60;
  if (minutes >= 150) return "high";
  if (minutes >= 60) return "medium";
  return "low";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function stateForScore(score: number): EngagementState {
  return ENGAGEMENT_BANDS.find((band) => score <= band.max)?.state ?? "ENGAGED";
}

/* ------------------------------------------------------------------------ */
/* Task count                                                               */
/* ------------------------------------------------------------------------ */

export interface TaskBudget {
  /** What the score alone suggests. */
  target: number;
  /** The floor the engine tries not to go under when options exist. */
  min: number;
  /** The ceiling after free time has had its say. */
  max: number;
  /** Plain-language note on what limited the day, for logs and tests. */
  limitedBy: "score" | "free_time" | "daily_maximum" | "momentum";
}

/**
 * How many tasks today can realistically hold.
 *
 * The score proposes; available time disposes. A highly engaged guest with one
 * free hour gets one task, because the alternative is a plan that cannot
 * happen — and a plan that cannot happen is worse than a short one.
 */
export function determineTaskCount(
  score: number,
  freeMinutes: number,
  options: { averageTaskMin?: number; momentum?: number } = {},
): TaskBudget {
  const band = TASK_TARGETS.find((entry) => score <= entry.max) ?? TASK_TARGETS[TASK_TARGETS.length - 1];

  /*
   * The short-term nudge.
   *
   * A guest who cleared yesterday gets one more today; one who cleared almost
   * none gets one fewer. Bounded to a single step so the day never lurches —
   * going from two tasks to eight because someone had a good Tuesday is how a
   * recommendation system loses a guest's trust.
   */
  const nudged = Math.max(1, band.target + (options.momentum ?? 0));

  // Each task costs its own time plus getting there and a breather after.
  const perTask = options.averageTaskMin ?? 95;
  const affordable = Math.max(0, Math.floor(freeMinutes / perTask));

  let max = Math.min(nudged, MAX_TASKS_PER_DAY);
  let limitedBy: TaskBudget["limitedBy"] = "score";

  if (affordable < max) {
    max = affordable;
    limitedBy = "free_time";
  } else if (nudged >= MAX_TASKS_PER_DAY) {
    limitedBy = "daily_maximum";
  } else if ((options.momentum ?? 0) !== 0) {
    limitedBy = "momentum";
  }

  return {
    target: nudged,
    min: Math.min(band.min, max),
    max,
    limitedBy,
  };
}

/**
 * How much the last few days should move today's target.
 *
 * Reads the behaviour log directly: what was suggested against what was
 * finished, over a short window. Days with nothing suggested are skipped —
 * a guest who was not offered anything did not fail to do it.
 */
export function computeMomentum(history: UserActivityEvent[], now = Date.now()): number {
  const cutoff = now - MOMENTUM.lookbackDays * 86_400_000;
  const suggested = new Map<string, number>();
  const finished = new Map<string, number>();

  for (const event of history) {
    const at = Date.parse(event.timestamp);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const day = event.timestamp.slice(0, 10);

    if (event.eventType === "suggested") {
      suggested.set(day, (suggested.get(day) ?? 0) + 1);
    }
    if (event.eventType === "completed" || event.eventType === "verified") {
      finished.set(day, (finished.get(day) ?? 0) + 1);
    }
  }

  const ratios: number[] = [];
  for (const [day, offered] of suggested) {
    if (offered === 0) continue;
    ratios.push(Math.min(1, (finished.get(day) ?? 0) / offered));
  }

  // No evidence is not a reason to change anything.
  if (ratios.length === 0) return 0;

  const average = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  if (average >= MOMENTUM.growAbove) return MOMENTUM.maxStep;
  if (average <= MOMENTUM.shrinkBelow) return -MOMENTUM.maxStep;
  return 0;
}

/* ------------------------------------------------------------------------ */
/* Tone                                                                      */
/* ------------------------------------------------------------------------ */

/**
 * How the day should be framed.
 *
 * The rule the brief is emphatic about: never report the score, never imply
 * the guest has underperformed. A resting guest is offered something easy, and
 * that is the whole of the adaptation they ever see.
 */
export function planHeadline(state: EngagementState, taskCount: number): string {
  if (taskCount === 0) return "Nothing booked in";
  switch (state) {
    case "RESTING":
      return "Slow day? Something easy";
    case "CASUAL":
      return "A gentle day";
    case "HIGHLY_ACTIVE":
      return "Plenty ahead";
    default:
      return "Your day";
  }
}

/** Categories that suit a resting guest — short, close, low effort. */
export function prefersEasy(state: EngagementState): boolean {
  return state === "RESTING";
}
