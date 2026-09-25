/**
 * The model registry.
 *
 * The map renderer and the admin editor both talk to a `ModelRepository` and
 * nothing else. Today the active implementation keeps records in the browser;
 * `createHttpModelRepository` at the bottom is the same interface over a REST
 * API. Moving to a real backend is a one-line swap of `modelRepository`.
 *
 * No model is declared in JavaScript. The starting registry is fetched from
 * `public/models.seed.json`, so even the seed is data an operator can edit
 * without touching source — and after the first run it is whatever the admin
 * has published.
 */

import type { MapModel, MapModelDraft } from "./types";

export interface ModelRepository {
  /** Every record, whatever its status — the admin library view. */
  list(): Promise<MapModel[]>;
  /** Only what the public map is allowed to render. */
  listPublished(): Promise<MapModel[]>;
  get(id: string): Promise<MapModel | null>;
  create(draft: MapModelDraft): Promise<MapModel>;
  update(id: string, patch: Partial<MapModelDraft>): Promise<MapModel>;
  remove(id: string): Promise<void>;
  /** Notifies on any mutation. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** A record reaches the public map only when it is published *and* visible. */
export function isLive(model: MapModel): boolean {
  return model.status === "published" && model.visible;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 28) || "model";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ------------------------------------------------------------------------ */
/* Browser-local implementation                                              */
/* ------------------------------------------------------------------------ */

const STORAGE_KEY = "hospitality-map.models.v1";
const SEED_URL = `${import.meta.env.BASE_URL}models.seed.json`;

class LocalModelRepository implements ModelRepository {
  private listeners = new Set<() => void>();
  private cache: MapModel[] | null = null;
  private loading: Promise<MapModel[]> | null = null;

  constructor() {
    // Another tab editing the registry should refresh this one.
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) {
          this.cache = null;
          this.loading = null;
          this.emit();
        }
      });
    }
  }

  /**
   * Resolves the registry once. Concurrent callers share the same promise, so
   * five components mounting at once still produce one fetch.
   */
  private load(): Promise<MapModel[]> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.loading) return this.loading;

    this.loading = (async () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as MapModel[];
          if (Array.isArray(parsed)) {
            this.cache = parsed;
            return parsed;
          }
        }
      } catch {
        /* private mode, quota, or corrupted JSON — fall through to the seed */
      }

      let seed: MapModel[] = [];
      try {
        const response = await fetch(SEED_URL, { cache: "no-cache" });
        if (response.ok) {
          const parsed = (await response.json()) as MapModel[];
          if (Array.isArray(parsed)) seed = parsed;
        }
      } catch {
        // No seed file is a legitimate state: an empty registry, and the admin
        // fills it. It is not a reason to fail the map.
      }

      this.cache = seed;
      this.persist(seed);
      return seed;
    })();

    return this.loading;
  }

  private persist(records: MapModel[]): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Keep the in-memory copy authoritative for this session.
    }
  }

  private write(records: MapModel[]): void {
    this.cache = records;
    this.loading = Promise.resolve(records);
    this.persist(records);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async list(): Promise<MapModel[]> {
    return (await this.load()).slice();
  }

  async listPublished(): Promise<MapModel[]> {
    return (await this.load()).filter(isLive);
  }

  async get(id: string): Promise<MapModel | null> {
    return (await this.load()).find((model) => model.id === id) ?? null;
  }

  async create(draft: MapModelDraft): Promise<MapModel> {
    const records = await this.load();
    const record: MapModel = {
      ...draft,
      id: makeId(draft.name),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.write([record, ...records]);
    return record;
  }

  async update(id: string, patch: Partial<MapModelDraft>): Promise<MapModel> {
    const records = await this.load();
    const index = records.findIndex((model) => model.id === id);
    if (index === -1) throw new Error(`No model with id ${id}`);

    const updated: MapModel = { ...records[index], ...patch, updatedAt: nowIso() };
    const next = records.slice();
    next[index] = updated;
    this.write(next);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const records = await this.load();
    this.write(records.filter((model) => model.id !== id));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/* ------------------------------------------------------------------------ */
/* REST implementation                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Drop-in replacement once `GET/POST/PATCH/DELETE /api/models` exists. It has
 * no local cache and no cross-tab sync — a backend makes both someone else's
 * problem — but satisfies the same contract, so callers are unaffected.
 */
export function createHttpModelRepository(baseUrl = "/api/models"): ModelRepository {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  async function request<T>(path = "", init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${baseUrl}${path} → ${response.status}`);
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  return {
    list: () => request<MapModel[]>(),
    listPublished: () => request<MapModel[]>("?status=published"),
    get: (id) => request<MapModel | null>(`/${id}`),
    create: async (draft) => {
      const created = await request<MapModel>("", { method: "POST", body: JSON.stringify(draft) });
      emit();
      return created;
    },
    update: async (id, patch) => {
      const updated = await request<MapModel>(`/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      emit();
      return updated;
    },
    remove: async (id) => {
      await request<void>(`/${id}`, { method: "DELETE" });
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The repository the app uses. Swap this line to change backends. */
export const modelRepository: ModelRepository = new LocalModelRepository();
