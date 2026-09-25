/**
 * Subscribes a component to the model registry.
 *
 * Reads go through the repository and re-run whenever it reports a change, so
 * publishing a model in the admin editor updates the public map in the next
 * tick — and would do the same over a websocket or a poll, without any
 * component knowing the difference.
 */

import { useCallback, useEffect, useState } from "react";

import { modelRepository } from "./modelRepository";
import type { MapModel } from "./types";

export type ModelScope = "all" | "published";

export function useModels(scope: ModelScope) {
  const [models, setModels] = useState<MapModel[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const records =
      scope === "all" ? await modelRepository.list() : await modelRepository.listPublished();
    setModels(records);
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      void load().catch((error) => {
        if (!cancelled) {
          console.warn("[models] registry read failed", error);
          setLoading(false);
        }
      });
    };

    run();
    const unsubscribe = modelRepository.subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load]);

  return { models, loading, reload: load };
}
