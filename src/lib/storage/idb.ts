/**
 * Minimal IndexedDB wrapper — no external dependency.
 * One database, two stores: `datasets` (large imported records) and `meta`
 * (small settings). Derived data (graphs, stats) is never stored; it is
 * recomputed on load so stale caches cannot contradict the records.
 */

const DB_NAME = "music-universe";
const DB_VERSION = 1;
export const DATASET_STORE = "datasets";
export const META_STORE = "meta";
export const ACTIVE_DATASET_KEY = "active";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATASET_STORE)) {
        db.createObjectStore(DATASET_STORE);
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () => reject(new Error("IndexedDB open blocked by another tab."));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export async function putValue<T>(store: string, key: string, value: T): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, "readwrite");
  await requestToPromise(tx.objectStore(store).put(value, key));
}

export async function getValue<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase();
  const tx = db.transaction(store, "readonly");
  return requestToPromise<T | undefined>(tx.objectStore(store).get(key));
}

export async function deleteValue(store: string, key: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, "readwrite");
  await requestToPromise(tx.objectStore(store).delete(key));
}

export async function clearStore(store: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(store, "readwrite");
  await requestToPromise(tx.objectStore(store).clear());
}
