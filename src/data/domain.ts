/**
 * Platform domain model.
 *
 * Everything the hotel experience platform stores, in one place. These are
 * plain serialisable records — exactly what a REST API would return and
 * exactly what the repositories in `./repositories` read and write, so the
 * backing store can change without anything downstream noticing.
 *
 * The existing guest-facing types (`Place`, `MapModel`, `Mission`) stay in
 * `./types`. This file is additive: a `MapModel` is still the visual asset,
 * and an `Experience` is the business record it can point at.
 */

import type { PlaceCategory } from "./types";

/* ------------------------------------------------------------------------ */
/* Shared vocabulary                                                         */
/* ------------------------------------------------------------------------ */

/** ISO-8601 instant, e.g. `2026-09-26T14:30:00.000Z`. */
export type Instant = string;
/** Calendar day in the hotel's local timezone, `YYYY-MM-DD`. */
export type DayStamp = string;
/** Local wall-clock time, `HH:MM`, 24-hour. */
export type Clock = string;

/**
 * What kind of thing an activity is, and — crucially — where it happens.
 *
 * The engine branches on `isInsideHotel` rather than on the label, so adding a
 * partner type later does not mean auditing every rule.
 */
export type ActivityType =
  | "HOTEL_ACTIVITY"
  | "HOTEL_EVENT"
  | "PARTNER_ACTIVITY"
  | "PARTNER_RESTAURANT"
  | "PARTNER_TOUR"
  | "PARTNER_ATTRACTION"
  | "PARTNER_EXPERIENCE";

export const ACTIVITY_TYPES: ActivityType[] = [
  "HOTEL_ACTIVITY",
  "HOTEL_EVENT",
  "PARTNER_ACTIVITY",
  "PARTNER_RESTAURANT",
  "PARTNER_TOUR",
  "PARTNER_ATTRACTION",
  "PARTNER_EXPERIENCE",
];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  HOTEL_ACTIVITY: "Hotel activity",
  HOTEL_EVENT: "Hotel event",
  PARTNER_ACTIVITY: "Partner activity",
  PARTNER_RESTAURANT: "Partner restaurant",
  PARTNER_TOUR: "Partner tour",
  PARTNER_ATTRACTION: "Partner attraction",
  PARTNER_EXPERIENCE: "Partner experience",
};

/** Hotel-owned activities and hotel events happen on the property. */
export function isInsideHotel(type: ActivityType): boolean {
  return type === "HOTEL_ACTIVITY" || type === "HOTEL_EVENT";
}

/** The interest vocabulary the guest picks from during onboarding. */
export type Interest =
  | "nature"
  | "sightseeing"
  | "food"
  | "culture"
  | "adventure"
  | "relaxation"
  | "shopping"
  | "nightlife"
  | "sports"
  | "events";

export const INTERESTS: Interest[] = [
  "nature",
  "sightseeing",
  "food",
  "culture",
  "adventure",
  "relaxation",
  "shopping",
  "nightlife",
  "sports",
  "events",
];

export const INTEREST_LABEL: Record<Interest, string> = {
  nature: "Nature",
  sightseeing: "Sightseeing",
  food: "Food",
  culture: "Culture",
  adventure: "Adventure",
  relaxation: "Relaxation",
  shopping: "Shopping",
  nightlife: "Nightlife",
  sports: "Sports",
  events: "Events",
};

/**
 * Earlier records used a slightly different vocabulary. Rather than migrate
 * stored data, unknown values are mapped on read — a seed file or a saved
 * preference written against the old list keeps working.
 */
const INTEREST_ALIASES: Record<string, Interest> = {
  entertainment: "events",
  active: "sports",
  local: "culture",
};

export function normaliseInterest(value: string): Interest | null {
  if ((INTERESTS as string[]).includes(value)) return value as Interest;
  return INTEREST_ALIASES[value] ?? null;
}

export function normaliseInterests(values: readonly string[]): Interest[] {
  const out: Interest[] = [];
  for (const value of values) {
    const mapped = normaliseInterest(value);
    if (mapped && !out.includes(mapped)) out.push(mapped);
  }
  return out;
}

/**
 * How many interests onboarding asks for before it stops nudging.
 *
 * A floor, not a gate: a guest can carry on with none, and the engine treats
 * that as "no signal" rather than "wants nothing".
 */
export const PREFERRED_INTEREST_COUNT = { min: 3, max: 5 } as const;

/** How hard the guest wants to work for it. */
export type EnergyLevel = "chill" | "balanced" | "adventurous";
export const ENERGY_LEVELS: EnergyLevel[] = ["chill", "balanced", "adventurous"];

/** Price bracket, not a currency amount — the guest picks a feel. */
export type BudgetBand = "free" | "moderate" | "premium";
export const BUDGET_BANDS: BudgetBand[] = ["free", "moderate", "premium"];

/** Roughly how demanding an activity is. Matched against `EnergyLevel`. */
export type Effort = "low" | "medium" | "high";

/* ------------------------------------------------------------------------ */
/* Hotel                                                                     */
/* ------------------------------------------------------------------------ */

export interface Hotel {
  id: string;
  name: string;
  /** Street line shown on the welcome screen. */
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  /** A deactivated hotel refuses new onboarding but keeps existing guests. */
  active: boolean;
  /** One line under the hotel name on the welcome screen. */
  tagline?: string;
  /** IANA zone. Free-window maths is done in the hotel's local day. */
  timezone: string;
  checkInTime: Clock;
  checkOutTime: Clock;
  /** Optional 3D model representing the property on the map. */
  modelId?: string;
  /** What a guest gets for finishing every task in a day. */
  dailyReward?: HotelReward;
  createdAt: Instant;
  updatedAt: Instant;
}

/**
 * A hotel's daily completion reward.
 *
 * Deliberately not a currency and not a balance — it is one concrete thing the
 * guest can claim at the desk today, and it is either locked or unlocked.
 */
export interface HotelReward {
  title: string;
  description?: string;
  /** Where to claim it, e.g. "Reception" or "Lobby bar". */
  location?: string;
}

/** Suggestions the admin can start from. Free text is always allowed. */
export const REWARD_PRESETS: HotelReward[] = [
  { title: "Free coffee", location: "Lobby bar" },
  { title: "Dessert on us", location: "Restaurant" },
  { title: "A drink at the bar", location: "Lobby bar" },
  { title: "10% off dinner", location: "Restaurant" },
  { title: "Spa entry", location: "Spa" },
  { title: "Late check-out, on request", location: "Reception" },
];

export type HotelDraft = Omit<Hotel, "id" | "createdAt" | "updatedAt">;

/**
 * The QR a guest scans at reception.
 *
 * `token` is the only thing in the public URL: high-entropy, non-sequential,
 * and revocable, so a hotel id is never guessable from a printed card. A hotel
 * can hold several codes over time — regenerating issues a new one and retires
 * the old rather than mutating it, which keeps scan analytics honest.
 */
export interface HotelQRCode {
  id: string;
  hotelId: string;
  token: string;
  active: boolean;
  /** Optional hard stop. Null means the code does not expire on its own. */
  expiresAt: Instant | null;
  /** Incremented on every successful resolution of the token. */
  scanCount: number;
  lastScannedAt: Instant | null;
  /** Free-text, e.g. "Reception desk" or "Room door cards". */
  label?: string;
  createdAt: Instant;
  updatedAt: Instant;
}

/* ------------------------------------------------------------------------ */
/* Experiences and the partner relationship                                  */
/* ------------------------------------------------------------------------ */

/** A single opening interval on one weekday. */
export interface OpeningInterval {
  /** 0 = Sunday … 6 = Saturday, matching `Date.getDay()`. */
  weekday: number;
  opens: Clock;
  closes: Clock;
}

/**
 * A thing a guest can do.
 *
 * One record whether it belongs to the hotel or to a partner — `type` says
 * which, and `hotelId` is set only for hotel-owned activities. A partner
 * experience is deliberately hotel-agnostic so the same castle can be sold by
 * four hotels; the link lives in `HotelPartner`.
 */
export interface Experience {
  id: string;
  name: string;
  description: string;
  type: ActivityType;
  /** Reuses the map's category vocabulary so markers and icons just work. */
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  /** Set only for HOTEL_ACTIVITY / HOTEL_EVENT — the property it belongs to. */
  hotelId?: string;
  /** Typical time on site, in minutes. Drives every scheduling decision. */
  durationMin: number;
  /** Empty means "no published hours" and is treated as always open. */
  openingHours: OpeningInterval[];
  budget: BudgetBand;
  /** Indicative price per person, in the hotel's local currency. */
  price?: number;
  effort: Effort;
  /** Interests this satisfies. Drives preference matching. */
  interests: Interest[];
  /** True when the guest is under cover — used by the weather rules. */
  indoor: boolean;
  imageUrl?: string;
  bookingUrl?: string;
  /** Whether a slot has to be reserved before turning up. */
  requiresBooking: boolean;
  /**
   * Optional link to a `MapModel`. The model is the *visual* for this record;
   * it confers no partner status of its own (see `HotelPartner`).
   */
  modelId?: string;
  /**
   * Whether this is a partner attraction at all.
   *
   * Stored explicitly rather than inferred from the presence of a GLB. A
   * partner attraction is *represented* by a 3D model on the map, but the
   * relationship is a database fact and the model is its visual language —
   * reading it the other way round would make uploading an asset a business
   * decision.
   */
  isPartner: boolean;
  active: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

export type ExperienceDraft = Omit<Experience, "id" | "createdAt" | "updatedAt">;

/**
 * The hotel ↔ experience join. This, and only this, decides whether an outside
 * experience may be recommended to a guest of a given hotel.
 */
export interface HotelPartner {
  id: string;
  hotelId: string;
  experienceId: string;
  active: boolean;
  /** 0–100. Nudges ranking without letting a hotel override hard rules. */
  priority: number;
  featured: boolean;
  /** Overrides the experience's own copy for this hotel only. */
  hotelDescription?: string;
  /** Percentage, retained for the future booking/commission model. */
  commissionPct?: number;
  createdAt: Instant;
  updatedAt: Instant;
}

export type HotelPartnerDraft = Omit<HotelPartner, "id" | "createdAt" | "updatedAt">;

/**
 * A scheduled happening at the hotel: live music, a tasting, a class.
 *
 * Distinct from `Experience` because it occurs once, at a fixed time, with
 * optional capacity — it cannot simply be slotted wherever it fits.
 */
export interface HotelEvent {
  id: string;
  hotelId: string;
  name: string;
  description: string;
  date: DayStamp;
  startTime: Clock;
  endTime: Clock;
  /** Where on the property, e.g. "Rooftop bar". */
  location: string;
  capacity?: number;
  /** How many guests have booked through the platform. */
  booked: number;
  requiresBooking: boolean;
  interests: Interest[];
  budget: BudgetBand;
  price?: number;
  effort: Effort;
  indoor: boolean;
  imageUrl?: string;
  active: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

export type HotelEventDraft = Omit<HotelEvent, "id" | "createdAt" | "updatedAt">;

/* ------------------------------------------------------------------------ */
/* Guest records                                                             */
/* ------------------------------------------------------------------------ */

/**
 * A stay.
 *
 * `hotelId` is stamped from the scanned QR token at creation and is never
 * accepted from client input afterwards, which is what stops a guest moving
 * their reservation to another hotel by editing a field.
 */
export interface Reservation {
  id: string;
  guestId: string;
  hotelId: string;
  guestName: string;
  checkIn: DayStamp;
  checkOut: DayStamp;
  nights: number;
  partySize: number;
  reference?: string;
  roomNumber?: string;
  /** How the record was created — kept for support, not shown to the guest. */
  source: "manual" | "scan" | "upload";
  createdAt: Instant;
  updatedAt: Instant;
}

export type ReservationDraft = Omit<Reservation, "id" | "createdAt" | "updatedAt" | "nights">;

/**
 * What a reservation document yielded. Every field is optional because OCR and
 * QR payloads are both partial by nature; the guest confirms before it becomes
 * a `Reservation`.
 */
export interface ParsedReservation {
  guestName?: string;
  hotelName?: string;
  checkIn?: DayStamp;
  checkOut?: DayStamp;
  nights?: number;
  partySize?: number;
  reference?: string;
  /** 0–1. Below `PARSE_CONFIDENCE_FLOOR` the UI leads with manual entry. */
  confidence: number;
  /** Which fields were actually found, for the "here's what we found" screen. */
  fields: string[];
}

export interface GuestPreferences {
  guestId: string;
  interests: Interest[];
  energyLevel: EnergyLevel;
  budget: BudgetBand;
  /** How far the guest is willing to go, in kilometres. */
  range: ActivityRange;
  /** True when the guest asked for discovery over their stated interests. */
  surpriseMe: boolean;
  /** False until the guest finishes onboarding; defaults still apply. */
  explicit: boolean;
  updatedAt: Instant;
}

/**
 * The distance band a guest is happy to travel.
 *
 * A band rather than a single number: "2–4 km" describes a comfortable walk
 * better than "4 km" does, and the engine treats the upper bound as a hard
 * limit and the lower bound as where it stops preferring closer things.
 */
export interface ActivityRange {
  minKm: number;
  maxKm: number;
}

export const DEFAULT_RANGE: ActivityRange = { minKm: 2, maxKm: 4 };

/** The bands the profile slider snaps to. */
export const RANGE_PRESETS: { label: string; range: ActivityRange }[] = [
  { label: "Right here", range: { minKm: 0, maxKm: 1 } },
  { label: "A short walk", range: { minKm: 1, maxKm: 2 } },
  { label: "Around the area", range: { minKm: 2, maxKm: 4 } },
  { label: "Across town", range: { minKm: 2, maxKm: 8 } },
  { label: "Anywhere", range: { minKm: 0, maxKm: 30 } },
];

/** Something already in the diary. The engine treats these as immovable. */
export interface Commitment {
  id: string;
  guestId: string;
  date: DayStamp;
  startTime: Clock;
  endTime: Clock;
  label: string;
  kind: "dinner" | "meeting" | "tour" | "transport" | "checkin" | "checkout" | "other";
  createdAt: Instant;
}

export type CommitmentDraft = Omit<Commitment, "id" | "createdAt">;

/* ------------------------------------------------------------------------ */
/* Achievements                                                              */
/* ------------------------------------------------------------------------ */

/**
 * One achievement per attraction, themed around it.
 *
 * The attraction owns the achievement rather than the other way round: there
 * is exactly one per place, it is unlocked by scanning that place's QR, and
 * deactivating it stops new unlocks without erasing anyone's collection.
 */
export interface Achievement {
  id: string;
  /** The `Experience` this belongs to. One achievement per attraction. */
  attractionId: string;
  name: string;
  description: string;
  /**
   * The sticker. Either an uploaded image reference or, until real art
   * exists, a generated placeholder derived from `icon` and `tone`.
   */
  stickerUrl?: string;
  /** Lucide icon name used for the placeholder sticker. */
  icon: string;
  /** Which palette family the placeholder sticker uses. */
  tone: AchievementTone;
  active: boolean;
  createdAt: Instant;
  updatedAt: Instant;
}

export type AchievementTone = "property" | "highlight" | "success" | "warning" | "music";

export const ACHIEVEMENT_TONES: AchievementTone[] = [
  "property",
  "highlight",
  "success",
  "warning",
  "music",
];

export type AchievementDraft = Omit<Achievement, "id" | "createdAt" | "updatedAt">;

/** A guest holds an achievement once. Scanning again changes nothing. */
export interface UserAchievement {
  id: string;
  guestId: string;
  achievementId: string;
  attractionId: string;
  unlockedAt: Instant;
  /** How it was earned. `granted` covers development and support overrides. */
  source: "qr_scan" | "task" | "granted";
}

/** Exactly this many achievements appear on the profile. */
export const FEATURED_ACHIEVEMENT_COUNT = 3;

/* ------------------------------------------------------------------------ */
/* Behaviour                                                                 */
/* ------------------------------------------------------------------------ */

export type ActivityEventType =
  | "suggested"
  | "viewed"
  | "started"
  | "completed"
  | "skipped"
  | "abandoned"
  | "liked"
  | "disliked"
  | "booked"
  | "verified"
  /** An attraction QR was scanned on site. */
  | "scanned"
  /** An achievement was unlocked. */
  | "unlocked";

/**
 * One thing that happened between a guest and an activity.
 *
 * Append-only. The engagement score, the recommendation memory and the hotel
 * analytics are all derived from this stream rather than from mutable counters,
 * so they cannot drift out of agreement with each other.
 */
export interface UserActivityEvent {
  id: string;
  guestId: string;
  hotelId: string;
  /** `Experience.id` or `HotelEvent.id`. */
  activityId: string;
  activityType: ActivityType;
  category: PlaceCategory;
  eventType: ActivityEventType;
  timestamp: Instant;
  /** Minutes actually spent, recorded on completion. */
  durationMin?: number;
  metadata?: Record<string, string | number | boolean>;
}

export type UserActivityEventDraft = Omit<UserActivityEvent, "id">;

/** Internal engagement band. Never shown to the guest as a judgement. */
export type EngagementState = "RESTING" | "CASUAL" | "ENGAGED" | "HIGHLY_ACTIVE";

/* ------------------------------------------------------------------------ */
/* Plans and tasks                                                           */
/* ------------------------------------------------------------------------ */

export type TaskState =
  | "AVAILABLE"
  | "LOCKED"
  | "STARTED"
  | "COMPLETED"
  | "SKIPPED"
  | "MISSED"
  | "EXPIRED"
  | "BOOKED"
  | "VERIFIED";

/** States a task will not leave. */
export const TERMINAL_TASK_STATES: TaskState[] = [
  "COMPLETED",
  "SKIPPED",
  "MISSED",
  "EXPIRED",
  "VERIFIED",
];

export function isTerminal(state: TaskState): boolean {
  return TERMINAL_TASK_STATES.includes(state);
}

/**
 * How a completion was proven. `manual` is the MVP default; the rest exist so
 * the verification surface can be turned on per hotel without a schema change.
 */
export type VerificationMethod = "manual" | "hotel_qr" | "partner_qr" | "location" | "booking";

/** One scheduled thing in a guest's day. */
export interface Task {
  id: string;
  planId: string;
  guestId: string;
  hotelId: string;
  /** The `Experience` or `HotelEvent` this realises. */
  activityId: string;
  activityKind: "experience" | "event";
  activityType: ActivityType;
  category: PlaceCategory;

  /** Guest-facing copy. AI may rewrite these; it may not change the ids. */
  title: string;
  shortDescription: string;
  /** One short sentence on why this was chosen. */
  reason: string;

  startTime: Clock;
  endTime: Clock;
  durationMin: number;
  latitude: number;
  longitude: number;
  /** Straight-line metres from the hotel. Null for on-property activities. */
  distanceM: number | null;
  /** Allowed walking minutes to get there, already reserved in the schedule. */
  travelMin: number;

  state: TaskState;
  /** At most one per plan — the deliberate step outside the guest's pattern. */
  isWildcard: boolean;
  requiresBooking: boolean;
  verification: VerificationMethod;
  /**
   * Whether the daily reward depends on this one.
   *
   * Every task in the set is required — the reward unlocks on a complete day,
   * not on a threshold — but the hotel task carries the flag so the UI can say
   * why it is there.
   */
  required: boolean;

  startedAt?: Instant;
  completedAt?: Instant;
  createdAt: Instant;
  updatedAt: Instant;
}

/** A guest's day. One per guest per calendar day. */
export interface DailyPlan {
  id: string;
  guestId: string;
  hotelId: string;
  date: DayStamp;
  tasks: Task[];
  /** Copy for the top of the plan. Written by AI when available. */
  summary: string;
  /** Engagement band at generation time — drives tone, not content. */
  engagement: EngagementState;
  /** 0–100 internal signal. Never rendered as a number to the guest. */
  activityScore: number;
  /** True when AI ranked/rewrote this plan; false when rules alone did. */
  aiAssisted: boolean;
  /** Set when the day genuinely had no hotel option that fit. */
  hotelActivityOmitted: boolean;
  /** The hotel's reward for finishing the day, captured when generated. */
  reward?: HotelReward;
  /** True once every task in the set is complete. */
  rewardUnlocked: boolean;
  /** Set when the guest has collected it, so it is not offered twice. */
  rewardClaimedAt?: Instant;
  generatedAt: Instant;
}

/* ------------------------------------------------------------------------ */
/* Session                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Who the app currently believes it is serving.
 *
 * Created when a hotel QR is scanned and completed through onboarding. The
 * guest id is local to the device — this is the same browser-local identity
 * model the existing `LocalAuthService` uses.
 */
export interface GuestSession {
  guestId: string;
  hotelId: string;
  /** The QR token the guest arrived through, for scan attribution. */
  qrToken: string;
  startedAt: Instant;
  /** False until every required onboarding step has been answered. */
  onboarded: boolean;
  /**
   * The e-mail of the signed-in account, when there is one.
   *
   * Mirrored onto the session so behaviour that depends on identity — such as
   * the development account that holds every achievement — does not have to
   * reach into the auth provider from the data layer.
   */
  email?: string;
}

/** Below this, the confirmation screen leads with "check these details". */
export const PARSE_CONFIDENCE_FLOOR = 0.55;
