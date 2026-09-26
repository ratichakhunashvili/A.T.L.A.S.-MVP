/**
 * Achievements: one per attraction, unlocked by being there.
 *
 * The rules that matter, and where they live:
 *
 *   · one achievement per attraction — enforced in `upsertForAttraction`
 *   · a guest holds one once — enforced in `unlockByAttraction`, which is the
 *     only write path, so a second scan is a no-op rather than a duplicate
 *   · exactly three are featured — enforced in `setFeatured`
 *
 * There are no points anywhere in here. A collection of places you have been
 * is a record of a trip; a number that only goes up is a scoreboard, and the
 * product is deliberately not one.
 */

import { createLocalCollection, nowIso, type Collection } from "./collection";
import { experiences } from "./catalogue";
import { logActivityEvent } from "./activity";
import { readSession } from "./guests";
import {
  FEATURED_ACHIEVEMENT_COUNT,
  type Achievement,
  type AchievementDraft,
  type AchievementTone,
  type Experience,
  type UserAchievement,
} from "../domain";

export const achievements: Collection<Achievement, AchievementDraft> = createLocalCollection<
  Achievement,
  AchievementDraft
>({
  name: "achievements",
  prefix: "ach",
  nameOf: (draft) => (draft as AchievementDraft).name,
});

/** `featured` lives on the row, so "exactly three" is a local invariant. */
type UserAchievementRecord = UserAchievement & { featured?: boolean };
type UserAchievementDraft = Omit<UserAchievementRecord, "id">;

export const userAchievements: Collection<UserAchievementRecord, UserAchievementDraft> =
  createLocalCollection<UserAchievementRecord, UserAchievementDraft>({
    name: "userAchievements",
    prefix: "ua",
    timestamps: false,
  });

/* ------------------------------------------------------------------------ */
/* Development account                                                       */
/* ------------------------------------------------------------------------ */

/**
 * The account that always holds everything.
 *
 * Implemented as a read-time grant rather than by writing rows: a new
 * achievement created in the admin is available to this account immediately,
 * with nothing to backfill and nothing to keep in sync. It also means the
 * grant disappears the moment the address changes, instead of leaving real
 * unlock records behind that look like someone actually went there.
 */
const DEVELOPMENT_ACCOUNT = "ratichakhunashvili@gmail.com";

export function isDevelopmentAccount(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === DEVELOPMENT_ACCOUNT;
}

/* ------------------------------------------------------------------------ */
/* Authoring                                                                 */
/* ------------------------------------------------------------------------ */

/** Sensible defaults so an admin never faces an empty achievement form. */
export function suggestAchievement(attraction: Experience): AchievementDraft {
  const tone: AchievementTone =
    attraction.category === "nature"
      ? "success"
      : attraction.category === "restaurant" || attraction.category === "experience"
        ? "warning"
        : attraction.category === "entertainment" || attraction.category === "event"
          ? "music"
          : "highlight";

  return {
    attractionId: attraction.id,
    name: `${shortName(attraction.name)} Explorer`,
    description: `Visited ${attraction.name}.`,
    icon: ICON_FOR_CATEGORY[attraction.category] ?? "Award",
    tone,
    active: true,
  };
}

/** "Narikala Fortress" → "Narikala". Keeps the sticker name from wrapping. */
function shortName(name: string): string {
  const words = name.replace(/[—–-]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.join(" ");
  const skip = new Set(["the", "of", "and", "de", "la"]);
  const meaningful = words.filter((word) => !skip.has(word.toLowerCase()));
  return meaningful.slice(0, 2).join(" ");
}

const ICON_FOR_CATEGORY: Record<string, string> = {
  hotel: "Hotel",
  restaurant: "UtensilsCrossed",
  experience: "Wine",
  museum: "Landmark",
  landmark: "Castle",
  nature: "Trees",
  adventure: "CableCar",
  entertainment: "FerrisWheel",
  event: "Music",
};

/** The achievement for an attraction, if it has one. */
export async function achievementFor(attractionId: string): Promise<Achievement | null> {
  const all = await achievements.list();
  return all.find((entry) => entry.attractionId === attractionId) ?? null;
}

/**
 * Creates or updates the attraction's single achievement.
 *
 * "One per attraction" is kept true here rather than hoped for: a second call
 * updates the first record instead of adding another.
 */
export async function upsertForAttraction(
  attractionId: string,
  draft: Omit<AchievementDraft, "attractionId">,
): Promise<Achievement> {
  const existing = await achievementFor(attractionId);
  if (existing) return achievements.update(existing.id, { ...draft, attractionId });
  return achievements.create({ ...draft, attractionId });
}

/** Every achievement, with the attraction it belongs to. */
export interface AchievementWithPlace {
  achievement: Achievement;
  attraction: Experience | null;
}

export async function listAchievements(): Promise<AchievementWithPlace[]> {
  const [all, catalogue] = await Promise.all([achievements.list(), experiences.list()]);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  return all.map((achievement) => ({
    achievement,
    attraction: byId.get(achievement.attractionId) ?? null,
  }));
}

/* ------------------------------------------------------------------------ */
/* Unlocking                                                                 */
/* ------------------------------------------------------------------------ */

export type UnlockOutcome =
  | { status: "unlocked"; achievement: Achievement; attraction: Experience }
  /** Already held. The caller shows nothing — no second popup, no counter. */
  | { status: "already"; achievement: Achievement; attraction: Experience }
  | { status: "unknown_attraction" }
  | { status: "inactive" }
  | { status: "no_achievement"; attraction: Experience };

/**
 * Unlocks by *attraction*, never by achievement id.
 *
 * This is the whole client-side defence the brief asks for: the caller hands
 * over what a QR code actually contains — the place — and this resolves which
 * achievement that earns. A crafted achievement id in the URL has nowhere to
 * go, because no code path accepts one.
 *
 * With no server, a guest who edits their own storage can still fake their own
 * collection. That costs them their own trip record and nobody else's, and the
 * check moves behind an API the moment the repositories do.
 */
export async function unlockByAttraction(
  guestId: string,
  attractionId: string,
  source: UserAchievement["source"] = "qr_scan",
): Promise<UnlockOutcome> {
  const attraction = await experiences.get(attractionId);
  if (!attraction) return { status: "unknown_attraction" };
  if (!attraction.active) return { status: "inactive" };

  const achievement = await achievementFor(attractionId);
  if (!achievement || !achievement.active) return { status: "no_achievement", attraction };

  const held = await userAchievements.list();
  const already = held.find(
    (row) => row.guestId === guestId && row.achievementId === achievement.id,
  );

  // A second scan changes nothing: no row, no event, no popup.
  if (already) return { status: "already", achievement, attraction };

  const featuredCount = held.filter((row) => row.guestId === guestId && row.featured).length;

  await userAchievements.create({
    guestId,
    achievementId: achievement.id,
    attractionId,
    unlockedAt: nowIso(),
    source,
    // The first three fill the profile stack on their own, so a new guest
    // never sees three empty slots.
    featured: featuredCount < FEATURED_ACHIEVEMENT_COUNT,
  });

  const session = readSession();
  await logActivityEvent({
    guestId,
    hotelId: session?.hotelId ?? "",
    activityId: attractionId,
    activityType: attraction.type,
    category: attraction.category,
    eventType: "unlocked",
    metadata: { achievementId: achievement.id, source },
  });

  return { status: "unlocked", achievement, attraction };
}

/* ------------------------------------------------------------------------ */
/* Reading a guest's collection                                              */
/* ------------------------------------------------------------------------ */

export interface HeldAchievement {
  achievement: Achievement;
  attraction: Experience | null;
  unlockedAt: string;
  featured: boolean;
}

/**
 * What this guest has collected, newest first.
 *
 * The development account is granted every active achievement here rather than
 * in storage — see `DEVELOPMENT_ACCOUNT`.
 */
export async function collectionFor(
  guestId: string,
  email?: string | null,
): Promise<HeldAchievement[]> {
  const [all, rows, catalogue] = await Promise.all([
    achievements.list(),
    userAchievements.list(),
    experiences.list(),
  ]);

  const byAchievement = new Map(all.map((entry) => [entry.id, entry]));
  const byAttraction = new Map(catalogue.map((entry) => [entry.id, entry]));
  const mine = rows.filter((row) => row.guestId === guestId);

  const held: HeldAchievement[] = [];
  const seen = new Set<string>();

  for (const row of mine) {
    const achievement = byAchievement.get(row.achievementId);
    if (!achievement) continue;
    seen.add(achievement.id);
    held.push({
      achievement,
      attraction: byAttraction.get(achievement.attractionId) ?? null,
      unlockedAt: row.unlockedAt,
      featured: row.featured === true,
    });
  }

  if (isDevelopmentAccount(email)) {
    for (const achievement of all) {
      if (!achievement.active || seen.has(achievement.id)) continue;
      held.push({
        achievement,
        attraction: byAttraction.get(achievement.attractionId) ?? null,
        unlockedAt: achievement.createdAt,
        // Real selections win; the grant only fills what is left.
        featured: false,
      });
    }
  }

  return held.sort((a, b) => Date.parse(b.unlockedAt) - Date.parse(a.unlockedAt));
}

/** The three on the profile, in the order they were chosen. */
export async function featuredFor(
  guestId: string,
  email?: string | null,
): Promise<HeldAchievement[]> {
  const held = await collectionFor(guestId, email);
  const chosen = held.filter((entry) => entry.featured);
  if (chosen.length > 0) return chosen.slice(0, FEATURED_ACHIEVEMENT_COUNT);
  // Nothing chosen yet — show the most recent, so the stack is never empty
  // for a guest who has collected something.
  return held.slice(0, FEATURED_ACHIEVEMENT_COUNT);
}

/**
 * Sets the featured three.
 *
 * Over-selection is truncated rather than rejected: the interface prevents a
 * fourth, and if something ever gets past it the invariant still holds.
 */
export async function setFeatured(guestId: string, achievementIds: string[]): Promise<void> {
  const wanted = new Set(achievementIds.slice(0, FEATURED_ACHIEVEMENT_COUNT));
  const rows = await userAchievements.list();

  const next = rows.map((row) =>
    row.guestId === guestId ? { ...row, featured: wanted.has(row.achievementId) } : row,
  );

  // The development account holds most of its collection virtually, so a
  // selection over granted achievements needs a row to live on.
  for (const id of wanted) {
    const exists = next.some((row) => row.guestId === guestId && row.achievementId === id);
    if (exists) continue;
    const achievement = (await achievements.list()).find((entry) => entry.id === id);
    if (!achievement) continue;
    next.push({
      id: `ua-granted-${id}`,
      guestId,
      achievementId: id,
      attractionId: achievement.attractionId,
      unlockedAt: nowIso(),
      source: "granted",
      featured: true,
    });
  }

  await userAchievements.replaceAll(next);
}

/** True when this guest already holds the attraction's achievement. */
export async function hasVisited(guestId: string, attractionId: string): Promise<boolean> {
  const rows = await userAchievements.list();
  return rows.some((row) => row.guestId === guestId && row.attractionId === attractionId);
}

/** Every attraction this guest has scanned — drives the map's visited state. */
export async function visitedAttractions(guestId: string): Promise<Set<string>> {
  const rows = await userAchievements.list();
  return new Set(
    rows.filter((row) => row.guestId === guestId).map((row) => row.attractionId),
  );
}
