/**
 * Layer 3 — the AI seam.
 *
 * AI is an enhancement, never a dependency. Every method here has a
 * deterministic answer already computed by the time it is called, so a
 * timeout, a malformed response or an unreachable provider costs the guest
 * nothing but slightly plainer wording.
 *
 * The model never sees the whole catalogue and never returns an activity: it
 * is handed a shortlist the rule engine has already approved and may only
 * reorder it and rewrite its copy. Anything it says about an id it was not
 * given is discarded by `applyRanking` before it can reach a guest.
 *
 * Keys live on the server. The browser talks to `/api/ai/*`, which is the only
 * thing that holds a provider credential.
 */

import type { Candidate } from "../engine/candidates";
import type { EngagementState, GuestPreferences, Hotel, Reservation } from "../data/domain";

/* ------------------------------------------------------------------------ */
/* Contracts                                                                 */
/* ------------------------------------------------------------------------ */

/** One shortlisted item, as the model sees it. */
export interface RankingCandidate {
  activityId: string;
  name: string;
  description: string;
  category: string;
  activityType: string;
  durationMin: number;
  startTime: string;
  endTime: string;
  distanceM: number | null;
  onProperty: boolean;
  /** The deterministic reason. The model may rephrase it, not contradict it. */
  groundedReason: string;
  isWildcard: boolean;
}

export interface RankingContext {
  hotel: Pick<Hotel, "name" | "city">;
  guest: {
    firstName?: string;
    interests: string[];
    energyLevel: string;
    budget: string;
    /** Internal band, so the model can set tone. Never rendered as a number. */
    engagement: EngagementState;
  };
  reservation: Pick<Reservation, "checkIn" | "checkOut" | "nights">;
  date: string;
  freeWindows: string[];
  recentActivities: string[];
  weather?: { condition: string; temperatureC?: number };
}

/** What a provider must return. Anything else is treated as a failure. */
export interface RankedTask {
  activityId: string;
  title: string;
  shortDescription: string;
  reason: string;
  order: number;
}

export interface RankingResult {
  tasks: RankedTask[];
  summary: string;
}

export interface AIProvider {
  readonly name: string;
  /** True when the provider is configured and reachable in principle. */
  isAvailable(): Promise<boolean>;
  generateRecommendationRanking(
    candidates: RankingCandidate[],
    context: RankingContext,
    signal?: AbortSignal,
  ): Promise<RankingResult>;
  /** Extracts structured reservation data from an uploaded document. */
  parseReservation(
    text: string,
    signal?: AbortSignal,
  ): Promise<Record<string, string | number | undefined>>;
}

/* ------------------------------------------------------------------------ */
/* HTTP provider                                                             */
/* ------------------------------------------------------------------------ */

/** How long the guest waits for cleverer wording before getting the plain one. */
const AI_TIMEOUT_MS = 6000;

/**
 * Talks to this application's own serverless functions.
 *
 * The browser never holds a provider key, never chooses a model, and never
 * sees a provider-shaped error — `/api/ai/rank` normalises all of that. If the
 * endpoint is not deployed (a purely static build), `isAvailable` returns
 * false once and the product runs on the rules engine alone.
 */
class HttpAIProvider implements AIProvider {
  readonly name = "http";
  private availability: Promise<boolean> | null = null;

  async isAvailable(): Promise<boolean> {
    if (this.availability) return this.availability;

    this.availability = (async () => {
      try {
        const response = await fetch("/api/ai/status", {
          method: "GET",
          signal: AbortSignal.timeout(2500),
        });
        if (!response.ok) return false;
        const body = (await response.json()) as { configured?: boolean };
        return body.configured === true;
      } catch {
        return false;
      }
    })();

    return this.availability;
  }

  async generateRecommendationRanking(
    candidates: RankingCandidate[],
    context: RankingContext,
    signal?: AbortSignal,
  ): Promise<RankingResult> {
    const response = await fetch("/api/ai/rank", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidates, context }),
      signal: signal ?? AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`AI ranking failed: ${response.status}`);
    return parseRankingResponse(await response.json());
  }

  async parseReservation(
    text: string,
    signal?: AbortSignal,
  ): Promise<Record<string, string | number | undefined>> {
    const response = await fetch("/api/ai/parse-reservation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: signal ?? AbortSignal.timeout(AI_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`Reservation parse failed: ${response.status}`);
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, string | number>) : {};
  }
}

/* ------------------------------------------------------------------------ */
/* Response validation                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Turns whatever came back into a `RankingResult`, or throws.
 *
 * Strict on shape, tolerant on extras: a provider that adds a field is fine, a
 * provider that returns prose instead of JSON is not. Copy is length-capped
 * here rather than in CSS, because a model that ignores "keep it short" should
 * not be able to break the card layout.
 */
export function parseRankingResponse(body: unknown): RankingResult {
  if (!body || typeof body !== "object") throw new Error("AI returned a non-object");

  const record = body as { tasks?: unknown; summary?: unknown };
  if (!Array.isArray(record.tasks)) throw new Error("AI returned no task array");

  const tasks: RankedTask[] = [];
  for (const [index, raw] of record.tasks.entries()) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;

    const activityId = typeof entry.activityId === "string" ? entry.activityId : null;
    if (!activityId) continue;

    tasks.push({
      activityId,
      title: cap(entry.title, 60),
      shortDescription: cap(entry.shortDescription, 160),
      reason: cap(entry.reason, 90),
      order: typeof entry.order === "number" ? entry.order : index,
    });
  }

  if (tasks.length === 0) throw new Error("AI returned no usable tasks");

  return { tasks, summary: cap(record.summary, 80) };
}

function cap(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/* ------------------------------------------------------------------------ */
/* Null provider                                                             */
/* ------------------------------------------------------------------------ */

/** Used in tests and whenever no endpoint is configured. */
export const nullProvider: AIProvider = {
  name: "none",
  isAvailable: async () => false,
  generateRecommendationRanking: async () => {
    throw new Error("No AI provider configured");
  },
  parseReservation: async () => ({}),
};

/** The provider the application uses. One line to swap. */
export const aiProvider: AIProvider = new HttpAIProvider();

/* ------------------------------------------------------------------------ */
/* Prompt input                                                              */
/* ------------------------------------------------------------------------ */

/** Projects a scheduled candidate into the narrow shape the model receives. */
export function toRankingCandidate(
  candidate: Candidate,
  scheduled: { startTime: string; endTime: string; reason: string; isWildcard: boolean },
): RankingCandidate {
  return {
    activityId: candidate.id,
    name: candidate.name,
    description: candidate.sourceDescription,
    category: candidate.category,
    activityType: candidate.activityType,
    durationMin: candidate.durationMin,
    startTime: scheduled.startTime,
    endTime: scheduled.endTime,
    distanceM: candidate.onProperty ? null : candidate.distanceM,
    onProperty: candidate.onProperty,
    groundedReason: scheduled.reason,
    isWildcard: scheduled.isWildcard,
  };
}

export function buildRankingContext(input: {
  hotel: Hotel;
  reservation: Reservation;
  preferences: GuestPreferences;
  engagement: EngagementState;
  date: string;
  freeWindows: string[];
  recentActivities: string[];
  weather?: { condition: string; temperatureC?: number };
}): RankingContext {
  return {
    hotel: { name: input.hotel.name, city: input.hotel.city },
    guest: {
      firstName: input.reservation.guestName.split(" ")[0],
      interests: input.preferences.interests,
      energyLevel: input.preferences.energyLevel,
      budget: input.preferences.budget,
      engagement: input.engagement,
    },
    reservation: {
      checkIn: input.reservation.checkIn,
      checkOut: input.reservation.checkOut,
      nights: input.reservation.nights,
    },
    date: input.date,
    freeWindows: input.freeWindows,
    recentActivities: input.recentActivities,
    weather: input.weather,
  };
}
