/**
 * Saving your plans and recipe library.
 *
 * These are small enough for localStorage (the big thing, the imported game recipe set, lives in
 * IndexedDB instead — see `import/game-store.ts`). Saves are debounced because the app saves after
 * every change, and typing in a rate field is a lot of changes.
 *
 * A read that does not look like our data returns null rather than throwing, so a corrupted or
 * foreign entry just means starting fresh instead of a blank page.
 */
import type { AppState } from '../core/types';
import { newProject } from './project';

const STORE_KEY = 'moniflow.v1';
const SAVE_DELAY_MS = 200;

export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as AppState | null;
    if (!parsed || !Array.isArray(parsed.library)) return null;
    if (!Array.isArray(parsed.projects) || !parsed.projects.length) return null;

    // Fill in fields added since the state was written, keeping each plan's own id.
    parsed.projects = parsed.projects.map((project) => ({ ...newProject(), ...project }));
    return parsed;
  } catch {
    return null;
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

export function saveState(state: AppState): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked (private browsing). Nothing useful to do but keep running.
    }
  }, SAVE_DELAY_MS);
}
