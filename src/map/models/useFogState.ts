/**
 * Which attractions are still concealed for this guest.
 *
 * Three records have to agree before a model is fogged, and the join has to be
 * null-safe at every hop — a half-configured attraction that fogged forever
 * would be worse than one that never fogged at all:
 *
 *     MapModel  ←(Experience.modelId)—  Experience  ←(Achievement.attractionId)—  Achievement
 *
 * A model is locked when an attraction points at it, that attraction has an
 * active achievement, and this guest has not unlocked it. Anything else — a
 * model nobody linked, an attraction with no achievement, an achievement an
 * admin switched off — renders normally. Scenery is scenery.
 *
 * Read through `experiences` rather than `eligiblePartnerExperiences`: that
 * helper scopes the catalogue to what a *hotel* may recommend, which is a
 * different question. The model is already on everyone's map; this only
 * decides whether it is concealed.
 */

import { useMemo } from "react";

import { achievements } from "../../data/repositories/achievements";
import { experiences } from "../../data/repositories/catalogue";
import { useCollection } from "../../data/useCollection";
import type { MapModel } from "../../data/types";

export interface FogState {
  /** Models concealed for this guest. */
  lockedModelIds: Set<string>;
  /** Models that could be concealed at all — linked, with a live achievement. */
  fogCapableModelIds: Set<string>;
  /** `MapModel.id` → the attraction it belongs to, for the details sheet. */
  attractionIdByModelId: Map<string, string>;
}

interface Options {
  models: MapModel[];
  /** Attraction ids this guest has unlocked, from their achievement collection. */
  unlockedAttractionIds: Set<string>;
}

export function useFogState({ models, unlockedAttractionIds }: Options): FogState {
  const { items: catalogue } = useCollection(experiences);
  const { items: awards } = useCollection(achievements);

  return useMemo(() => {
    const activeAchievementByAttraction = new Set(
      awards.filter((award) => award.active).map((award) => award.attractionId),
    );

    const attractionIdByModelId = new Map<string, string>();
    for (const attraction of catalogue) {
      if (!attraction.modelId) continue;
      if (!attraction.active) continue;
      attractionIdByModelId.set(attraction.modelId, attraction.id);
    }

    const fogCapableModelIds = new Set<string>();
    const lockedModelIds = new Set<string>();

    for (const model of models) {
      const attractionId = attractionIdByModelId.get(model.id);
      if (!attractionId) continue;
      if (!activeAchievementByAttraction.has(attractionId)) continue;

      fogCapableModelIds.add(model.id);
      if (!unlockedAttractionIds.has(attractionId)) lockedModelIds.add(model.id);
    }

    if (import.meta.env.DEV) {
      // A dangling `modelId` is invisible in production and costs an admin an
      // afternoon. Say so on the day it is introduced.
      for (const attraction of catalogue) {
        if (!attraction.modelId) continue;
        if (models.some((model) => model.id === attraction.modelId)) continue;
        console.warn(
          `[fog] "${attraction.name}" points at model "${attraction.modelId}", which does not exist`,
        );
      }
    }

    return { lockedModelIds, fogCapableModelIds, attractionIdByModelId };
  }, [models, catalogue, awards, unlockedAttractionIds]);
}
