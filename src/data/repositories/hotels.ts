/**
 * Hotels and their QR codes.
 *
 * The one rule worth stating plainly: a hotel is identified by a QR *token*,
 * never by an id in a URL. `resolveHotelToken` is the only supported way to go
 * from something a guest can present to a hotel record, and it refuses
 * inactive hotels, inactive codes and expired codes rather than letting the
 * caller decide.
 */

import { createLocalCollection, makeId, nowIso, type Collection } from "./collection";
import { experiences, hotelEvents, hotelPartners } from "./catalogue";
import { activityEvents } from "./activity";
import { dailyPlans } from "./plans";
import { endSession, readSession, reservations } from "./guests";
import type { Hotel, HotelDraft, HotelQRCode } from "../domain";

export const hotels: Collection<Hotel, HotelDraft> = createLocalCollection<Hotel, HotelDraft>({
  name: "hotels",
  prefix: "htl",
  nameOf: (draft) => (draft as HotelDraft).name,
});

type QRDraft = Omit<HotelQRCode, "id" | "createdAt" | "updatedAt">;

export const hotelQRCodes: Collection<HotelQRCode, QRDraft> = createLocalCollection<
  HotelQRCode,
  QRDraft
>({
  name: "hotelQRCodes",
  prefix: "qr",
});

/* ------------------------------------------------------------------------ */
/* Tokens                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Crockford base32 — no I, L, O or U, so a token read off a printed card
 * cannot be mistyped into a different valid token, and nothing spells a word.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 20 characters of base32 is 100 bits of entropy from `crypto.getRandomValues`.
 * Guessing one is not a threat model; enumerating hotel ids would have been,
 * which is exactly why the id never appears in the URL.
 */
export function generateHotelToken(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** The public onboarding path for a token. */
export function joinPath(token: string): string {
  return `/join/hotel/${token}`;
}

/** The absolute link an admin copies or encodes into a printed QR. */
export function joinUrl(token: string, origin = window.location.origin): string {
  return `${origin}${joinPath(token)}`;
}

export type TokenFailure =
  | "unknown"
  | "inactive_code"
  | "expired_code"
  | "inactive_hotel"
  | "missing_hotel";

export type TokenResolution =
  | { ok: true; hotel: Hotel; code: HotelQRCode }
  | { ok: false; reason: TokenFailure };

/**
 * Turns a scanned token into a hotel, or explains why it will not.
 *
 * Every refusal is a distinct reason because the guest-facing screens say
 * different things for each: a retired code is a "ask reception for the
 * current card", an inactive hotel is "this property is not taking guests".
 */
export async function resolveHotelToken(token: string): Promise<TokenResolution> {
  const normalised = token.trim().toUpperCase();
  const codes = await hotelQRCodes.list();
  const code = codes.find((candidate) => candidate.token === normalised);

  if (!code) return { ok: false, reason: "unknown" };
  if (!code.active) return { ok: false, reason: "inactive_code" };
  if (code.expiresAt && Date.parse(code.expiresAt) < Date.now()) {
    return { ok: false, reason: "expired_code" };
  }

  const hotel = await hotels.get(code.hotelId);
  if (!hotel) return { ok: false, reason: "missing_hotel" };
  if (!hotel.active) return { ok: false, reason: "inactive_hotel" };

  return { ok: true, hotel, code };
}

/**
 * Records a scan. Deliberately separate from resolution so that rendering an
 * admin preview, or a guest reloading the onboarding page, does not inflate
 * the hotel's scan analytics — only the first resolution of a session counts.
 */
export async function recordScan(codeId: string): Promise<void> {
  const code = await hotelQRCodes.get(codeId);
  if (!code) return;
  await hotelQRCodes.update(codeId, {
    scanCount: code.scanCount + 1,
    lastScannedAt: nowIso(),
  });
}

/* ------------------------------------------------------------------------ */
/* Admin operations                                                          */
/* ------------------------------------------------------------------------ */

/** Issues the hotel's first code, or its replacement. */
export async function issueQRCode(hotelId: string, label?: string): Promise<HotelQRCode> {
  const stamp = nowIso();
  const code: HotelQRCode = {
    id: makeId("qr"),
    hotelId,
    token: generateHotelToken(),
    active: true,
    expiresAt: null,
    scanCount: 0,
    lastScannedAt: null,
    label,
    createdAt: stamp,
    updatedAt: stamp,
  };

  const existing = await hotelQRCodes.list();
  await hotelQRCodes.replaceAll([code, ...existing]);
  return code;
}

/**
 * Regenerating retires every current code for the hotel and issues one new
 * one. The old tokens stop working immediately — that is the point of
 * regenerating — but the records survive so their scan history is not lost.
 */
export async function regenerateQRCode(hotelId: string, label?: string): Promise<HotelQRCode> {
  const existing = await hotelQRCodes.list();
  const retired = existing.map((code) =>
    code.hotelId === hotelId && code.active
      ? { ...code, active: false, updatedAt: nowIso() }
      : code,
  );
  await hotelQRCodes.replaceAll(retired);
  return issueQRCode(hotelId, label);
}

/** Every code ever issued for a hotel, newest first. */
export async function codesForHotel(hotelId: string): Promise<HotelQRCode[]> {
  const codes = await hotelQRCodes.list();
  return codes
    .filter((code) => code.hotelId === hotelId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** The code a guest would scan today, if there is one. */
export async function activeCodeForHotel(hotelId: string): Promise<HotelQRCode | null> {
  const codes = await codesForHotel(hotelId);
  return codes.find((code) => code.active) ?? null;
}

/* ------------------------------------------------------------------------ */
/* Deletion                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * What deleting a hotel would take with it.
 *
 * Computed before anything is removed so the confirmation can state the real
 * consequences rather than a generic warning. An operator deleting a property
 * with forty active guests should be told that.
 */
export interface HotelDeletionImpact {
  qrCodes: number;
  /** Hotel-owned activities. Partner experiences are NOT counted or removed. */
  ownedActivities: number;
  events: number;
  partnerLinks: number;
  reservations: number;
  plans: number;
  activityEvents: number;
  guests: number;
}

export async function previewHotelDeletion(hotelId: string): Promise<HotelDeletionImpact> {
  const [codes, catalogue, events, links, stays, plans, log] = await Promise.all([
    hotelQRCodes.list(),
    experiences.list(),
    hotelEvents.list(),
    hotelPartners.list(),
    reservations.list(),
    dailyPlans.list(),
    activityEvents.list(),
  ]);

  const mine = <T extends { hotelId: string }>(rows: T[]) =>
    rows.filter((row) => row.hotelId === hotelId);

  const guestIds = new Set(mine(stays).map((stay) => stay.guestId));
  for (const event of mine(log)) guestIds.add(event.guestId);

  return {
    qrCodes: mine(codes).length,
    ownedActivities: catalogue.filter((entry) => entry.hotelId === hotelId).length,
    events: mine(events).length,
    partnerLinks: mine(links).length,
    reservations: mine(stays).length,
    plans: mine(plans).length,
    activityEvents: mine(log).length,
    guests: guestIds.size,
  };
}

/**
 * Deletes a hotel and everything that belongs only to it.
 *
 * Removed: the hotel, its QR codes, the activities and events it runs itself,
 * its partner *links*, and the guest records tied to this stay — reservations,
 * plans and behaviour log entries. Deleting the property and keeping a guest's
 * reservation for it would leave a record nobody can act on, and retaining
 * their behaviour after the business relationship ends is not data anyone
 * should hold.
 *
 * Deliberately NOT removed: the partner experiences themselves. They live in a
 * shared catalogue and other hotels may still sell them — only this hotel's
 * link to them goes. The 3D models are likewise untouched; they are assets,
 * not property records.
 *
 * Order matters. Dependents are cleared before the hotel, so an interrupted
 * run can be re-run and never leaves a row pointing at a hotel that is gone.
 */
export async function deleteHotel(hotelId: string): Promise<HotelDeletionImpact> {
  const impact = await previewHotelDeletion(hotelId);

  const [codes, catalogue, events, links, stays, plans, log] = await Promise.all([
    hotelQRCodes.list(),
    experiences.list(),
    hotelEvents.list(),
    hotelPartners.list(),
    reservations.list(),
    dailyPlans.list(),
    activityEvents.list(),
  ]);

  const without = <T extends { hotelId: string }>(rows: T[]) =>
    rows.filter((row) => row.hotelId !== hotelId);

  await Promise.all([
    hotelQRCodes.replaceAll(without(codes)),
    // Only the hotel's own activities; shared partner experiences survive.
    experiences.replaceAll(catalogue.filter((entry) => entry.hotelId !== hotelId)),
    hotelEvents.replaceAll(without(events)),
    hotelPartners.replaceAll(without(links)),
    reservations.replaceAll(without(stays)),
    dailyPlans.replaceAll(without(plans)),
    activityEvents.replaceAll(without(log)),
  ]);

  await hotels.remove(hotelId);

  // A guest whose hotel has just been deleted has nothing to return to.
  const session = readSession();
  if (session?.hotelId === hotelId) endSession();

  return impact;
}
