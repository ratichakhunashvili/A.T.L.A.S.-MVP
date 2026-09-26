/**
 * The whole collection, and the choice of which three appear on the profile.
 *
 * Everything unlocked is shown, plus everything still out there — greyed, with
 * the place named, so the sheet doubles as a reason to go somewhere. Selection
 * is capped at three by the interface: a fourth tap is refused rather than
 * silently dropping the oldest, because a cap the guest cannot see is a cap
 * they will fight.
 */

import { Check, Lock, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { Sticker } from "../ui/achievements/Sticker";
import { useAchievements } from "../state/achievements";
import { listAchievements, type AchievementWithPlace } from "../data/repositories/achievements";
import { FEATURED_ACHIEVEMENT_COUNT } from "../data/domain";

interface AchievementsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function AchievementsSheet({ open, onClose }: AchievementsSheetProps) {
  const { collection, featured, chooseFeatured } = useAchievements();
  const [everything, setEverything] = useState<AchievementWithPlace[]>([]);
  const [selection, setSelection] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    void listAchievements().then(setEverything);
  }, [open, collection]);

  // Re-seed the working selection each time the sheet opens, so cancelling is
  // simply closing it.
  useEffect(() => {
    if (open) setSelection(featured.map((entry) => entry.achievement.id));
  }, [open, featured]);

  const heldIds = useMemo(
    () => new Set(collection.map((entry) => entry.achievement.id)),
    [collection],
  );

  const { unlocked, locked } = useMemo(() => {
    const active = everything.filter((entry) => entry.achievement.active);
    return {
      unlocked: active.filter((entry) => heldIds.has(entry.achievement.id)),
      locked: active.filter((entry) => !heldIds.has(entry.achievement.id)),
    };
  }, [everything, heldIds]);

  const full = selection.length >= FEATURED_ACHIEVEMENT_COUNT;

  function toggle(id: string) {
    setSelection((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      // Refuse a fourth rather than evicting something the guest chose.
      if (current.length >= FEATURED_ACHIEVEMENT_COUNT) return current;
      return [...current, id];
    });
    setSaved(false);
  }

  async function save() {
    await chooseFeatured(selection);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  const dirty =
    selection.join("|") !== featured.map((entry) => entry.achievement.id).join("|");

  return (
    <BottomSheet open={open} onClose={onClose} label="Achievements">
      <SheetHeader
        eyebrow="Your collection"
        title={
          collection.length === 0
            ? "Nothing yet"
            : `${collection.length} ${collection.length === 1 ? "achievement" : "achievements"}`
        }
        subtitle={
          collection.length === 0
            ? undefined
            : `Choose ${FEATURED_ACHIEVEMENT_COUNT} to show on your profile.`
        }
        onClose={onClose}
      />

      <div className="sheet__scroll scroll-region">
        {collection.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Trophy size={22} strokeWidth={1.8} aria-hidden="true" />
            </span>
            <p className="empty-state__title">Your collection starts at the first place you visit</p>
            <p className="empty-state__body">
              Scan the code at an attraction and its sticker is yours.
            </p>
          </div>
        ) : (
          <>
            <div className="ach-grid">
              {unlocked.map(({ achievement, attraction }) => {
                const chosen = selection.includes(achievement.id);
                return (
                  <button
                    key={achievement.id}
                    type="button"
                    className="ach-card"
                    data-selected={chosen}
                    aria-pressed={chosen}
                    disabled={!chosen && full}
                    onClick={() => toggle(achievement.id)}
                  >
                    {chosen ? (
                      <span className="ach-card__tick">
                        <Check size={12} strokeWidth={3} aria-hidden="true" />
                      </span>
                    ) : null}
                    <Sticker achievement={achievement} size={56} />
                    <span className="ach-card__name">{achievement.name}</span>
                    {attraction ? (
                      <span className="ach-card__where">{attraction.name}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <p className="ach-hint">
              {full
                ? `${FEATURED_ACHIEVEMENT_COUNT} selected. Tap one to swap it out.`
                : `${selection.length} of ${FEATURED_ACHIEVEMENT_COUNT} selected.`}
            </p>

            <div className="place-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--block"
                disabled={!dirty && !saved}
                onClick={() => void save()}
              >
                {saved ? (
                  <>
                    <Check size={16} strokeWidth={2.6} aria-hidden="true" />
                    Saved
                  </>
                ) : (
                  "Save selection"
                )}
              </button>
            </div>
          </>
        )}

        {locked.length > 0 ? (
          <>
            <p className="section-label day__section">Still out there</p>
            <div className="ach-grid">
              {locked.map(({ achievement, attraction }) => (
                <div key={achievement.id} className="ach-card" data-locked="true">
                  <span className="ach-card__tick" style={{ background: "var(--color-nav-muted)" }}>
                    <Lock size={10} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <Sticker achievement={achievement} size={56} locked />
                  <span className="ach-card__name">{achievement.name}</span>
                  {attraction ? (
                    <span className="ach-card__where">{attraction.name}</span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </BottomSheet>
  );
}
