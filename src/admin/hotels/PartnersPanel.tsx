/**
 * The hotel's partner network.
 *
 * This screen is where the product's central restriction is administered: the
 * rows attached here are the complete set of outside experiences the
 * recommendation engine may ever offer this hotel's guests. Detaching one
 * removes it from every plan generated afterwards, immediately.
 *
 * Detaching is not deleting. The row is deactivated so the hotel's negotiated
 * priority and commission survive a seasonal pause, and so last quarter's
 * analytics still have something to point at.
 */

import { Box, Handshake, Link2, Loader2, Plus, Star, Unlink } from "lucide-react";
import { useState } from "react";

import {
  attachPartner,
  detachPartner,
  experiences as experienceRepo,
  hotelPartners,
  partnersForHotel,
} from "../../data/repositories/catalogue";
import { useQuery } from "../../data/useCollection";
import { CATEGORY_ICON } from "../../ui/icons";
import { ACTIVITY_TYPE_LABEL, isInsideHotel, type Hotel } from "../../data/domain";

export function PartnersPanel({ hotel, onEdit }: { hotel: Hotel; onEdit: (id: string) => void }) {
  const { data: rows, loading } = useQuery(
    () => partnersForHotel(hotel.id),
    [hotelPartners, experienceRepo],
    [hotel.id],
  );

  const { data: catalogue } = useQuery(
    () => experienceRepo.list(),
    [experienceRepo],
    [],
  );

  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading || !rows) {
    return (
      <div className="empty-state">
        <Loader2 size={20} className="day__spin" aria-hidden="true" />
      </div>
    );
  }

  const attached = rows.filter((entry) => entry.partner.active);
  const detached = rows.filter((entry) => !entry.partner.active);

  /*
   * What this hotel could add: anything in the catalogue that is not already
   * attached and is not another hotel's own activity. The same experience can
   * be sold by any number of hotels, which is exactly why partnership is a
   * join table rather than a field on the experience.
   */
  const available = (catalogue ?? []).filter(
    (experience) =>
      !isInsideHotel(experience.type) &&
      !experience.hotelId &&
      !rows.some((entry) => entry.experience.id === experience.id && entry.partner.active),
  );

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="hp">
      <div className="hp__head">
        <div>
          <p className="hp__count">
            {attached.length} {attached.length === 1 ? "partner" : "partners"}
          </p>
          <p className="hp__muted">
            Only these experiences can be recommended to guests of {hotel.name}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--sm btn--accent"
          onClick={() => setAdding((current) => !current)}
        >
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          Add partner
        </button>
      </div>

      {adding ? (
        <div className="hp__picker">
          <p className="section-label">Attach an existing experience</p>
          {available.length === 0 ? (
            <p className="hp__muted">
              Everything in the catalogue is already attached. Create a new experience on the
              Experiences tab first.
            </p>
          ) : (
            <ul className="hp__list">
              {available.map((experience) => {
                const Icon = CATEGORY_ICON[experience.category];
                return (
                  <li key={experience.id} className="hp__row">
                    <span className="hp__row-icon">
                      <Icon size={15} strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="hp__row-main">
                      <span className="hp__row-title">{experience.name}</span>
                      <span className="hp__row-sub">
                        {ACTIVITY_TYPE_LABEL[experience.type]} · {experience.durationMin} min
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn--sm"
                      disabled={busy === experience.id}
                      onClick={() =>
                        void run(experience.id, async () => {
                          await attachPartner(hotel.id, experience.id);
                          setAdding(false);
                        })
                      }
                    >
                      <Link2 size={13} strokeWidth={2.4} aria-hidden="true" />
                      Attach
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {attached.length === 0 && !adding ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Handshake size={22} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <p className="empty-state__title">No partners yet</p>
          <p className="empty-state__body">
            Until this hotel attaches partners, guests are offered hotel activities and events
            only. No outside attraction appears in a plan without a partner row.
          </p>
        </div>
      ) : null}

      {attached.length > 0 ? (
        <ul className="hp__list">
          {attached.map(({ partner, experience }) => {
            const Icon = CATEGORY_ICON[experience.category];
            return (
              <li key={partner.id} className="hp__row hp__row--tall">
                <span className="hp__row-icon" data-featured={partner.featured}>
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                </span>

                <span className="hp__row-main">
                  <span className="hp__row-title">
                    {experience.name}
                    {partner.featured ? (
                      <Star size={12} strokeWidth={2.6} className="hp__star" aria-label="Featured" />
                    ) : null}
                    {experience.modelId ? (
                      <Box size={12} strokeWidth={2.2} className="hp__model" aria-label="Has a 3D model" />
                    ) : null}
                  </span>
                  <span className="hp__row-sub">
                    {ACTIVITY_TYPE_LABEL[experience.type]} · {experience.durationMin} min ·{" "}
                    {experience.budget}
                    {partner.commissionPct ? ` · ${partner.commissionPct}% commission` : ""}
                  </span>
                </span>

                {/* Priority nudges ranking; it cannot override a hard rule. */}
                <label className="hp__priority">
                  <span className="visually-hidden">Priority for {experience.name}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={partner.priority}
                    onChange={(event) =>
                      void hotelPartners.update(partner.id, {
                        priority: Number(event.target.value),
                      })
                    }
                  />
                  <span className="hp__priority-value">{partner.priority}</span>
                </label>

                <div className="hp__row-actions">
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() =>
                      void hotelPartners.update(partner.id, { featured: !partner.featured })
                    }
                    aria-pressed={partner.featured}
                  >
                    <Star size={13} strokeWidth={2.2} aria-hidden="true" />
                    {partner.featured ? "Featured" : "Feature"}
                  </button>

                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    onClick={() => onEdit(experience.id)}
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    disabled={busy === partner.id}
                    onClick={() => void run(partner.id, () => detachPartner(hotel.id, experience.id))}
                  >
                    <Unlink size={13} strokeWidth={2.2} aria-hidden="true" />
                    Detach
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {detached.length > 0 ? (
        <>
          <p className="section-label hp__section">Detached</p>
          <p className="hp__muted">
            Kept so their terms and history survive. Guests are not offered these.
          </p>
          <ul className="hp__list">
            {detached.map(({ partner, experience }) => (
              <li key={partner.id} className="hp__row hp__row--muted">
                <span className="hp__row-main">
                  <span className="hp__row-title">{experience.name}</span>
                  <span className="hp__row-sub">Priority {partner.priority}</span>
                </span>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={busy === partner.id}
                  onClick={() =>
                    void run(partner.id, () => attachPartner(hotel.id, experience.id))
                  }
                >
                  <Link2 size={13} strokeWidth={2.2} aria-hidden="true" />
                  Re-attach
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
