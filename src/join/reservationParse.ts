/**
 * Reading a reservation the guest hands us.
 *
 * Three strategies, tried in order of how much we can trust them:
 *
 *   1. a QR code in the image — structured, so it is read exactly
 *   2. deterministic patterns over the text — dates, references, party size
 *   3. the AI parser, for prose that patterns cannot reach
 *
 * Nothing here is ever trusted enough to save on its own. Every path ends at
 * the same confirmation screen, because OCR that is right nine times out of
 * ten still puts a guest in the wrong room on the tenth.
 *
 * The uploaded file never leaves the browser. Only extracted *text* is sent to
 * the parsing endpoint, and nothing is persisted anywhere.
 */

import { aiProvider } from "../ai/provider";
import { PARSE_CONFIDENCE_FLOOR, type ParsedReservation } from "../data/domain";

/* ------------------------------------------------------------------------ */
/* QR payloads                                                               */
/* ------------------------------------------------------------------------ */

/** Decodes any QR in an image file, where the platform supports it. */
export async function readQRFromImage(file: File): Promise<string | null> {
  if (!window.BarcodeDetector) return null;

  try {
    const bitmap = await createImageBitmap(file);
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    const results = await detector.detect(bitmap);
    bitmap.close();
    return results[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

/**
 * Interprets a QR payload.
 *
 * Booking platforms use JSON, URLs with query parameters, or key=value lines.
 * All three are structured enough to read confidently, which is why a QR hit
 * scores far higher than a text match.
 */
export function parseQRPayload(payload: string): ParsedReservation | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  // JSON payloads.
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      return fromRecord(data, 0.95);
    } catch {
      /* not JSON after all */
    }
  }

  // URLs carrying the booking in the query string.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const data: Record<string, unknown> = {};
      url.searchParams.forEach((value, key) => {
        data[key] = value;
      });
      const parsed = fromRecord(data, 0.85);
      if (parsed.fields.length > 0) return parsed;
    } catch {
      /* malformed URL */
    }
  }

  // `key=value` or `key: value`, one per line.
  if (/[:=]/.test(trimmed)) {
    const data: Record<string, unknown> = {};
    for (const line of trimmed.split(/[\r\n;|]+/)) {
      const match = line.match(/^\s*([A-Za-z_][\w\s-]*?)\s*[:=]\s*(.+?)\s*$/);
      if (match) data[match[1].toLowerCase().replace(/[\s-]+/g, "")] = match[2];
    }
    const parsed = fromRecord(data, 0.8);
    if (parsed.fields.length > 0) return parsed;
  }

  return null;
}

/** Maps the many names booking systems use onto our own fields. */
const FIELD_ALIASES: Record<string, string[]> = {
  guestName: ["guestname", "name", "guest", "leadguest", "fullname", "customer"],
  hotelName: ["hotelname", "hotel", "property", "propertyname", "venue"],
  checkIn: ["checkin", "checkindate", "arrival", "arrivaldate", "from", "startdate"],
  checkOut: ["checkout", "checkoutdate", "departure", "departuredate", "to", "enddate"],
  reference: ["reference", "ref", "bookingref", "bookingreference", "confirmation",
    "confirmationnumber", "bookingid", "reservationid", "pnr"],
  partySize: ["partysize", "guests", "adults", "pax", "numguests", "occupancy"],
};

function fromRecord(data: Record<string, unknown>, confidence: number): ParsedReservation {
  const normalised = new Map<string, string>();
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    normalised.set(key.toLowerCase().replace(/[\s_-]+/g, ""), String(value));
  }

  const result: ParsedReservation = { confidence, fields: [] };

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const key = aliases.find((alias) => normalised.has(alias));
    if (!key) continue;
    const raw = normalised.get(key)!;

    if (field === "checkIn" || field === "checkOut") {
      const iso = normaliseDate(raw);
      if (iso) {
        result[field] = iso;
        result.fields.push(field);
      }
      continue;
    }

    if (field === "partySize") {
      const count = Number.parseInt(raw, 10);
      if (Number.isFinite(count) && count > 0 && count < 40) {
        result.partySize = count;
        result.fields.push(field);
      }
      continue;
    }

    const text = raw.trim().slice(0, 120);
    if (!text) continue;
    if (field === "guestName") result.guestName = text;
    else if (field === "hotelName") result.hotelName = text;
    else if (field === "reference") result.reference = text;
    else continue;
    result.fields.push(field);
  }

  if (result.checkIn && result.checkOut) {
    result.nights = Math.max(
      0,
      Math.round(
        (Date.parse(`${result.checkOut}T00:00:00Z`) - Date.parse(`${result.checkIn}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }

  return result;
}

/* ------------------------------------------------------------------------ */
/* Text patterns                                                             */
/* ------------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Turns a written date into ISO, or gives up.
 *
 * `03/04/2026` is deliberately *not* interpreted. Day-first and month-first
 * conventions disagree, and silently choosing one is how a guest ends up
 * confirming a stay a month from the one they booked. Ambiguous input is
 * returned as null and typed in by hand.
 */
export function normaliseDate(input: string): string | undefined {
  const text = input.trim();

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "14 October 2026" / "Oct 14, 2026"
  const named = text.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,})\.?,?\s+(\d{4})\b|\b([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})\b/,
  );
  if (named) {
    const day = named[1] ?? named[5];
    const monthWord = (named[2] ?? named[4] ?? "").slice(0, 3).toLowerCase();
    const year = named[3] ?? named[6];
    const month = MONTHS[monthWord];
    if (day && month && year) {
      return `${year}-${String(month).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
    }
  }

  // Unambiguous only when one component cannot be a month.
  const numeric = text.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = numeric[3];
    if (first > 12 && second <= 12) {
      return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
    }
    if (second > 12 && first <= 12) {
      return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
    }
    return undefined; // Genuinely ambiguous — the guest decides.
  }

  return undefined;
}

/** Pattern-matches a block of reservation text. */
export function parseReservationText(text: string): ParsedReservation {
  const result: ParsedReservation = { confidence: 0, fields: [] };
  const lines = text.split(/\r?\n/);

  const labelled = (labels: string[]): string | undefined => {
    const pattern = new RegExp(`(?:${labels.join("|")})\\s*[:\\-]?\\s*(.+)`, "i");
    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
    }
    return undefined;
  };

  const checkInRaw = labelled(["check[\\s-]?in", "arrival", "from"]);
  const checkOutRaw = labelled(["check[\\s-]?out", "departure", "until", "to"]);

  if (checkInRaw) {
    const iso = normaliseDate(checkInRaw);
    if (iso) {
      result.checkIn = iso;
      result.fields.push("checkIn");
    }
  }
  if (checkOutRaw) {
    const iso = normaliseDate(checkOutRaw);
    if (iso) {
      result.checkOut = iso;
      result.fields.push("checkOut");
    }
  }

  // Two bare dates in order is a common layout on confirmation emails.
  if (!result.checkIn || !result.checkOut) {
    const found: string[] = [];
    for (const match of text.matchAll(
      /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,}\.?,?\s+\d{4}|[A-Za-z]{3,}\.?\s+\d{1,2},?\s+\d{4})\b/g,
    )) {
      const iso = normaliseDate(match[0]);
      if (iso && !found.includes(iso)) found.push(iso);
    }
    found.sort();
    if (!result.checkIn && found[0]) {
      result.checkIn = found[0];
      result.fields.push("checkIn");
    }
    if (!result.checkOut && found[1]) {
      result.checkOut = found[1];
      result.fields.push("checkOut");
    }
  }

  const name = labelled(["guest\\s*name", "lead\\s*guest", "name of guest", "booked by"]);
  if (name && name.length < 80) {
    result.guestName = name;
    result.fields.push("guestName");
  }

  const hotel = labelled(["hotel", "property", "accommodation"]);
  if (hotel && hotel.length < 90) {
    result.hotelName = hotel;
    result.fields.push("hotelName");
  }

  const reference =
    // Longest alternative first, and anchored with a word boundary: written
    // the other way round, `ref` matches inside "reference" and the value
    // captured is "erence: BK-48219".
    labelled([
      "booking\\s*(?:reference|ref|number|id)\\b",
      "confirmation\\s*(?:number|code|no\\.?)\\b",
      "reservation\\s*(?:number|id)\\b",
    ]) ??
    text.match(/\b(?:ref|conf)[:# ]\s*([A-Z0-9-]{5,})\b/i)?.[1];
  if (reference) {
    result.reference = reference.split(/\s{2,}/)[0].trim().slice(0, 40);
    result.fields.push("reference");
  }

  const party = text.match(/\b(\d{1,2})\s*(?:adults?|guests?|persons?|pax)\b/i);
  if (party) {
    const count = Number(party[1]);
    if (count > 0 && count < 40) {
      result.partySize = count;
      result.fields.push("partySize");
    }
  }

  if (result.checkIn && result.checkOut) {
    result.nights = Math.max(
      0,
      Math.round(
        (Date.parse(`${result.checkOut}T00:00:00Z`) - Date.parse(`${result.checkIn}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }

  // Confidence tracks how much we actually found, with the dates weighted
  // highest — a parse without dates is not useful whatever else it read.
  const hasDates = Boolean(result.checkIn && result.checkOut);
  result.confidence = Math.min(
    0.9,
    (hasDates ? 0.45 : 0) + result.fields.length * 0.1,
  );

  return result;
}

/* ------------------------------------------------------------------------ */
/* Orchestration                                                             */
/* ------------------------------------------------------------------------ */

export type ParseOutcome =
  | { status: "parsed"; result: ParsedReservation; method: "qr" | "text" | "ai" }
  | { status: "unreadable"; reason: string };

/** Reads plain text out of what the guest gave us, where we can. */
export async function extractText(file: File): Promise<string | null> {
  if (file.type.startsWith("text/") || /\.(txt|eml|ics|json|csv)$/i.test(file.name)) {
    return (await file.text()).slice(0, 20_000);
  }
  return null;
}

/**
 * The whole pipeline for one uploaded file.
 *
 * Images are tried for a QR first because that is the only fully reliable
 * path. Without one, an image needs OCR, which this build does not ship — the
 * guest is told plainly and offered manual entry rather than being left on a
 * spinner.
 */
export async function parseReservationFile(file: File): Promise<ParseOutcome> {
  if (file.size > 12 * 1024 * 1024) {
    return { status: "unreadable", reason: "That file is too large to read. Enter your stay instead." };
  }

  if (file.type.startsWith("image/")) {
    const payload = await readQRFromImage(file);
    if (payload) {
      const parsed = parseQRPayload(payload);
      if (parsed && parsed.fields.length > 0) return { status: "parsed", result: parsed, method: "qr" };
    }
  }

  const text = await extractText(file);
  if (text) {
    const local = parseReservationText(text);
    if (local.confidence >= PARSE_CONFIDENCE_FLOOR) {
      return { status: "parsed", result: local, method: "text" };
    }

    // Patterns were not enough. The AI parser sees text only, never the file.
    try {
      const remote = await aiProvider.parseReservation(text);
      const merged = mergeParsed(local, remote);
      if (merged.fields.length > 0) return { status: "parsed", result: merged, method: "ai" };
    } catch {
      /* AI unavailable — the local parse is still worth offering. */
    }

    if (local.fields.length > 0) return { status: "parsed", result: local, method: "text" };
  }

  return {
    status: "unreadable",
    reason: file.type.startsWith("image/")
      ? "We couldn't read that image. If your confirmation has a QR code, try that — otherwise enter your stay below."
      : "We couldn't read that document. Enter your stay below instead.",
  };
}

/** Local patterns win where they found something; AI fills the gaps. */
function mergeParsed(
  local: ParsedReservation,
  remote: Record<string, string | number | undefined>,
): ParsedReservation {
  const merged: ParsedReservation = { ...local, fields: [...local.fields] };

  const take = (key: "guestName" | "hotelName" | "checkIn" | "checkOut" | "reference") => {
    if (merged[key]) return;
    const value = remote[key];
    if (typeof value === "string" && value.trim()) {
      merged[key] = value.trim();
      merged.fields.push(key);
    }
  };

  take("guestName");
  take("hotelName");
  take("checkIn");
  take("checkOut");
  take("reference");

  if (!merged.partySize && typeof remote.partySize === "number" && remote.partySize > 0) {
    merged.partySize = remote.partySize;
    merged.fields.push("partySize");
  }

  if (merged.checkIn && merged.checkOut) {
    merged.nights = Math.max(
      0,
      Math.round(
        (Date.parse(`${merged.checkOut}T00:00:00Z`) - Date.parse(`${merged.checkIn}T00:00:00Z`)) /
          86_400_000,
      ),
    );
  }

  const remoteConfidence = typeof remote.confidence === "number" ? remote.confidence : 0.5;
  merged.confidence = Math.max(local.confidence, Math.min(0.85, remoteConfidence));

  return merged;
}
