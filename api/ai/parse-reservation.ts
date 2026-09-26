/**
 * POST /api/ai/parse-reservation
 *
 * Pulls structured fields out of reservation text that the deterministic
 * parser could not read on its own.
 *
 * Privacy notes, because this handles genuinely personal data:
 *   · only text reaches this function, never the uploaded image or PDF
 *   · nothing is written to disk, a database or a log — the extracted fields
 *     are returned and immediately forgotten
 *   · the response is `no-store`, so no intermediary caches a booking
 *   · the guest confirms every field before any of it is saved
 */

import {
  callModel,
  extractJson,
  readBody,
  readConfig,
  requireMethod,
  type ApiRequest,
  type ApiResponse,
} from "../_ai";

/** Long enough for a booking confirmation, short enough to bound cost. */
const MAX_TEXT_LENGTH = 6000;

const SYSTEM = `You extract booking details from hotel reservation text.

Return JSON only, with these keys. Omit any key you cannot find — never guess,
and never infer a value from another field:

{
  "guestName": "the lead guest's full name",
  "hotelName": "the property name",
  "checkIn": "YYYY-MM-DD",
  "checkOut": "YYYY-MM-DD",
  "partySize": number of guests,
  "reference": "booking or confirmation number",
  "confidence": 0.0 to 1.0
}

Rules:
- Dates must be ISO. If a date is ambiguous (03/04/2026 could be March or
  April), omit it rather than choosing. The guest will type it.
- "confidence" is your honest assessment of how clearly this text is a hotel
  reservation. Unrelated text scores near 0.
- Never invent a reference number, a name or a date.`;

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  if (!requireMethod(request, response, "POST")) return;

  const config = readConfig();
  if (!config) {
    response.status(503).json({ error: "ai_not_configured" });
    return;
  }

  let text: string;
  try {
    const body = readBody<{ text?: unknown }>(request);
    text = typeof body.text === "string" ? body.text.slice(0, MAX_TEXT_LENGTH) : "";
  } catch {
    response.status(400).json({ error: "invalid_json" });
    return;
  }

  if (text.trim().length < 20) {
    response.status(400).json({ error: "text_too_short" });
    return;
  }

  try {
    const raw = await callModel(config, SYSTEM, text, 500);
    const parsed = extractJson(raw) as Record<string, unknown>;

    // Whitelist the fields we accept. A model returning extra keys should not
    // be able to put arbitrary data into a reservation record.
    const result: Record<string, string | number> = {};
    for (const key of ["guestName", "hotelName", "checkIn", "checkOut", "reference"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) result[key] = value.trim().slice(0, 120);
    }
    for (const key of ["partySize", "confidence"]) {
      const value = parsed[key];
      if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    }

    // Dates that are not ISO are dropped rather than passed on to be
    // misinterpreted downstream.
    for (const key of ["checkIn", "checkOut"]) {
      const value = result[key];
      if (typeof value === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) delete result[key];
    }

    response.setHeader("cache-control", "no-store");
    response.status(200).json(result);
  } catch (error) {
    console.error("[ai/parse-reservation]", error instanceof Error ? error.message : error);
    response.status(502).json({ error: "upstream_failed" });
  }
}
