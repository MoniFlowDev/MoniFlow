/**
 * Turning an exporter dump into MoniFlow recipes.
 *
 * The dump holds every recipe the game ended up with, in one of two forms. Most arrive in the
 * exporter's compact form (`{ gt: … }` for GregTech, `{ generic: … }` for everything else), which
 * is already close to what we want. The rest arrive as the game's own recipe JSON and have to be
 * read capability by capability.
 *
 * Anything that is not a recipe we can plan with is counted and skipped rather than failing the
 * import: generator fuels produce EU instead of consuming it, and a recipe with no outputs is of
 * no use to a planner.
 */
import { itemName, registerItemNames } from '../core/item-names';
import type { Recipe, RecipeIO } from '../core/types';
import type { GameDump, IconData, ImportMeta, ImportStats } from './dump-schema';
import {
  chanceOf,
  contentList,
  parseEut,
  parseFluidContent,
  parseItemContent,
} from './ingredients';
import { applyLeftovers, normalizeTools } from './leftovers';
import { machineFromType } from './machine-names';
import { TagResolver } from './tag-resolver';

export interface ImportedGame {
  recipes: Recipe[];
  /** Item id -> display name, as the game reported it. */
  names: Record<string, string>;
  stats: ImportStats;
  icons: IconData;
  itemInfo: Record<string, string>;
  meta: ImportMeta;
}

/** How many exporter warnings to carry through to the UI. */
const MAX_EXPORT_ERRORS = 10;

/** A recipe body, before it is given an id, a name and a machine. */
interface RecipeBody {
  duration: number;
  eut: number;
  inputs: RecipeIO[];
  outputs: RecipeIO[];
  temp: number;
  cond: Recipe['cond'] | null;
  recycling: boolean;
  /** GregTech recipes are timed in ticks and always take at least one; other mods' may be instant. */
  kind: 'gt' | 'generic';
}

/** A generator fuel: it makes EU rather than using it, so it is not a recipe we can plan. */
const GENERATOR = Symbol('generator');
type ParseOutcome = RecipeBody | typeof GENERATOR | null;

export function parseGameDump(dump: GameDump): ImportedGame {
  if (!dump || !Array.isArray(dump.recipes)) {
    throw new Error('This file does not look like a MoniFlow export (no "recipes" list).');
  }

  const items = dump.items ?? {};
  const fluids = dump.fluids ?? {};
  const itemInfo = dump.itemInfo ?? {};
  const resolver = new TagResolver(dump.tags ?? {}, items, fluids);

  // Register names first: a game recipe has no name of its own, so it is titled after its product.
  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(items)) if (name) names[id] = name;
  for (const [id, name] of Object.entries(fluids)) if (name && !names[id]) names[id] = name;
  registerItemNames(names);

  const stats: ImportStats = {
    total: dump.recipes.length,
    parsed: 0,
    skipped: 0,
    generators: 0,
    errors: 0,
    gregtech: 0,
    other: 0,
    tagGuesses: 0,
    tagUnresolved: 0,
    toolsNormalized: 0,
    types: {},
  };

  const recipes: Recipe[] = [];
  const usedIds = new Set<string>();

  for (const entry of dump.recipes) {
    let id: string | null = null;
    let type = 'gtceu:unknown';
    let body: ParseOutcome;

    try {
      const compact = compactPayload(entry);
      if (compact) {
        id = compact.id;
        type = compact.type;
        body = parseCompact(compact.payload, compact.isGregtech, resolver, itemInfo);
      } else {
        const json = recipeJson(entry);
        if (!json) {
          stats.skipped++;
          continue;
        }
        id = json.id;
        type = json.type;
        body = parseRecipeJson(json.value, resolver);
      }
    } catch {
      stats.errors++;
      continue;
    }

    if (body === GENERATOR) {
      stats.generators++;
      continue;
    }
    if (!body || !body.outputs.length) {
      stats.skipped++;
      continue;
    }

    const recipe = assemble(body, uniqueId(id, type, recipes.length, usedIds), type);
    recipes.push(recipe);
    stats.parsed++;
    if (body.kind === 'generic') stats.other++;
    else stats.gregtech++;
    stats.types[recipe.machine] = (stats.types[recipe.machine] ?? 0) + 1;
  }

  const icons: IconData = {
    gtIcons: dump.gtIcons ?? {},
    gtMaterials: dump.gtMaterials ?? {},
    iconSets: dump.iconSets ?? {},
  };

  stats.tagGuesses = resolver.stats.guesses;
  stats.tagUnresolved = resolver.stats.unresolved;
  stats.toolsNormalized = normalizeTools(recipes, { gtIcons: icons.gtIcons, itemInfo, names });

  return {
    recipes,
    names,
    stats,
    icons,
    itemInfo,
    meta: {
      exported: dump.exported ?? null,
      gtceu: dump.gtceu ?? null,
      exportErrors: exportErrors(dump.errors),
    },
  };
}

/* ------------------------------ entry forms ------------------------------ */

interface CompactEntry {
  id: string | null;
  type: string;
  isGregtech: boolean;
  payload: Record<string, unknown>;
}

/** The exporter's own compact form, which covers the vast majority of entries. */
function compactPayload(entry: unknown): CompactEntry | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const rec = entry as Record<string, unknown>;
  const gt = rec['gt'];
  const generic = rec['generic'];
  const payload = (gt ?? generic) as Record<string, unknown> | undefined;
  if (!payload) return null;

  const isGregtech = gt != null;
  return {
    id: rec['id'] == null ? null : String(rec['id']),
    type: String(rec['type'] ?? (isGregtech ? 'gtceu:unknown' : 'unknown')),
    isGregtech,
    payload,
  };
}

/** The game's raw recipe JSON, which may be an object, a JSON string, or wrapped in either. */
function recipeJson(
  entry: unknown,
): { id: string | null; type: string; value: Record<string, unknown> } | null {
  let value: unknown;
  let id: unknown;

  if (typeof entry === 'string') {
    value = JSON.parse(entry);
    id = (value as Record<string, unknown>)?.['id'];
  } else if (entry && typeof entry === 'object') {
    const rec = entry as Record<string, unknown>;
    id = rec['id'];
    if (typeof rec['json'] === 'string') value = JSON.parse(rec['json']);
    else if (rec['json']) value = rec['json'];
    else value = entry;
  } else {
    return null;
  }

  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const outerType = (entry as Record<string, unknown> | null)?.['type'];
  return {
    id: id == null ? null : String(id),
    type: String(rec['type'] ?? outerType ?? 'gtceu:unknown'),
    value: rec,
  };
}

/* ------------------------------ compact form ------------------------------ */

/** One compact ingredient: `{ id, n: amount, f: isFluid, c: chance as a fraction }`. */
interface CompactIO {
  id?: unknown;
  n?: unknown;
  f?: unknown;
  c?: unknown;
}

function parseCompact(
  payload: Record<string, unknown>,
  isGregtech: boolean,
  resolver: TagResolver,
  itemInfo: Record<string, string>,
): ParseOutcome {
  if (Number(payload['gen']) > 0) return GENERATOR;

  const inputs = compactList(payload['in'], resolver);
  const outputs = compactList(payload['out'], resolver);
  if (!isGregtech) applyLeftovers(inputs, outputs, itemInfo);

  return {
    duration: Math.max(0, Number(payload['duration']) || 0),
    eut: Math.max(0, Number(payload['eut']) || 0),
    inputs,
    outputs,
    temp: Number(payload['temp']) || 0,
    cond: cleanroomLabel(payload['clean']),
    recycling: false,
    kind: isGregtech ? 'gt' : 'generic',
  };
}

function compactList(list: unknown, resolver: TagResolver): RecipeIO[] {
  if (!Array.isArray(list)) return [];
  const out: RecipeIO[] = [];

  for (const raw of list as CompactIO[]) {
    if (!raw?.id || !(Number(raw.n) > 0)) continue;
    const fluid = !!raw.f;
    const id = String(raw.id);
    const io: RecipeIO = {
      item: fluid ? resolver.fluid(id) : resolver.item(id),
      amount: Number(raw.n),
    };
    if (fluid) io.fluid = true;
    // The compact form stores chance as a fraction; a 1 means guaranteed, which we leave implicit.
    if (raw.c != null && Number(raw.c) < 1) io.chance = Number((Number(raw.c) * 100).toFixed(2));
    out.push(io);
  }
  return out;
}

/* ------------------------------ raw recipe JSON ------------------------------ */

function parseRecipeJson(json: Record<string, unknown>, resolver: TagResolver): ParseOutcome {
  // A recipe that outputs EU is a generator fuel.
  if (contentList(json['tickOutputs'], 'eu').length) return GENERATOR;

  const inputs: RecipeIO[] = [];
  const outputs: RecipeIO[] = [];

  for (const entry of contentList(json['inputs'], 'item')) {
    if (chanceOf(entry) === 0) continue; // a zero chance on an input means it is not consumed
    const parsed = parseItemContent(entry['content']);
    if (parsed && parsed.count > 0) {
      inputs.push({ item: resolver.item(parsed.key), amount: parsed.count });
    }
  }
  for (const entry of contentList(json['inputs'], 'fluid')) {
    if (chanceOf(entry) === 0) continue;
    const parsed = parseFluidContent(entry['content']);
    if (parsed && parsed.amount > 0) {
      inputs.push({ item: resolver.fluid(parsed.key), amount: parsed.amount, fluid: true });
    }
  }

  for (const entry of contentList(json['outputs'], 'item')) {
    const parsed = parseItemContent(entry['content']);
    if (!parsed || !(parsed.count > 0)) continue;
    outputs.push(withChance({ item: resolver.item(parsed.key), amount: parsed.count }, entry));
  }
  for (const entry of contentList(json['outputs'], 'fluid')) {
    const parsed = parseFluidContent(entry['content']);
    if (!parsed || !(parsed.amount > 0)) continue;
    outputs.push(
      withChance({ item: resolver.fluid(parsed.key), amount: parsed.amount, fluid: true }, entry),
    );
  }

  const duration = Math.max(1, Number(json['duration']) || 1);

  // Rare, but some recipes consume a fluid every tick rather than once per craft.
  for (const entry of contentList(json['tickInputs'], 'fluid')) {
    const parsed = parseFluidContent(entry['content']);
    if (parsed && parsed.amount > 0) {
      inputs.push({
        item: resolver.fluid(parsed.key),
        amount: parsed.amount * duration,
        fluid: true,
      });
    }
  }

  const data = json['data'] as Record<string, unknown> | undefined;
  return {
    duration,
    eut: parseEut(json['tickInputs']),
    inputs,
    outputs,
    temp: Number(data?.['ebf_temp'] ?? data?.['temperature']) || 0,
    cond: cleanroomFromConditions(json['recipeConditions']),
    recycling: /recycling/.test(String(json['category'] ?? '')),
    kind: 'gt',
  };
}

function withChance(io: RecipeIO, entry: Record<string, unknown>): RecipeIO {
  const chance = chanceOf(entry);
  if (chance < 1) io.chance = Number((chance * 100).toFixed(2));
  return io;
}

/* ------------------------------ assembly ------------------------------ */

function assemble(body: RecipeBody, id: string, type: string): Recipe {
  const machine = machineFromType(type);
  const product = body.outputs[0]!;

  const recipe: Recipe = {
    id,
    name: itemName(product.item) || machine,
    machine,
    type,
    // GregTech recipes always take at least a tick; other mods' recipes may be genuinely instant.
    duration: body.kind === 'gt' ? Math.max(1, body.duration) : body.duration,
    eut: body.eut,
    inputs: body.inputs,
    outputs: body.outputs,
    src: 'game',
  };
  if (body.temp) recipe.temp = body.temp;
  if (body.cond) recipe.cond = body.cond;
  if (body.recycling) recipe.recycling = true;
  if (body.kind === 'generic') recipe.mod = type.split(':')[0];
  return recipe;
}

/** Recipe ids should be unique, but duplicates do happen; disambiguate rather than drop. */
function uniqueId(id: string | null, type: string, index: number, used: Set<string>): string {
  let candidate = `g:${id ?? `${type}:${index}`}`;
  if (used.has(candidate)) candidate += `#${index}`;
  used.add(candidate);
  return candidate;
}

function cleanroomLabel(value: unknown): Recipe['cond'] | null {
  if (!value) return null;
  return /sterile/i.test(String(value)) ? 'Sterile cleanroom' : 'Cleanroom';
}

function cleanroomFromConditions(conditions: unknown): Recipe['cond'] | null {
  if (!Array.isArray(conditions)) return null;
  const cleanroom = conditions.find(
    (c) => c && /cleanroom/.test(String((c as Record<string, unknown>)['type'] ?? '')),
  ) as Record<string, unknown> | undefined;
  if (!cleanroom) return null;
  return /sterile/.test(String(cleanroom['cleanroom'] ?? '')) ? 'Sterile cleanroom' : 'Cleanroom';
}

/** The exporter writes its own first few problems either as a list or an id-keyed object. */
function exportErrors(errors: unknown): string[] {
  if (Array.isArray(errors)) return errors.slice(0, MAX_EXPORT_ERRORS).map(String);
  if (errors && typeof errors === 'object') {
    return Object.values(errors)
      .map(String)
      .slice(0, MAX_EXPORT_ERRORS + 1);
  }
  return [];
}
