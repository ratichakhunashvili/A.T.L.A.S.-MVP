/**
 * Hotel events.
 *
 * Distinct from activities because they happen once, at a fixed time, with
 * optional capacity — the engine cannot slot them wherever they fit, it has to
 * take them at 18:30 or leave them. That is also why they are worth having:
 * an event the guest can actually make is the strongest reason to be in the
 * hotel that evening.
 */

import { CalendarDays, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { hotelEvents } from "../../data/repositories/catalogue";
import { useCollection } from "../../data/useCollection";
import { addMinutesToClock } from "../../data/repositories/guests";
import { todayStamp } from "../../engine/time";
import {
  BUDGET_BANDS,
  INTEREST_LABEL,
  INTERESTS,
  type BudgetBand,
  type Effort,
  type Hotel,
  type HotelEvent,
  type HotelEventDraft,
} from "../../data/domain";

const EFFORTS: Effort[] = ["low", "medium", "high"];

export function EventsPanel({ hotel }: { hotel: Hotel }) {
  const { items, loading } = useCollection(hotelEvents);
  const [editing, setEditing] = useState<HotelEvent | "new" | null>(null);

  const mine = useMemo(
    () =>
      items
        .filter((event) => event.hotelId === hotel.id)
        .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)),
    [items, hotel.id],
  );

  const today = todayStamp();
  const upcoming = mine.filter((event) => event.date >= today);
  const past = mine.filter((event) => event.date < today);

  if (editing) {
    return (
      <EventForm
        hotel={hotel}
        event={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
      />
    );
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
      <div className="hp__head">
        <div>
          <p className="hp__count">{upcoming.length} upcoming</p>
          <p className="hp__muted">
            Events are weighted highly — they are the easiest way to keep a guest on the property.
          </p>
        </div>
        <button type="button" className="btn btn--sm btn--accent" onClick={() => setEditing("new")}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          New event
        </button>
      </div>

      {upcoming.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <CalendarDays size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <p className="empty-state__title">Nothing on</p>
          <p className="empty-state__body">
            Live music, a tasting, yoga, a supra — anything with a time and a place.
          </p>
        </div>
      ) : (
        <ul className="hp__list">
          {upcoming.map((event) => (
            <EventRow key={event.id} event={event} onEdit={() => setEditing(event)} />
          ))}
        </ul>
      )}

      {past.length > 0 ? (
        <>
          <p className="section-label hp__section">Past</p>
          <ul className="hp__list">
            {past.slice(0, 8).map((event) => (
              <EventRow key={event.id} event={event} onEdit={() => setEditing(event)} past />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function EventRow({
  event,
  onEdit,
  past,
}: {
  event: HotelEvent;
  onEdit: () => void;
  past?: boolean;
}) {
  const full = event.capacity !== undefined && event.booked >= event.capacity;

  return (
    <li className="hp__row" data-muted={past}>
      <span className="hp__row-date">
        <strong>{event.date.slice(8)}</strong>
        <span>{monthName(event.date)}</span>
      </span>
      <span className="hp__row-main">
        <span className="hp__row-title">{event.name}</span>
        <span className="hp__row-sub">
          {event.startTime}–{event.endTime} · {event.location}
          {event.capacity ? ` · ${event.booked}/${event.capacity}` : ""}
          {event.active ? "" : " · inactive"}
        </span>
      </span>
      {full ? <span className="hp__badge hp__badge--warn">Full</span> : null}
      <button type="button" className="btn btn--sm btn--ghost" onClick={onEdit}>
        Edit
      </button>
    </li>
  );
}

function monthName(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, { month: "short" });
}

/* ------------------------------------------------------------------------ */
/* Form                                                                      */
/* ------------------------------------------------------------------------ */

function EventForm({
  hotel,
  event,
  onDone,
}: {
  hotel: Hotel;
  event: HotelEvent | null;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<HotelEventDraft>(() =>
    event
      ? { ...event }
      : {
          hotelId: hotel.id,
          name: "",
          description: "",
          date: todayStamp(),
          startTime: "19:00",
          endTime: "20:30",
          location: "",
          booked: 0,
          requiresBooking: false,
          interests: [],
          budget: "free",
          effort: "low",
          indoor: true,
          active: true,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof HotelEventDraft>(key: K, value: HotelEventDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!draft.name.trim()) {
      setError("Give the event a name.");
      return;
    }
    if (draft.endTime <= draft.startTime) {
      setError("It has to finish after it starts.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (event) await hotelEvents.update(event.id, draft);
      else await hotelEvents.create(draft);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hp hp__form">
      <div className="hp__head">
        <p className="hp__count">{event ? `Edit ${event.name}` : "New event"}</p>
        <button type="button" className="icon-btn" onClick={onDone} aria-label="Close">
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="ev-name">Name</label>
        <input
          id="ev-name"
          className="input"
          value={draft.name}
          onChange={(event_) => set("name", event_.target.value)}
          placeholder="Live music on the roof"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="ev-desc">Description</label>
        <textarea
          id="ev-desc"
          className="textarea"
          rows={2}
          value={draft.description}
          onChange={(event_) => set("description", event_.target.value)}
        />
      </div>

      <div className="field-row field-row--three">
        <div className="field">
          <label className="field__label" htmlFor="ev-date">Date</label>
          <input
            id="ev-date"
            className="input"
            type="date"
            value={draft.date}
            onChange={(event_) => set("date", event_.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ev-start">From</label>
          <input
            id="ev-start"
            className="input"
            type="time"
            value={draft.startTime}
            onChange={(event_) => {
              set("startTime", event_.target.value);
              if (draft.endTime <= event_.target.value) {
                set("endTime", addMinutesToClock(event_.target.value, 90));
              }
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ev-end">Until</label>
          <input
            id="ev-end"
            className="input"
            type="time"
            value={draft.endTime}
            onChange={(event_) => set("endTime", event_.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="ev-loc">Where</label>
          <input
            id="ev-loc"
            className="input"
            value={draft.location}
            onChange={(event_) => set("location", event_.target.value)}
            placeholder="Roof terrace"
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ev-cap">
            Capacity <span className="field__optional">optional</span>
          </label>
          <input
            id="ev-cap"
            className="input"
            type="number"
            min={1}
            value={draft.capacity ?? ""}
            onChange={(event_) =>
              set("capacity", event_.target.value === "" ? undefined : Number(event_.target.value))
            }
          />
        </div>
      </div>

      <div className="field-row field-row--three">
        <div className="field">
          <label className="field__label" htmlFor="ev-budget">Budget</label>
          <select
            id="ev-budget"
            className="select"
            value={draft.budget}
            onChange={(event_) => set("budget", event_.target.value as BudgetBand)}
          >
            {BUDGET_BANDS.map((band) => (
              <option key={band} value={band}>{band}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ev-effort">Effort</label>
          <select
            id="ev-effort"
            className="select"
            value={draft.effort}
            onChange={(event_) => set("effort", event_.target.value as Effort)}
          >
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="ev-price">
            Price <span className="field__optional">₾</span>
          </label>
          <input
            id="ev-price"
            className="input"
            type="number"
            min={0}
            value={draft.price ?? ""}
            onChange={(event_) =>
              set("price", event_.target.value === "" ? undefined : Number(event_.target.value))
            }
          />
        </div>
      </div>

      <div className="field">
        <span className="field__label">Interests</span>
        <div className="join__grid">
          {INTERESTS.map((interest) => {
            const active = draft.interests.includes(interest);
            return (
              <button
                key={interest}
                type="button"
                className="join__tile"
                data-active={active}
                aria-pressed={active}
                onClick={() =>
                  set(
                    "interests",
                    active
                      ? draft.interests.filter((entry) => entry !== interest)
                      : [...draft.interests, interest],
                  )
                }
              >
                {INTEREST_LABEL[interest]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field-row">
        <label className="hp__toggle">
          <input
            type="checkbox"
            checked={draft.indoor}
            onChange={(event_) => set("indoor", event_.target.checked)}
          />
          Indoors
        </label>
        <label className="hp__toggle">
          <input
            type="checkbox"
            checked={draft.requiresBooking}
            onChange={(event_) => set("requiresBooking", event_.target.checked)}
          />
          Needs booking
        </label>
      </div>

      <label className="hp__toggle">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event_) => set("active", event_.target.checked)}
        />
        Active
      </label>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hp__actions">
        <button type="button" className="btn btn--sm" disabled={saving} onClick={() => void save()}>
          <Save size={14} strokeWidth={2.4} aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </button>
        {event ? (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={saving}
            onClick={() =>
              void (async () => {
                setSaving(true);
                await hotelEvents.remove(event.id);
                onDone();
              })()
            }
          >
            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
