/**
 * The card behind a marker or a 3D model.
 *
 * Everything a guest needs to decide — what it is, how far, how long, what it
 * costs — in a sheet that leaves most of the map visible. Selecting a model
 * and selecting a place land here through the same path, because from the
 * guest's side they are the same gesture: tap a thing on the map.
 */

import { Bookmark, Castle, Clock, MapPin, Navigation, Star, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { historyFor, logActivityEvent } from "../data/repositories/activity";
import { readSession } from "../data/repositories/guests";
import { CATEGORY_ICON } from "../ui/icons";
import { CATEGORY_LABEL, type MapModel, type Place } from "../data/types";
import {
  distanceMetres,
  formatDistance,
  walkingMinutes,
  type Coordinates,
} from "../data/geo";
import type { Selection } from "../state/overlay";

interface PlaceDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  selection: Selection | null;
  places: Place[];
  models: MapModel[];
  /** The guest's position, when known. Drives the real distance reading. */
  origin: Coordinates | null;
  /** True when that position is only accurate to a neighbourhood. */
  originApproximate: boolean;
  onRoute: (longitude: number, latitude: number) => void;
}

export function PlaceDetailsSheet({
  open,
  onClose,
  selection,
  places,
  models,
  origin,
  originApproximate,
  onRoute,
}: PlaceDetailsSheetProps) {
  const place = selection?.kind === "place" ? places.find((p) => p.id === selection.id) : undefined;
  const model = selection?.kind === "model" ? models.find((m) => m.id === selection.id) : undefined;

  const subject = place ?? model;
  const subjectId = subject?.id ?? null;

  /*
   * Whether this is saved.
   *
   * Hooks run before the early return below, so the sheet keeps a stable hook
   * order whether or not there is anything selected.
   */
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const session = readSession();
    if (!open || !subjectId || !session) {
      setSaved(false);
      return;
    }
    let cancelled = false;
    void historyFor(session.guestId).then((history) => {
      if (cancelled) return;
      // The latest verdict wins: saving, unsaving and saving again should
      // leave it saved.
      const latest = history.find(
        (event) =>
          event.activityId === subjectId &&
          (event.eventType === "liked" || event.eventType === "disliked"),
      );
      setSaved(latest?.eventType === "liked");
    });
    return () => {
      cancelled = true;
    };
  }, [open, subjectId]);

  const toggleSaved = useCallback(async () => {
    const session = readSession();
    if (!subjectId || !session) return;

    const next = !saved;
    setSaved(next);
    await logActivityEvent({
      guestId: session.guestId,
      hotelId: session.hotelId,
      activityId: subjectId,
      activityType: "PARTNER_ATTRACTION",
      category: place?.category ?? model?.category ?? "landmark",
      eventType: next ? "liked" : "disliked",
    });
  }, [model?.category, place?.category, saved, subjectId]);

  // The selection is kept after closing, so the sheet still has a subject to
  // render on the way out — nothing to render only means nothing was selected.
  if (!subject) return null;

  const category = subject.category;
  const Icon = CATEGORY_ICON[category];
  const hasMission = Boolean(place?.missionId ?? model?.missionId);

  /*
   * A measured distance beats the seeded one every time, and it is the whole
   * point of asking for the permission. Without a fix the card falls back to
   * the curated "from the hotel" figure rather than inventing one.
   */
  const measured = origin ? distanceMetres(origin, subject) : null;
  // "≈" is the difference between a measurement and an estimate.
  const about = originApproximate ? "≈ " : "";

  return (
    <BottomSheet open={open} onClose={onClose} label={subject.name}>
      <SheetHeader
        eyebrow={model ? "3D model" : CATEGORY_LABEL[category]}
        title={subject.name}
        onClose={onClose}
      />

      <div className="sheet__scroll scroll-region">
        <div className="place-hero">
          <span className="place-hero__badge">
            <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
            {CATEGORY_LABEL[category]}
          </span>
          {hasMission ? (
            <span className="place-hero__mission">
              <Castle size={11} strokeWidth={2.4} aria-hidden="true" />
              Mission
            </span>
          ) : null}
          <Icon size={46} strokeWidth={1.2} aria-hidden="true" />
        </div>

        {place ? (
          <div className="place-meta">
            {place.rating ? (
              <span className="place-meta__item place-meta__item--rating">
                <Star size={13} strokeWidth={2.4} aria-hidden="true" />
                <strong>{place.rating.toFixed(1)}</strong>
                {place.reviewCount ? `(${place.reviewCount})` : null}
              </span>
            ) : null}
            {measured !== null ? (
              <span className="place-meta__item">
                <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>
                  {about}
                  {formatDistance(measured)}
                </strong>
                {measured < 2500 && !originApproximate
                  ? ` · ${walkingMinutes(measured)} min walk`
                  : " away"}
              </span>
            ) : place.distanceKm !== undefined ? (
              <span className="place-meta__item">
                <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>{place.distanceKm}</strong> km from the hotel
              </span>
            ) : null}
            {place.durationMin ? (
              <span className="place-meta__item">
                <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>
                  {place.durationMin >= 60
                    ? `${Math.round((place.durationMin / 60) * 10) / 10} h`
                    : `${place.durationMin} min`}
                </strong>
              </span>
            ) : null}
            {place.price ? (
              <span className="place-meta__item">
                <Wallet size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>{place.price} ₾</strong> per person
              </span>
            ) : null}
          </div>
        ) : null}

        {model && measured !== null ? (
          <div className="place-meta">
            <span className="place-meta__item">
              <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
              <strong>
                {about}
                {formatDistance(measured)}
              </strong>
              {measured < 2500 && !originApproximate
                ? ` · ${walkingMinutes(measured)} min walk`
                : " away"}
            </span>
          </div>
        ) : null}

        <p className="place-body">{subject.description}</p>

        {place?.openHours ? (
          <p className="chat__caption" style={{ marginTop: 8 }}>
            {place.openHours}
          </p>
        ) : null}

        <div className="place-actions">
          <button
            type="button"
            className="btn"
            onClick={() => onRoute(subject.longitude, subject.latitude)}
          >
            <Navigation size={15} strokeWidth={2.4} aria-hidden="true" />
            Show on map
          </button>
          {/*
            Saving is a real signal, not a decoration: it is recorded as a
            "liked" event, which is the same thing the recommendation engine
            reads when it decides what to offer tomorrow.
          */}
          <button
            type="button"
            className="btn btn--ghost"
            style={{ flex: "0 0 52px" }}
            aria-label={saved ? "Saved. Tap to remove." : "Save this place"}
            aria-pressed={saved}
            onClick={() => void toggleSaved()}
          >
            <Bookmark
              size={16}
              strokeWidth={2.2}
              fill={saved ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
