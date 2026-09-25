/**
 * Profile — the part of the product that outlives the stay.
 *
 * Guest Mode is temporary; visited places, reviews and achievements are not.
 * So this sheet leads with what has accumulated, then the trips it came from,
 * then preferences. Same bottom-sheet model as Missions — no new page, no new
 * interaction to learn.
 */

import { Bell, Bookmark, ChevronRight, Globe, Star } from "lucide-react";
import { useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { PROFILE, TRIPS } from "../data/seed";

const LANGUAGES = ["English", "ქართული"] as const;

interface ProfilePanelProps {
  open: boolean;
  onClose: () => void;
}

export function ProfilePanel({ open, onClose }: ProfilePanelProps) {
  const [languageIndex, setLanguageIndex] = useState(0);

  return (
    <BottomSheet open={open} onClose={onClose} label="Profile">
      {/* The name belongs beside the avatar below, so the header carries the
          section rather than repeating it. */}
      <SheetHeader eyebrow="Your account" title="Profile" onClose={onClose} />

      <div className="sheet__scroll scroll-region">
        <div className="profile-head">
          <span className="avatar" aria-hidden="true">
            {PROFILE.initials}
          </span>
          <span>
            <span className="profile-head__name">{PROFILE.name}</span>
            <span className="profile-head__meta">{PROFILE.memberSince}</span>
          </span>
        </div>

        <div className="stat-grid">
          <div className="stat stat--accent">
            <p className="stat__value">{PROFILE.points.toLocaleString("en-US")}</p>
            <p className="stat__label">Points</p>
          </div>
          <div className="stat">
            <p className="stat__value">{PROFILE.completedMissions}</p>
            <p className="stat__label">Missions</p>
          </div>
          <div className="stat">
            <p className="stat__value">{PROFILE.savedPlaces}</p>
            <p className="stat__label">Saved</p>
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

        <div className="section-label">
          <span className="eyebrow">Preferences</span>
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
            <button type="button" className="pref">
              <span className="pref__icon">
                <Bell size={15} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="pref__label">Notifications</span>
              <span className="pref__value">On</span>
              <ChevronRight size={15} className="pref__chevron" aria-hidden="true" />
            </button>
          </li>
          <li>
            <button type="button" className="pref">
              <span className="pref__icon">
                <Star size={15} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="pref__label">Your reviews</span>
              <span className="pref__value">{PROFILE.reviews}</span>
              <ChevronRight size={15} className="pref__chevron" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </div>
    </BottomSheet>
  );
}
