/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/**
 * Last good element set, kept in IndexedDB.
 *
 * It's ~1.8 MB of text, so too big for localStorage, and re-downloading it
 * every page load is a waste when it changes twice a day. Cached locally, a
 * repeat visit draws the constellation before the network even resolves, and
 * the thing works offline.
 */

const DB_NAME = 'starlink-tracker';
const DB_VERSION = 1;
const STORE = 'tle';
const KEY = 'latest';

export interface CachedTle {
  text: string;
  fetchedAt: number;
  etag: string | null;
  storedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    // Private browsing and storage pressure both fail here. Fall back to
    // network-only rather than breaking.
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function readCachedTle(): Promise<CachedTle | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<CachedTle | null>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as CachedTle | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function writeCachedTle(value: Omit<CachedTle, 'storedAt'>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...value, storedAt: Date.now() }, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}
