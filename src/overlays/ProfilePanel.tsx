/**
 * Profile — the part of the product that outlives the stay.
 *
 * Guest Mode is temporary; visited places, reviews and achievements are not.
 * So this sheet leads with what has accumulated, then the trips it came from,
 * then preferences. Same bottom-sheet model as Missions — no new page, no new
 * interaction to learn.
 */

import { Bell, Bookmark, ChevronRight, Globe, LogOut, Star, UserPlus } from "lucide-react";
import { useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { PreferencesEditor } from "./PreferencesEditor";
import { StickerStack } from "../ui/achievements/Sticker";
import { PROFILE, TRIPS } from "../data/seed";
import { useAchievements } from "../state/achievements";
import { useAuth } from "../auth/AuthProvider";
import { useOverlay } from "../state/overlay";

const LANGUAGES = ["English", "ქართული"] as const;

interface ProfilePanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const [languageIndex, setLanguageIndex] = useState(0);
  const { user, signOut } = useAuth();
  const { openAuth, open: openOverlay } = useOverlay();
  const { collection, featured } = useAchievements();

  // Signed in, the account supplies the identity; as a guest the seeded
  // traveller stands in, because the profile is useful either way.
  const name = user?.fullName ?? PROFILE.name;
  const initials =
    user?.fullName
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || PROFILE.initials;

  return (
    <BottomSheet open={open} onClose={onClose} label="Profile">
      {/* The name belongs beside the avatar below, so the header carries the
          section rather than repeating it. */}
      <SheetHeader eyebrow="Your account" title="Profile" onClose={onClose} />

      <div className="sheet__scroll scroll-region">
        <div className="profile-head">
          <span className="avatar" aria-hidden="true">
            {initials}
          </span>
          <span>
            <span className="profile-head__name">{name}</span>
            <span className="profile-head__meta">
              {user ? user.email : PROFILE.memberSince}
            </span>
          </span>
        </div>

        {user ? null : (
          <div className="account-card" style={{ marginTop: 14 }}>
            <span className="account-card__icon">
              <UserPlus size={19} strokeWidth={2} aria-hidden="true" />
            </span>
            <p className="account-card__title">Keep what you collect</p>
            <p className="account-card__text">
              Missions, saved places and reviews follow you to the next stay once you have an
              account.
            </p>
            <div className="account-card__actions">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => openAuth("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                className="btn btn--accent btn--sm"
                onClick={() => openAuth("signup")}
              >
                Create account
              </button>
            </div>
          </div>
        )}

        {/*
          Where the points total used to be.

          A collection of places you have actually been says more about a trip
          than a number does, and it is the one thing here the guest earned by
          going somewhere.
        */}
        <button
          type="button"
          className="ach-entry"
          onClick={() => openOverlay("achievements")}
          aria-label="Your achievements"
        >
          <StickerStack entries={featured.map((entry) => entry.achievement)} />
          <span className="ach-entry__text">
            <span className="ach-entry__label">Achievements</span>
            <span className="ach-entry__count">
              {collection.length === 0
                ? "None yet"
                : `${collection.length} collected`}
            </span>
          </span>
          <ChevronRight size={17} className="ach-entry__chevron" aria-hidden="true" />
        </button>

        <div className="stat-grid">
          <div className="stat">
            <p className="stat__value">{PROFILE.completedMissions}</p>
            <p className="stat__label">Missions</p>
          </div>
          <div className="stat">
            <p className="stat__value">{PROFILE.savedPlaces}</p>
            <p className="stat__label">Saved</p>
          </div>
          <div className="stat">
            <p className="stat__value">{PROFILE.reviews}</p>
            <p className="stat__label">Reviews</p>
          </div>
        </div>

        <div className="section-label">
          <span className="eyebrow">Travel history</span>
          <span className="eyebrow">{TRIPS.length} trips</span>
        </div>

        <ul className="pref-list">
          {TRIPS.map((trip) => (
            <li key={trip.id}>
              <div className="pref">
                <span className="pref__icon">
                  <Bookmark size={15} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="step__body">
                  <span className="pref__label">{trip.city}</span>
                  <span className="step__detail">{trip.detail}</span>
                </span>
                <span className="pref__value">{trip.when}</span>
              </div>
            </li>
          ))}
        </ul>

        {/*
          What the recommendations are built from, editable in place. Changing
          anything here saves immediately and changes nothing about today until
          the guest asks for a rebuild.
        */}
        <div className="section-label">
          <span className="eyebrow">Your days</span>
        </div>

        <PreferencesEditor />

        <div className="section-label">
          <span className="eyebrow">Settings</span>
        </div>

        <ul className="pref-list">
          <li>
            <button
              type="button"
              className="pref"
              onClick={() => setLanguageIndex((index) => (index + 1) % LANGUAGES.length)}
            >
              <span className="pref__icon">
                <Globe size={15} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="pref__label">Language</span>
              <span className="pref__value">{LANGUAGES[languageIndex]}</span>
              <ChevronRight size={15} className="pref__chevron" aria-hidden="true" />
            </button>
          </li>
          <li>
            <button
              type="button"
              className="pref"
              onClick={() => openOverlay("notifications")}
            >
              <span className="pref__icon">
                <Bell size={15} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="pref__label">Notifications</span>
              <span className="pref__value">Open</span>
              <ChevronRight size={15} className="pref__chevron" aria-hidden="true" />
            </button>
          </li>
          <li>
            {/* Not a button: reviews are read-only for now, and a control that
                does nothing is worse than a line of text. */}
            <div className="pref">
              <span className="pref__icon">
                <Star size={15} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="pref__label">Your reviews</span>
              <span className="pref__value">{PROFILE.reviews}</span>
            </div>
          </li>
          {user ? (
            <li>
              <button type="button" className="pref" onClick={() => void signOut()}>
                <span className="pref__icon">
                  <LogOut size={15} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="pref__label">Sign out</span>
                <span className="pref__value account-email">{user.email}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </BottomSheet>
  );
}
