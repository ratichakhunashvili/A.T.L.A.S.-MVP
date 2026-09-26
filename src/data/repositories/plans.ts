/**
 * Daily plans and the task state machine.
 *
 * A plan is stored whole, with its tasks embedded, because a day is read and
 * written as a unit and nothing else ever needs a task on its own. Task
 * transitions go through `transitionTask` so that the legal-move table and the
 * behaviour log stay in one place instead of being re-implemented by whichever
 * component holds the button.
 */

import { createLocalCollection, type Collection } from "./collection";
import { nowIso } from "./collection";
import { logActivityEvent } from "./activity";
import { clockToMinutes } from "./guests";
import type { DailyPlan, DayStamp, Task, TaskState } from "../domain";
import { isTerminal } from "../domain";

type PlanDraft = Omit<DailyPlan, "id">;

export const dailyPlans: Collection<DailyPlan, PlanDraft> = createLocalCollection<
  DailyPlan,
  PlanDraft
>({
  name: "dailyPlans",
  prefix: "plan",
  timestamps: false,
});

/** The plan for one guest on one day, if it has been generated. */
export async function planFor(
  guestId: string,
  hotelId: string,
  date: DayStamp,
): Promise<DailyPlan | null> {
  const plans = await dailyPlans.list();
  return (
    plans.find(
      (plan) => plan.guestId === guestId && plan.hotelId === hotelId && plan.date === date,
    ) ?? null
  );
}

/** Every plan for a guest, newest day first. */
export async function plansFor(guestId: string): Promise<DailyPlan[]> {
  const plans = await dailyPlans.list();
  return plans
    .filter((plan) => plan.guestId === guestId)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Stores a freshly generated plan, replacing any earlier one for that day.
 *
 * Tasks the guest has already acted on are carried across: regenerating a
 * plan at lunchtime must not erase the fact that they did the spa at ten.
 */
export async function savePlan(plan: DailyPlan): Promise<DailyPlan> {
  const existing = await planFor(plan.guestId, plan.hotelId, plan.date);

  if (!existing) {
    const created = await dailyPlans.create(plan as PlanDraft);
    return created;
  }

  const settled = existing.tasks.filter(
    (task) => task.state !== "AVAILABLE" && task.state !== "LOCKED",
  );
  const settledActivityIds = new Set(settled.map((task) => task.activityId));

  const merged: Task[] = [
    ...settled,
    ...plan.tasks
      .filter((task) => !settledActivityIds.has(task.activityId))
      .map((task) => ({ ...task, planId: existing.id })),
  ].sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime));

  return dailyPlans.update(existing.id, {
    ...plan,
    tasks: merged,
    generatedAt: nowIso(),
  } as Partial<PlanDraft>);
}

/* ------------------------------------------------------------------------ */
/* Task transitions                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Which moves are legal.
 *
 * Kept as data rather than as branches so the whole machine is readable at a
 * glance, and so an illegal transition is a quiet no-op rather than a state
 * nobody designed for.
 */
const LEGAL_MOVES: Record<TaskState, TaskState[]> = {
  AVAILABLE: ["STARTED", "SKIPPED", "BOOKED", "MISSED", "EXPIRED", "LOCKED"],
  LOCKED: ["AVAILABLE", "EXPIRED"],
  BOOKED: ["STARTED", "SKIPPED", "MISSED", "EXPIRED"],
  STARTED: ["COMPLETED", "VERIFIED", "SKIPPED", "MISSED"],
  COMPLETED: ["VERIFIED"],
  VERIFIED: [],
  SKIPPED: [],
  MISSED: [],
  EXPIRED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return LEGAL_MOVES[from]?.includes(to) ?? false;
}

/** What each transition means in the behaviour log. */
const EVENT_FOR_STATE: Partial<Record<TaskState, "started" | "completed" | "skipped" | "booked" | "verified">> =
  {
    STARTED: "started",
    COMPLETED: "completed",
    SKIPPED: "skipped",
    BOOKED: "booked",
    VERIFIED: "verified",
  };

export interface TransitionResult {
  plan: DailyPlan;
  task: Task;
}

/**
 * Moves one task and records what happened.
 *
 * The log write is the reason this is not a plain state setter: every
 * transition the guest makes has to reach the behaviour stream, or tomorrow's
 * recommendations will be based on a day that looks emptier than it was.
 */
export async function transitionTask(
  planId: string,
  taskId: string,
  to: TaskState,
): Promise<TransitionResult | null> {
  const plan = await dailyPlans.get(planId);
  if (!plan) return null;

  const index = plan.tasks.findIndex((task) => task.id === taskId);
  if (index === -1) return null;

  const current = plan.tasks[index];
  if (!canTransition(current.state, to)) return null;

  const stamp = nowIso();
  const updated: Task = {
    ...current,
    state: to,
    ...(to === "STARTED" ? { startedAt: stamp } : {}),
    ...(to === "COMPLETED" || to === "VERIFIED" ? { completedAt: stamp } : {}),
    updatedAt: stamp,
  };

  const tasks = plan.tasks.slice();
  tasks[index] = updated;

  /*
   * The reward is all-or-nothing.
   *
   * Not a threshold and not a running total — the hotel offers one thing for
   * finishing the day, so it is unlocked exactly when nothing is outstanding.
   * Recomputed on every transition, so skipping the last task locks it again
   * and starting it unlocks it, without anyone having to remember to.
   */
  const rewardUnlocked =
    tasks.length > 0 &&
    tasks.every((entry) => entry.state === "COMPLETED" || entry.state === "VERIFIED");

  const saved = await dailyPlans.update(planId, {
    tasks,
    rewardUnlocked,
  } as Partial<PlanDraft>);

  const eventType = EVENT_FOR_STATE[to];
  if (eventType) {
    await logActivityEvent({
      guestId: plan.guestId,
      hotelId: plan.hotelId,
      activityId: updated.activityId,
      activityType: updated.activityType,
      category: updated.category,
      eventType,
      ...(to === "COMPLETED" || to === "VERIFIED"
        ? { durationMin: elapsedMinutes(updated) }
        : {}),
      metadata: { wildcard: updated.isWildcard, taskId: updated.id },
    });
  }

  return { plan: saved, task: updated };
}

/** How long the guest actually spent, falling back to the planned duration. */
function elapsedMinutes(task: Task): number {
  if (!task.startedAt || !task.completedAt) return task.durationMin;
  const elapsed = (Date.parse(task.completedAt) - Date.parse(task.startedAt)) / 60_000;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : task.durationMin;
}

/**
 * Ages a plan against the clock.
 *
 * A task whose window has passed untouched becomes MISSED rather than sitting
 * there as an accusation. This runs when a plan is read, not on a timer, which
 * is enough: nobody sees a stale state without the plan being on screen.
 */
export function expireStaleTasks(plan: DailyPlan, nowMinutes: number, today: DayStamp): DailyPlan {
  if (plan.date > today) return plan;

  const dayIsOver = plan.date < today;
  let changed = false;

  const tasks = plan.tasks.map((task) => {
    if (isTerminal(task.state) || task.state === "STARTED") return task;
    const finished = dayIsOver || clockToMinutes(task.endTime) < nowMinutes;
    if (!finished) return task;
    changed = true;
    return { ...task, state: "MISSED" as TaskState, updatedAt: nowIso() };
  });

  return changed ? { ...plan, tasks } : plan;
}

/** The task the dashboard should lead with. */
export function nextTask(plan: DailyPlan, nowMinutes: number): Task | null {
  const started = plan.tasks.find((task) => task.state === "STARTED");
  if (started) return started;

  const upcoming = plan.tasks
    .filter((task) => !isTerminal(task.state))
    .sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime));

  return (
    upcoming.find((task) => clockToMinutes(task.endTime) >= nowMinutes) ?? upcoming[0] ?? null
  );
}

/**
 * Marks the hotel's reward as collected.
 *
 * Separate from unlocking: a reward the guest has claimed should stop being
 * offered, and that is a different fact from having earned it.
 */
export async function claimReward(planId: string): Promise<DailyPlan | null> {
  const plan = await dailyPlans.get(planId);
  if (!plan || !plan.rewardUnlocked || plan.rewardClaimedAt) return plan;
  return dailyPlans.update(planId, { rewardClaimedAt: nowIso() } as Partial<PlanDraft>);
}

/** How far through the day the guest is, as a fraction. */
export function planProgress(plan: DailyPlan): { done: number; total: number; fraction: number } {
  const total = plan.tasks.length;
  const done = plan.tasks.filter(
    (task) => task.state === "COMPLETED" || task.state === "VERIFIED",
  ).length;
  return { done, total, fraction: total === 0 ? 0 : done / total };
}
