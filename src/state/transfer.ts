/**
 * Getting plans and recipes in and out: JSON backups, and a plan packed into a link.
 *
 * Imports are deliberately additive. A backup or a shared link merges its recipes into your
 * library and adds its plans alongside yours; nothing you already have is replaced by surprise.
 * Everything coming in is also re-validated, since a file or a URL can say anything.
 */
import { addItemNames, itemNameRaw } from '../core/item-names';
import type { AppState, Project, Recipe, RecipeIO } from '../core/types';
import { newProject, uid } from './project';

/** Current payload version of a share link. */
const SHARE_VERSION = 1;
const SHARE_PREFIX = '#plan=';

export interface SharePayload {
  v: number;
  project?: Partial<Project>;
  recipes?: unknown[];
  /** Display names for the items used, so a shared link reads properly without an import. */
  names?: Record<string, string>;
}

/** A backup file, which the app writes and may also be hand-assembled. */
export interface BackupFile {
  library?: unknown[];
  projects?: Partial<Project>[];
  /** Older backups held a single plan. */
  project?: Partial<Project>;
}

/* ------------------------------ validation ------------------------------ */

/**
 * Rebuild a recipe from untrusted JSON, keeping only fields we understand and coercing the rest.
 * Returns null for anything that could not be a recipe.
 */
export function sanitizeRecipe(input: unknown): Recipe | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw['outputs'])) return null;

  const sides = (value: unknown): RecipeIO[] =>
    (Array.isArray(value) ? value : [])
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !!entry['item'])
      .map((entry) => {
        const io: RecipeIO = { item: String(entry['item']), amount: Number(entry['amount']) || 0 };
        if (entry['fluid']) io.fluid = true;
        if (entry['chance'] != null && entry['chance'] !== '') io.chance = Number(entry['chance']);
        return io;
      });

  const recipe: Recipe = {
    id: String(raw['id'] ?? uid('r_')),
    name: String(raw['name'] ?? 'Unnamed'),
    machine: String(raw['machine'] ?? 'Unknown'),
    duration: Math.max(1, Number(raw['duration']) || 1),
    eut: Math.max(0, Number(raw['eut']) || 0),
    inputs: sides(raw['inputs']),
    outputs: sides(raw['outputs']),
  };
  if (Number(raw['temp']) > 0) recipe.temp = Number(raw['temp']);

  return recipe.outputs.length ? recipe : null;
}

export interface MergeResult {
  added: number;
  updated: number;
}

/** Merge recipes into the library, matching on id. */
export function mergeRecipes(state: AppState, incoming: readonly unknown[]): MergeResult {
  let added = 0;
  let updated = 0;

  for (const entry of incoming) {
    const recipe = sanitizeRecipe(entry);
    if (!recipe) continue;

    const existing = state.library.findIndex((r) => r.id === recipe.id);
    if (existing >= 0) {
      state.library[existing] = recipe;
      updated++;
    } else {
      state.library.push(recipe);
      added++;
    }
  }
  return { added, updated };
}

/** Add an imported plan, with a fresh id so it cannot collide with one you have. */
export function importProject(state: AppState, incoming: Partial<Project>): Project {
  const project = newProject(incoming);
  project.name = incoming.name ?? 'Imported plan';
  state.projects.push(project);
  return project;
}

/* ------------------------------ backups ------------------------------ */

export function backupJson(state: AppState): string {
  return JSON.stringify(
    { app: 'MoniFlow', version: SHARE_VERSION, library: state.library, projects: state.projects },
    null,
    2,
  );
}

export function libraryJson(state: AppState): string {
  return JSON.stringify({ library: state.library }, null, 2);
}

/* ------------------------------ share links ------------------------------ */

/**
 * Pack the current plan into a link. The recipes it uses travel with it, so the link works for
 * someone who has not imported the same game export — including the item display names, which
 * otherwise only exist inside an import.
 */
export function buildShareUrl(project: Project, usedRecipes: readonly Recipe[]): string {
  const names: Record<string, string> = {};
  for (const recipe of usedRecipes) {
    for (const io of [...recipe.inputs, ...recipe.outputs]) {
      const name = itemNameRaw(io.item);
      if (name && name !== io.item) names[io.item] = name;
    }
  }

  const payload: SharePayload = {
    v: SHARE_VERSION,
    // The id is dropped: the recipient gets a plan of their own.
    project: { ...project, id: undefined },
    recipes: [...usedRecipes],
    names,
  };

  const encoded = toBase64(JSON.stringify(payload));
  return `${location.href.split('#')[0]}${SHARE_PREFIX}${encoded}`;
}

export function isShareHash(hash: string): boolean {
  return hash.startsWith(SHARE_PREFIX);
}

export function parseShareHash(hash: string): SharePayload | null {
  if (!isShareHash(hash)) return null;
  try {
    return JSON.parse(fromBase64(hash.slice(SHARE_PREFIX.length))) as SharePayload;
  } catch {
    return null;
  }
}

/**
 * Apply a shared payload. Recipes are only added when missing, so opening a link can never
 * overwrite a recipe you have edited.
 */
export function applySharePayload(
  state: AppState,
  payload: SharePayload,
  knownRecipeId: (id: string) => boolean,
): Project | null {
  for (const entry of payload.recipes ?? []) {
    const recipe = sanitizeRecipe(entry);
    if (recipe && !knownRecipeId(recipe.id)) state.library.push(recipe);
  }

  if (payload.names) addItemNames(payload.names);
  return payload.project ? importProject(state, payload.project) : null;
}

/** Base64 over UTF-8, which `btoa` alone cannot do. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
