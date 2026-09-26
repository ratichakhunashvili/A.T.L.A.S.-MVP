/**
 * The guest's stay, as the rest of the app sees it.
 *
 * One context holding the hotel, the reservation, the preferences and today's
 * plan, with a single `refresh` that re-reads all of it. Components never
 * touch repositories directly for this data — which means a partner detached
 * in the admin, or a task completed on the map, reaches every surface through
 * the same path.
 *
 * Everything is null before onboarding. The map still works in that state:
 * this context adds a planned day to the product, it does not gate it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { generatePlanForGuest, type BlockedReason } from "../engine/service";
import {
  claimReward,
  dailyPlans,
  expireStaleTasks,
  planFor,
  transitionTask,
} from "../data/repositories/plans";
import { hotels } from "../data/repositories/hotels";
import {
  activeReservation,
  readPreferences,
  readSession,
  subscribeToSession,
  updateSession,
} from "../data/repositories/guests";
import { useAuth } from "../auth/AuthProvider";
import { eligiblePartnerExperiences, upcomingEvents } from "../data/repositories/catalogue";
import { nowMinutes, todayStamp } from "../engine/time";
import type {
  DailyPlan,
  DayStamp,
  GuestPreferences,
  GuestSession,
  Hotel,
  HotelEvent,
  Reservation,
  Task,
  TaskState,
} from "../data/domain";
import type { PartnerExperience } from "../data/repositories/catalogue";

interface GuestContextValue {
  session: GuestSession | null;
  hotel: Hotel | null;
  reservation: Reservation | null;
  preferences: GuestPreferences | null;
  plan: DailyPlan | null;
  partners: PartnerExperience[];
  events: HotelEvent[];
  blocked: BlockedReason | null;
  loading: boolean;
  /** True while a fresh plan is being generated. */
  planning: boolean;
  /** Re-reads everything from the repositories. */
  refresh: () => Promise<void>;
  /** Generates (or regenerates) today's plan. */
  regenerate: () => Promise<void>;
  /** Moves a task and refreshes the plan. */
  moveTask: (taskId: string, to: TaskState) => Promise<Task | null>;
  /** Marks the hotel's daily reward as collected. */
  claim: () => Promise<void>;
  /** The calendar day the plan belongs to. Flips at local midnight. */
  activeDate: DayStamp;
}

const GuestContext = createContext<GuestContextValue | null>(null);

export function GuestProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [session, setSession] = useState<GuestSession | null>(() => readSession());
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [preferences, setPreferences] = useState<GuestPreferences | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [partners, setPartners] = useState<PartnerExperience[]>([]);
  const [events, setEvents] = useState<HotelEvent[]>([]);
  const [blocked, setBlocked] = useState<BlockedReason | null>(null);
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);

  /** Guards against two generations racing after a fast double action. */
  const generating = useRef(false);
  /** True once today's plan has been generated automatically. */
  const autoPlanned = useRef(false);

  /**
   * The day the product is working on.
   *
   * Held in state rather than read on every render so that midnight actually
   * *does* something: when this flips, everything downstream re-reads, the
   * previous plan becomes history, and a new one is generated for the new day.
   */
  const [activeDate, setActiveDate] = useState(() => todayStamp());

  useEffect(() => subscribeToSession(() => setSession(readSession())), []);

  /*
   * Mirror the signed-in address onto the session.
   *
   * The data layer decides some things by identity — the development account
   * that holds every achievement, for one — and it should not have to reach
   * up into the auth provider to find out who is here.
   */
  useEffect(() => {
    const current = readSession();
    if (!current) return;
    const email = user?.email;
    if (current.email === email) return;
    updateSession({ email });
  }, [user?.email]);

  const refresh = useCallback(async () => {
    const current = readSession();
    setSession(current);

    if (!current) {
      setHotel(null);
      setReservation(null);
      setPreferences(null);
      setPlan(null);
      setPartners([]);
      setEvents([]);
      setLoading(false);
      return;
    }

    const today = todayStamp();
    setActiveDate(today);
    const [foundHotel, foundReservation, foundPreferences, foundPartners, foundEvents, foundPlan] =
      await Promise.all([
        hotels.get(current.hotelId),
        activeReservation(current.guestId, current.hotelId),
        readPreferences(current.guestId),
        eligiblePartnerExperiences(current.hotelId),
        upcomingEvents(current.hotelId, today),
        planFor(current.guestId, current.hotelId, today),
      ]);

    setHotel(foundHotel);
    setReservation(foundReservation);
    setPreferences(foundPreferences);
    setPartners(foundPartners);
    setEvents(foundEvents);
    // A task whose window has passed becomes MISSED on read, so a plan left
    // open overnight does not still be offering yesterday's four o'clock.
    setPlan(foundPlan ? expireStaleTasks(foundPlan, nowMinutes(), today) : null);
    setLoading(false);
  }, []);

  const regenerate = useCallback(async () => {
    const current = readSession();
    if (!current || generating.current) return;

    generating.current = true;
    setPlanning(true);
    try {
      const result = await generatePlanForGuest({
        guestId: current.guestId,
        hotelId: current.hotelId,
      });
      setBlocked(result.blocked);
      if (!result.blocked) setPlan(result.plan);
      await refresh();
    } finally {
      generating.current = false;
      setPlanning(false);
    }
  }, [refresh]);

  const moveTask = useCallback(
    async (taskId: string, to: TaskState) => {
      if (!plan) return null;
      const result = await transitionTask(plan.id, taskId, to);
      if (result) setPlan(result.plan);
      return result?.task ?? null;
    },
    [plan],
  );

  const claim = useCallback(async () => {
    if (!plan) return;
    const updated = await claimReward(plan.id);
    if (updated) setPlan(updated);
  }, [plan]);

  /*
   * Midnight.
   *
   * One timeout to the next local midnight rather than a ticking interval —
   * it costs nothing while the app sits open all evening, and it fires on the
   * boundary rather than up to a minute after it. Rescheduled each time it
   * runs, so a session left open for a week keeps turning over correctly.
   *
   * Yesterday's incomplete tasks are not carried forward. They stay on
   * yesterday's plan, which is now history; today starts empty and is
   * generated fresh.
   */
  useEffect(() => {
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    // A second of slack, so the timer never fires just before the boundary and
    // computes the day it was trying to leave.
    const delay = midnight.getTime() - Date.now() + 1000;

    const timer = window.setTimeout(() => {
      autoPlanned.current = false;
      setActiveDate(todayStamp());
      setPlan(null);
      void refresh();
    }, delay);

    return () => window.clearTimeout(timer);
  }, [activeDate, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh, session?.guestId, session?.hotelId]);

  /*
   * Follow the stored plan.
   *
   * `moveTask` updates state directly, but it is not the only writer: the QR
   * scanner completes tasks, and another tab can too. Subscribing means the
   * day on screen is the day in storage, whoever changed it — which is how the
   * reward went on saying "3 tasks to go" after all three were finished.
   */
  useEffect(() => dailyPlans.subscribe(() => void refresh()), [refresh]);

  /**
   * Generates the day on first arrival, once the guest has finished
   * onboarding. Regeneration after that is explicit — a plan that reshuffles
   * itself while the guest is reading it is not a plan.
   */
  useEffect(() => {
    if (autoPlanned.current || loading) return;
    if (!session?.onboarded || !reservation || plan) return;
    autoPlanned.current = true;
    void regenerate();
  }, [loading, plan, regenerate, reservation, session?.onboarded]);

  const value = useMemo<GuestContextValue>(
    () => ({
      session,
      hotel,
      reservation,
      preferences,
      plan,
      partners,
      events,
      blocked,
      loading,
      planning,
      refresh,
      regenerate,
      moveTask,
      claim,
      activeDate,
    }),
    [
      session, hotel, reservation, preferences, plan, partners, events,
      blocked, loading, planning, refresh, regenerate, moveTask, claim, activeDate,
    ],
  );

  return <GuestContext.Provider value={value}>{children}</GuestContext.Provider>;
}

export function useGuest(): GuestContextValue {
  const value = useContext(GuestContext);
  if (!value) throw new Error("useGuest must be used inside <GuestProvider>");
  return value;
}

/** True when there is a finished onboarding to render a plan for. */
export function useHasStay(): boolean {
  const { session, reservation } = useGuest();
  return Boolean(session?.onboarded && reservation);
}
