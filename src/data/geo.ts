/**
 * Geographic distance and proximity ranking.
 *
 * Everything that asks "how far is this?" goes through here. Subtracting
 * coordinates would be wrong in two ways at once — a degree of longitude is
 * not a degree of latitude, and neither is a metre — so distances use the
 * haversine formula against the earth's mean radius. At city scale that is
 * accurate to well under a metre, which is far finer than a phone's GPS fix.
 */

import type { Place } from "./types";

export interface Coordinates {
  longitude: number;
  latitude: number;
}

const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/* ------------------------------------------------------------------------ */
/* Position fixes                                                            */
/* ------------------------------------------------------------------------ */

/**
 * A position fix, with everything needed to judge whether to trust it.
 *
 * A latitude and longitude on their own are a claim without evidence. The
 * accuracy radius and the timestamp are what make it possible to say "you are
 * here" honestly — or to admit that we only know the city.
 */
export interface Fix {
  latitude: number;
  longitude: number;
  /** Radius of the 95% confidence circle, in metres, from the device. */
  accuracy: number;
  /** Epoch milliseconds, as reported by the device. */
  timestamp: number;
  /** Where the numbers came from. Only one source today, but not forever. */
  source: "device";
}

/**
 * How much to trust a fix.
 *
 * The thresholds are the one knob worth tuning. A phone with GPS typically
 * reports 5–30 m. A laptop on Wi-Fi reports 30–150 m. A desktop on Ethernet
 * has no GPS and often no usable Wi-Fi scan, so the browser falls back to an
 * IP lookup and reports thousands — that point is the internet provider, not
 * the person, and it must never be drawn as though it were them.
 */
export const ACCURACY_THRESHOLDS = {
  /** At or under this, treat the fix as "you are here". */
  precise: 120,
  /** Usable, but it must be shown and described as approximate. */
  approximate: 2000,
};

export type FixQuality = "precise" | "approximate" | "coarse";

export function classifyAccuracy(accuracy: number): FixQuality {
  if (accuracy <= ACCURACY_THRESHOLDS.precise) return "precise";
  if (accuracy <= ACCURACY_THRESHOLDS.approximate) return "approximate";
  return "coarse";
}

/**
 * Rejects a fix that cannot be true before it reaches the map.
 *
 * Null Island is excluded deliberately: (0, 0) is in the Gulf of Guinea and is
 * far more often a zeroed-out value than a real position.
 */
export function isPlausibleFix(fix: {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}): boolean {
  const { latitude, longitude, accuracy, timestamp } = fix;

  if (![latitude, longitude, accuracy].every(Number.isFinite)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (latitude === 0 && longitude === 0) return false;
  if (!(accuracy > 0)) return false;
  // A timestamp from the future is a broken clock, not a position.
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60_000) return false;

  return true;
}

/**
 * A geodesic circle as a GeoJSON ring, for drawing an accuracy radius.
 *
 * Built in geographic space rather than as a pixel radius, so it stays the
 * right size on the ground through every zoom without being recomputed.
 */
export function accuracyRing(
  centre: Coordinates,
  radiusMetres: number,
  steps = 72,
): [number, number][] {
  const lat = toRadians(centre.latitude);
  const lon = toRadians(centre.longitude);
  const angular = radiusMetres / EARTH_RADIUS_M;
  const ring: [number, number][] = [];

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps;
    const pointLat = Math.asin(
      Math.sin(lat) * Math.cos(angular) + Math.cos(lat) * Math.sin(angular) * Math.cos(bearing),
    );
    const pointLon =
      lon +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat),
        Math.cos(angular) - Math.sin(lat) * Math.sin(pointLat),
      );
    ring.push([(pointLon * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }

  return ring;
}

/** Great-circle distance between two points, in metres. */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.longitude - a.longitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distance as a traveller would say it: rounded to something believable given
 * the precision of the fix underneath. Nobody needs "237 m".
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "";
  if (metres < 100) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  // 950 rather than 1000, so nothing ever rounds up to a bare "1000 m".
  if (metres < 950) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

/** Rough walking time, for places close enough that walking is the answer. */
export function walkingMinutes(metres: number): number {
  // 1.35 m/s is a relaxed pace on a hill, which Tbilisi mostly is.
  return Math.max(1, Math.round(metres / 1.35 / 60));
}

/* ------------------------------------------------------------------------ */
/* Proximity                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * How strongly a place should be drawn.
 *
 * The point of the tiers is that the map answers "what is worth walking to
 * from right here?" at a glance, instead of presenting a dozen equally loud
 * pins. Nothing is removed — the far tier is quieter, not absent.
 */
export type ProximityTier = "nearest" | "near" | "far";

export interface RankedPlace {
  place: Place;
  /** Metres from the guest, or null when their position is unknown. */
  metres: number | null;
  tier: ProximityTier;
  /** 0 for the closest, counting outward. */
  rank: number;
}

/** How many places get the full-strength treatment around the guest. */
export const NEAR_COUNT = 8;

/**
 * Ranks places by real distance from a point.
 *
 * With no origin every place comes back untiered and undistanced, which is
 * exactly the pre-location behaviour — the map is not allowed to imply it
 * knows where someone is standing.
 */
export function rankPlacesByDistance(
  places: Place[],
  origin: Coordinates | null,
  nearCount: number = NEAR_COUNT,
): RankedPlace[] {
  if (!origin) {
    return places.map((place, index) => ({
      place,
      metres: null,
      tier: "near" as const,
      rank: index,
    }));
  }

  const measured = places
    .map((place) => ({ place, metres: distanceMetres(origin, place) }))
    .sort((a, b) => a.metres - b.metres);

  return measured.map(({ place, metres }, index) => ({
    place,
    metres,
    rank: index,
    tier: index === 0 ? "nearest" : index < nearCount ? "near" : "far",
  }));
}
