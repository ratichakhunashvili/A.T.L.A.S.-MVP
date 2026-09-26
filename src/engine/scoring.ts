/**
 * Layer 2 — the scoring engine.
 *
 * Decides what makes *sense* among the things the rules allow. Every factor
 * returns 0–1, is multiplied by a weight from `config.ts`, and is kept on the
 * result so a suggestion can be explained without re-deriving it.
 *
 * This layer is deterministic and total: given the same guest and the same
 * candidates it always produces the same order. That is what lets the product
 * survive the AI being unavailable — the fallback is not a degraded mode, it
 * is this, unranked by anything cleverer.
 */

import { BUDGET_FIT, ENERGY_FIT, SCORING } from "./config";
import { fatigueMultiplier } from "./rules";
import { travelMinutes } from "./time";
import type { Candidate } from "./candidates";
import type {
  BudgetBand,
  EngagementState,
  GuestPreferences,
  Interest,
} from "../data/domain";
import type { PlaceCategory } from "../data/types";
import type { WeatherContext } from "./rules";

export interface ScoringContext {
  preferences: GuestPreferences;
  engagement: EngagementState;
  /** Decayed per-category affinity from the behaviour log. */
  affinity: Map<PlaceCategory, number>;
  /** Categories the guest keeps skipping. */
  fatigue: Map<PlaceCategory, number>;
  /** Categories already used by earlier picks in this plan. */
  usedCategories: Set<PlaceCategory>;
  /** Longest free window, for the time-fit factor. */
  longestWindowMin: number;
  /** Total free minutes in the day. */
  totalFreeMin: number;
  weather?: WeatherContext;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
  factors: Record<string, number>;
  /** The single strongest reason, for the fallback explanation copy. */
  topFactor: string;
}

/** Which interests each map category tends to satisfy. */
const CATEGORY_INTERESTS: Record<PlaceCategory, Interest[]> = {
  hotel: ["relaxation"],
  restaurant: ["food"],
  experience: ["culture", "food"],
  museum: ["culture", "sightseeing"],
  landmark: ["sightseeing", "culture"],
  nature: ["nature", "relaxation"],
  adventure: ["adventure", "sports"],
  entertainment: ["events", "nightlife"],
  event: ["events", "culture"],
};

/**
 * Scores one candidate.
 *
 * `usedCategories` is read here rather than applied afterwards, which is why
 * scoring happens inside the selection loop: variety is a property of the plan
 * being built, not of the candidate on its own.
 */
export function scoreCandidate(candidate: Candidate, context: ScoringContext): ScoredCandidate {
  const factors: Record<string, number> = {};

  factors.preferenceMatch = preferenceMatch(candidate, context.preferences);
  factors.timeFit = timeFit(candidate, context);
  factors.distanceEfficiency = distanceEfficiency(candidate, context);
  factors.novelty = novelty(candidate, context);
  factors.recentInterest = recentInterest(candidate, context);
  factors.energyFit = ENERGY_FIT[context.preferences.energyLevel][candidate.effort];
  factors.budgetFit = budgetFit(candidate.budget, context.preferences.budget);
  factors.hotelPriority = candidate.onProperty ? 1 : 0;
  factors.partnerPriority = candidate.onProperty ? 0 : candidate.partnerPriority / 100;
  factors.variety = context.usedCategories.has(candidate.category) ? 0 : 1;
  factors.weather = weatherFit(candidate, context.weather);

  let score = 0;
  for (const [name, value] of Object.entries(factors)) {
    const weight = SCORING.weights[name as keyof typeof SCORING.weights] ?? 0;
    score += value * weight;
  }

  // 17 · The hotel's own offering gets a bounded lift, not a free pass.
  if (candidate.activityType === "HOTEL_ACTIVITY") score += SCORING.hotelActivityBonus;
  if (candidate.activityType === "HOTEL_EVENT") score += SCORING.hotelEventBonus;
  if (candidate.featured) score += SCORING.featuredPartnerBonus;

  // 22 · Repeated skips turn a category down.
  score *= fatigueMultiplier(candidate.category, context.fatigue);

  // 23 · A resting guest is offered less demanding things, gently.
  if (context.engagement === "RESTING") {
    const easiness = candidate.effort === "low" ? 1.15 : candidate.effort === "medium" ? 1 : 0.7;
    const closeness = candidate.distanceM <= 900 ? 1.1 : 1;
    score *= easiness * closeness;
  }

  const topFactor = Object.entries(factors)
    .map(([name, value]) => ({
      name,
      contribution: value * (SCORING.weights[name as keyof typeof SCORING.weights] ?? 0),
    }))
    .sort((a, b) => b.contribution - a.contribution)[0]?.name ?? "preferenceMatch";

  return { candidate, score, factors, topFactor };
}

export function scoreAll(candidates: Candidate[], context: ScoringContext): ScoredCandidate[] {
  return candidates
    .map((candidate) => scoreCandidate(candidate, context))
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------------ */
/* Factors                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * How well this matches what the guest said they wanted.
 *
 * A guest who declared nothing scores a flat 0.6 everywhere — neutral, so the
 * other factors decide, rather than 0, which would make every option look
 * equally wrong.
 */
function preferenceMatch(candidate: Candidate, preferences: GuestPreferences): number {
  if (preferences.interests.length === 0) return 0.6;

  const candidateInterests = new Set<Interest>([
    ...candidate.interests,
    ...CATEGORY_INTERESTS[candidate.category],
  ]);

  const hits = preferences.interests.filter((interest) => candidateInterests.has(interest)).length;
  if (hits === 0) return 0.12;

  // One solid match is most of the value; more is better but with diminishing
  // returns, so a broadly-tagged experience cannot dominate a specific one.
  return Math.min(1, 0.55 + 0.22 * hits);
}

/**
 * How comfortably it fits the time available.
 *
 * Peaks where the activity uses a healthy share of the longest window without
 * consuming it. Something that exactly fills the day scores lower than
 * something that leaves room, because a plan of one thing is rarely the best
 * use of six free hours.
 */
function timeFit(candidate: Candidate, context: ScoringContext): number {
  if (context.longestWindowMin <= 0) return 0;

  const total = candidate.durationMin + travelMinutes(candidate.distanceM) * 2;
  const share = total / context.longestWindowMin;

  if (share > 1) return 0;
  if (share <= 0.15) return 0.55; // Very short: fine, but not a centrepiece.
  if (share <= 0.65) return 1;
  return Math.max(0.3, 1 - (share - 0.65) * 1.6);
}

/** Closer is better, with on-property best of all. */
function distanceEfficiency(candidate: Candidate, context: ScoringContext): number {
  if (candidate.onProperty) return 1;

  const travel = travelMinutes(candidate.distanceM);
  // Travel worth more than a third of the whole free day is poor value.
  const budget = Math.max(20, context.totalFreeMin / 3);
  return Math.max(0, 1 - (travel * 2) / budget);
}

/** Something the guest has not done. The engine's appetite for new things. */
function novelty(candidate: Candidate, context: ScoringContext): number {
  const affinity = context.affinity.get(candidate.category) ?? 0;
  if (affinity <= 0) return 1;
  return Math.max(0.2, 1 - Math.min(1, affinity / 3) * 0.8);
}

/** The opposite pull: what they have actually enjoyed lately. */
function recentInterest(candidate: Candidate, context: ScoringContext): number {
  const affinity = context.affinity.get(candidate.category) ?? 0;
  if (affinity === 0) return 0.5;
  return Math.max(0, Math.min(1, 0.5 + affinity / 4));
}

function budgetFit(candidate: BudgetBand, guest: BudgetBand): number {
  return BUDGET_FIT[guest][candidate];
}

/**
 * Weather as a soft factor.
 *
 * The hard cases (storms, heavy rain, extreme heat) were already removed by
 * the rules. What is left is preference: a bright day makes outdoors better, a
 * grey one makes indoors better, and neither is decisive.
 */
function weatherFit(candidate: Candidate, weather?: WeatherContext): number {
  if (!weather) return 0.5;

  const wet = (weather.precipitationChance ?? 0) > 0.35 || weather.condition === "rain";
  const bright = weather.condition === "clear";

  if (candidate.indoor) return wet ? 1 : bright ? 0.35 : 0.6;
  return wet ? 0.2 : bright ? 1 : 0.6;
}

/* ------------------------------------------------------------------------ */
/* Explanations                                                              */
/* ------------------------------------------------------------------------ */

/**
 * The deterministic reason line.
 *
 * Used verbatim when AI is unavailable, and as the grounding fact when it is —
 * so the guest sees a true statement either way. These never claim anything
 * the system does not know: no "other guests loved this", no invented
 * popularity.
 */
export function explainChoice(scored: ScoredCandidate, context: ScoringContext): string {
  const { candidate, topFactor } = scored;

  if (candidate.activityType === "HOTEL_EVENT") return "On at your hotel today.";
  if (candidate.activityType === "HOTEL_ACTIVITY") return "Right here at your hotel.";

  switch (topFactor) {
    case "preferenceMatch": {
      const matched = context.preferences.interests.find((interest) =>
        new Set([...candidate.interests, ...CATEGORY_INTERESTS[candidate.category]]).has(interest),
      );
      return matched ? `Matches your interest in ${matched}.` : "Close to what you like.";
    }
    case "distanceEfficiency":
      return candidate.distanceM <= 700 ? "You're close by." : "An easy hop from the hotel.";
    case "timeFit":
      return "Fits the time you have free.";
    case "novelty":
      return "You haven't tried this kind of thing yet.";
    case "recentInterest":
      return "More of what you've been enjoying.";
    case "budgetFit":
      return "In your budget.";
    case "energyFit":
      return context.preferences.energyLevel === "chill"
        ? "Easy going, like you asked for."
        : "Suits the pace you wanted.";
    case "weather":
      return candidate.indoor ? "Indoors, given the forecast." : "Good weather for it.";
    case "partnerPriority":
      return "A partner your hotel rates highly.";
    default:
      return "Fits your day.";
  }
}

/** The line a wildcard carries. Honest about being a step sideways. */
export function explainWildcard(preferences: GuestPreferences): string {
  if (preferences.interests.length === 0) return "Something different to try.";
  const [first, second] = preferences.interests;
  const liked = second ? `${first} and ${second}` : first;
  return `You usually go for ${liked} — this one's a little different.`;
}
