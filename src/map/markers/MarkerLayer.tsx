/**
 * Every custom marker on the map: places, 3D model ground anchors, and the
 * guest's own position. Mapbox's default pin is never used — a marker here is
 * a product surface, with its own selected, hover and press states.
 *
 * Places arrive already ranked by distance, so this component only has to
 * render the hierarchy someone else decided: colour by family, weight by how
 * near it is, and a label on the few that have earned one.
 */

import { memo } from "react";
import { Check, Lock } from "lucide-react";

import { MapMarker } from "../MapMarker";
import { CATEGORY_FAMILY, CATEGORY_ICON } from "../../ui/icons";
import {
  formatDistance,
  type Coordinates,
  type FixQuality,
  type RankedPlace,
} from "../../data/geo";
import type { MapModel } from "../../data/types";
import type { Selection } from "../../state/overlay";

interface MarkerLayerProps {
  places: RankedPlace[];
  models: MapModel[];
  selection: Selection | null;
  /** Place id the running mission points at next — gets a halo. */
  highlightPlaceId?: string;
  onSelect: (selection: Selection) => void;
  userLocation?: Coordinates | null;
  /** How much the fix can be trusted — the dot says so rather than hiding it. */
  userQuality?: FixQuality | null;
  /** Models whose attraction the guest has already collected. */
  visitedModelIds?: Set<string>;
  /**
   * Models still concealed under fog.
   *
   * These have no geometry on the map at all, so this marker is the only way
   * to find or select them — it has to stay present and pressable.
   */
  lockedModelIds?: Set<string>;
  /**
   * Per-model asset stage, so the ground ring can stand down once the real
   * geometry is standing in its place.
   */
  modelStage?: Map<string, "locked" | "pending" | "ready" | "failed">;
}

function MarkerLayerImpl({
  places,
  models,
  selection,
  highlightPlaceId,
  onSelect,
  userLocation,
  userQuality,
  visitedModelIds,
  lockedModelIds,
  modelStage,
}: MarkerLayerProps) {
  return (
    <>
      {places.map(({ place, metres, tier }) => {
        const Icon = CATEGORY_ICON[place.category];
        const family = CATEGORY_FAMILY[place.category];
        const selected = selection?.kind === "place" && selection.id === place.id;
        const isHotel = family === "hotel";
        const distance = metres === null ? null : formatDistance(metres);

        // A label is earned, not given: the hotel always, whatever is selected,
        // and the single nearest place. Everything else stays a dot.
        const labelled = isHotel || selected || tier === "nearest";

        const zIndex = selected ? 34 : isHotel ? 26 : tier === "nearest" ? 22 : tier === "near" ? 12 : 6;
        const size = isHotel || tier === "nearest" ? 20 : tier === "far" ? 14 : 16;

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
              data-family={family}
              data-category={place.category}
              data-tier={tier}
              data-selected={selected}
              data-highlight={place.id === highlightPlaceId && !selected}
              aria-label={
                distance
                  ? `${place.name}, ${distance} away. Open details.`
                  : `${place.name}. Open details.`
              }
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "place", id: place.id })}
            >
              {labelled ? (
                <span className="place-marker__label">
                  <span className="place-marker__name">{place.name}</span>
                  {distance ? <span className="place-marker__distance">{distance}</span> : null}
                </span>
              ) : null}

              <span className="place-marker__pin">
                <Icon size={size} strokeWidth={2} aria-hidden="true" />
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
        const locked = lockedModelIds?.has(model.id) ?? false;
        const stage = modelStage?.get(model.id) ?? (locked ? "locked" : "pending");

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
              data-visited={visitedModelIds?.has(model.id) ?? false}
              data-locked={locked}
              data-stage={stage}
              aria-label={
                locked
                  ? `${model.name}, locked. Photograph it to reveal it. Open details.`
                  : `${model.name}, 3D model. Open details.`
              }
              aria-pressed={selected}
              onClick={() => onSelect({ kind: "model", id: model.id })}
            >
              {/* Two rings: one on the ground plane, one spreading out of it.
                  Between them they say "this one is worth walking to" without
                  taking any more of the map than the old single ring did.

                  Once the real geometry is standing, the rings collapse rather
                  than unmount: a zero-size button is unreachable by keyboard,
                  and at a zoom where the model is a few pixels the badge is
                  still the only thing worth pressing. */}
              <span className="model-anchor__pulse" aria-hidden="true" />
              <span className="model-anchor__ring" />
              <span className="model-anchor__badge" aria-hidden="true">
                {locked ? <Lock size={7} strokeWidth={3} aria-hidden="true" /> : null}
              </span>
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
          <div
            className="user-dot"
            data-quality={userQuality ?? "precise"}
            role="img"
            aria-label={
              userQuality && userQuality !== "precise"
                ? "Your approximate location"
                : "Your location"
            }
          />
        </MapMarker>
      ) : null}
    </>
  );
}

export const MarkerLayer = memo(MarkerLayerImpl);
