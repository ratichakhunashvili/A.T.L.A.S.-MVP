/**
 * Experiences, the hotel↔partner join, and hotel events.
 *
 * This module owns the single most important rule in the product:
 *
 *   A guest who entered through Hotel A's QR may only ever be recommended
 *   outside experiences that Hotel A has explicitly partnered with.
 *
 * `eligiblePartnerExperiences` is the only supported way to get outside
 * candidates, and it derives them from `HotelPartner` rows. Nothing else in
 * the codebase reads the experience list directly for recommendation purposes,
 * so there is no path by which an arbitrary nearby attraction can leak into a
 * plan — including one that happens to have a 3D model.
 */

import { createLocalCollection, type Collection } from "./collection";
import type {
  DayStamp,
  Experience,
  ExperienceDraft,
  HotelEvent,
  HotelEventDraft,
  HotelPartner,
  HotelPartnerDraft,
} from "../domain";

export const experiences: Collection<Experience, ExperienceDraft> = createLocalCollection<
  Experience,
  ExperienceDraft
>({
  name: "experiences",
  prefix: "exp",
  nameOf: (draft) => (draft as ExperienceDraft).name,
});

export const hotelPartners: Collection<HotelPartner, HotelPartnerDraft> = createLocalCollection<
  HotelPartner,
  HotelPartnerDraft
>({
  name: "hotelPartners",
  prefix: "prt",
});

/**
 * Seeded events carry a relative day token (`"+0"`, `"+1"`) instead of a fixed
 * date, so a demo installed in March still has something on tonight. Real
 * records written by the admin always carry a real `YYYY-MM-DD` and pass
 * through untouched.
 */
export function resolveSeedDate(value: string): string {
  const match = /^\+(\d+)$/.exec(value);
  if (!match) return value;

  const date = new Date();
  date.setDate(date.getDate() + Number(match[1]));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export const hotelEvents: Collection<HotelEvent, HotelEventDraft> = createLocalCollection<
  HotelEvent,
  HotelEventDraft
>({
  name: "hotelEvents",
  prefix: "evt",
  nameOf: (draft) => (draft as HotelEventDraft).name,
  hydrate: (event) => ({ ...event, date: resolveSeedDate(event.date) }),
});

/* ------------------------------------------------------------------------ */
/* Partner queries                                                           */
/* ------------------------------------------------------------------------ */

/** A partner row joined to the experience it points at. */
export interface PartnerExperience {
  partner: HotelPartner;
  experience: Experience;
}

/**
 * Every partner row for a hotel, joined and sorted by the hotel's own
 * priority. Includes inactive rows — the admin needs to see what it has
 * detached. Use `eligiblePartnerExperiences` for anything guest-facing.
 */
export async function partnersForHotel(hotelId: string): Promise<PartnerExperience[]> {
  const [rows, catalogue] = await Promise.all([hotelPartners.list(), experiences.list()]);
  const byId = new Map(catalogue.map((experience) => [experience.id, experience]));

  return rows
    .filter((row) => row.hotelId === hotelId)
    .map((partner) => ({ partner, experience: byId.get(partner.experienceId) }))
    .filter((entry): entry is PartnerExperience => entry.experience !== undefined)
    .sort((a, b) => {
      if (a.partner.featured !== b.partner.featured) return a.partner.featured ? -1 : 1;
      return b.partner.priority - a.partner.priority;
    });
}

/**
 * The outside world, as far as this hotel's guests are concerned.
 *
 * Both sides have to be switched on: a hotel can detach a partner, and a
 * partner can close down, and either one removes the experience from every
 * plan generated from this moment on.
 */
export async function eligiblePartnerExperiences(hotelId: string): Promise<PartnerExperience[]> {
  const rows = await partnersForHotel(hotelId);
  return rows.filter((entry) => entry.partner.active && entry.experience.active);
}

/** True when this hotel has partnered with this experience, right now. */
export async function isPartnered(hotelId: string, experienceId: string): Promise<boolean> {
  const rows = await eligiblePartnerExperiences(hotelId);
  return rows.some((entry) => entry.experience.id === experienceId);
}

/** Which hotels sell a given experience. Powers the admin's reuse view. */
export async function hotelsForExperience(experienceId: string): Promise<string[]> {
  const rows = await hotelPartners.list();
  return rows
    .filter((row) => row.experienceId === experienceId && row.active)
    .map((row) => row.hotelId);
}

/**
 * Attaches an experience to a hotel, or re-activates a row that was detached
 * earlier. Re-using the row keeps the hotel's priority and negotiated
 * commission instead of silently resetting them.
 */
export async function attachPartner(
  hotelId: string,
  experienceId: string,
  options: { priority?: number; featured?: boolean; hotelDescription?: string } = {},
): Promise<HotelPartner> {
  const rows = await hotelPartners.list();
  const existing = rows.find(
    (row) => row.hotelId === hotelId && row.experienceId === experienceId,
  );

  if (existing) {
    return hotelPartners.update(existing.id, {
      active: true,
      ...(options.priority !== undefined ? { priority: options.priority } : {}),
      ...(options.featured !== undefined ? { featured: options.featured } : {}),
      ...(options.hotelDescription !== undefined
        ? { hotelDescription: options.hotelDescription }
        : {}),
    });
  }

  return hotelPartners.create({
    hotelId,
    experienceId,
    active: true,
    priority: options.priority ?? 50,
    featured: options.featured ?? false,
    hotelDescription: options.hotelDescription,
  });
}

/**
 * Detaches rather than deletes. The relationship is business history — a hotel
 * that drops a winery for a season and takes it back should not lose the
 * terms, and the analytics should still explain last month's bookings.
 */
export async function detachPartner(hotelId: string, experienceId: string): Promise<void> {
  const rows = await hotelPartners.list();
  const existing = rows.find(
    (row) => row.hotelId === hotelId && row.experienceId === experienceId,
  );
  if (existing) await hotelPartners.update(existing.id, { active: false });
}

/* ------------------------------------------------------------------------ */
/* Hotel-owned activities and events                                         */
/* ------------------------------------------------------------------------ */

/**
 * Activities the hotel runs itself. These need no partner row — the hotel is
 * not a partner of itself — but they are still ordinary `Experience` records,
 * so scoring and scheduling treat them identically.
 */
export async function hotelActivities(hotelId: string): Promise<Experience[]> {
  const catalogue = await experiences.list();
  return catalogue.filter(
    (experience) =>
      experience.active &&
      experience.hotelId === hotelId &&
      experience.type === "HOTEL_ACTIVITY",
  );
}

/** Events at the hotel on a given day. */
export async function eventsOnDate(hotelId: string, date: DayStamp): Promise<HotelEvent[]> {
  const events = await hotelEvents.list();
  return events
    .filter((event) => event.active && event.hotelId === hotelId && event.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** Upcoming events, for the dashboard's "what's on" strip. */
export async function upcomingEvents(
  hotelId: string,
  fromDate: DayStamp,
  limit = 6,
): Promise<HotelEvent[]> {
  const events = await hotelEvents.list();
  return events
    .filter((event) => event.active && event.hotelId === hotelId && event.date >= fromDate)
    .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))
    .slice(0, limit);
}

/** An event is full when it has a capacity and has reached it. */
export function hasCapacity(event: HotelEvent): boolean {
  return event.capacity === undefined || event.booked < event.capacity;
}

/* ------------------------------------------------------------------------ */
/* Attraction codes                                                          */
/* ------------------------------------------------------------------------ */

/** The path an attraction's printed QR points at. */
export function scanPath(attractionId: string): string {
  return `/scan/attraction/${attractionId}`;
}

/**
 * The absolute link encoded into an attraction's QR.
 *
 * Unlike a hotel's code this carries the record's own id rather than a
 * revocable token. It is what the brief specifies, and it is a fair trade:
 * the id identifies a public place, and the worst a guessed one does is give
 * someone a sticker for a place they did not stand in. A hotel token, by
 * contrast, grants a stay — which is why that one is 100 bits of entropy.
 */
export function scanUrl(attractionId: string, origin = window.location.origin): string {
  return `${origin}${scanPath(attractionId)}`;
}

/* ------------------------------------------------------------------------ */
/* Model linkage                                                             */
/* ------------------------------------------------------------------------ */

/**
 * The experience a 3D model represents, if any.
 *
 * Note the direction: an experience points at a model, never the reverse. A
 * model with no experience is a decorative asset and is still rendered by the
 * existing `ModelLayer`; it simply cannot become a task, and it confers no
 * partner status on anything.
 */
export async function experienceForModel(modelId: string): Promise<Experience | null> {
  const catalogue = await experiences.list();
  return catalogue.find((experience) => experience.modelId === modelId) ?? null;
}

/** Experiences with no model attached — the admin's "attach a model" picker. */
export async function experiencesWithoutModel(): Promise<Experience[]> {
  const catalogue = await experiences.list();
  return catalogue.filter((experience) => !experience.modelId);
}
