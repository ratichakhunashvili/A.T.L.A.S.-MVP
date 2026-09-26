/**
 * Guest onboarding — everything between scanning the hotel's QR and having a
 * plan.
 *
 * One full-screen flow with a progress rail, because this is the only part of
 * the product that is genuinely sequential. It is deliberately short: a
 * welcome, the stay, three preference questions and anything already in the
 * diary. Each step does one thing and most can be skipped.
 *
 * The hotel is resolved from the token in the URL before anything is shown. A
 * guest never picks their hotel from a list, and nothing here accepts a hotel
 * id from the client.
 */

import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  MapPin,
  Plus,
  ScanLine,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ReservationScanner } from "./ReservationScanner";
import { navigate } from "../routing";
import { resolveHotelToken, recordScan, type TokenFailure } from "../data/repositories/hotels";
import {
  addMinutesToClock,
  commitments as commitmentsRepo,
  nightsBetween,
  RESERVATION_PROBLEM_COPY,
  saveReservation,
  savePreferences,
  seedStayCommitments,
  startSession,
  updateSession,
  validateReservation,
  type ReservationProblem,
} from "../data/repositories/guests";
import { todayStamp } from "../engine/time";
import {
  BUDGET_BANDS,
  ENERGY_LEVELS,
  INTEREST_LABEL,
  INTERESTS,
  PREFERRED_INTEREST_COUNT,
  type BudgetBand,
  type Commitment,
  type EnergyLevel,
  type Hotel,
  type Interest,
  type ParsedReservation,
} from "../data/domain";
import "./join.css";

/* ------------------------------------------------------------------------ */
/* Step definitions                                                          */
/* ------------------------------------------------------------------------ */

type Step = "welcome" | "method" | "scan" | "confirm" | "interests" | "energy" | "budget" | "schedule" | "done";

/** Steps that count toward the progress rail. The welcome is not a question. */
const PROGRESS_STEPS: Step[] = ["confirm", "interests", "energy", "budget", "schedule"];

const TOKEN_FAILURE_COPY: Record<TokenFailure, { title: string; body: string }> = {
  unknown: {
    title: "That code isn't one of ours",
    body: "Check you scanned the code on the card at reception, not a booking confirmation.",
  },
  inactive_code: {
    title: "That code has been retired",
    body: "Your hotel has issued a new one. Ask at reception for the current card.",
  },
  expired_code: {
    title: "That code has expired",
    body: "Ask reception for the current card and scan again.",
  },
  inactive_hotel: {
    title: "This property isn't taking guests",
    body: "The hotel has paused its guest experience. Reception can tell you more.",
  },
  missing_hotel: {
    title: "Something's out of step",
    body: "That code points at a property we can't find. Please tell reception.",
  },
};

interface StayDraft {
  guestName: string;
  checkIn: string;
  checkOut: string;
  partySize: number;
  reference: string;
  roomNumber: string;
  source: "manual" | "scan" | "upload";
}

const EMPTY_STAY: StayDraft = {
  guestName: "",
  checkIn: "",
  checkOut: "",
  partySize: 2,
  reference: "",
  roomNumber: "",
  source: "manual",
};

/* ------------------------------------------------------------------------ */
/* The flow                                                                  */
/* ------------------------------------------------------------------------ */

export function JoinFlow({ token }: { token: string }) {
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [failure, setFailure] = useState<TokenFailure | null>(null);
  const [step, setStep] = useState<Step>("welcome");
  const [guestId, setGuestId] = useState<string | null>(null);

  const [stay, setStay] = useState<StayDraft>(EMPTY_STAY);
  const [parsed, setParsed] = useState<ParsedReservation | null>(null);
  const [problems, setProblems] = useState<ReservationProblem[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [energy, setEnergy] = useState<EnergyLevel>("balanced");
  const [budget, setBudget] = useState<BudgetBand>("moderate");
  const [surprise, setSurprise] = useState(false);
  const [diary, setDiary] = useState<Omit<Commitment, "id" | "guestId" | "createdAt">[]>([]);
  const [saving, setSaving] = useState(false);

  /* -- Resolve the hotel from the token, once --------------------------- */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const resolution = await resolveHotelToken(token);
      if (cancelled) return;

      if (!resolution.ok) {
        setFailure(resolution.reason);
        return;
      }

      setHotel(resolution.hotel);
      const session = startSession(resolution.hotel.id, token);
      setGuestId(session.guestId);

      // Counted once per arrival, not on every re-render or reload.
      const scanKey = `atlas.scanned.${resolution.code.id}.${session.guestId}`;
      if (!sessionStorage.getItem(scanKey)) {
        sessionStorage.setItem(scanKey, "1");
        void recordScan(resolution.code.id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const applyParsed = useCallback((result: ParsedReservation, source: "scan" | "upload") => {
    setParsed(result);
    setStay((current) => ({
      ...current,
      guestName: result.guestName ?? current.guestName,
      checkIn: result.checkIn ?? current.checkIn,
      checkOut: result.checkOut ?? current.checkOut,
      partySize: result.partySize ?? current.partySize,
      reference: result.reference ?? current.reference,
      source,
    }));
    setStep("confirm");
  }, []);

  const nights = useMemo(
    () => (stay.checkIn && stay.checkOut ? nightsBetween(stay.checkIn, stay.checkOut) : 0),
    [stay.checkIn, stay.checkOut],
  );

  async function commitStay(): Promise<boolean> {
    const found = validateReservation(stay);
    setProblems(found);
    if (found.length > 0 || !guestId || !hotel) return false;

    await saveReservation({
      guestId,
      // Always the hotel we resolved from the token — never anything typed.
      hotelId: hotel.id,
      guestName: stay.guestName.trim(),
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      partySize: stay.partySize,
      reference: stay.reference.trim() || undefined,
      roomNumber: stay.roomNumber.trim() || undefined,
      source: stay.source,
    });
    return true;
  }

  async function finish() {
    if (!guestId || !hotel) return;
    setSaving(true);

    try {
      await savePreferences(guestId, {
        interests,
        energyLevel: energy,
        budget,
        surpriseMe: surprise,
        // A guest who told us nothing is not "has no interests" — the engine
        // reads this as no signal and leans harder on discovery.
        explicit: interests.length > 0,
      });

      for (const entry of diary) {
        await commitmentsRepo.create({ ...entry, guestId });
      }

      const reservation = { checkIn: stay.checkIn, checkOut: stay.checkOut };
      await seedStayCommitments(
        guestId,
        { ...reservation, id: "", guestId, hotelId: hotel.id, guestName: stay.guestName,
          nights, partySize: stay.partySize, source: stay.source,
          createdAt: "", updatedAt: "" },
        hotel.checkInTime,
        hotel.checkOutTime,
      );

      updateSession({ onboarded: true });
      setStep("done");
    } finally {
      setSaving(false);
    }
  }

  /* -- Failure and loading states --------------------------------------- */
  if (failure) {
    const copy = TOKEN_FAILURE_COPY[failure];
    return (
      <div className="join join--centered">
        <div className="join__card join__card--message">
          <span className="join__icon join__icon--warn">
            <X size={22} strokeWidth={2.4} aria-hidden="true" />
          </span>
          <h1 className="join__title">{copy.title}</h1>
          <p className="join__body">{copy.body}</p>
          <button type="button" className="btn btn--block" onClick={() => navigate("/")}>
            Open the map anyway
          </button>
        </div>
      </div>
    );
  }

  if (!hotel) {
    return (
      <div className="join join--centered">
        <div className="join__card join__card--message">
          <Loader2 className="join__spinner" size={24} aria-hidden="true" />
          <p className="join__body">Finding your hotel…</p>
        </div>
      </div>
    );
  }

  const progressIndex = PROGRESS_STEPS.indexOf(step);

  return (
    <div className="join">
      <header className="join__bar">
        {step !== "welcome" && step !== "done" ? (
          <button type="button" className="join__back" onClick={() => setStep(previousStep(step))}>
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="visually-hidden">Back</span>
          </button>
        ) : (
          <span />
        )}

        <span className="join__hotel">{hotel.name}</span>

        {progressIndex >= 0 ? (
          <span className="join__progress" aria-label={`Step ${progressIndex + 1} of ${PROGRESS_STEPS.length}`}>
            {PROGRESS_STEPS.map((entry, index) => (
              <span key={entry} className="join__pip" data-done={index <= progressIndex} />
            ))}
          </span>
        ) : (
          <span />
        )}
      </header>

      <div className="join__stage">
        {step === "welcome" ? (
          <Welcome hotel={hotel} onNext={() => setStep("method")} />
        ) : null}

        {step === "method" ? (
          <MethodChoice
            onScan={() => setStep("scan")}
            onManual={() => {
              setStay((current) => ({ ...current, source: "manual" }));
              setStep("confirm");
            }}
          />
        ) : null}

        {step === "scan" ? (
          <ReservationScanner
            onParsed={applyParsed}
            onManual={() => {
              setStay((current) => ({ ...current, source: "manual" }));
              setStep("confirm");
            }}
          />
        ) : null}

        {step === "confirm" ? (
          <StayForm
            hotel={hotel}
            stay={stay}
            parsed={parsed}
            nights={nights}
            problems={problems}
            onChange={setStay}
            onNext={async () => {
              if (await commitStay()) setStep("interests");
            }}
          />
        ) : null}

        {step === "interests" ? (
          <InterestPicker
            selected={interests}
            surprise={surprise}
            onSurprise={() => setSurprise((current) => !current)}
            onToggle={(interest) =>
              setInterests((current) =>
                current.includes(interest)
                  ? current.filter((entry) => entry !== interest)
                  : [...current, interest],
              )
            }
            onNext={() => setStep("energy")}
          />
        ) : null}

        {step === "energy" ? (
          <EnergyPicker value={energy} onChange={setEnergy} onNext={() => setStep("budget")} />
        ) : null}

        {step === "budget" ? (
          <BudgetPicker value={budget} onChange={setBudget} onNext={() => setStep("schedule")} />
        ) : null}

        {step === "schedule" ? (
          <SchedulePicker
            checkIn={stay.checkIn}
            entries={diary}
            onAdd={(entry) => setDiary((current) => [...current, entry])}
            onRemove={(index) => setDiary((current) => current.filter((_, i) => i !== index))}
            onNext={() => void finish()}
            saving={saving}
          />
        ) : null}

        {step === "done" ? <Done hotel={hotel} name={stay.guestName} /> : null}
      </div>
    </div>
  );
}

function previousStep(step: Step): Step {
  const order: Step[] = ["welcome", "method", "scan", "confirm", "interests", "energy", "budget", "schedule"];
  const index = order.indexOf(step);
  // Skipping back past the scanner lands on the choice, not on a dead camera.
  if (step === "confirm") return "method";
  return index > 0 ? order[index - 1] : "welcome";
}

/* ------------------------------------------------------------------------ */
/* Steps                                                                     */
/* ------------------------------------------------------------------------ */

function Welcome({ hotel, onNext }: { hotel: Hotel; onNext: () => void }) {
  return (
    <section className="join__card join__card--hero">
      <p className="eyebrow">Welcome to</p>
      <h1 className="join__display">{hotel.name}</h1>
      {hotel.tagline ? <p className="join__body">{hotel.tagline}</p> : null}

      <div className="join__promise">
        <p className="join__promise-line">Tell us when you're free.</p>
        <p className="join__promise-sub">We'll figure out what you can do.</p>
      </div>

      <button type="button" className="btn btn--block" onClick={onNext}>
        Let's set up your stay
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
      <p className="join__note">No account needed. Takes about a minute.</p>
    </section>
  );
}

function MethodChoice({ onScan, onManual }: { onScan: () => void; onManual: () => void }) {
  return (
    <section className="join__card">
      <h1 className="join__title">Your reservation</h1>
      <p className="join__body">We only need your dates. Either way works.</p>

      <button type="button" className="join__option" onClick={onScan}>
        <span className="join__option-icon">
          <ScanLine size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="join__option-text">
          <span className="join__option-title">Scan your booking</span>
          <span className="join__option-sub">Point the camera at the QR, or upload the confirmation</span>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>

      <button type="button" className="join__option" onClick={onManual}>
        <span className="join__option-icon">
          <Plus size={20} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="join__option-text">
          <span className="join__option-title">Enter it yourself</span>
          <span className="join__option-sub">Four fields, thirty seconds</span>
        </span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

interface StayFormProps {
  hotel: Hotel;
  stay: StayDraft;
  parsed: ParsedReservation | null;
  nights: number;
  problems: ReservationProblem[];
  onChange: (stay: StayDraft) => void;
  onNext: () => void;
}

function StayForm({ hotel, stay, parsed, nights, problems, onChange, onNext }: StayFormProps) {
  const set = <K extends keyof StayDraft>(key: K, value: StayDraft[K]) =>
    onChange({ ...stay, [key]: value });

  const today = todayStamp();

  return (
    <section className="join__card">
      <h1 className="join__title">{parsed ? "Here's what we found" : "Your stay"}</h1>
      <p className="join__body">
        {parsed
          ? "Check these are right — you can change anything before we save it."
          : `A few details about your stay at ${hotel.name}.`}
      </p>

      {parsed ? (
        <p className="join__parsed" role="status">
          Read from your booking:{" "}
          {parsed.fields.length > 0 ? parsed.fields.map(fieldLabel).join(", ") : "nothing usable"}
        </p>
      ) : null}

      <div className="field">
        <label className="field__label" htmlFor="join-name">First name</label>
        <input
          id="join-name"
          className="input"
          value={stay.guestName}
          autoComplete="given-name"
          onChange={(event) => set("guestName", event.target.value)}
          placeholder="Nino"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="join-in">Check-in</label>
          <input
            id="join-in"
            className="input"
            type="date"
            value={stay.checkIn}
            min={`${Number(today.slice(0, 4)) - 1}-01-01`}
            onChange={(event) => set("checkIn", event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="join-out">Check-out</label>
          <input
            id="join-out"
            className="input"
            type="date"
            value={stay.checkOut}
            min={stay.checkIn || undefined}
            onChange={(event) => set("checkOut", event.target.value)}
          />
        </div>
      </div>

      {/* The guest is never asked to count nights. */}
      {nights > 0 ? (
        <p className="join__derived" role="status">
          {nights} {nights === 1 ? "night" : "nights"} at {hotel.name}
        </p>
      ) : null}

      <div className="field-row">
        <div className="field">
          <label className="field__label" htmlFor="join-party">Guests</label>
          <input
            id="join-party"
            className="input"
            type="number"
            min={1}
            max={20}
            value={stay.partySize}
            onChange={(event) => set("partySize", Math.max(1, Number(event.target.value) || 1))}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="join-room">
            Room <span className="field__optional">optional</span>
          </label>
          <input
            id="join-room"
            className="input"
            value={stay.roomNumber}
            onChange={(event) => set("roomNumber", event.target.value)}
            placeholder="304"
          />
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="join-ref">
          Booking reference <span className="field__optional">optional</span>
        </label>
        <input
          id="join-ref"
          className="input"
          value={stay.reference}
          onChange={(event) => set("reference", event.target.value)}
          placeholder="BK-48219"
        />
      </div>

      {problems.length > 0 ? (
        <p className="field__error" role="alert">
          {RESERVATION_PROBLEM_COPY[problems[0]]}
        </p>
      ) : null}

      <button type="button" className="btn btn--block" onClick={onNext}>
        That's right
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    guestName: "your name",
    hotelName: "the hotel",
    checkIn: "check-in",
    checkOut: "check-out",
    reference: "the reference",
    partySize: "guests",
  };
  return labels[field] ?? field;
}

interface InterestPickerProps {
  selected: Interest[];
  surprise: boolean;
  onToggle: (interest: Interest) => void;
  onSurprise: () => void;
  onNext: () => void;
}

function InterestPicker({ selected, surprise, onToggle, onSurprise, onNext }: InterestPickerProps) {
  const enough = selected.length >= PREFERRED_INTEREST_COUNT.min;

  return (
    <section className="join__card">
      <h1 className="join__title">What sounds good?</h1>
      <p className="join__body">
        Pick {PREFERRED_INTEREST_COUNT.min} to {PREFERRED_INTEREST_COUNT.max} — or skip it and
        we'll work the rest out as we go.
      </p>

      <div className="join__grid">
        {INTERESTS.map((interest) => {
          const active = selected.includes(interest);
          return (
            <button
              key={interest}
              type="button"
              className="join__tile"
              data-active={active}
              aria-pressed={active}
              onClick={() => onToggle(interest)}
            >
              {active ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : null}
              {INTEREST_LABEL[interest]}
            </button>
          );
        })}
      </div>

      {/* The discovery switch, offered up front rather than buried in a
          settings screen later. */}
      <button
        type="button"
        className="prefs__surprise"
        data-active={surprise}
        aria-pressed={surprise}
        onClick={onSurprise}
      >
        <Sparkles size={15} strokeWidth={2.2} aria-hidden="true" />
        <span>
          <strong>Surprise me</strong>
          <em>More of what you wouldn't have looked for.</em>
        </span>
        <span className="prefs__switch" data-on={surprise} aria-hidden="true" />
      </button>

      <button type="button" className="btn btn--block" onClick={onNext}>
        {selected.length === 0 && !surprise
          ? "Skip for now"
          : enough || surprise
            ? "Next"
            : `Next · ${selected.length} of ${PREFERRED_INTEREST_COUNT.min}`}
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}

const ENERGY_COPY: Record<EnergyLevel, { title: string; body: string }> = {
  chill: { title: "Chill", body: "Short outings, long lunches, nothing rushed" },
  balanced: { title: "Balanced", body: "A couple of things a day with room to breathe" },
  adventurous: { title: "Adventurous", body: "Fill the day — hills, distance, early starts" },
};

function EnergyPicker({
  value,
  onChange,
  onNext,
}: {
  value: EnergyLevel;
  onChange: (value: EnergyLevel) => void;
  onNext: () => void;
}) {
  return (
    <section className="join__card">
      <h1 className="join__title">How do you like to spend your free time?</h1>

      <div className="join__stack">
        {ENERGY_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className="join__choice"
            data-active={value === level}
            aria-pressed={value === level}
            onClick={() => onChange(level)}
          >
            <span className="join__choice-title">{ENERGY_COPY[level].title}</span>
            <span className="join__choice-body">{ENERGY_COPY[level].body}</span>
          </button>
        ))}
      </div>

      <button type="button" className="btn btn--block" onClick={onNext}>
        Next
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}

const BUDGET_COPY: Record<BudgetBand, { title: string; body: string }> = {
  free: { title: "Free", body: "Parks, walks, markets, views" },
  moderate: { title: "Moderate", body: "A meal out, a ticket, a tasting" },
  premium: { title: "Premium", body: "Private tours, tastings, the good table" },
};

function BudgetPicker({
  value,
  onChange,
  onNext,
}: {
  value: BudgetBand;
  onChange: (value: BudgetBand) => void;
  onNext: () => void;
}) {
  return (
    <section className="join__card">
      <h1 className="join__title">What's your usual budget?</h1>

      <div className="join__stack">
        {BUDGET_BANDS.map((band) => (
          <button
            key={band}
            type="button"
            className="join__choice"
            data-active={value === band}
            aria-pressed={value === band}
            onClick={() => onChange(band)}
          >
            <span className="join__choice-title">{BUDGET_COPY[band].title}</span>
            <span className="join__choice-body">{BUDGET_COPY[band].body}</span>
          </button>
        ))}
      </div>

      <button type="button" className="btn btn--block" onClick={onNext}>
        Next
        <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>
    </section>
  );
}

const COMMITMENT_KINDS: { value: Commitment["kind"]; label: string }[] = [
  { value: "dinner", label: "Dinner" },
  { value: "meeting", label: "Meeting" },
  { value: "tour", label: "Tour" },
  { value: "transport", label: "Travel" },
  { value: "other", label: "Something else" },
];

interface SchedulePickerProps {
  checkIn: string;
  entries: Omit<Commitment, "id" | "guestId" | "createdAt">[];
  onAdd: (entry: Omit<Commitment, "id" | "guestId" | "createdAt">) => void;
  onRemove: (index: number) => void;
  onNext: () => void;
  saving: boolean;
}

function SchedulePicker({ checkIn, entries, onAdd, onRemove, onNext, saving }: SchedulePickerProps) {
  const today = todayStamp();
  const [date, setDate] = useState(checkIn > today ? checkIn : today);
  const [start, setStart] = useState("20:00");
  const [kind, setKind] = useState<Commitment["kind"]>("dinner");
  const [label, setLabel] = useState("");

  function add() {
    const chosen = COMMITMENT_KINDS.find((entry) => entry.value === kind);
    onAdd({
      date,
      startTime: start,
      endTime: addMinutesToClock(start, kind === "dinner" ? 120 : 60),
      label: label.trim() || chosen?.label || "Commitment",
      kind,
    });
    setLabel("");
  }

  return (
    <section className="join__card">
      <h1 className="join__title">Anything already in the diary?</h1>
      <p className="join__body">
        We'll plan around it. Dinner reservations, meetings, a flight — whatever is fixed.
      </p>

      {entries.length > 0 ? (
        <ul className="join__diary">
          {entries.map((entry, index) => (
            <li key={`${entry.date}-${entry.startTime}-${index}`} className="join__diary-item">
              <span className="join__diary-time">{entry.startTime}</span>
              <span className="join__diary-label">
                {entry.label}
                <span className="join__diary-date">{entry.date}</span>
              </span>
              <button
                type="button"
                className="icon-btn"
                onClick={() => onRemove(index)}
                aria-label={`Remove ${entry.label}`}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="join__adder">
        <div className="field-row field-row--three">
          <div className="field">
            <label className="field__label" htmlFor="join-c-date">Day</label>
            <input
              id="join-c-date"
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="join-c-time">From</label>
            <input
              id="join-c-time"
              className="input"
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="join-c-kind">What</label>
            <select
              id="join-c-kind"
              className="select"
              value={kind}
              onChange={(event) => setKind(event.target.value as Commitment["kind"])}
            >
              {COMMITMENT_KINDS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="join-c-label">
            Note <span className="field__optional">optional</span>
          </label>
          <input
            id="join-c-label"
            className="input"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Dinner at Shavi Lomi"
          />
        </div>

        <button type="button" className="btn btn--ghost btn--block btn--sm" onClick={add}>
          <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
          Add to the diary
        </button>
      </div>

      <button type="button" className="btn btn--block" onClick={onNext} disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="join__spinner" size={16} aria-hidden="true" />
            Building your day…
          </>
        ) : (
          <>
            {entries.length === 0 ? "Nothing fixed — build my day" : "Build my day"}
            <ArrowRight size={16} strokeWidth={2.4} aria-hidden="true" />
          </>
        )}
      </button>
    </section>
  );
}

function Done({ hotel, name }: { hotel: Hotel; name: string }) {
  // A beat on the confirmation, then straight to the map. The guest should
  // arrive at a day that is already planned, not at another button.
  useEffect(() => {
    const timer = window.setTimeout(() => navigate("/", { replace: true }), 1900);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section className="join__card join__card--message">
      <span className="join__icon join__icon--ok">
        <Check size={24} strokeWidth={3} aria-hidden="true" />
      </span>
      <h1 className="join__title">{name ? `You're set, ${name}` : "You're set"}</h1>
      <p className="join__body">
        We've put together your first day at {hotel.name}. Opening your map…
      </p>
      <button type="button" className="btn btn--block" onClick={() => navigate("/", { replace: true })}>
        <MapPin size={16} strokeWidth={2.4} aria-hidden="true" />
        Open my map
      </button>
    </section>
  );
}
