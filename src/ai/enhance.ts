/**
 * Applying AI output to a finished plan — safely.
 *
 * The rule the brief is most insistent about lives here: the model may reorder
 * and rewrite, it may not add. `applyRanking` starts from the deterministic
 * plan, matches the model's entries to tasks that are already in it by id, and
 * silently drops everything else. A hallucinated activity id does not become a
 * task; it becomes nothing at all.
 *
 * Times are never taken from the model. The schedule was produced by the rules
 * engine against real free windows and opening hours, and re-deriving it from
 * an AI response would hand back exactly the guarantee the layering exists to
 * protect.
 */

import { aiProvider, buildRankingContext, toRankingCandidate, type AIProvider } from "./provider";
import { describeWindow, type FreeWindow } from "../engine/time";
import type { DailyPlan, GuestPreferences, Hotel, Reservation, Task } from "../data/domain";
import type { Candidate } from "../engine/candidates";

export interface EnhanceInput {
  plan: DailyPlan;
  hotel: Hotel;
  reservation: Reservation;
  preferences: GuestPreferences;
  freeWindows: FreeWindow[];
  /** Names of things the guest has done recently, for context only. */
  recentActivities: string[];
  /** Candidate records keyed by activity id, for the prompt projection. */
  candidatesById: Map<string, Candidate>;
  weather?: { condition: string; temperatureC?: number };
  provider?: AIProvider;
}

/**
 * Returns an enhanced plan, or the original.
 *
 * Never throws and never rejects: every failure path — unconfigured, offline,
 * slow, malformed, hallucinated — ends with the deterministic plan the caller
 * already had. The only observable difference is `aiAssisted`.
 */
export async function enhancePlan(input: EnhanceInput): Promise<DailyPlan> {
  const provider = input.provider ?? aiProvider;
  const { plan } = input;

  if (plan.tasks.length === 0) return plan;

  try {
    if (!(await provider.isAvailable())) return plan;

    const candidates = plan.tasks
      .map((task) => {
        const candidate = input.candidatesById.get(task.activityId);
        if (!candidate) return null;
        return toRankingCandidate(candidate, {
          startTime: task.startTime,
          endTime: task.endTime,
          reason: task.reason,
          isWildcard: task.isWildcard,
        });
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (candidates.length === 0) return plan;

    const context = buildRankingContext({
      hotel: input.hotel,
      reservation: input.reservation,
      preferences: input.preferences,
      engagement: plan.engagement,
      date: plan.date,
      freeWindows: input.freeWindows.map(describeWindow),
      recentActivities: input.recentActivities,
      weather: input.weather,
    });

    const ranking = await provider.generateRecommendationRanking(candidates, context);
    return mergeRanking(plan, ranking);
  } catch {
    // Deliberately silent. The guest has a working plan; a provider problem is
    // an operational concern, not something to put in front of them.
    return plan;
  }
}

/**
 * Merges validated AI output into the plan.
 *
 * Exported separately from `enhancePlan` so the merge rules can be tested
 * without a provider: given a response containing an unknown id, a missing id
 * and a valid one, exactly one task should change.
 */
export function mergeRanking(
  plan: DailyPlan,
  ranking: { tasks: { activityId: string; title: string; shortDescription: string; reason: string; order: number }[]; summary: string },
): DailyPlan {
  const allowedIds = new Set(plan.tasks.map((task) => task.activityId));

  // Anything the model invented is dropped before it can influence anything.
  const accepted = ranking.tasks.filter((entry) => allowedIds.has(entry.activityId));
  if (accepted.length === 0) return plan;

  const copyById = new Map(accepted.map((entry) => [entry.activityId, entry]));
  const orderById = new Map(accepted.map((entry, index) => [entry.activityId, entry.order ?? index]));

  const rewritten: Task[] = plan.tasks.map((task) => {
    const copy = copyById.get(task.activityId);
    if (!copy) return task;

    return {
      ...task,
      // Empty strings from the model fall back to what was already there, so a
      // half-filled response degrades field by field rather than all at once.
      title: copy.title || task.title,
      shortDescription: copy.shortDescription || task.shortDescription,
      reason: copy.reason || task.reason,
    };
  });

  /*
   * Presentation order may follow the model; the schedule may not.
   *
   * Tasks stay sorted by their real start time because those times came from
   * the free-window and opening-hours maths. The model's ordering is used only
   * to break ties between tasks that begin at the same minute, which is the
   * most influence it can have without being able to produce an impossible
   * day.
   */
  const ordered = rewritten.slice().sort((a, b) => {
    if (a.startTime !== b.startTime) return a.startTime.localeCompare(b.startTime);
    return (orderById.get(a.activityId) ?? 0) - (orderById.get(b.activityId) ?? 0);
  });

  return {
    ...plan,
    tasks: ordered,
    summary: ranking.summary || plan.summary,
    aiAssisted: true,
  };
}
