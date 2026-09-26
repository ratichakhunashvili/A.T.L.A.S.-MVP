/**
 * Hotels: the list, and one hotel's detail with its tabs.
 *
 * The tab set follows the shape of the product rather than the shape of the
 * database: a hotel is its QR code, its partners, what it runs itself, what is
 * on tonight, and how any of that is going.
 */

import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  Handshake,
  Hotel as HotelIcon,
  Loader2,
  MapPin,
  Plus,
  QrCode,
  Save,
  Sparkles,
  Box,
  ChevronDown,
  Gift,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { AnalyticsPanel } from "./AnalyticsPanel";
import { ConfirmDialog } from "../ConfirmDialog";
import { LocationPicker } from "../LocationPicker";
import { EventsPanel } from "./EventsPanel";
import { ExperiencePanel } from "./ExperiencePanel";
import { PartnersPanel } from "./PartnersPanel";
import { QRPanel } from "./QRPanel";
import {
  hotels,
  activeCodeForHotel,
  deleteHotel,
  hotelQRCodes,
  previewHotelDeletion,
  type HotelDeletionImpact,
} from "../../data/repositories/hotels";
import { eligiblePartnerExperiences, hotelPartners } from "../../data/repositories/catalogue";
import { useCollection, useQuery } from "../../data/useCollection";
import { useModels } from "../../data/useModels";
import { generatePlanForGuest } from "../../engine/service";
import { REWARD_PRESETS, type Hotel, type HotelDraft, type HotelReward } from "../../data/domain";
import "./hotels.css";

type Tab = "overview" | "qr" | "partners" | "activities" | "events" | "analytics";

const TABS: { id: Tab; label: string; icon: typeof QrCode }[] = [
  { id: "overview", label: "Overview", icon: Building2 },
  { id: "qr", label: "QR", icon: QrCode },
  { id: "partners", label: "Partners", icon: Handshake },
  { id: "activities", label: "Activities", icon: Sparkles },
  { id: "events", label: "Events", icon: CalendarDays },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
];

export function HotelsSection() {
  const { items, loading } = useCollection(hotels);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => items.find((hotel) => hotel.id === selectedId) ?? null,
    [items, selectedId],
  );

  if (creating) {
    return (
      <HotelForm
        hotel={null}
        onDone={(created) => {
          setCreating(false);
          if (created) setSelectedId(created.id);
        }}
      />
    );
  }

  if (selected) {
    return <HotelDetail hotel={selected} onBack={() => setSelectedId(null)} />;
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
          <p className="hp__count">
            {items.length} {items.length === 1 ? "property" : "properties"}
          </p>
          <p className="hp__muted">Each one has its own QR code and its own partner network.</p>
        </div>
        <button type="button" className="btn btn--sm btn--accent" onClick={() => setCreating(true)}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          New hotel
        </button>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <HotelIcon size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <p className="empty-state__title">No hotels yet</p>
          <p className="empty-state__body">
            Create one, generate its QR code, and attach the partners its guests should see.
          </p>
        </div>
      ) : (
        <ul className="hp__list">
          {items.map((hotel) => (
            <HotelRow key={hotel.id} hotel={hotel} onOpen={() => setSelectedId(hotel.id)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function HotelRow({ hotel, onOpen }: { hotel: Hotel; onOpen: () => void }) {
  const { data } = useQuery(
    async () => {
      const [code, partners] = await Promise.all([
        activeCodeForHotel(hotel.id),
        eligiblePartnerExperiences(hotel.id),
      ]);
      return { hasCode: Boolean(code), scans: code?.scanCount ?? 0, partners: partners.length };
    },
    [hotelQRCodes, hotelPartners],
    [hotel.id],
  );

  return (
    <li className="hp__row hp__row--tall">
      <span className="hp__row-icon">
        <HotelIcon size={15} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="hp__row-main">
        <span className="hp__row-title">
          {hotel.name}
          {hotel.active ? null : <span className="hp__badge hp__badge--warn">Inactive</span>}
        </span>
        <span className="hp__row-sub">
          {hotel.city}
          {data ? ` · ${data.partners} partners · ${data.scans} scans` : ""}
          {data && !data.hasCode ? " · no QR code" : ""}
        </span>
      </span>
      <button type="button" className="btn btn--sm" onClick={onOpen}>
        Manage
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------------ */
/* Detail                                                                    */
/* ------------------------------------------------------------------------ */

function HotelDetail({ hotel, onBack }: { hotel: Hotel; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="hp__detail">
      <div className="hp__detail-head">
        <button type="button" className="admin__back" onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" />
          Hotels
        </button>
        <div>
          <h2 className="hp__detail-title">{hotel.name}</h2>
          <p className="hp__muted">
            {hotel.address}, {hotel.city}
          </p>
        </div>
      </div>

      <nav className="hp__tabs" aria-label="Hotel sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className="hp__tab"
            data-active={tab === id}
            aria-current={tab === id}
            onClick={() => setTab(id)}
          >
            <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>

      <div className="hp__tabbody">
        {tab === "overview" ? (
          <HotelForm hotel={hotel} onDone={() => undefined} onDeleted={onBack} />
        ) : null}
        {tab === "qr" ? <QRPanel hotel={hotel} /> : null}
        {tab === "partners" ? (
          <PartnersPanel hotel={hotel} onEdit={() => setTab("activities")} />
        ) : null}
        {tab === "activities" ? (
          <>
            <ExperiencePanel hotel={hotel} ownedOnly />
            <div className="hp__divider" />
            <ExperiencePanel hotel={hotel} ownedOnly={false} />
          </>
        ) : null}
        {tab === "events" ? <EventsPanel hotel={hotel} /> : null}
        {tab === "analytics" ? <AnalyticsPanel hotel={hotel} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Form                                                                      */
/* ------------------------------------------------------------------------ */

function HotelForm({
  hotel,
  onDone,
  onDeleted,
}: {
  hotel: Hotel | null;
  onDone: (created: Hotel | null) => void;
  /** Called once the property and everything under it is gone. */
  onDeleted?: () => void;
}) {
  const [draft, setDraft] = useState<HotelDraft>(() =>
    hotel
      ? { ...hotel }
      : {
          name: "",
          address: "",
          city: "",
          latitude: 41.69314,
          longitude: 44.80217,
          active: true,
          timezone: "Asia/Tbilisi",
          checkInTime: "14:00",
          checkOutTime: "11:00",
        },
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dryRun, setDryRun] = useState<string | null>(null);
  /** Non-null once the operator has asked to delete and we know the cost. */
  const [pendingDelete, setPendingDelete] = useState<HotelDeletionImpact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [manualCoords, setManualCoords] = useState(false);
  const { models } = useModels("all");

  const set = <K extends keyof HotelDraft>(key: K, value: HotelDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!draft.name.trim()) {
      setError("The hotel needs a name.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (hotel) {
        await hotels.update(hotel.id, draft);
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
        onDone(null);
      } else {
        const created = await hotels.create(draft);
        // A hotel with no QR cannot take guests, so one is issued with it.
        const { issueQRCode } = await import("../../data/repositories/hotels");
        await issueQRCode(created.id, "Reception desk");
        onDone(created);
      }
    } finally {
      setSaving(false);
    }
  }

  /**
   * Runs the engine without saving anything.
   *
   * The fastest way for an operator to answer "why is this hotel's plan
   * empty?" — it reports what the rules actually did rather than making them
   * reverse-engineer it from a guest's screen.
   */
  async function preview() {
    if (!hotel) return;
    setDryRun("Running…");
    const result = await generatePlanForGuest({
      guestId: "admin-preview",
      hotelId: hotel.id,
      dryRun: true,
      skipAI: true,
    });

    if (result.blocked) {
      setDryRun(
        result.blocked === "no_reservation"
          ? "No preview guest: create a stay by scanning this hotel's QR yourself."
          : `Blocked: ${result.blocked.replace(/_/g, " ")}`,
      );
      return;
    }

    const { diagnostics, plan } = result;
    const rejections = [...diagnostics.rejections.entries()]
      .map(([reason, count]) => `${count} ${reason.replace(/_/g, " ")}`)
      .join(", ");

    setDryRun(
      `${plan.tasks.length} tasks from ${diagnostics.eligibleCount}/${diagnostics.candidatesConsidered} eligible · ` +
        `${Math.round(diagnostics.totalFreeMin / 60)}h free · score ${diagnostics.activityScore} · ` +
        `limited by ${diagnostics.taskBudget.limitedBy.replace(/_/g, " ")}` +
        (rejections ? ` · filtered: ${rejections}` : ""),
    );
  }

  return (
    <div className="hp hp__form">
      <div className="field">
        <label className="field__label" htmlFor="h-name">Name</label>
        <input
          id="h-name"
          className="input"
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Hotel Veli"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="h-tag">
          Tagline <span className="field__optional">optional</span>
        </label>
        <input
          id="h-tag"
          className="input"
          value={draft.tagline ?? ""}
          onChange={(event) => set("tagline", event.target.value || undefined)}
          placeholder="Old Tbilisi, one street back from Freedom Square."
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="h-addr">Address</label>
          <input
            id="h-addr"
            className="input"
            value={draft.address}
            onChange={(event) => set("address", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="h-city">City</label>
          <input
            id="h-city"
            className="input"
            value={draft.city}
            onChange={(event) => set("city", event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <span className="field__label">Where the property is</span>
        <LocationPicker
          value={{ latitude: draft.latitude, longitude: draft.longitude }}
          onChange={(next) =>
            setDraft((current) => ({
              ...current,
              latitude: next.latitude,
              longitude: next.longitude,
            }))
          }
          label={draft.name || "New hotel"}
        />
        <p className="field__hint">
          Search, click the map, or drag the pin. This is where the guest's day starts and what
          "at your hotel" measures from.
        </p>

        <button
          type="button"
          className="hp__disclose"
          aria-expanded={manualCoords}
          onClick={() => setManualCoords((current) => !current)}
        >
          <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" />
          Type coordinates instead
        </button>

        {manualCoords ? (
          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="h-lat">Latitude</label>
              <input
                id="h-lat"
                className="input"
                type="number"
                step="0.000001"
                value={draft.latitude}
                onChange={(event) => set("latitude", Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="h-lng">Longitude</label>
              <input
                id="h-lng"
                className="input"
                type="number"
                step="0.000001"
                value={draft.longitude}
                onChange={(event) => set("longitude", Number(event.target.value))}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="h-tz">Timezone</label>
          <input
            id="h-tz"
            className="input"
            value={draft.timezone}
            onChange={(event) => set("timezone", event.target.value)}
          />
          <p className="field__hint">The day rolls over at midnight here.</p>
        </div>

        {/* Attached, not uploaded: the model library is managed on its own
            tab, and the same asset can represent more than one thing. */}
        <div className="field">
          <label className="field__label" htmlFor="h-model">
            3D model <span className="field__optional">optional</span>
          </label>
          <select
            id="h-model"
            className="select"
            value={draft.modelId ?? ""}
            onChange={(event) => set("modelId", event.target.value || undefined)}
          >
            <option value="">No model</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
                {model.status === "published" ? "" : ` (${model.status})`}
              </option>
            ))}
          </select>
          <p className="field__hint">
            <Box size={11} strokeWidth={2.2} aria-hidden="true" /> Shown on the guest map at the
            property's location.
          </p>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="h-in">Check-in from</label>
          <input
            id="h-in"
            className="input"
            type="time"
            value={draft.checkInTime}
            onChange={(event) => set("checkInTime", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="h-out">Check-out by</label>
          <input
            id="h-out"
            className="input"
            type="time"
            value={draft.checkOutTime}
            onChange={(event) => set("checkOutTime", event.target.value)}
          />
        </div>
      </div>

      {/*
        What the guest gets for finishing the day.

        One concrete thing, claimed at the desk. Not a balance, not a tier,
        and not something that accumulates — the whole reason the points
        system came out.
      */}
      <div className="hp__block">
        <div className="hp__block-head">
          <span className="hp__row-icon">
            <Gift size={16} strokeWidth={2.2} aria-hidden="true" />
          </span>
          <div>
            <p className="hp__count">Daily reward</p>
            <p className="hp__muted">
              Unlocked only when the guest completes every task in a day.
            </p>
          </div>
        </div>

        <div className="chip-row">
          {REWARD_PRESETS.map((preset) => (
            <button
              key={preset.title}
              type="button"
              className="chip"
              data-active={draft.dailyReward?.title === preset.title}
              onClick={() => set("dailyReward", preset)}
            >
              {preset.title}
            </button>
          ))}
        </div>

        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor="h-reward">What it is</label>
            <input
              id="h-reward"
              className="input"
              value={draft.dailyReward?.title ?? ""}
              onChange={(event) =>
                set(
                  "dailyReward",
                  event.target.value
                    ? ({ ...draft.dailyReward, title: event.target.value } as HotelReward)
                    : undefined,
                )
              }
              placeholder="A coffee on us"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="h-reward-where">
              Where to claim it <span className="field__optional">optional</span>
            </label>
            <input
              id="h-reward-where"
              className="input"
              value={draft.dailyReward?.location ?? ""}
              disabled={!draft.dailyReward?.title}
              onChange={(event) =>
                set("dailyReward", {
                  ...(draft.dailyReward ?? { title: "" }),
                  location: event.target.value || undefined,
                })
              }
              placeholder="Lobby bar"
            />
          </div>
        </div>

        {draft.dailyReward?.title ? (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => set("dailyReward", undefined)}
          >
            Remove reward
          </button>
        ) : null}
      </div>

      <label className="hp__toggle">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set("active", event.target.checked)}
        />
        Taking guests
        <span className="field__hint">
          Switching this off makes the QR code refuse new onboarding. Existing guests keep their
          plans.
        </span>
      </label>

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="hp__actions">
        <button type="button" className="btn btn--sm" disabled={saving} onClick={() => void save()}>
          <Save size={14} strokeWidth={2.4} aria-hidden="true" />
          {saving ? "Saving…" : saved ? "Saved" : hotel ? "Save changes" : "Create hotel"}
        </button>

        {hotel ? (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void preview()}>
            <MapPin size={14} strokeWidth={2.2} aria-hidden="true" />
            Dry-run the engine
          </button>
        ) : null}

        {hotel ? (
          <button
            type="button"
            className="btn btn--sm btn--danger hp__delete"
            disabled={deleting}
            onClick={() =>
              void previewHotelDeletion(hotel.id).then(setPendingDelete)
            }
          >
            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
            Delete property
          </button>
        ) : null}
      </div>

      {dryRun ? <p className="hp__dryrun">{dryRun}</p> : null}

      {/*
        Deactivating and deleting are different answers to different problems,
        and the form says so rather than leaving an operator to guess which
        one they want.
      */}
      {hotel ? (
        <p className="hp__muted">
          Closing for the season? Turn off <strong>Taking guests</strong> instead — it stops new
          onboarding without losing anything.
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${hotel?.name ?? "this property"}?`}
        body={pendingDelete ? describeImpact(pendingDelete) : ""}
        confirmLabel="Delete property"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!hotel) return;
          setPendingDelete(null);
          setDeleting(true);
          void deleteHotel(hotel.id)
            .then(() => onDeleted?.())
            .finally(() => setDeleting(false));
        }}
      />
    </div>
  );
}

/**
 * The confirmation copy, built from the real counts.
 *
 * Naming what survives matters as much as naming what goes: an operator who
 * thinks deleting a hotel destroys the shared partner catalogue will never
 * press the button, and one who does not realise guest data goes with it
 * should not press it yet.
 */
function describeImpact(impact: HotelDeletionImpact): string {
  const going: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) going.push(`${count} ${count === 1 ? one : many}`);
  };

  add(impact.qrCodes, "QR code", "QR codes");
  add(impact.ownedActivities, "hotel activity", "hotel activities");
  add(impact.events, "event", "events");
  add(impact.partnerLinks, "partner link", "partner links");
  add(impact.reservations, "reservation", "reservations");
  add(impact.plans, "daily plan", "daily plans");

  const removed =
    going.length > 0 ? `This removes ${formatList(going)}.` : "This property has nothing attached.";

  const guests =
    impact.guests > 0
      ? ` ${impact.guests} ${impact.guests === 1 ? "guest loses their" : "guests lose their"} plan and history.`
      : "";

  const kept =
    impact.partnerLinks > 0
      ? " The partner experiences themselves are kept — other hotels may still sell them."
      : "";

  return `${removed}${guests}${kept} Printed QR codes stop working immediately. This cannot be undone.`;
}

function formatList(items: string[]): string {
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
