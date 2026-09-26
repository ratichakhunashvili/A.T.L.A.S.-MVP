/**
 * The guest's achievement collection, and the unlock gesture.
 *
 * One provider so that an unlock can be triggered from anywhere — the QR
 * scanner, a deep link, a completed task — and land in the same place: a
 * single toast, a single collection, a single profile stack.
 *
 * Unlocks are serialised through a queue. Scanning two codes quickly should
 * show two notifications one after another, not one on top of the other.
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

import {
  achievements as achievementRepo,
  collectionFor,
  featuredFor,
  setFeatured,
  unlockByAttraction,
  userAchievements,
  type HeldAchievement,
  type UnlockOutcome,
} from "../data/repositories/achievements";
import {
  ensureGuestSession,
  readSession,
  subscribeToSession,
} from "../data/repositories/guests";
import { useAuth } from "../auth/AuthProvider";
import type { Achievement, Experience, GuestSession } from "../data/domain";

/** What the toast is currently showing. */
export interface UnlockNotice {
  achievement: Achievement;
  attraction: Experience;
}

interface AchievementContextValue {
  collection: HeldAchievement[];
  featured: HeldAchievement[];
  loading: boolean;
  /** The unlock currently on screen, if any. */
  notice: UnlockNotice | null;
  dismissNotice: () => void;
  /**
   * Unlocks whatever the given attraction earns.
   *
   * Returns the outcome so a caller can say something specific; a repeat scan
   * resolves to `already` and deliberately shows nothing.
   */
  unlock: (attractionId: string) => Promise<UnlockOutcome>;
  /** Replaces the featured three. */
  chooseFeatured: (achievementIds: string[]) => Promise<void>;
  refresh: (guestId?: string) => Promise<void>;
}

const AchievementContext = createContext<AchievementContextValue | null>(null);

/** How long an unlock stays on screen before it leaves on its own. */
const NOTICE_MS = 4600;

export function AchievementProvider({ children }: { children: ReactNode }) {
  /*
   * The session is read here rather than taken from `useGuest`.
   *
   * Effects run children-first, so a scan handled deep in the tree creates the
   * guest *before* the provider above it has a session to hand down — and this
   * provider would then load an empty collection and never be told otherwise.
   * Subscribing to the source removes the ordering question altogether.
   */
  const [session, setSession] = useState<GuestSession | null>(() => readSession());
  useEffect(() => subscribeToSession(() => setSession(readSession())), []);

  const { user } = useAuth();
  const [collection, setCollection] = useState<HeldAchievement[]>([]);
  const [featured, setFeaturedState] = useState<HeldAchievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<UnlockNotice | null>(null);

  const queue = useRef<UnlockNotice[]>([]);
  const timer = useRef<number | undefined>(undefined);

  const guestId = session?.guestId ?? null;
  const email = user?.email ?? session?.email ?? null;

  const refresh = useCallback(async (overrideId?: string) => {
    const id = overrideId ?? guestId;
    if (!id) {
      setCollection([]);
      setFeaturedState([]);
      setLoading(false);
      return;
    }
    const [held, top] = await Promise.all([
      collectionFor(id, email),
      featuredFor(id, email),
    ]);
    setCollection(held);
    setFeaturedState(top);
    setLoading(false);
  }, [guestId, email]);

  useEffect(() => {
    void refresh();
    // An admin creating an achievement should reach the development account's
    // collection without a reload.
    const off = [achievementRepo.subscribe(() => void refresh()), userAchievements.subscribe(() => void refresh())];
    return () => off.forEach((unsubscribe) => unsubscribe());
  }, [refresh]);

  /** Shows the next queued unlock, if nothing is on screen. */
  const pump = useCallback(() => {
    if (notice !== null) return;
    const next = queue.current.shift();
    if (!next) return;

    setNotice(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, [notice]);

  useEffect(() => {
    if (notice === null) pump();
  }, [notice, pump]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const dismissNotice = useCallback(() => {
    window.clearTimeout(timer.current);
    setNotice(null);
  }, []);

  const unlock = useCallback(
    async (attractionId: string): Promise<UnlockOutcome> => {
      /*
       * The identity is read here, not taken from context.
       *
       * A guest arriving straight from an attraction's printed code has no
       * session until this moment, and the provider's copy of it lags the
       * write by a render. Relying on that copy made the very first scan of a
       * new guest's trip fail silently — which is the one scan that matters
       * most.
       */
      const created = ensureGuestSession();
      setSession(created);

      const outcome = await unlockByAttraction(created.guestId, attractionId);

      // Only a *new* unlock produces a notification. A repeat scan is silent
      // by design — the guest already has it, and saying so twice is noise.
      if (outcome.status === "unlocked") {
        queue.current.push({ achievement: outcome.achievement, attraction: outcome.attraction });
        await refresh(created.guestId);
        pump();
      }

      return outcome;
    },
    [pump, refresh],
  );

  const chooseFeatured = useCallback(
    async (achievementIds: string[]) => {
      if (!guestId) return;
      await setFeatured(guestId, achievementIds);
      await refresh();
    },
    [guestId, refresh],
  );

  const value = useMemo<AchievementContextValue>(
    () => ({
      collection,
      featured,
      loading,
      notice,
      dismissNotice,
      unlock,
      chooseFeatured,
      refresh,
    }),
    [collection, featured, loading, notice, dismissNotice, unlock, chooseFeatured, refresh],
  );

  return <AchievementContext.Provider value={value}>{children}</AchievementContext.Provider>;
}

export function useAchievements(): AchievementContextValue {
  const value = useContext(AchievementContext);
  if (!value) throw new Error("useAchievements must be used inside <AchievementProvider>");
  return value;
}
