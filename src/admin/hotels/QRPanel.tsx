/**
 * The hotel's QR code.
 *
 * Generates, previews, downloads and revokes the code a guest scans at
 * reception. The token is the only thing in the printed URL — no hotel id
 * appears anywhere a guest could edit — and regenerating retires every earlier
 * code the moment it is pressed.
 *
 * PNG and SVG are both produced in the browser from the same encoder, so the
 * printed card and the on-screen preview cannot drift apart.
 */

import { Eye, EyeOff, Loader2, QrCode as QrIcon, Users } from "lucide-react";
import { useState } from "react";

import { QRCard } from "../QRCard";

import {
  activeCodeForHotel,
  codesForHotel,
  hotelQRCodes,
  issueQRCode,
  joinUrl,
  regenerateQRCode,
} from "../../data/repositories/hotels";
import { historyForHotel } from "../../data/repositories/activity";
import { useQuery } from "../../data/useCollection";
import type { Hotel, HotelQRCode } from "../../data/domain";


export function QRPanel({ hotel }: { hotel: Hotel }) {
  const { data: codes, loading } = useQuery(
    () => codesForHotel(hotel.id),
    [hotelQRCodes],
    [hotel.id],
  );
  const { data: guestCount } = useQuery(
    async () => {
      const events = await historyForHotel(hotel.id);
      return new Set(events.map((event) => event.guestId)).size;
    },
    [hotelQRCodes],
    [hotel.id],
  );

  const [busy, setBusy] = useState(false);

  const active = codes?.find((code) => code.active) ?? null;
  const link = active ? joinUrl(active.token) : null;




  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 size={20} className="day__spin" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="hp">
      {active && link ? (
        <>
          <QRCard
            url={link}
            name={hotel.name}
            instruction="Scan to start your stay. No account needed."
            onRegenerate={() => void run(() => regenerateQRCode(hotel.id, active.label))}
          >
            <div className="hp__stats">
              <div className="stat">
                <span className="stat__value">{active.scanCount}</span>
                <span className="stat__label">Scans</span>
              </div>
              <div className="stat">
                <span className="stat__value">{guestCount ?? 0}</span>
                <span className="stat__label">Guests</span>
              </div>
            </div>

            {active.lastScannedAt ? (
              <p className="hp__muted">
                Last scanned {new Date(active.lastScannedAt).toLocaleString()}
              </p>
            ) : (
              <p className="hp__muted">Not scanned yet</p>
            )}
          </QRCard>

          <div className="hp__actions">
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={busy}
              onClick={() => void run(() => hotelQRCodes.update(active.id, { active: false }))}
            >
              <EyeOff size={14} strokeWidth={2.2} aria-hidden="true" />
              Deactivate
            </button>
          </div>

          <p className="hp__warning">
            Regenerating issues a new code and stops the current one working immediately. Reprint
            the cards before you do it.
          </p>
        </>
      ) : (
        <div className="empty-state">
          <span className="empty-state__icon">
            <QrIcon size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <p className="empty-state__title">No active code</p>
          <p className="empty-state__body">
            Generate one and print it for reception. Guests scan it to start their stay — no
            account, no hotel search.
          </p>
          <button
            type="button"
            className="btn btn--sm btn--accent"
            disabled={busy}
            onClick={() => void run(() => issueQRCode(hotel.id, "Reception desk"))}
          >
            <QrIcon size={14} strokeWidth={2.4} aria-hidden="true" />
            Generate QR code
          </button>
        </div>
      )}

      {/* Retired codes stay visible: their scan history explains last month's
          numbers, and an operator needs to know a card is dead, not absent. */}
      {codes && codes.filter((code) => !code.active).length > 0 ? (
        <>
          <p className="section-label hp__section">Retired codes</p>
          <ul className="hp__list">
            {codes
              .filter((code) => !code.active)
              .map((code) => (
                <RetiredCode key={code.id} code={code} onRestore={() => void run(async () => {
                  // Only one code can be live, so restoring retires the rest.
                  const current = await activeCodeForHotel(hotel.id);
                  if (current) await hotelQRCodes.update(current.id, { active: false });
                  await hotelQRCodes.update(code.id, { active: true });
                })} />
              ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function RetiredCode({ code, onRestore }: { code: HotelQRCode; onRestore: () => void }) {
  return (
    <li className="hp__row">
      <span className="hp__row-main">
        <span className="hp__row-title">{code.token.slice(0, 10)}…</span>
        <span className="hp__row-sub">
          {code.scanCount} scans · retired {new Date(code.updatedAt).toLocaleDateString()}
        </span>
      </span>
      <button type="button" className="btn btn--sm btn--ghost" onClick={onRestore}>
        <Eye size={13} strokeWidth={2.2} aria-hidden="true" />
        Make live
      </button>
    </li>
  );
}


export { Users };
