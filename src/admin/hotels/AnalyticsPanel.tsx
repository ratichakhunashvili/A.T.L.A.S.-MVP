/**
 * What the hotel is allowed to see.
 *
 * Aggregates only. A hotel administrator gets counts, rates and category
 * totals — enough to run the programme — and never an individual guest's
 * itinerary, name or reservation. The guest ids that produce `activeGuests`
 * are device-local and anonymous, and they are counted here, not listed.
 *
 * Every figure is derived from the same behaviour log the recommendation
 * engine reads, so the analytics cannot disagree with what guests were
 * actually offered.
 */

import { Activity, Loader2, ShieldCheck } from "lucide-react";

import { historyForHotel, summariseHotel } from "../../data/repositories/activity";
import { activityEvents } from "../../data/repositories/activity";
import { hotelQRCodes, codesForHotel } from "../../data/repositories/hotels";
import { useQuery } from "../../data/useCollection";
import { CATEGORY_LABEL } from "../../data/types";
import type { Hotel } from "../../data/domain";

export function AnalyticsPanel({ hotel }: { hotel: Hotel }) {
  const { data, loading } = useQuery(
    async () => {
      const [events, codes] = await Promise.all([
        historyForHotel(hotel.id),
        codesForHotel(hotel.id),
      ]);
      return {
        summary: summariseHotel(events),
        scans: codes.reduce((total, code) => total + code.scanCount, 0),
      };
    },
    [activityEvents, hotelQRCodes],
    [hotel.id],
  );

  if (loading || !data) {
    return (
      <div className="empty-state">
        <Loader2 size={20} className="day__spin" aria-hidden="true" />
      </div>
    );
  }

  const { summary, scans } = data;

  if (summary.suggested === 0 && scans === 0) {
    return (
      <div className="empty-state">
        <span className="empty-state__icon">
          <Activity size={22} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <p className="empty-state__title">No activity yet</p>
        <p className="empty-state__body">
          Figures appear once guests start scanning the QR code and working through their days.
        </p>
      </div>
    );
  }

  return (
    <div className="hp">
      <p className="section-label">Reach</p>
      <div className="hp__metrics">
        <Metric label="QR scans" value={scans} />
        <Metric label="Active guests" value={summary.activeGuests} />
        <Metric label="Tasks suggested" value={summary.suggested} />
        <Metric
          label="Tasks per guest-day"
          value={summary.averageTasksPerGuestDay.toFixed(1)}
        />
      </div>

      <p className="section-label hp__section">Engagement</p>
      <div className="hp__metrics">
        <Metric label="Started" value={summary.started} />
        <Metric label="Completed" value={summary.completed} tone="good" />
        <Metric label="Skipped" value={summary.skipped} />
        <Metric
          label="Completion rate"
          value={`${Math.round(summary.completionRate * 100)}%`}
          tone="good"
        />
      </div>

      <p className="section-label hp__section">Where guests spend their time</p>
      <div className="hp__metrics">
        <Metric label="Hotel activities" value={summary.hotelActivityUses} tone="good" />
        <Metric label="Hotel events" value={summary.eventAttendance} tone="good" />
        <Metric label="Partner experiences" value={summary.partnerActivityUses} />
        <Metric label="Bookings made" value={summary.booked} />
      </div>

      {/* The measure of whether exploration is earning its place. */}
      <p className="section-label hp__section">Exploration</p>
      <div className="hp__metrics">
        <Metric label="Wildcards offered" value={summary.wildcardsSuggested} />
        <Metric label="Wildcards taken" value={summary.wildcardsAccepted} />
        <Metric
          label="Acceptance"
          value={
            summary.wildcardsSuggested === 0
              ? "—"
              : `${Math.round(summary.wildcardAcceptance * 100)}%`
          }
        />
        <Metric label="Verified on site" value={summary.verified} />
      </div>

      {summary.topCategories.length > 0 ? (
        <>
          <p className="section-label hp__section">Most completed</p>
          <ul className="hp__bars">
            {summary.topCategories.map((entry) => {
              const top = summary.topCategories[0].count || 1;
              return (
                <li key={entry.category} className="hp__bar">
                  <span className="hp__bar-label">{CATEGORY_LABEL[entry.category]}</span>
                  <span className="hp__bar-track">
                    <span
                      className="hp__bar-fill"
                      style={{ width: `${Math.round((entry.count / top) * 100)}%` }}
                    />
                  </span>
                  <span className="hp__bar-value">{entry.count}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <p className="hp__privacy">
        <ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" />
        Aggregate figures only. Guest names, reservations and itineraries are never shown here.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "good";
}) {
  return (
    <div className="hp__metric" data-tone={tone}>
      <span className="hp__metric-value">{value}</span>
      <span className="hp__metric-label">{label}</span>
    </div>
  );
}
