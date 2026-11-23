import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { GameDump } from '../src/import/dump-schema';
import { parseGameDump, type ImportedGame } from '../src/import/parse-dump';
import type { Project, Recipe, RecipeIO } from '../src/core/types';

/**
 * A trimmed Monifactory export: thirteen usable recipes covering the awkward cases (tag inputs,
 * chanced outputs, cleanroom conditions, other mods, tools, buckets) plus a generator fuel and a
 * deliberately broken entry.
 */
export function sampleDump(): GameDump {
  const path = fileURLToPath(new URL('./fixtures/sample-export.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as GameDump;
}

let cached: ImportedGame | null = null;

/** The parsed sample export. Parsing registers item names globally, so it is shared. */
export function sampleGame(): ImportedGame {
  if (!cached) cached = parseGameDump(sampleDump());
  return cached;
}

export function recipesById(game: ImportedGame): Record<string, Recipe> {
  return Object.fromEntries(game.recipes.map((r) => [r.id, r]));
}

/** A recipe written the short way, for tests that only care about the graph shape. */
export function recipe(
  id: string,
  options: {
    machine?: string;
    eut?: number;
    duration?: number;
    inputs?: ReadonlyArray<[string, number, boolean?]>;
    outputs?: ReadonlyArray<[string, number, boolean?]>;
    recycling?: boolean;
    src?: 'game';
    name?: string;
  } = {},
): Recipe {
  const io = ([item, amount, fluid]: [string, number, boolean?]): RecipeIO =>
    fluid ? { item, amount, fluid: true } : { item, amount };

  const built: Recipe = {
    id,
    name: options.name ?? id,
    machine: options.machine ?? 'M',
    eut: options.eut ?? 8,
    duration: options.duration ?? 20,
    inputs: (options.inputs ?? []).map(io),
    outputs: (options.outputs ?? []).map(io),
  };
  if (options.recycling) built.recycling = true;
  if (options.src) built.src = options.src;
  return built;
}

/** A plan with sensible defaults, so each test only states what it is about. */
export function plan(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p_test',
    name: 'test',
    targets: [],
    choices: {},
    nodes: {},
    defaultTier: 1,
    defaultCoil: 0,
    gridTier: 2,
    autoExpand: true,
    gen: { preset: 0, eut: 32 },
    ...overrides,
  };
}
