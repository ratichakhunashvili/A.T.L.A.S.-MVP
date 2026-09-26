/**
 * The common shape the engine reasons about.
 *
 * An `Experience` and a `HotelEvent` are different records with different
 * rules — one can be slotted anywhere it fits, the other happens at 18:30 or
 * not at all — but every layer after eligibility wants the same handful of
 * facts about both. Normalising once here means the rules, the scoring and the
 * AI prompt each handle one type instead of three.
 */

import { distanceMetres } from "../data/geo";
import { isInsideHotel } from "../data/domain";
import type {
  ActivityType,
  BudgetBand,
  Effort,
  Experience,
  Hotel,
  HotelEvent,
  HotelPartner,
  Interest,
  OpeningInterval,
} from "../data/domain";
import type { PlaceCategory } from "../data/types";

export interface Candidate {
  /** `Experience.id` or `HotelEvent.id`. */
  id: string;
  kind: "experience" | "event";
  name: string;
  description: string;
  activityType: ActivityType;
  category: PlaceCategory;
  latitude: number;
  longitude: number;
  durationMin: number;
  openingHours: OpeningInterval[];
  /** Set for events: the fixed clock time they begin. */
  fixedStart?: string;
  fixedEnd?: string;
  budget: BudgetBand;
  price?: number;
  effort: Effort;
  interests: Interest[];
  indoor: boolean;
  imageUrl?: string;
  bookingUrl?: string;
  requiresBooking: boolean;
  modelId?: string;
  /** True for hotel activities and hotel events. */
  onProperty: boolean;
  /** Metres from the hotel. Zero for on-property. */
  distanceM: number;
  /** The hotel's own ranking for this partner, 0–100. */
  partnerPriority: number;
  featured: boolean;
  /** Where the copy the guest reads comes from. */
  sourceDescription: string;
}

function distanceFromHotel(hotel: Hotel, latitude: number, longitude: number): number {
  return Math.round(
    distanceMetres(
      { latitude: hotel.latitude, longitude: hotel.longitude },
      { latitude, longitude },
    ),
  );
}

/** A hotel-owned activity. No partner row, no travel. */
export function candidateFromHotelActivity(experience: Experience): Candidate {
  return {
    id: experience.id,
    kind: "experience",
    name: experience.name,
    description: experience.description,
    activityType: experience.type,
    category: experience.category,
    latitude: experience.latitude,
    longitude: experience.longitude,
    durationMin: experience.durationMin,
    openingHours: experience.openingHours,
    budget: experience.budget,
    price: experience.price,
    effort: experience.effort,
    interests: experience.interests,
    indoor: experience.indoor,
    imageUrl: experience.imageUrl,
    bookingUrl: experience.bookingUrl,
    requiresBooking: experience.requiresBooking,
    modelId: experience.modelId,
    onProperty: true,
    distanceM: 0,
    partnerPriority: 100,
    featured: false,
    sourceDescription: experience.description,
  };
}

/**
 * A partner experience.
 *
 * Only ever built from a `HotelPartner` row, which is the mechanism that keeps
 * unpartnered attractions out of plans: there is no constructor here that
 * takes an experience without one.
 */
export function candidateFromPartner(
  experience: Experience,
  partner: HotelPartner,
  hotel: Hotel,
): Candidate {
  return {
    id: experience.id,
    kind: "experience",
    name: experience.name,
    description: partner.hotelDescription ?? experience.description,
    activityType: experience.type,
    category: experience.category,
    latitude: experience.latitude,
    longitude: experience.longitude,
    durationMin: experience.durationMin,
    openingHours: experience.openingHours,
    budget: experience.budget,
    price: experience.price,
    effort: experience.effort,
    interests: experience.interests,
    indoor: experience.indoor,
    imageUrl: experience.imageUrl,
    bookingUrl: experience.bookingUrl,
    requiresBooking: experience.requiresBooking,
    modelId: experience.modelId,
    onProperty: isInsideHotel(experience.type),
    distanceM: distanceFromHotel(hotel, experience.latitude, experience.longitude),
    partnerPriority: partner.priority,
    featured: partner.featured,
    sourceDescription: partner.hotelDescription ?? experience.description,
  };
}

/** A hotel event. Fixed time, on the property, optionally capacity-limited. */
export function candidateFromEvent(event: HotelEvent, hotel: Hotel): Candidate {
  const [startH, startM] = event.startTime.split(":").map(Number);
  const [endH, endM] = event.endTime.split(":").map(Number);
  const duration = Math.max(15, endH * 60 + endM - (startH * 60 + startM));

  return {
    id: event.id,
    kind: "event",
    name: event.name,
    description: event.description,
    activityType: "HOTEL_EVENT",
    category: "event",
    latitude: hotel.latitude,
    longitude: hotel.longitude,
    durationMin: duration,
    openingHours: [],
    fixedStart: event.startTime,
    fixedEnd: event.endTime,
    budget: event.budget,
    price: event.price,
    effort: event.effort,
    interests: event.interests,
    indoor: event.indoor,
    imageUrl: event.imageUrl,
    requiresBooking: event.requiresBooking,
    onProperty: true,
    distanceM: 0,
    partnerPriority: 100,
    featured: false,
    sourceDescription: event.description,
  };
}
