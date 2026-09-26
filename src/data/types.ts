/**
 * Domain types for the guest experience.
 *
 * These describe the shape of data the UI consumes. Nothing here assumes where
 * the data comes from — the repository layer (`modelRepository.ts`) is the only
 * place that knows whether records live in memory, in the browser, or behind an
 * HTTP API.
 */

/** Category vocabulary shared by markers, models and missions. */
export type PlaceCategory =
  | "hotel"
  | "restaurant"
  | "experience"
  | "museum"
  | "landmark"
  | "nature"
  | "adventure"
  | "entertainment"
  | "event";

export const PLACE_CATEGORIES: PlaceCategory[] = [
  "hotel",
  "restaurant",
  "experience",
  "museum",
  "landmark",
  "nature",
  "adventure",
  "entertainment",
  "event",
];

export const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  hotel: "Your hotel",
  restaurant: "Restaurant",
  experience: "Experience",
  museum: "Museum",
  landmark: "Landmark",
  nature: "Nature",
  adventure: "Adventure",
  entertainment: "Entertainment",
  event: "Event",
};

/** A point of interest rendered as a custom marker on the map. */
export interface Place {
  id: string;
  name: string;
  category: PlaceCategory;
  longitude: number;
  latitude: number;
  /** Short editorial line shown in the details sheet. */
  description: string;
  rating?: number;
  reviewCount?: number;
  /** Walking distance from the hotel, in kilometres. */
  distanceKm?: number;
  /** Typical time the experience takes, in minutes. */
  durationMin?: number;
  /** Price per person in Georgian lari. Omitted when free. */
  price?: number;
  openHours?: string;
  /** True once the guest has confirmed a visit — drives the "unlocked" look. */
  unlocked?: boolean;
  /** Links this place to a mission step, if it is part of one. */
  missionId?: string;
}

/* ------------------------------------------------------------------------ */
/* 3D models                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Publication state. Only `published` records reach the public map; `hidden`
 * is a published record temporarily taken down, `draft` has never been live.
 */
export type ModelStatus = "published" | "hidden" | "draft";

/**
 * A geo-anchored 3D asset.
 *
 * Deliberately flat and serialisable: this is exactly what an API returns and
 * exactly what the admin editor writes back. The map renderer never reads
 * anything outside this shape, so swapping the backing store changes nothing
 * downstream.
 *
 * Optional fields at the bottom are the extensibility surface — richer content
 * (media, pricing, bookings, associations) can be filled in without a schema
 * migration on the renderer side.
 */
export interface MapModel {
  id: string;
  name: string;
  /**
   * Where the asset lives. Either an absolute `https://` URL, or a
   * `local:<key>` reference resolved through `ModelStorageService` for assets
   * uploaded in the browser before a real object store is connected.
   */
  modelUrl: string;
  latitude: number;
  longitude: number;
  /** Metres above the terrain. */
  altitude: number;
  /** Uniform scale multiplier applied to the asset's own units. */
  scale: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  /** Author-facing toggle. A record can be published yet not visible. */
  visible: boolean;
  status: ModelStatus;
  category: PlaceCategory;
  description: string;
  /** Optional preview image URL shown in the admin library. */
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;

  /**
   * Basemap buildings to take out from under this model.
   *
   * Stored as coordinates rather than feature ids: an id is only stable
   * within a tileset version, and a mask that silently stops working after a
   * basemap update is a bug nobody would go looking for. `BuildingMask`
   * re-resolves these to features every time the style loads.
   */
  hiddenBuildings?: { longitude: number; latitude: number }[];

  /* -- Extensibility (unused by the renderer, safe to populate later) ----- */
  images?: string[];
  videoUrl?: string;
  website?: string;
  bookingUrl?: string;
  price?: number;
  openingHours?: string;
  hotelId?: string;
  missionId?: string;
  eventId?: string;
}

/** The fields the admin editor can author. `id` and timestamps are assigned. */
export type MapModelDraft = Omit<MapModel, "id" | "createdAt" | "updatedAt">;

/* ------------------------------------------------------------------------ */
/* Missions, notifications, profile                                          */
/* ------------------------------------------------------------------------ */

export interface MissionStep {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  /** Place this step resolves to, so the map can fly to it. */
  placeId?: string;
}

export interface Mission {
  id: string;
  title: string;
  subtitle: string;
  category: PlaceCategory;
  steps: MissionStep[];
  /** Straight-line distance from the hotel, in kilometres. */
  distanceKm: number;
  /** Set on the single mission the guest is currently running. */
  active?: boolean;
}

export type NotificationKind = "event" | "booking" | "discovery" | "mission";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string;
  /** Human-readable relative time, e.g. "12 min ago". */
  time: string;
  unread: boolean;
}

/**
 * The guest's own summary.
 *
 * There is deliberately no score here. Progress is expressed as achievements
 * collected and days completed — a number that only goes up is a scoreboard,
 * and this product is not one.
 */
export interface GuestProfile {
  name: string;
  initials: string;
  memberSince: string;
  completedMissions: number;
  savedPlaces: number;
  reviews: number;
}

export interface ChatMessage {
  id: string;
  author: "assistant" | "guest";
  text: string;
}

/** The hotel whose Guest Mode is currently active. */
export interface GuestStay {
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  daysLeft: number;
  longitude: number;
  latitude: number;
}
