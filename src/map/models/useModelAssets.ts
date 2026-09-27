/**
 * Resolving 3D assets, and knowing whether they actually arrived.
 *
 * Mapbox's model layer has no load event. Handed a URL, it either draws
 * something or it does not, and a 404 or a renamed archive becomes a blank
 * patch on the map with nothing in the console tying it to a record. So the
 * bytes are fetched here first and validated against the same container check
 * the uploader uses — which costs no extra bandwidth for a GLB, because the
 * blob we already downloaded is what gets handed on.
 *
 * This is also the one place in the app that creates an object URL. Two caches
 * used to make them and neither ever revoked; owning both ends here means an
 * asset that leaves the map takes its URL with it.
 *
 * Entries are keyed by the asset *reference*, not by model id: `useModels`
 * hands back a fresh array on every repository notification, and keying by id
 * would re-download every GLB each time an unrelated record changed.
 */

import { useEffect, useRef, useState } from "react";

import {
  extensionOfRef,
  isLocalRef,
  modelStorage,
  validateModelBytes,
} from "../../data/storage";
import type { MapModel } from "../../data/types";

export type ModelAsset =
  | { status: "pending" }
  | { status: "ready"; url: string }
  | { status: "failed"; reason: string };

/** Give up on an asset that has not arrived in this long. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Mapbox caches a model by the URL string it was given, so revoking an object
 * URL while a feature still references it blanks the model that was drawing
 * correctly a moment ago. Revoking a beat after the record has left avoids it.
 */
const REVOKE_DELAY_MS = 500;

interface Entry {
  asset: ModelAsset;
  /** Set only when we created it — a passthrough URL is not ours to revoke. */
  objectUrl?: string;
  controller: AbortController;
  timedOut: boolean;
}

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "could not be loaded";
}

export function useModelAssets(models: MapModel[]): Map<string, ModelAsset> {
  const [assets, setAssets] = useState<Map<string, ModelAsset>>(() => new Map());
  const entries = useRef(new Map<string, Entry>());
  const revokeTimers = useRef(new Map<string, number>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const publish = () => {
      if (!mounted.current) return;
      const next = new Map<string, ModelAsset>();
      for (const [ref, entry] of entries.current) next.set(ref, entry.asset);
      setAssets(next);
    };

    const settle = (ref: string, asset: ModelAsset, objectUrl?: string) => {
      const entry = entries.current.get(ref);
      // The record left while this was in flight; the URL is already orphaned.
      if (!entry) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      entry.asset = asset;
      entry.objectUrl = objectUrl;
      publish();
    };

    const resolve = async (ref: string, entry: Entry) => {
      const timer = window.setTimeout(() => {
        entry.timedOut = true;
        entry.controller.abort();
      }, FETCH_TIMEOUT_MS);

      try {
        const blob = await modelStorage.getModelBlob(ref, entry.controller.signal);
        const extension = await extensionOfRef(ref, blob);

        const check = await validateModelBytes(blob, extension);
        if (!check.ok) {
          settle(ref, { status: "failed", reason: check.message });
          return;
        }

        // A remote `.gltf` resolves its `.bin` buffers and its textures
        // relative to its own URL. Handing Mapbox a blob URL instead silently
        // breaks every one of those references, so the original address is
        // what goes on the feature — the fetch above was only to prove it is
        // really there and really glTF.
        if (extension === ".gltf" && !isLocalRef(ref)) {
          settle(ref, { status: "ready", url: ref });
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        settle(ref, { status: "ready", url: objectUrl }, objectUrl);
      } catch (error) {
        if (entry.controller.signal.aborted && !entry.timedOut) return; // record left
        settle(ref, {
          status: "failed",
          reason: entry.timedOut ? "timed out" : reasonOf(error),
        });
      } finally {
        window.clearTimeout(timer);
      }
    };

    const wanted = new Set(models.map((model) => model.modelUrl));
    let changed = false;

    for (const ref of wanted) {
      // A revoke was pending for an asset that has come back — cancel it
      // rather than pulling the URL out from under the feature being re-added.
      const pending = revokeTimers.current.get(ref);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        revokeTimers.current.delete(ref);
      }

      if (entries.current.has(ref)) continue;

      const entry: Entry = {
        asset: { status: "pending" },
        controller: new AbortController(),
        timedOut: false,
      };
      entries.current.set(ref, entry);
      changed = true;
      void resolve(ref, entry);
    }

    for (const [ref, entry] of [...entries.current]) {
      if (wanted.has(ref)) continue;
      entry.controller.abort();
      entries.current.delete(ref);
      changed = true;

      const { objectUrl } = entry;
      if (!objectUrl) continue;
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
        revokeTimers.current.delete(ref);
      }, REVOKE_DELAY_MS);
      revokeTimers.current.set(ref, timer);
    }

    if (changed) publish();
  }, [models]);

  // Refs are stable, so this runs once: abort anything in flight and hand back
  // every URL this hook minted.
  const cleanup = useRef<() => void>(() => {});
  cleanup.current = () => {
    for (const entry of entries.current.values()) {
      entry.controller.abort();
      if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
    }
    entries.current.clear();
    for (const timer of revokeTimers.current.values()) window.clearTimeout(timer);
    revokeTimers.current.clear();
  };

  useEffect(() => () => cleanup.current(), []);

  return assets;
}
