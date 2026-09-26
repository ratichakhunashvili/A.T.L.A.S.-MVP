/**
 * Subscribing a component to a repository.
 *
 * The same contract `useModels` established, generalised: read through the
 * repository, re-read whenever it reports a change. An admin attaching a
 * partner in one panel updates every other panel in the next tick, and would
 * do the same over a websocket without any component knowing.
 */

import { useCallback, useEffect, useState } from "react";

import type { Collection, Identified } from "./repositories/collection";

export function useCollection<T extends Identified, D>(
  collection: Collection<T, D>,
): { items: T[]; loading: boolean; reload: () => Promise<void> } {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const records = await collection.list();
    setItems(records);
    setLoading(false);
  }, [collection]);

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      void load().catch(() => {
        if (!cancelled) setLoading(false);
      });
    };

    run();
    const unsubscribe = collection.subscribe(run);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [collection, load]);

  return { items, loading, reload: load };
}

/**
 * The same, for a derived query rather than a whole collection.
 *
 * `deps` is what re-runs the query; `sources` is which repositories to watch.
 * Both are needed: a partner list depends on a hotel id *and* on two
 * collections, and missing either makes the view stale in a way that is hard
 * to notice.
 */
export function useQuery<T>(
  query: () => Promise<T>,
  sources: { subscribe(listener: () => void): () => void }[],
  deps: unknown[],
): { data: T | null; loading: boolean; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(query, deps);

  const load = useCallback(async () => {
    const result = await run();
    setData(result);
    setLoading(false);
  }, [run]);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      void load().catch(() => {
        if (!cancelled) setLoading(false);
      });
    };

    refresh();
    const unsubscribes = sources.map((source) => source.subscribe(refresh));
    return () => {
      cancelled = true;
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return { data, loading, reload: load };
}
