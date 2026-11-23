/**
 * The shape of what the in-game exporter writes.
 *
 * `kubejs/zzz_moniflow_export.js` dumps whatever the game's recipe objects happen to contain, so
 * the recipe entries themselves are deliberately typed as `unknown` — every field is probed and
 * validated while parsing rather than trusted here. The surrounding tables (names, tags, icon
 * data) have a stable shape and are typed properly.
 */

/** A recipe entry: a compact `{ gt | generic }` object, a raw JSON object, or a JSON string. */
export type DumpRecipeEntry = unknown;

export interface GameDump {
  recipes?: DumpRecipeEntry[];
  /** Tag path -> member ids, either as a list or `"id1|id2"`. */
  tags?: Record<string, string | string[]>;
  /** Item id -> display name (may contain Minecraft `§` colour codes). */
  items?: Record<string, string>;
  /** Fluid id -> display name. */
  fluids?: Record<string, string>;
  /**
   * Item id -> what happens to it as a crafting ingredient:
   * `d:<uses>` a tool with that durability, `k` kept entirely, `r:<id>` handed back as `<id>`.
   */
  itemInfo?: Record<string, string>;
  /** Item id -> icon recipe for the atlas builder, e.g. `tool|gtceu:wrench`. */
  gtIcons?: Record<string, string>;
  gtMaterials?: Record<string, unknown>;
  iconSets?: Record<string, unknown>;
  exported?: string | null;
  gtceu?: string | null;
  /** First few exporter problems, as a list or an id-keyed object. */
  errors?: unknown;
}

/** Icon source data handed to the atlas builder. */
export interface IconData {
  gtIcons: Record<string, string>;
  gtMaterials: Record<string, unknown>;
  iconSets: Record<string, unknown>;
}

export interface ImportStats {
  total: number;
  parsed: number;
  skipped: number;
  /** Generator fuels, which produce EU rather than consuming it, and so are not recipes. */
  generators: number;
  errors: number;
  gregtech: number;
  /** Recipes from other mods, read through Minecraft's generic recipe API. */
  other: number;
  /** Tags the exporter did not resolve that we guessed an item for. */
  tagGuesses: number;
  tagUnresolved: number;
  /** Tool ingredients swapped for a basic equivalent. */
  toolsNormalized: number;
  /** Machine name -> recipe count. */
  types: Record<string, number>;
}

export interface ImportMeta {
  exported: string | null;
  gtceu: string | null;
  exportErrors: string[];
}
