/**
 * Every tunable number the recommendation engine uses.
 *
 * Business rules do not belong buried inside an AI prompt, and they do not
 * belong scattered through the scoring code either. They live here, named, so
 * that changing how much a hotel's priority counts is a one-line edit someone
 * can review — and so the engine's behaviour can be explained without reading
 * the engine.
 */

import type { BudgetBand, EnergyLevel, Effort, EngagementState } from "../data/domain";

/* ------------------------------------------------------------------------ */
/* Engagement score                                                          */
/* ------------------------------------------------------------------------ */

export const ENGAGEMENT = {
  /**
   * Contribution of each factor to the 0–100 score. These are the weights the
   * product brief specifies; they sum to 1.
   */
  weights: {
    completion: 0.4,
    consistency: 0.25,
    difficulty: 0.2,
    variety: 0.15,
  },

  /**
   * Half-life of a behaviour signal, in days.
   *
   * Two days means yesterday counts fully, the day before about 70%, three
   * days back about a third — the decay curve the brief describes, expressed
   * as one configurable constant rather than a hardcoded ladder.
   */
  halfLifeDays: 2,

  /** How far back the score looks at all. */
  windowDays: 7,

  /**
   * Completions per day that represent a fully engaged guest. Someone doing
   * two things a day is not "50% engaged" — this is the ceiling the
   * completion factor normalises against.
   */
  saturationPerDay: 2.5,

  /** A guest with no history yet starts here: interested, unproven. */
  baselineScore: 45,
} as const;

/** Score bands, and what each one means for how the day should feel. */
export const ENGAGEMENT_BANDS: { max: number; state: EngagementState }[] = [
  { max: 20, state: "RESTING" },
  { max: 45, state: "CASUAL" },
  { max: 75, state: "ENGAGED" },
  { max: 100, state: "HIGHLY_ACTIVE" },
];

/**
 * How many tasks a day each band suggests.
 *
 * Suggestions, not quotas: available free time overrides all of these, and the
 * engine only ever schedules what genuinely fits.
 */
export const TASK_TARGETS: { max: number; min: number; target: number }[] = [
  { max: 25, min: 1, target: 2 },
  { max: 50, min: 2, target: 3 },
  { max: 75, min: 3, target: 4 },
  { max: 100, min: 4, target: 5 },
];

/** Nothing generates more than this in a day, whatever the score says. */
export const MAX_TASKS_PER_DAY = 5;

/**
 * How the day reacts to yesterday.
 *
 * The score already moves with behaviour, but slowly — it is an average over a
 * week. This is the short-term nudge on top of it: finish everything and
 * tomorrow offers one more, miss most of it and tomorrow offers one fewer.
 * Bounded to ±1 so a day never doubles or collapses.
 */
export const MOMENTUM = {
  /** How many recent days are considered. */
  lookbackDays: 3,
  /** Completion ratio at or above which the day grows. */
  growAbove: 0.85,
  /** Completion ratio at or below which it shrinks. */
  shrinkBelow: 0.4,
  /** The most it can move in one step. */
  maxStep: 1,
} as const;

/* ------------------------------------------------------------------------ */
/* Time and travel                                                           */
/* ------------------------------------------------------------------------ */

export const TIME = {
  /** A window shorter than this cannot hold anything worth doing. */
  minimumWindowMin: 30,

  /** Breathing room left after an activity before the next commitment. */
  bufferMin: 15,

  /** Average walking speed, metres per minute. */
  walkMetresPerMin: 80,

  /** Beyond this, the engine assumes a taxi rather than a walk. */
  walkableMetres: 1600,

  /** Average city driving speed, metres per minute. */
  driveMetresPerMin: 350,

  /** Fixed overhead for finding and taking a taxi. */
  taxiOverheadMin: 8,

  /** Earliest a plan will schedule anything. */
  dayStart: "08:00",

  /** Latest a plan will schedule anything to finish. */
  dayEnd: "23:00",

  /** How far ahead of `now` the first task of today may start. */
  leadTimeMin: 20,
} as const;

/* ------------------------------------------------------------------------ */
/* Scoring weights                                                           */
/* ------------------------------------------------------------------------ */

/**
 * What makes one eligible activity a better suggestion than another.
 *
 * Every factor produces 0–1 and is multiplied by its weight here, so the
 * relative importance of "matches their interests" against "is close by" is
 * visible in one place and adjustable without touching the maths.
 */
export const SCORING = {
  weights: {
    preferenceMatch: 2.4,
    timeFit: 1.6,
    distanceEfficiency: 1.2,
    novelty: 1.0,
    recentInterest: 1.1,
    energyFit: 0.9,
    budgetFit: 0.9,
    hotelPriority: 1.4,
    partnerPriority: 0.8,
    variety: 0.7,
    weather: 0.6,
  },

  /**
   * Hotel-owned activities get a standing bonus.
   *
   * This is the business rule from the brief made explicit and bounded: it
   * lifts hotel options above equally-good partner ones, and it is small
   * enough that a genuinely better-matched partner experience still wins. It
   * is a thumb on the scale, not a thumb through the scale.
   */
  hotelActivityBonus: 0.9,

  /** Hotel events additionally help the guest engage with the property. */
  hotelEventBonus: 1.1,

  /** A featured partner sits above the hotel's other partners. */
  featuredPartnerBonus: 0.4,
} as const;

/* ------------------------------------------------------------------------ */
/* Exploration                                                               */
/* ------------------------------------------------------------------------ */

export const EXPLORATION = {
  /** At most one deliberately off-pattern suggestion per day. */
  maxWildcardsPerDay: 1,

  /**
   * What share of a day's tasks should be discovery rather than preference.
   *
   * Expressed as a share rather than as a per-day chance, because that is the
   * thing the product actually cares about: roughly a quarter of what a guest
   * is offered should be something they did not ask for. With a day of three
   * or four tasks that works out at one, and `wildcardChance` turns the share
   * into the probability of including it.
   */
  discoveryShare: 0.25,
  /** No stated interests means no pattern to respect, so explore harder. */
  discoveryShareWithoutPreferences: 0.4,
  /** The guest asked to be surprised. Their wish. */
  discoveryShareSurpriseMe: 0.5,

  /**
   * A wildcard has to be off-pattern but not bad: it must still clear every
   * hard rule and score at least this fraction of the best candidate.
   */
  minimumQualityRatio: 0.45,

  /**
   * How far past the guest's stated range a discovery pick may reach.
   *
   * Only a wildcard gets this, and only because "something you would not have
   * looked for" sometimes sits one street further than "things near me".
   */
  rangeSlackKm: 1.5,
} as const;

/**
 * The chance of spending a slot on discovery, given how many tasks the day
 * holds. Derived from the share so the two cannot drift apart.
 */
export function wildcardChance(taskCount: number, share: number): number {
  if (taskCount <= 0) return 0;
  return Math.min(1, taskCount * share);
}

/* ------------------------------------------------------------------------ */
/* Matching tables                                                           */
/* ------------------------------------------------------------------------ */

/** How well an activity's effort suits a guest's stated energy. 0–1. */
export const ENERGY_FIT: Record<EnergyLevel, Record<Effort, number>> = {
  chill: { low: 1, medium: 0.55, high: 0.15 },
  balanced: { low: 0.75, medium: 1, high: 0.7 },
  adventurous: { low: 0.45, medium: 0.85, high: 1 },
};

/**
 * How well a price bracket suits a stated budget.
 *
 * Note the asymmetry: something cheaper than the guest's budget is nearly
 * always fine, something more expensive is not. A "free" guest is not offered
 * a premium tasting; a "premium" guest is perfectly happy in a park.
 */
export const BUDGET_FIT: Record<BudgetBand, Record<BudgetBand, number>> = {
  free: { free: 1, moderate: 0.25, premium: 0 },
  moderate: { free: 0.85, moderate: 1, premium: 0.4 },
  premium: { free: 0.7, moderate: 0.95, premium: 1 },
};

/** Tone for the plan summary. Never a judgement, only a register. */
export const ENGAGEMENT_TONE: Record<EngagementState, string> = {
  RESTING: "Something easy",
  CASUAL: "A gentle day",
  ENGAGED: "Your day",
  HIGHLY_ACTIVE: "Plenty ahead",
};
