/**
 * Missions — a bottom sheet over the map.
 *
 * The running mission is the hero: where the guest is, what is left, and what
 * it pays. Steps are live — tapping one flies the camera to that place and
 * opens its card, which is the whole point of missions living on a map rather
 * than in a list.
 */

import { ChevronRight, MapPin, Trophy } from "lucide-react";
import { useMemo, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { CATEGORY_ICON } from "../ui/icons";
import { CATEGORY_LABEL, type Mission, type PlaceCategory } from "../data/types";

interface MissionPanelProps {
  open: boolean;
  onClose: () => void;
  missions: Mission[];
  onGoToPlace: (placeId: string) => void;
}

export function MissionPanel({ open, onClose, missions, onGoToPlace }: MissionPanelProps) {
  const [filter, setFilter] = useState<PlaceCategory | "all">("all");

  const active = missions.find((mission) => mission.active) ?? missions[0];
  /*
   * Only what still needs doing.
   *
   * A finished mission in the active list reads as something to start again,
   * which is exactly wrong. Completed ones stay in history; this panel is the
   * list of things outstanding.
   */
  const others = missions.filter(
    (mission) =>
      mission.id !== active?.id && mission.steps.some((step) => !step.done),
  );

  const categories = useMemo(() => {
    const present = new Set(others.map((mission) => mission.category));
    return Array.from(present);
  }, [others]);

  const visible = filter === "all" ? others : others.filter((m) => m.category === filter);

  const done = active ? active.steps.filter((step) => step.done).length : 0;
  const total = active?.steps.length ?? 0;
  const nextIndex = active?.steps.findIndex((step) => !step.done) ?? -1;

  return (
    <BottomSheet open={open} onClose={onClose} label="Missions">
      <SheetHeader eyebrow="Mission" title={active?.title ?? "No mission yet"} onClose={onClose} />

      <div className="sheet__scroll scroll-region">
        {active ? (
          <>
            <div className="mission-hero">
              <p className="mission-hero__subtitle">{active.subtitle}</p>

              <div className="mission-stats">
                <div className="mission-progress">
                  <div className="progress-head">
                    <span className="eyebrow">Progress</span>
                    <span className="progress-count">
                      {done} / {total}
                    </span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={done}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-label={`${done} of ${total} steps complete`}
                  >
                    <div
                      className="progress-fill"
                      style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                    />
                  </div>
                </div>

                <span className="reward-chip">
                  <Trophy size={13} strokeWidth={2.4} aria-hidden="true" />
                  {total - done} to go
                </span>
              </div>
            </div>

            <div className="section-label">
              <span className="eyebrow">Steps</span>
              <span className="eyebrow">{total - done} left</span>
            </div>

            <ul className="step-list">
              {active.steps.map((step, index) => (
                <li key={step.id}>
                  <button
                    type="button"
                    className="step"
                    data-done={step.done}
                    data-next={index === nextIndex}
                    disabled={!step.placeId}
                    onClick={() => step.placeId && onGoToPlace(step.placeId)}
                  >
                    <span className="step__mark" aria-hidden="true">
                      {step.done ? "✓" : index + 1}
                    </span>
                    <span className="step__body">
                      <span className="step__title">{step.title}</span>
                      <span className="step__detail">{step.detail}</span>
                    </span>
                    {step.placeId ? (
                      <ChevronRight size={16} className="pref__chevron" aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="section-label">
          <span className="eyebrow">Nearby missions</span>
        </div>

        <div className="chip-row" role="group" aria-label="Filter missions by category">
          <button
            type="button"
            className="chip"
            data-active={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {categories.map((category) => {
            const Icon = CATEGORY_ICON[category];
            return (
              <button
                key={category}
                type="button"
                className="chip"
                data-active={filter === category}
                onClick={() => setFilter(category)}
              >
                <Icon size={13} strokeWidth={2.2} aria-hidden="true" />
                {CATEGORY_LABEL[category]}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 10 }}>
          {visible.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <MapPin size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <p className="empty-state__title">Nothing in that category</p>
              <p className="empty-state__body">Try another category, or head back to the map.</p>
            </div>
          ) : (
            visible.map((mission) => {
              const Icon = CATEGORY_ICON[mission.category];
              const first = mission.steps.find((step) => step.placeId);
              return (
                <button
                  key={mission.id}
                  type="button"
                  className="mission-card"
                  disabled={!first?.placeId}
                  onClick={() => first?.placeId && onGoToPlace(first.placeId)}
                >
                  <span className="mission-card__icon">
                    <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="step__body">
                    <span className="mission-card__title">{mission.title}</span>
                    <span className="mission-card__meta">
                      {mission.steps.length} steps · {mission.distanceKm} km away
                    </span>
                  </span>
                  <span className="mission-card__reward">
                    {mission.steps.filter((step) => !step.done).length} left
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
