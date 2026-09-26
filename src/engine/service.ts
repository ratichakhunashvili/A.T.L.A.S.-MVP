/**
 * Plan generation, end to end.
 *
 * The one place that knows how to go from "a guest id and a date" to "a stored
 * plan". Components call `generatePlanForGuest` and get a plan; they do not
 * assemble engine inputs themselves, which is what keeps the partner
 * restriction impossible to bypass by accident — there is no other caller of
 * `generateDailyPlan` in the application.
 */

import { generateDailyPlan, type PlanDiagnostics } from "./plan";
import { enhancePlan } from "../ai/enhance";
import {
  candidateFromEvent,
  candidateFromHotelActivity,
  candidateFromPartner,
  type Candidate,
} from "./candidates";
import { nowMinutes, todayStamp } from "./time";
import type { WeatherContext } from "./rules";
import {
  eligiblePartnerExperiences,
  eventsOnDate,
  hotelActivities,
} from "../data/repositories/catalogue";
import { hotels } from "../data/repositories/hotels";
import {
  activeReservation,
  commitmentsOn,
  readPreferences,
} from "../data/repositories/guests";
import { historyFor, logActivityEvent } from "../data/repositories/activity";
import { visitedAttractions } from "../data/repositories/achievements";
import { savePlan } from "../data/repositories/plans";
import type { DailyPlan, DayStamp } from "../data/domain";

export interface GenerateOptions {
  guestId: string;
  hotelId: string;
  date?: DayStamp;
  weather?: WeatherContext;
  /** Skips the AI layer. Used by tests and by the admin's dry-run preview. */
  skipAI?: boolean;
  /** Skips persistence. Used by the admin's preview. */
  dryRun?: boolean;
  random?: () => number;
}

export interface GenerateResult {
  plan: DailyPlan;
  diagnostics: PlanDiagnostics;
  /** Why there is no plan, when there isn't one. */
  blocked: BlockedReason | null;
}

export type BlockedReason =
  | "no_hotel"
  | "no_reservation"
  | "outside_stay"
  | "no_free_time"
  | "no_activities";

export const BLOCKED_COPY: Record<BlockedReason, { title: string; body: string }> = {
  no_hotel: {
    title: "We lost track of your hotel",
    body: "Scan the QR code at reception again to pick up where you left off.",
  },
  no_reservation: {
    title: "Tell us about your stay",
    body: "Add your check-in and check-out dates and we'll build your days around them.",
  },
  outside_stay: {
    title: "Nothing planned for this day",
    body: "This date falls outside your stay.",
  },
  no_free_time: {
    title: "Your day is already full",
    body: "Everything you've told us about fills today. Free up a window and we'll find something.",
  },
  no_activities: {
    title: "More experiences coming soon",
    body: "Your hotel is still building its partner network. Hotel activities and events will appear here as they're added.",
  },
};

/**
 * Builds and stores today's plan.
 *
 * Reads every input fresh rather than caching: a partner detached in the admin
 * two minutes ago must not appear in a plan generated now, and the cheapest
 * way to guarantee that is to never hold a stale copy.
 */
export async function generatePlanForGuest(options: GenerateOptions): Promise<GenerateResult> {
  const date = options.date ?? todayStamp();
  const isToday = date === todayStamp();

  const hotel = await hotels.get(options.hotelId);
  if (!hotel) return blocked("no_hotel");

  const reservation = await activeReservation(options.guestId, options.hotelId);
  if (!reservation) return blocked("no_reservation");

  if (date < reservation.checkIn || date > reservation.checkOut) {
    return blocked("outside_stay");
  }

  const [activities, partners, events, commitments, preferences, history, visited] =
    await Promise.all([
      hotelActivities(options.hotelId),
      // 10 · The partner restriction. Outside candidates come from here or from
      // nowhere — there is no fallback to a wider catalogue.
      eligiblePartnerExperiences(options.hotelId),
      eventsOnDate(options.hotelId, date),
      commitmentsOn(options.guestId, date),
      readPreferences(options.guestId),
      historyFor(options.guestId),
      visitedAttractions(options.guestId),
    ]);

  const { plan, diagnostics } = generateDailyPlan({
    guestId: options.guestId,
    hotel,
    reservation,
    date,
    preferences,
    commitments,
    hotelActivities: activities,
    partners,
    events,
    history,
    visitedAttractionIds: visited,
    weather: options.weather,
    nowMinutes: nowMinutes(),
    isToday,
    random: options.random,
  });

  // 54 & 55 · Distinguish "nothing to offer" from "no room to offer it".
  if (plan.tasks.length === 0) {
    const nothingToOffer =
      activities.length === 0 && partners.length === 0 && events.length === 0;
    if (nothingToOffer) return { plan, diagnostics, blocked: "no_activities" };
    if (diagnostics.totalFreeMin < 30) return { plan, diagnostics, blocked: "no_free_time" };
  }

  /* -- 15 · AI ranking, if it is available and wanted -------------------- */
  let finalPlan = plan;

  if (!options.skipAI && plan.tasks.length > 0) {
    const candidatesById = new Map<string, Candidate>();
    for (const experience of activities) {
      candidatesById.set(experience.id, candidateFromHotelActivity(experience));
    }
    for (const entry of partners) {
      candidatesById.set(
        entry.experience.id,
        candidateFromPartner(entry.experience, entry.partner, hotel),
      );
    }
    for (const event of events) {
      candidatesById.set(event.id, candidateFromEvent(event, hotel));
    }

    finalPlan = await enhancePlan({
      plan,
      hotel,
      reservation,
      preferences,
      freeWindows: diagnostics.freeWindows,
      recentActivities: recentNames(history, candidatesById),
      candidatesById,
      weather: options.weather,
    });
  }

  if (options.dryRun) return { plan: finalPlan, diagnostics, blocked: null };

  const stored = await savePlan(finalPlan);

  // 14 · Every suggestion is logged, so tomorrow's recommendations know what
  // was offered today — not only what was taken.
  await Promise.all(
    stored.tasks
      .filter((task) => task.state === "AVAILABLE")
      .map((task) =>
        logActivityEvent({
          guestId: task.guestId,
          hotelId: task.hotelId,
          activityId: task.activityId,
          activityType: task.activityType,
          category: task.category,
          eventType: "suggested",
          metadata: { wildcard: task.isWildcard, taskId: task.id },
        }),
      ),
  );

  return { plan: stored, diagnostics, blocked: null };
}

function recentNames(
  history: Awaited<ReturnType<typeof historyFor>>,
  candidatesById: Map<string, Candidate>,
): string[] {
  const names: string[] = [];
  for (const event of history) {
    if (event.eventType !== "completed" && event.eventType !== "verified") continue;
    const name = candidatesById.get(event.activityId)?.name;
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 5) break;
  }
  return names;
}

function blocked(reason: BlockedReason): GenerateResult {
  return {
    plan: emptyPlan(),
    diagnostics: {
      freeWindows: [],
      totalFreeMin: 0,
      activityScore: 0,
      taskBudget: { target: 0, min: 0, max: 0, limitedBy: "score" },
      candidatesConsidered: 0,
      eligibleCount: 0,
      rejections: new Map(),
      scheduleViolations: [],
      hotelActivityOmitted: false,
      noPartners: false,
    },
    blocked: reason,
  };
}

function emptyPlan(): DailyPlan {
  return {
    id: "",
    guestId: "",
    hotelId: "",
    date: todayStamp(),
    tasks: [],
    summary: "",
    engagement: "CASUAL",
    activityScore: 0,
    aiAssisted: false,
    hotelActivityOmitted: false,
    rewardUnlocked: false,
    generatedAt: new Date().toISOString(),
  };
}
