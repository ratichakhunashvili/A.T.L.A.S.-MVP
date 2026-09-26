/**
 * Experiences — the catalogue, and the form that edits one.
 *
 * Two things worth calling out:
 *
 * A hotel activity carries `hotelId` and needs no partner row; a partner
 * experience carries neither and is attached to hotels separately. The form
 * sets this from the chosen type rather than asking, because getting it wrong
 * is the one mistake that would break the partner restriction.
 *
 * A 3D model is *attached* here, from the models the admin has already
 * uploaded. It is never uploaded again per experience, and attaching one
 * grants no partner status — the model is the visual, the partner row is the
 * permission.
 */

import { Box, ChevronDown, Loader2, Plus, QrCode, Save, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { LocationPicker } from "../LocationPicker";
import { QRCard } from "../QRCard";
import { Sticker, STICKER_ICON_NAMES, TONE_LABEL } from "../../ui/achievements/Sticker";
import {
  achievementFor,
  suggestAchievement,
  upsertForAttraction,
  achievements as achievementRepo,
} from "../../data/repositories/achievements";
import { scanUrl } from "../../data/repositories/catalogue";

import {
  experiences as experienceRepo,
  hotelPartners,
} from "../../data/repositories/catalogue";
import { useCollection, useQuery } from "../../data/useCollection";
import { useModels } from "../../data/useModels";
import { CATEGORY_ICON } from "../../ui/icons";
import { PLACE_CATEGORIES, CATEGORY_LABEL, type PlaceCategory } from "../../data/types";
import {
  ACHIEVEMENT_TONES,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABEL,
  BUDGET_BANDS,
  INTEREST_LABEL,
  INTERESTS,
  isInsideHotel,
  type AchievementDraft,
  type AchievementTone,
  type ActivityType,
  type BudgetBand,
  type Effort,
  type Experience,
  type ExperienceDraft,
  type Hotel,
  type Interest,
  type OpeningInterval,
} from "../../data/domain";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EFFORTS: Effort[] = ["low", "medium", "high"];

/* ------------------------------------------------------------------------ */
/* List                                                                      */
/* ------------------------------------------------------------------------ */

interface ExperiencePanelProps {
  hotel: Hotel;
  /** Restricts the list to this hotel's own activities. */
  ownedOnly: boolean;
}

export function ExperiencePanel({ hotel, ownedOnly }: ExperiencePanelProps) {
  const { items, loading } = useCollection(experienceRepo);
  const [editing, setEditing] = useState<Experience | "new" | null>(null);

  const visible = useMemo(() => {
    if (ownedOnly) {
      return items.filter(
        (experience) => experience.hotelId === hotel.id && isInsideHotel(experience.type),
      );
    }
    return items.filter((experience) => !isInsideHotel(experience.type));
  }, [items, hotel.id, ownedOnly]);

  if (editing) {
    return (
      <ExperienceForm
        hotel={hotel}
        experience={editing === "new" ? null : editing}
        defaultOwned={ownedOnly}
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
          <p className="hp__count">
            {visible.length} {ownedOnly ? "hotel activities" : "experiences in the catalogue"}
          </p>
          <p className="hp__muted">
            {ownedOnly
              ? "Run by the hotel. Always eligible for this hotel's guests."
              : "Shared across hotels. A hotel must attach one before its guests see it."}
          </p>
        </div>
        <button type="button" className="btn btn--sm btn--accent" onClick={() => setEditing("new")}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          New
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">Nothing here yet</p>
          <p className="empty-state__body">
            {ownedOnly
              ? "Add the spa, the rooftop, breakfast — anything a guest can do without leaving."
              : "Add a castle, a winery, a restaurant, then attach it to the hotels that sell it."}
          </p>
        </div>
      ) : (
        <ul className="hp__list">
          {visible.map((experience) => {
            const Icon = CATEGORY_ICON[experience.category];
            return (
              <li key={experience.id} className="hp__row">
                <span className="hp__row-icon">
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="hp__row-main">
                  <span className="hp__row-title">
                    {experience.name}
                    {experience.modelId ? (
                      <Box size={12} strokeWidth={2.2} className="hp__model" aria-label="3D model attached" />
                    ) : null}
                  </span>
                  <span className="hp__row-sub">
                    {ACTIVITY_TYPE_LABEL[experience.type]} · {experience.durationMin} min ·{" "}
                    {experience.budget}
                    {experience.active ? "" : " · inactive"}
                  </span>
                </span>
                <PartnerCount experienceId={experience.id} />
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => setEditing(experience)}
                >
                  Edit
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** How many hotels sell this — the reuse the many-to-many exists for. */
function PartnerCount({ experienceId }: { experienceId: string }) {
  const { data } = useQuery(
    async () => {
      const rows = await hotelPartners.list();
      return rows.filter((row) => row.experienceId === experienceId && row.active).length;
    },
    [hotelPartners],
    [experienceId],
  );

  if (!data) return null;
  return (
    <span className="hp__badge" title={`Sold by ${data} ${data === 1 ? "hotel" : "hotels"}`}>
      {data} {data === 1 ? "hotel" : "hotels"}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Form                                                                      */
/* ------------------------------------------------------------------------ */

interface ExperienceFormProps {
  hotel: Hotel;
  experience: Experience | null;
  defaultOwned: boolean;
  onDone: () => void;
}

function ExperienceForm({ hotel, experience, defaultOwned, onDone }: ExperienceFormProps) {
  const { models } = useModels("all");
  const [draft, setDraft] = useState<ExperienceDraft>(() =>
    experience
      ? { ...experience }
      : {
          name: "",
          description: "",
          type: defaultOwned ? "HOTEL_ACTIVITY" : "PARTNER_ATTRACTION",
          category: defaultOwned ? "hotel" : "landmark",
          latitude: hotel.latitude,
          longitude: hotel.longitude,
          hotelId: defaultOwned ? hotel.id : undefined,
          durationMin: 60,
          openingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            opens: "09:00",
            closes: "18:00",
          })),
          budget: "moderate",
          effort: "low",
          interests: [],
          indoor: true,
          requiresBooking: false,
          isPartner: !defaultOwned,
          active: true,
        },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualCoords, setManualCoords] = useState(false);

  /*
   * The attraction's achievement, edited alongside it.
   *
   * Kept in the same form rather than behind another screen: an attraction
   * and the sticker you earn for going there are one thing to an admin, and
   * splitting them is how half of them end up without one.
   */
  const [achievement, setAchievement] = useState<AchievementDraft | null>(null);

  useEffect(() => {
    if (!experience) {
      setAchievement(null);
      return;
    }
    let cancelled = false;
    void achievementFor(experience.id).then((found) => {
      if (cancelled) return;
      setAchievement(found ?? suggestAchievement(experience));
    });
    return () => {
      cancelled = true;
    };
  }, [experience]);

  /*
   * Ownership follows the type, not a separate switch. A HOTEL_ACTIVITY
   * belongs to this hotel and sits at its coordinates; a partner experience
   * belongs to nobody and must carry its own.
   */
  useEffect(() => {
    const owned = isInsideHotel(draft.type);
    setDraft((current) => {
      if (owned && current.hotelId === hotel.id) return current;
      if (!owned && current.hotelId === undefined) return current;
      return owned
        ? { ...current, hotelId: hotel.id, latitude: hotel.latitude, longitude: hotel.longitude }
        : { ...current, hotelId: undefined };
    });
  }, [draft.type, hotel.id, hotel.latitude, hotel.longitude]);

  const set = <K extends keyof ExperienceDraft>(key: K, value: ExperienceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const owned = isInsideHotel(draft.type);

  async function save() {
    if (!draft.name.trim()) {
      setError("Give it a name.");
      return;
    }
    if (!Number.isFinite(draft.latitude) || !Number.isFinite(draft.longitude)) {
      setError("Latitude and longitude have to be numbers.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const saved = experience
        ? await experienceRepo.update(experience.id, draft)
        : await experienceRepo.create(draft);

      // One achievement per attraction, created or updated in the same step.
      if (achievement && draft.isPartner) {
        await upsertForAttraction(saved.id, {
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          tone: achievement.tone,
          stickerUrl: achievement.stickerUrl,
          active: achievement.active,
        });
      }

      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!experience) return;
    setSaving(true);
    try {
      // Detach everywhere first, or plans could reference a missing record.
      const rows = await hotelPartners.list();
      for (const row of rows.filter((entry) => entry.experienceId === experience.id)) {
        await hotelPartners.remove(row.id);
      }

      // The achievement belongs to the attraction, so it goes with it.
      // Guests keep the ones they have already collected; nothing new can be
      // unlocked for a place that no longer exists.
      const existing = await achievementFor(experience.id);
      if (existing) await achievementRepo.remove(existing.id);

      await experienceRepo.remove(experience.id);
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hp hp__form">
      <div className="hp__head">
        <p className="hp__count">{experience ? `Edit ${experience.name}` : "New experience"}</p>
        <button type="button" className="icon-btn" onClick={onDone} aria-label="Close">
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="xp-name">Name</label>
        <input
          id="xp-name"
          className="input"
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Narikala Fortress"
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="xp-desc">Description</label>
        <textarea
          id="xp-desc"
          className="textarea"
          rows={3}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
          placeholder="What a guest actually does here, in one or two sentences."
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="xp-type">Type</label>
          <select
            id="xp-type"
            className="select"
            value={draft.type}
            onChange={(event) => set("type", event.target.value as ActivityType)}
          >
            {ACTIVITY_TYPES.map((type) => (
              <option key={type} value={type}>{ACTIVITY_TYPE_LABEL[type]}</option>
            ))}
          </select>
          <p className="field__hint">
            {owned
              ? `Runs at ${hotel.name}. Always eligible for its guests.`
              : "A partner experience. Hotels must attach it before guests see it."}
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="xp-cat">Category</label>
          <select
            id="xp-cat"
            className="select"
            value={draft.category}
            onChange={(event) => set("category", event.target.value as PlaceCategory)}
          >
            {PLACE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{CATEGORY_LABEL[category]}</option>
            ))}
          </select>
        </div>
      </div>

      {/*
        Placing happens on the map. An admin knows where a castle is by
        looking at it, not by knowing its latitude.
      */}
      {owned ? (
        <p className="hp__muted">
          A hotel activity happens at {hotel.name}, so it uses the hotel's own location.
        </p>
      ) : (
        <div className="field">
          <span className="field__label">Where it is</span>
          <LocationPicker
            value={{ latitude: draft.latitude, longitude: draft.longitude }}
            onChange={(next) =>
              setDraft((current) => ({
                ...current,
                latitude: next.latitude,
                longitude: next.longitude,
              }))
            }
            label={draft.name || "New attraction"}
            reference={[{ latitude: hotel.latitude, longitude: hotel.longitude, name: hotel.name }]}
          />

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
                <label className="field__label" htmlFor="xp-lat">Latitude</label>
                <input
                  id="xp-lat"
                  className="input"
                  type="number"
                  step="0.000001"
                  value={draft.latitude}
                  onChange={(event) => set("latitude", Number(event.target.value))}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="xp-lng">Longitude</label>
                <input
                  id="xp-lng"
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
      )}

      <div className="field">
        <label className="field__label" htmlFor="xp-dur">Minutes on site</label>
        <input
          id="xp-dur"
          className="input"
          type="number"
          min={15}
          step={15}
          value={draft.durationMin}
          onChange={(event) => set("durationMin", Math.max(15, Number(event.target.value)))}
        />
      </div>

      <div className="field-row field-row--three">
        <div className="field">
          <label className="field__label" htmlFor="xp-budget">Budget</label>
          <select
            id="xp-budget"
            className="select"
            value={draft.budget}
            onChange={(event) => set("budget", event.target.value as BudgetBand)}
          >
            {BUDGET_BANDS.map((band) => (
              <option key={band} value={band}>{band}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="xp-effort">Effort</label>
          <select
            id="xp-effort"
            className="select"
            value={draft.effort}
            onChange={(event) => set("effort", event.target.value as Effort)}
          >
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort}>{effort}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="xp-price">
            Price <span className="field__optional">₾</span>
          </label>
          <input
            id="xp-price"
            className="input"
            type="number"
            min={0}
            value={draft.price ?? ""}
            onChange={(event) =>
              set("price", event.target.value === "" ? undefined : Number(event.target.value))
            }
          />
        </div>
      </div>

      <div className="field">
        <span className="field__label">Interests this satisfies</span>
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
                {INTEREST_LABEL[interest as Interest]}
              </button>
            );
          })}
        </div>
        <p className="field__hint">Drives preference matching. Two or three is usually right.</p>
      </div>

      <OpeningHoursEditor
        value={draft.openingHours}
        onChange={(hours) => set("openingHours", hours)}
      />

      {/* Attaching, never uploading. The model library is managed separately. */}
      <div className="field">
        <label className="field__label" htmlFor="xp-model">
          3D model <span className="field__optional">optional</span>
        </label>
        <select
          id="xp-model"
          className="select"
          value={draft.modelId ?? ""}
          onChange={(event) => set("modelId", event.target.value || undefined)}
        >
          <option value="">No model</option>
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name} {model.status === "published" ? "" : `(${model.status})`}
            </option>
          ))}
        </select>
        <p className="field__hint">
          The model is this experience's visual on the map. It does not make anything a partner —
          that is the hotel's partner list.
        </p>
      </div>

      <div className="field-row">
        <label className="hp__toggle">
          <input
            type="checkbox"
            checked={draft.indoor}
            onChange={(event) => set("indoor", event.target.checked)}
          />
          Indoors
          <span className="field__hint">Kept dry when the forecast is against outdoor plans.</span>
        </label>

        <label className="hp__toggle">
          <input
            type="checkbox"
            checked={draft.requiresBooking}
            onChange={(event) => set("requiresBooking", event.target.checked)}
          />
          Needs booking
        </label>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="xp-booking">
          Booking link <span className="field__optional">optional</span>
        </label>
        <input
          id="xp-booking"
          className="input"
          value={draft.bookingUrl ?? ""}
          onChange={(event) => set("bookingUrl", event.target.value || undefined)}
          placeholder="https://"
        />
      </div>

      {!owned ? (
        <label className="hp__toggle">
          <input
            type="checkbox"
            checked={draft.isPartner}
            onChange={(event) => set("isPartner", event.target.checked)}
          />
          Partner attraction
          <span className="field__hint">
            Partner attractions get a 3D model on the map, a printed code and an achievement.
            Partnership is stored here — a model alone never grants it.
          </span>
        </label>
      ) : null}

      <label className="hp__toggle">
        <input
          type="checkbox"
          checked={draft.active}
          onChange={(event) => set("active", event.target.checked)}
        />
        Active
        <span className="field__hint">
          Switching this off removes it from every hotel's plans immediately.
        </span>
      </label>

      {/* -- The achievement ------------------------------------------------ */}
      {draft.isPartner && achievement ? (
        <div className="hp__block">
          <div className="hp__block-head">
            <Sticker achievement={achievement} size={52} />
            <div>
              <p className="hp__count">Achievement</p>
              <p className="hp__muted">
                Unlocked by scanning this attraction's code. One per attraction.
              </p>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="ach-name">Name</label>
            <input
              id="ach-name"
              className="input"
              value={achievement.name}
              onChange={(event) =>
                setAchievement({ ...achievement, name: event.target.value })
              }
              placeholder="Narikala Explorer"
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="ach-desc">Description</label>
            <input
              id="ach-desc"
              className="input"
              value={achievement.description}
              onChange={(event) =>
                setAchievement({ ...achievement, description: event.target.value })
              }
              placeholder="Walked the walls above the old town."
            />
          </div>

          <div className="field-row">
            <div className="field">
              <label className="field__label" htmlFor="ach-icon">Sticker icon</label>
              <select
                id="ach-icon"
                className="select"
                value={achievement.icon}
                onChange={(event) =>
                  setAchievement({ ...achievement, icon: event.target.value })
                }
              >
                {STICKER_ICON_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ach-tone">Colour</label>
              <select
                id="ach-tone"
                className="select"
                value={achievement.tone}
                onChange={(event) =>
                  setAchievement({ ...achievement, tone: event.target.value as AchievementTone })
                }
              >
                {ACHIEVEMENT_TONES.map((tone) => (
                  <option key={tone} value={tone}>{TONE_LABEL[tone]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="ach-art">
              Sticker image <span className="field__optional">optional</span>
            </label>
            <input
              id="ach-art"
              className="input"
              value={achievement.stickerUrl ?? ""}
              onChange={(event) =>
                setAchievement({ ...achievement, stickerUrl: event.target.value || undefined })
              }
              placeholder="https://… — leave empty for the generated sticker"
            />
            <p className="field__hint">
              Until real art exists the generated sticker is used, so nothing looks unfinished.
            </p>
          </div>

          <label className="hp__toggle">
            <input
              type="checkbox"
              checked={achievement.active}
              onChange={(event) =>
                setAchievement({ ...achievement, active: event.target.checked })
              }
            />
            Achievement active
            <span className="field__hint">
              Switching this off stops new unlocks. Guests keep what they already collected.
            </span>
          </label>
        </div>
      ) : null}

      {/* -- The attraction's own code -------------------------------------- */}
      {experience && draft.isPartner ? (
        <div className="hp__block">
          <div className="hp__block-head">
            <span className="hp__row-icon">
              <QrCode size={16} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <div>
              <p className="hp__count">Attraction code</p>
              <p className="hp__muted">
                Print this for the site. Scanning it unlocks the achievement — no location
                permission needed.
              </p>
            </div>
          </div>

          <QRCard
            url={scanUrl(experience.id)}
            name={experience.name}
            instruction={`Scan here to collect “${achievement?.name ?? "your achievement"}”.`}
          />
        </div>
      ) : experience && !draft.isPartner ? (
        <p className="hp__muted">
          <Sparkles size={12} strokeWidth={2.2} aria-hidden="true" /> Hotel activities do not carry
          their own code or achievement — they are completed in the daily plan.
        </p>
      ) : null}

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
        {experience ? (
          <button
            type="button"
            className="btn btn--sm btn--danger"
            disabled={saving}
            onClick={() => void remove()}
          >
            <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Opening hours                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Per-weekday hours.
 *
 * A day with no row is closed, and an empty schedule altogether means "no
 * published hours" and is treated as always open — the distinction matters,
 * because a park with no listed hours should not disappear from every plan.
 */
function OpeningHoursEditor({
  value,
  onChange,
}: {
  value: OpeningInterval[];
  onChange: (hours: OpeningInterval[]) => void;
}) {
  return (
    <div className="field">
      <span className="field__label">Opening hours</span>
      <div className="hp__hours">
        {WEEKDAYS.map((label, weekday) => {
          const entry = value.find((interval) => interval.weekday === weekday);
          return (
            <div key={weekday} className="hp__hour-row">
              <label className="hp__hour-day">
                <input
                  type="checkbox"
                  checked={Boolean(entry)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...value, { weekday, opens: "09:00", closes: "18:00" }]
                        : value.filter((interval) => interval.weekday !== weekday),
                    )
                  }
                />
                {label}
              </label>

              {entry ? (
                <>
                  <input
                    className="input input--time"
                    type="time"
                    value={entry.opens}
                    aria-label={`${label} opens`}
                    onChange={(event) =>
                      onChange(
                        value.map((interval) =>
                          interval.weekday === weekday
                            ? { ...interval, opens: event.target.value }
                            : interval,
                        ),
                      )
                    }
                  />
                  <input
                    className="input input--time"
                    type="time"
                    value={entry.closes}
                    aria-label={`${label} closes`}
                    onChange={(event) =>
                      onChange(
                        value.map((interval) =>
                          interval.weekday === weekday
                            ? { ...interval, closes: event.target.value }
                            : interval,
                        ),
                      )
                    }
                  />
                </>
              ) : (
                <span className="hp__hour-closed">Closed</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="field__hint">
        Leave every day unticked for a place with no published hours — it will be treated as always
        open rather than never open.
      </p>
    </div>
  );
}
