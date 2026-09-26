/**
 * Editing what the recommendations are built from.
 *
 * Interests, pace, budget and how far the guest is willing to go — the same
 * four things onboarding asked for, in the one place they can be changed.
 *
 * The rule that shapes this screen: **changing a preference never rebuilds the
 * day by itself.** Settings save immediately, and a separate, explicit
 * "Regenerate route" replaces today's plan. A plan that reshuffles while the
 * guest is reading it is not a plan, and a guest who taps "Food" should not
 * lose the museum they were walking to.
 */

import { Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { useGuest } from "../state/guest";
import { savePreferences } from "../data/repositories/guests";
import {
  BUDGET_BANDS,
  ENERGY_LEVELS,
  INTEREST_LABEL,
  INTERESTS,
  PREFERRED_INTEREST_COUNT,
  RANGE_PRESETS,
  type ActivityRange,
  type BudgetBand,
  type EnergyLevel,
  type Interest,
} from "../data/domain";

const ENERGY_LABEL: Record<EnergyLevel, string> = {
  chill: "Chill",
  balanced: "Balanced",
  adventurous: "Adventurous",
};

const BUDGET_LABEL: Record<BudgetBand, string> = {
  free: "Free",
  moderate: "Moderate",
  premium: "Premium",
};

export function PreferencesEditor() {
  const { session, preferences, regenerate, planning, plan } = useGuest();

  const [interests, setInterests] = useState<Interest[]>([]);
  const [energy, setEnergy] = useState<EnergyLevel>("balanced");
  const [budget, setBudget] = useState<BudgetBand>("moderate");
  const [range, setRange] = useState<ActivityRange>(RANGE_PRESETS[2].range);
  const [surprise, setSurprise] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!preferences) return;
    setInterests(preferences.interests);
    setEnergy(preferences.energyLevel);
    setBudget(preferences.budget);
    setRange(preferences.range);
    setSurprise(preferences.surpriseMe);
    setDirty(false);
  }, [preferences]);

  /**
   * Saves on every change.
   *
   * There is no Save button because there is nothing to lose by saving: the
   * settings take effect on the *next* plan, so writing them down early costs
   * the guest nothing and forgetting to press Save would cost them everything.
   */
  async function commit(patch: Parameters<typeof savePreferences>[1]) {
    if (!session) return;
    setDirty(true);
    await savePreferences(session.guestId, { ...patch, explicit: true });
  }

  function toggleInterest(interest: Interest) {
    const next = interests.includes(interest)
      ? interests.filter((entry) => entry !== interest)
      : [...interests, interest];
    setInterests(next);
    void commit({ interests: next });
  }

  const short = interests.length > 0 && interests.length < PREFERRED_INTEREST_COUNT.min;

  return (
    <div className="prefs">
      <p className="section-label">
        <span className="eyebrow">What sounds good</span>
        <span className="eyebrow">{interests.length} chosen</span>
      </p>

      <div className="join__grid">
        {INTERESTS.map((interest) => {
          const active = interests.includes(interest);
          return (
            <button
              key={interest}
              type="button"
              className="join__tile"
              data-active={active}
              aria-pressed={active}
              onClick={() => toggleInterest(interest)}
            >
              {active ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
              {INTEREST_LABEL[interest]}
            </button>
          );
        })}
      </div>

      {short ? (
        <p className="prefs__hint">
          Pick {PREFERRED_INTEREST_COUNT.min} or more and the days get noticeably better.
        </p>
      ) : null}

      {/*
        Discovery is a stated wish, not a hidden dial. Turning it on widens the
        share of a day spent on things outside the guest's pattern.
      */}
      <button
        type="button"
        className="prefs__surprise"
        data-active={surprise}
        aria-pressed={surprise}
        onClick={() => {
          const next = !surprise;
          setSurprise(next);
          void commit({ surpriseMe: next });
        }}
      >
        <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>
          <strong>Surprise me</strong>
          <em>More of what you wouldn't have looked for.</em>
        </span>
        <span className="prefs__switch" data-on={surprise} aria-hidden="true" />
      </button>

      <p className="section-label prefs__label">
        <span className="eyebrow">Your pace</span>
      </p>
      <div className="segmented">
        {ENERGY_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            data-active={energy === level}
            aria-pressed={energy === level}
            onClick={() => {
              setEnergy(level);
              void commit({ energyLevel: level });
            }}
          >
            {ENERGY_LABEL[level]}
          </button>
        ))}
      </div>

      <p className="section-label prefs__label">
        <span className="eyebrow">Budget</span>
      </p>
      <div className="segmented">
        {BUDGET_BANDS.map((band) => (
          <button
            key={band}
            type="button"
            data-active={budget === band}
            aria-pressed={budget === band}
            onClick={() => {
              setBudget(band);
              void commit({ budget: band });
            }}
          >
            {BUDGET_LABEL[band]}
          </button>
        ))}
      </div>

      {/*
        How far is a hard limit on what gets suggested, with one exception:
        a discovery pick may reach a little past it.
      */}
      <p className="section-label prefs__label">
        <span className="eyebrow">How far you'll go</span>
        <span className="eyebrow">
          {range.minKm === 0 ? "up to" : `${range.minKm}–`}
          {range.maxKm} km
        </span>
      </p>
      <div className="prefs__range">
        {RANGE_PRESETS.map((preset) => {
          const active = preset.range.maxKm === range.maxKm && preset.range.minKm === range.minKm;
          return (
            <button
              key={preset.label}
              type="button"
              className="chip"
              data-active={active}
              aria-pressed={active}
              onClick={() => {
                setRange(preset.range);
                void commit({ range: preset.range });
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/*
        The explicit rebuild.

        Everything above is already saved; nothing above has touched today.
        This is the only thing that does.
      */}
      <div className="prefs__regen">
        <p className="prefs__regen-text">
          {dirty
            ? "Saved. Today's plan is unchanged until you rebuild it."
            : plan
              ? "Rebuild today's plan with your current settings and location."
              : "Set your dates and we'll build your day."}
        </p>
        <button
          type="button"
          className="btn btn--block"
          disabled={planning || !plan}
          onClick={() => void regenerate().then(() => setDirty(false))}
        >
          {planning ? (
            <>
              <Loader2 size={16} className="day__spin" aria-hidden="true" />
              Rebuilding…
            </>
          ) : (
            <>
              <RefreshCw size={16} strokeWidth={2.2} aria-hidden="true" />
              Regenerate route
            </>
          )}
        </button>
      </div>
    </div>
  );
}
