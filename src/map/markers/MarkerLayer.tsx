/**
 * Every custom marker on the map: places, 3D model ground anchors, and the
 * guest's own position. Mapbox's default pin is never used — a marker here is
 * a product surface, with its own selected, hover and press states.
 */

import { memo } from "react";
import { Check } from "lucide-react";

import { MapMarker } from "../MapMarker";
import { CATEGORY_ICON } from "../../ui/icons";
import type { MapModel, Place } from "../../data/types";
import type { Selection } from "../../state/overlay";

interface MarkerLayerProps {
  places: Place[];
  models: MapModel[];
  selection: Selection | null;
  /** Place id the running mission points at next — gets a halo. */
  highlightPlaceId?: string;
  onSelect: (selection: Selection) => void;
  userLocation?: { longitude: number; latitude: number } | null;
}

function MarkerLayerImpl({
  places,
  models,
  selection,
  highlightPlaceId,
  onSelect,
  userLocation,
}: MarkerLayerProps) {
  return (
    <>
      {places.map((place) => {
        const Icon = CATEGORY_ICON[place.category];
        const selected = selection?.kind === "place" && selection.id === place.id;
        const isHotel = place.category === "hotel";
        // Selected markers come forward; the hotel always outranks its neighbours.
        const zIndex = selected ? 30 : isHotel ? 20 : 10;

        return (
          <MapMarker
            key={place.id}
            longitude={place.longitude}
            latitude={place.latitude}
            zIndex={zIndex}
          >
            <button
              type="button"
              className="place-marker"
              data-category={place.category}
              data-selected={selected}
              data-unlocked={place.unlocked ?? false}
              data-highlight={place.id === highlightPlaceId && !selected}
              aria-label={`${place.name}. Open details.`}
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "place", id: place.id })}
            >
              {selected || isHotel ? (
                <span className="place-marker__label">{place.name}</span>
              ) : null}
              <span className="place-marker__pin">
                <Icon size={isHotel ? 19 : 16} strokeWidth={2} aria-hidden="true" />
                {place.unlocked && !isHotel ? (
                  <span className="place-marker__badge">
                    <Check size={9} strokeWidth={3.5} aria-hidden="true" />
                  </span>
                ) : null}
              </span>
              <span className="place-marker__stem" />
              <span className="place-marker__ground" />
            </button>
          </MapMarker>
        );
      })}

      {models.map((model) => {
        const selected = selection?.kind === "model" && selection.id === model.id;
        return (
          <MapMarker
            key={model.id}
            longitude={model.longitude}
            latitude={model.latitude}
            anchor="center"
            zIndex={selected ? 28 : 5}
          >
            <button
              type="button"
              className="model-anchor"
              data-selected={selected}
              aria-label={`${model.name}, 3D model. Open details.`}
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "model", id: model.id })}
            >
              <span className="model-anchor__ring" />
            </button>
          </MapMarker>
        );
      })}

      {userLocation ? (
        <MapMarker
          longitude={userLocation.longitude}
          latitude={userLocation.latitude}
          anchor="center"
          zIndex={40}
        >
          <div className="user-dot" role="img" aria-label="Your location" />
        </MapMarker>
      ) : null}
    </>
  );
}

export const MarkerLayer = memo(MarkerLayerImpl);
