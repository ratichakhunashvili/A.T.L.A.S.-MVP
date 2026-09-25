/**
 * Asset storage for uploaded 3D models.
 *
 * `ModelStorageService` is the seam between the admin uploader and wherever the
 * bytes actually end up. The browser-local implementation below keeps files in
 * IndexedDB so the demo works with no backend at all; a Supabase / R2 / S3 /
 * Firebase adapter only has to satisfy the same three methods, and nothing in
 * the map renderer or the editor changes.
 *
 * References are stored on the record as opaque strings. Anything that is not
 * a `local:` reference is treated as a URL and returned untouched, so records
 * pointing at a CDN already work today.
 */

export interface UploadResult {
  /** The value to persist on `MapModel.modelUrl`. */
  ref: string;
  /** A URL usable immediately, without a further `getModelUrl` round trip. */
  url: string;
}

export interface ModelStorageService {
  uploadModel(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult>;
  deleteModel(ref: string): Promise<void>;
  /** Resolves a stored reference to something the renderer can fetch. */
  getModelUrl(ref: string): Promise<string>;
}

export const LOCAL_REF_PREFIX = "local:";

export function isLocalRef(ref: string): boolean {
  return ref.startsWith(LOCAL_REF_PREFIX);
}

/* ------------------------------------------------------------------------ */
/* IndexedDB plumbing                                                        */
/* ------------------------------------------------------------------------ */

const DB_NAME = "hospitality-map";
const DB_VERSION = 1;
const STORE = "model-assets";

interface StoredAsset {
  key: string;
  filename: string;
  contentType: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

function runTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Asset store write failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

/* ------------------------------------------------------------------------ */
/* Browser-local implementation                                              */
/* ------------------------------------------------------------------------ */

class LocalModelStorage implements ModelStorageService {
  /**
   * Object URLs are per-session. Caching them keeps a model from being
   * re-materialised (and re-downloaded by the map) on every style reload.
   */
  private urlCache = new Map<string, string>();

  async uploadModel(file: File, onProgress?: (fraction: number) => void): Promise<UploadResult> {
    const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    onProgress?.(0.1);

    const asset: StoredAsset = {
      key,
      filename: file.name,
      contentType: file.type || "model/gltf-binary",
      size: file.size,
      blob: file,
      createdAt: new Date().toISOString(),
    };

    await runTransaction("readwrite", (store) => store.put(asset));
    onProgress?.(1);

    const ref = `${LOCAL_REF_PREFIX}${key}`;
    const url = URL.createObjectURL(file);
    this.urlCache.set(ref, url);
    return { ref, url };
  }

  async deleteModel(ref: string): Promise<void> {
    if (!isLocalRef(ref)) return;
    const cached = this.urlCache.get(ref);
    if (cached) {
      URL.revokeObjectURL(cached);
      this.urlCache.delete(ref);
    }
    await runTransaction("readwrite", (store) => store.delete(ref.slice(LOCAL_REF_PREFIX.length)));
  }

  async getModelUrl(ref: string): Promise<string> {
    if (!isLocalRef(ref)) return ref;

    const cached = this.urlCache.get(ref);
    if (cached) return cached;

    const asset = await runTransaction<StoredAsset | undefined>("readonly", (store) =>
      store.get(ref.slice(LOCAL_REF_PREFIX.length)),
    );
    if (!asset) throw new Error(`Uploaded asset ${ref} is no longer in local storage`);

    const url = URL.createObjectURL(asset.blob);
    this.urlCache.set(ref, url);
    return url;
  }
}

export const modelStorage: ModelStorageService = new LocalModelStorage();

/* ------------------------------------------------------------------------ */
/* Upload validation                                                         */
/* ------------------------------------------------------------------------ */

export const ACCEPTED_MODEL_EXTENSIONS = [".glb", ".gltf"] as const;
export const MAX_MODEL_BYTES = 60 * 1024 * 1024;

export interface ValidationFailure {
  ok: false;
  message: string;
}
export interface ValidationSuccess {
  ok: true;
  extension: string;
}
export type ValidationResult = ValidationFailure | ValidationSuccess;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks a file before it is allowed anywhere near the public map: extension,
 * size, and — for `.glb` — the container header itself, so a renamed archive
 * or a truncated download is caught here rather than as a silent blank spot on
 * the map. `.gltf` is validated as JSON with the required `asset` block.
 */
export async function validateModelFile(file: File): Promise<ValidationResult> {
  const extension = extensionOf(file.name);

  if (!ACCEPTED_MODEL_EXTENSIONS.includes(extension as (typeof ACCEPTED_MODEL_EXTENSIONS)[number])) {
    return {
      ok: false,
      message: `${extension || "That file"} is not supported. Upload a .glb or .gltf — convert .obj, .fbx or .blend to GLB first.`,
    };
  }

  if (file.size === 0) return { ok: false, message: "That file is empty." };

  if (file.size > MAX_MODEL_BYTES) {
    return {
      ok: false,
      message: `${formatBytes(file.size)} is over the ${formatBytes(MAX_MODEL_BYTES)} limit. Decimate the mesh or reduce texture size.`,
    };
  }

  if (extension === ".glb") {
    const header = new DataView(await file.slice(0, 12).arrayBuffer());
    if (header.byteLength < 12 || header.getUint32(0, true) !== 0x46546c67 /* "glTF" */) {
      return { ok: false, message: "This is not a valid GLB — the file header is missing." };
    }
    const version = header.getUint32(4, true);
    if (version !== 2) {
      return { ok: false, message: `GLB version ${version} is not supported. Export as glTF 2.0.` };
    }
    const declared = header.getUint32(8, true);
    if (declared !== file.size) {
      return { ok: false, message: "This GLB looks truncated — re-export it and try again." };
    }
    return { ok: true, extension };
  }

  try {
    const parsed = JSON.parse(await file.text()) as { asset?: { version?: string } };
    if (!parsed.asset?.version) {
      return { ok: false, message: "This .gltf has no asset block — it is not a valid glTF document." };
    }
  } catch {
    return { ok: false, message: "This .gltf could not be parsed as JSON." };
  }

  return { ok: true, extension };
}
