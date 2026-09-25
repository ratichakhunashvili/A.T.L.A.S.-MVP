/**
 * The card behind a marker or a 3D model.
 *
 * Everything a guest needs to decide — what it is, how far, how long, what it
 * costs — in a sheet that leaves most of the map visible. Selecting a model
 * and selecting a place land here through the same path, because from the
 * guest's side they are the same gesture: tap a thing on the map.
 */

import { Bookmark, Castle, Clock, MapPin, Navigation, Star, Wallet } from "lucide-react";

import { BottomSheet, SheetHeader } from "../ui/sheets/Sheets";
import { CATEGORY_ICON } from "../ui/icons";
import { CATEGORY_LABEL, type MapModel, type Place } from "../data/types";
import type { Selection } from "../state/overlay";

interface PlaceDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  selection: Selection | null;
  places: Place[];
  models: MapModel[];
  onRoute: (longitude: number, latitude: number) => void;
}

export function PlaceDetailsSheet({
  open,
  onClose,
  selection,
  places,
  models,
  onRoute,
}: PlaceDetailsSheetProps) {
  const place = selection?.kind === "place" ? places.find((p) => p.id === selection.id) : undefined;
  const model = selection?.kind === "model" ? models.find((m) => m.id === selection.id) : undefined;

  const subject = place ?? model;
  // The selection is kept after closing, so the sheet still has a subject to
  // render on the way out — nothing to render only means nothing was selected.
  if (!subject) return null;

  const category = subject.category;
  const Icon = CATEGORY_ICON[category];
  const hasMission = Boolean(place?.missionId ?? model?.missionId);

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
              <span className="place-meta__item">
                <Star size={13} strokeWidth={2.4} aria-hidden="true" />
                <strong>{place.rating.toFixed(1)}</strong>
                {place.reviewCount ? `(${place.reviewCount})` : null}
              </span>
            ) : null}
            {place.distanceKm !== undefined ? (
              <span className="place-meta__item">
                <MapPin size={13} strokeWidth={2.2} aria-hidden="true" />
                <strong>{place.distanceKm}</strong> km
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
          <button type="button" className="btn btn--ghost" style={{ flex: "0 0 52px" }} aria-label="Save this place">
            <Bookmark size={16} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
