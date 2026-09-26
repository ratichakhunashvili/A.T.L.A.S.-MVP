/**
 * The storage seam for every platform entity.
 *
 * `LocalModelRepository` proved the shape: an interface the app talks to, a
 * browser-local implementation behind it, and a documented HTTP swap. Eight
 * more entities should not mean eight more copies of that class, so the
 * mechanics live here once and each entity gets a thin typed repository.
 *
 * Records are seeded from `public/platform.seed.json` on first run — an
 * operator can edit the starting network without touching source, exactly as
 * they already can for 3D models.
 */

export interface Identified {
  id: string;
}

/** What every entity repository can do. */
export interface Collection<T extends Identified, D> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(draft: D): Promise<T>;
  update(id: string, patch: Partial<D>): Promise<T>;
  remove(id: string): Promise<void>;
  /** Replaces the whole collection. Used by seeding and admin imports. */
  replaceAll(records: T[]): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A readable, collision-resistant id. The slug keeps records legible in
 * devtools and in the seed file; the suffix is what actually makes it unique.
 */
export function makeId(prefix: string, name?: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const suffix = randomSuffix(6);
  return slug ? `${prefix}-${slug}-${suffix}` : `${prefix}-${suffix}`;
}

function randomSuffix(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/* ------------------------------------------------------------------------ */
/* Seed loading                                                              */
/* ------------------------------------------------------------------------ */

const SEED_URL = `${import.meta.env.BASE_URL}platform.seed.json`;

/** The shape of `public/platform.seed.json`. Every key is optional. */
type SeedDocument = Record<string, unknown[]>;

let seedPromise: Promise<SeedDocument> | null = null;

/**
 * Fetched once for the whole application, however many repositories ask. A
 * missing or malformed seed is an empty platform, not a failure — the admin
 * can build the network by hand.
 */
function loadSeed(): Promise<SeedDocument> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    try {
      const response = await fetch(SEED_URL, { cache: "no-cache" });
      if (!response.ok) return {};
      const parsed: unknown = await response.json();
      return parsed && typeof parsed === "object" ? (parsed as SeedDocument) : {};
    } catch {
      return {};
    }
  })();

  return seedPromise;
}

/* ------------------------------------------------------------------------ */
/* Browser-local implementation                                              */
/* ------------------------------------------------------------------------ */

const STORAGE_PREFIX = "atlas.";
const STORAGE_VERSION = "v1";

export interface LocalCollectionOptions<T> {
  /** Storage suffix and seed key, e.g. `hotels`. */
  name: string;
  /** Id prefix, e.g. `htl`. */
  prefix: string;
  /** Pulls a display name out of a draft so ids stay readable. */
  nameOf?: (draft: unknown) => string | undefined;
  /** Stamps `createdAt` / `updatedAt` if the entity carries them. */
  timestamps?: boolean;
  /** Last chance to normalise a record read from storage or the seed. */
  hydrate?: (record: T) => T;
}

class LocalCollection<T extends Identified, D> implements Collection<T, D> {
  private listeners = new Set<() => void>();
  private cache: T[] | null = null;
  private loading: Promise<T[]> | null = null;
  private readonly key: string;

  constructor(private readonly options: LocalCollectionOptions<T>) {
    this.key = `${STORAGE_PREFIX}${options.name}.${STORAGE_VERSION}`;

    if (typeof window !== "undefined") {
      // An admin publishing in another tab should reach this one.
      window.addEventListener("storage", (event) => {
        if (event.key !== this.key) return;
        this.cache = null;
        this.loading = null;
        this.emit();
      });
    }
  }

  private load(): Promise<T[]> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const stored = this.readStored();
      if (stored) {
        this.cache = stored;
        return stored;
      }

      const seed = await loadSeed();
      const raw = Array.isArray(seed[this.options.name]) ? (seed[this.options.name] as T[]) : [];
      const records = this.options.hydrate ? raw.map(this.options.hydrate) : raw;

      this.cache = records;
      this.persist(records);
      return records;
    })();

    return this.loading;
  }

  private readStored(): T[] | null {
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return this.options.hydrate ? (parsed as T[]).map(this.options.hydrate) : (parsed as T[]);
    } catch {
      // Private mode, quota, or corrupt JSON — fall through to the seed.
      return null;
    }
  }

  private persist(records: T[]): void {
    try {
      window.localStorage.setItem(this.key, JSON.stringify(records));
    } catch {
      // The in-memory copy stays authoritative for this session.
    }
  }

  private write(records: T[]): void {
    this.cache = records;
    this.loading = Promise.resolve(records);
    this.persist(records);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async list(): Promise<T[]> {
    return (await this.load()).slice();
  }

  async get(id: string): Promise<T | null> {
    return (await this.load()).find((record) => record.id === id) ?? null;
  }

  async create(draft: D): Promise<T> {
    const records = await this.load();
    const stamp = nowIso();
    const record = {
      ...(draft as object),
      id: makeId(this.options.prefix, this.options.nameOf?.(draft)),
      ...(this.options.timestamps === false ? {} : { createdAt: stamp, updatedAt: stamp }),
    } as T;

    this.write([record, ...records]);
    return record;
  }

  async update(id: string, patch: Partial<D>): Promise<T> {
    const records = await this.load();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) throw new Error(`No ${this.options.name} record with id ${id}`);

    const updated = {
      ...records[index],
      ...(patch as object),
      ...(this.options.timestamps === false ? {} : { updatedAt: nowIso() }),
    } as T;

    const next = records.slice();
    next[index] = updated;
    this.write(next);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const records = await this.load();
    this.write(records.filter((record) => record.id !== id));
  }

  async replaceAll(records: T[]): Promise<void> {
    this.write(records.slice());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function createLocalCollection<T extends Identified, D>(
  options: LocalCollectionOptions<T>,
): Collection<T, D> {
  return new LocalCollection<T, D>(options);
}

/* ------------------------------------------------------------------------ */
/* REST implementation                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Drop-in replacement once `/api/<name>` exists. Same contract, no local cache
 * and no cross-tab sync — a server makes both someone else's problem.
 *
 * Swapping a single entity to the server is a one-line change in that entity's
 * module, so the migration can be done incrementally rather than all at once.
 */
export function createHttpCollection<T extends Identified, D>(
  baseUrl: string,
): Collection<T, D> {
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  async function request<R>(path = "", init?: RequestInit): Promise<R> {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
    if (!response.ok) {
      throw new Error(`${init?.method ?? "GET"} ${baseUrl}${path} → ${response.status}`);
    }
    return response.status === 204 ? (undefined as R) : ((await response.json()) as R);
  }

  return {
    list: () => request<T[]>(),
    get: (id) => request<T | null>(`/${id}`),
    create: async (draft) => {
      const created = await request<T>("", { method: "POST", body: JSON.stringify(draft) });
      emit();
      return created;
    },
    update: async (id, patch) => {
      const updated = await request<T>(`/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      emit();
      return updated;
    },
    remove: async (id) => {
      await request<void>(`/${id}`, { method: "DELETE" });
      emit();
    },
    replaceAll: async (records) => {
      await request<void>("", { method: "PUT", body: JSON.stringify(records) });
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
