/**
 * The guest side: session, reservation, preferences, commitments.
 *
 * The guest identity here is browser-local, the same model the existing
 * `LocalAuthService` uses — no account is required to use the product, and
 * onboarding never asks for one. Signing in later (through the existing auth
 * panel) attaches a name to this identity; it does not replace it.
 *
 * `hotelId` on a reservation is always taken from the resolved QR token and
 * never from anything the guest typed. That is the whole defence against a
 * guest attaching themselves to a hotel they did not scan.
 */

import { createLocalCollection, makeId, nowIso, type Collection } from "./collection";
import { DEFAULT_RANGE, normaliseInterests } from "../domain";
import type {
  Commitment,
  CommitmentDraft,
  DayStamp,
  GuestPreferences,
  GuestSession,
  Reservation,
  ReservationDraft,
} from "../domain";

const SESSION_KEY = "atlas.session.v1";

/* ------------------------------------------------------------------------ */
/* Session                                                                   */
/* ------------------------------------------------------------------------ */

const sessionListeners = new Set<() => void>();

function emitSession(): void {
  for (const listener of sessionListeners) listener();
}

export function subscribeToSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export function readSession(): GuestSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestSession;
    // A guest with no hotel is a valid guest. Someone who scanned an
    // attraction on the street, before ever reaching a reception desk, still
    // collects what they find — requiring a hotel here would have turned the
    // whole achievement system off for them.
    return parsed.guestId ? parsed : null;
  } catch {
    return null;
  }
}

function writeSession(session: GuestSession | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing useful to do; the in-memory flow continues for this page view.
  }
  emitSession();
}

/**
 * Starts (or resumes) a stay at a hotel.
 *
 * Scanning the same hotel's code again resumes the existing session rather
 * than wiping the guest's history — a guest who re-scans at reception on day
 * three should not lose their plan. Scanning a *different* hotel starts fresh,
 * because that is a different stay.
 */
export function startSession(hotelId: string, qrToken: string): GuestSession {
  const existing = readSession();

  if (existing && existing.hotelId === hotelId) {
    const resumed = { ...existing, qrToken };
    writeSession(resumed);
    return resumed;
  }

  // An anonymous guest who now scans a hotel code keeps their identity, and
  // with it everything they have already collected.
  if (existing && !existing.hotelId) {
    const adopted = { ...existing, hotelId, qrToken };
    writeSession(adopted);
    return adopted;
  }

  const session: GuestSession = {
    guestId: makeId("gst"),
    hotelId,
    qrToken,
    startedAt: nowIso(),
    onboarded: false,
  };
  writeSession(session);
  return session;
}

/**
 * The identity everything else hangs off.
 *
 * Created on demand and anonymously: no account, no hotel, no questions. A
 * later hotel scan attaches the stay to this same guest, so anything collected
 * beforehand carries over rather than being stranded on a discarded identity.
 */
export function ensureGuestSession(): GuestSession {
  const existing = readSession();
  if (existing) return existing;

  const session: GuestSession = {
    guestId: makeId("gst"),
    hotelId: "",
    qrToken: "",
    startedAt: nowIso(),
    onboarded: false,
  };
  writeSession(session);
  return session;
}

export function updateSession(patch: Partial<GuestSession>): GuestSession | null {
  const current = readSession();
  if (!current) return null;
  const next = { ...current, ...patch };
  writeSession(next);
  return next;
}

export function endSession(): void {
  writeSession(null);
}

/* ------------------------------------------------------------------------ */
/* Reservations                                                              */
/* ------------------------------------------------------------------------ */

type StoredReservation = Reservation;

export const reservations: Collection<StoredReservation, ReservationDraft> = createLocalCollection<
  StoredReservation,
  ReservationDraft
>({
  name: "reservations",
  prefix: "res",
  nameOf: (draft) => (draft as ReservationDraft).guestName,
});

/** Whole nights between two calendar days. */
export function nightsBetween(checkIn: DayStamp, checkOut: DayStamp): number {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export type ReservationProblem =
  | "missing_dates"
  | "invalid_dates"
  | "checkout_not_after_checkin"
  | "implausible_length"
  | "missing_name";

/** The longest stay the product will accept without a human looking at it. */
const MAX_NIGHTS = 60;

export function validateReservation(input: {
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
}): ReservationProblem[] {
  const problems: ReservationProblem[] = [];

  if (!input.guestName?.trim()) problems.push("missing_name");

  if (!input.checkIn || !input.checkOut) {
    problems.push("missing_dates");
    return problems;
  }

  const start = Date.parse(`${input.checkIn}T00:00:00Z`);
  const end = Date.parse(`${input.checkOut}T00:00:00Z`);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    problems.push("invalid_dates");
    return problems;
  }

  if (end <= start) {
    problems.push("checkout_not_after_checkin");
    return problems;
  }

  if (nightsBetween(input.checkIn, input.checkOut) > MAX_NIGHTS) {
    problems.push("implausible_length");
  }

  return problems;
}

export const RESERVATION_PROBLEM_COPY: Record<ReservationProblem, string> = {
  missing_name: "We need a first name to set up your stay.",
  missing_dates: "Add your check-in and check-out dates.",
  invalid_dates: "Those dates could not be read. Use the date pickers.",
  checkout_not_after_checkin: "Check-out has to be after check-in.",
  implausible_length: `A stay longer than ${MAX_NIGHTS} nights needs reception to set it up.`,
};

/**
 * Saves a confirmed stay. `nights` is always derived here — the guest is never
 * asked to do the arithmetic, and a client-supplied value is never trusted.
 */
export async function saveReservation(
  draft: Omit<ReservationDraft, "hotelId"> & { hotelId: string },
): Promise<Reservation> {
  const existing = await reservations.list();
  const previous = existing.find(
    (record) => record.guestId === draft.guestId && record.hotelId === draft.hotelId,
  );

  const payload = { ...draft, nights: nightsBetween(draft.checkIn, draft.checkOut) };

  if (previous) {
    return reservations.update(previous.id, payload) as Promise<Reservation>;
  }
  return reservations.create(payload) as Promise<Reservation>;
}

/** The stay this guest is currently on, at this hotel. */
export async function activeReservation(
  guestId: string,
  hotelId: string,
): Promise<Reservation | null> {
  const records = await reservations.list();
  return (
    records.find((record) => record.guestId === guestId && record.hotelId === hotelId) ?? null
  );
}

/** True when `date` falls inside the stay (check-out day included). */
export function coversDate(reservation: Reservation, date: DayStamp): boolean {
  return date >= reservation.checkIn && date <= reservation.checkOut;
}

/* ------------------------------------------------------------------------ */
/* Preferences                                                               */
/* ------------------------------------------------------------------------ */

type PreferenceRecord = GuestPreferences & { id: string };

const preferenceStore = createLocalCollection<PreferenceRecord, GuestPreferences>({
  name: "preferences",
  prefix: "pref",
});

/**
 * Preferences always resolve to something usable.
 *
 * A guest who skipped the questions still gets a plan: balanced energy, a
 * moderate budget and no declared interests, which the scoring engine reads as
 * "no signal" rather than "wants nothing". `explicit` records which it was, so
 * the engine can lean harder on exploration when it is guessing.
 */
export const DEFAULT_PREFERENCES: Omit<GuestPreferences, "guestId" | "updatedAt"> = {
  interests: [],
  energyLevel: "balanced",
  budget: "moderate",
  range: DEFAULT_RANGE,
  surpriseMe: false,
  explicit: false,
};

export async function readPreferences(guestId: string): Promise<GuestPreferences> {
  const records = await preferenceStore.list();
  const found = records.find((record) => record.guestId === guestId);
  if (!found) return { ...DEFAULT_PREFERENCES, guestId, updatedAt: nowIso() };

  // Records written before a field existed are filled in on read rather than
  // migrated, so an older session keeps working without a rewrite.
  return {
    ...DEFAULT_PREFERENCES,
    ...found,
    interests: normaliseInterests(found.interests ?? []),
    range: found.range ?? DEFAULT_RANGE,
  };
}

export async function savePreferences(
  guestId: string,
  patch: Partial<Omit<GuestPreferences, "guestId" | "updatedAt">>,
): Promise<GuestPreferences> {
  const records = await preferenceStore.list();
  const existing = records.find((record) => record.guestId === guestId);
  const payload = { ...(existing ?? { ...DEFAULT_PREFERENCES, guestId }), ...patch, updatedAt: nowIso() };

  if (existing) return preferenceStore.update(existing.id, payload);
  return preferenceStore.create(payload as GuestPreferences);
}

export function subscribeToPreferences(listener: () => void): () => void {
  return preferenceStore.subscribe(listener);
}

/* ------------------------------------------------------------------------ */
/* Commitments                                                               */
/* ------------------------------------------------------------------------ */

export const commitments: Collection<Commitment, CommitmentDraft> = createLocalCollection<
  Commitment,
  CommitmentDraft
>({
  name: "commitments",
  prefix: "cmt",
  timestamps: false,
});

/** What the guest has already promised to be somewhere for, on one day. */
export async function commitmentsOn(guestId: string, date: DayStamp): Promise<Commitment[]> {
  const records = await commitments.list();
  return records
    .filter((record) => record.guestId === guestId && record.date === date)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * The arrival and departure days come with their own fixed points. Seeding
 * them means the engine never schedules a castle visit across a check-out.
 */
export async function seedStayCommitments(
  guestId: string,
  reservation: Reservation,
  checkInTime: string,
  checkOutTime: string,
): Promise<void> {
  const existing = await commitments.list();
  const mine = existing.filter((record) => record.guestId === guestId);

  const wanted: CommitmentDraft[] = [
    {
      guestId,
      date: reservation.checkIn,
      startTime: checkInTime,
      endTime: addMinutesToClock(checkInTime, 45),
      label: "Check in",
      kind: "checkin",
    },
    {
      guestId,
      date: reservation.checkOut,
      startTime: subtractMinutesFromClock(checkOutTime, 45),
      endTime: checkOutTime,
      label: "Check out",
      kind: "checkout",
    },
  ];

  for (const draft of wanted) {
    const duplicate = mine.some(
      (record) => record.date === draft.date && record.kind === draft.kind,
    );
    if (!duplicate) await commitments.create(draft);
  }
}

/* -- Clock helpers ------------------------------------------------------- */

export function clockToMinutes(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

export function minutesToClock(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  const hours = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function addMinutesToClock(clock: string, minutes: number): string {
  return minutesToClock(clockToMinutes(clock) + minutes);
}

export function subtractMinutesFromClock(clock: string, minutes: number): string {
  return minutesToClock(clockToMinutes(clock) - minutes);
}
