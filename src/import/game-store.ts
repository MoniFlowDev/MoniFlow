/**
 * Where the imported game recipes live.
 *
 * A Monifactory export is tens of megabytes once parsed — far past what localStorage will take —
 * so it goes in IndexedDB under a single key and is read back on load. Everything here degrades
 * to "no game data" rather than throwing, because an import failing should leave you with a
 * usable app and your own recipes intact.
 */
import type { ImportedGame } from './parse-dump';

const DB_NAME = 'moniflow';
const STORE = 'gamedata';
const DB_VERSION = 1;

/** The single key the current import is stored under. */
const CURRENT = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function read<T>(key: string): Promise<T | null> {
  const db = await open();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function write(key: string, value: unknown): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (value == null) store.delete(key);
      else store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The imported game data, or null if there is none (or storage is unavailable). */
export async function loadGameData(): Promise<ImportedGame | null> {
  try {
    return await read<ImportedGame>(CURRENT);
  } catch {
    return null;
  }
}

/** Replace the stored import. Pass null to clear it. */
export function saveGameData(data: ImportedGame | null): Promise<void> {
  return write(CURRENT, data);
}

/** Read an auxiliary value, such as the icon atlas. */
export function loadAux<T>(key: string): Promise<T | null> {
  return read<T>(key).catch(() => null);
}

/** Store an auxiliary value. Pass null to delete it. */
export function saveAux(key: string, value: unknown): Promise<void> {
  return write(key, value);
}
