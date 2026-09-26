/**
 * POST /api/ai/rank
 *
 * Ranks and rewrites a shortlist the rule engine has already approved.
 *
 * The contract, enforced on both sides: the request carries a closed set of
 * activity ids, and the response is filtered back down to that same set before
 * it is returned. Even if the model invents an activity, it cannot leave this
 * function — which means the browser's validation in `mergeRanking` is a
 * second line of defence rather than the only one.
 */

import {
  callModel,
  extractJson,
  readBody,
  readConfig,
  requireMethod,
  type ApiRequest,
  type ApiResponse,
} from "../_ai.js";

interface RankRequest {
  candidates: {
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
    groundedReason: string;
    isWildcard: boolean;
  }[];
  context: Record<string, unknown>;
}

/**
 * The instruction.
 *
 * Every prohibition here exists because the alternative is a guest being told
 * something untrue: invented popularity, invented history, invented facts
 * about a venue nobody verified. The model is given the grounded reason the
 * scoring engine produced and asked to say it better — not to find a new one.
 */
const SYSTEM = `You write the daily plan for a hotel guest experience app.

You are given a shortlist of activities that have ALREADY been validated
against the guest's schedule, the hotel's partner network, opening hours and
travel time. Your job is presentation only.

Rules, in order of importance:
1. Use ONLY the activityId values you were given. Never invent one, never drop
   one, never merge two.
2. Never change the times. They were computed from real constraints.
3. Never state a fact that is not in the data you were given. No claims about
   popularity, other guests, reviews, history, or what a place is famous for.
4. Rewrite "groundedReason" into one short, warm sentence that means the same
   thing. If you cannot improve it, return it unchanged.
5. Titles stay recognisable — a guest must be able to find the place. Improve
   the phrasing, do not rename the venue.
6. Match the guest's energy: a RESTING guest gets calm, unhurried wording; a
   HIGHLY_ACTIVE one gets brisker wording. Never mention engagement, scores,
   activity levels or algorithms.
7. An activity marked isWildcard is a deliberate step outside the guest's usual
   choices. Frame it as an invitation, honestly — "a little different from your
   usual" — never as something they are known to like.

Respond with JSON only, no prose and no code fences:
{
  "summary": "under 8 words, e.g. 'A slow morning, then the old town'",
  "tasks": [
    { "activityId": "...", "title": "...", "shortDescription": "under 20 words",
      "reason": "one short sentence", "order": 0 }
  ]
}`;

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (!requireMethod(request, response, "POST")) return;

  const config = readConfig();
  if (!config) {
    // Not an error: the deployment simply has no AI configured, and the client
    // already holds a complete plan.
    response.status(503).json({ error: "ai_not_configured" });
    return;
  }

  let payload: RankRequest;
  try {
    payload = readBody<RankRequest>(request);
  } catch {
    response.status(400).json({ error: "invalid_json" });
    return;
  }

  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  if (candidates.length === 0) {
    response.status(400).json({ error: "no_candidates" });
    return;
  }

  // A plan is at most four tasks; anything larger is not a plan we generated.
  if (candidates.length > 8) {
    response.status(400).json({ error: "too_many_candidates" });
    return;
  }

  const allowed = new Set(candidates.map((candidate) => candidate.activityId));

  try {
    const text = await callModel(
      config,
      SYSTEM,
      JSON.stringify({ context: payload.context, candidates }, null, 1),
    );

    const parsed = extractJson(text) as {
      tasks?: { activityId?: string; title?: string; shortDescription?: string; reason?: string; order?: number }[];
      summary?: string;
    };

    const tasks = (parsed.tasks ?? [])
      // The server-side half of the id contract.
      .filter((task) => typeof task.activityId === "string" && allowed.has(task.activityId))
      .map((task, index) => ({
        activityId: task.activityId as string,
        title: typeof task.title === "string" ? task.title : "",
        shortDescription: typeof task.shortDescription === "string" ? task.shortDescription : "",
        reason: typeof task.reason === "string" ? task.reason : "",
        order: typeof task.order === "number" ? task.order : index,
      }));

    if (tasks.length === 0) {
      response.status(502).json({ error: "no_valid_tasks" });
      return;
    }

    response.setHeader("cache-control", "no-store");
    response.status(200).json({
      tasks,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    });
  } catch (error) {
    // The client treats any non-200 identically and falls back to its own
    // ranking, so the detail here is for logs, not for the guest.
    console.error("[ai/rank]", error instanceof Error ? error.message : error);
    response.status(502).json({ error: "upstream_failed" });
  }
}
