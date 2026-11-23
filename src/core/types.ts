/**
 * The vocabulary the whole app is written in.
 *
 * Two kinds of recipe share one shape: the handful you write yourself in Settings > Recipes,
 * and the thousands imported from a Monifactory install (`src: 'game'`). Everything
 * downstream — solver, efficiency ranking, graph — only ever sees `Recipe`.
 */

/** Stable identity for an item or fluid. Game recipes use ids (`gtceu:steel_ingot`); your own use display names. */
export type ItemKey = string;

/** One side of a recipe: an ingredient or a product. */
export interface RecipeIO {
  item: ItemKey;
  /** Items are counts; fluids are mB. For tools this is the fractional cost per craft (1 / `uses`). */
  amount: number;
  fluid?: boolean;
  /** Output chance in percent. Absent means a guaranteed 100%. */
  chance?: number;

  /* --- crafting-table ingredients that come back --- */
  /** Tool durability: the craft spends one use out of this many. */
  uses?: number;
  /** `uses` was guessed rather than read from the export. */
  usesEstimated?: boolean;
  /** Not consumed at all (`amount` is 0). */
  kept?: boolean;
  /** This output only exists because an ingredient was handed back (an emptied bucket). */
  returned?: boolean;
  /** Set once `normalizeTools` has swapped an exotic tool for a basic one; makes the pass idempotent. */
  toolNormalized?: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  machine: string;
  /** Ticks. Zero means instant (crafting table, stonecutter): no machine time and no power. */
  duration: number;
  /** Base EU/t before overclocking. Zero means an unpowered machine. */
  eut: number;
  inputs: RecipeIO[];
  outputs: RecipeIO[];

  /** Required Electric Blast Furnace heat in kelvin. */
  temp?: number;
  /** Cleanroom requirement, as a label to show. */
  cond?: 'Cleanroom' | 'Sterile cleanroom';
  /** GregTech marks some recipes as recycling; they are ranked last in the picker. */
  recycling?: boolean;

  /** Imported recipes are read-only. Absent for your own. */
  src?: 'game';
  /** Original recipe type id from the export, e.g. `gtceu:macerator`. */
  type?: string;
  /** Owning mod namespace, set for non-GregTech (generic) recipes. */
  mod?: string;
}

/** How much of something you want, per second. */
export interface Target {
  item: ItemKey;
  /** Per second, always — display units are applied only at render time. */
  rate: number;
}

export type OverclockMode = 'standard' | 'perfect' | 'none';

/** Per-step overrides. Stored under `Project.nodes` keyed by recipe id; every field is optional. */
export interface NodeOverrides {
  tier?: number;
  ocMode?: OverclockMode;
  coil?: number;
  parallel?: number;
}

/** The same settings after defaults have been filled in — what the solver actually uses. */
export interface NodeSettings {
  tier: number;
  ocMode: OverclockMode;
  coil: number;
  parallel: number;
  /** True when the solver chose `tier` itself (perfect overclocking) rather than you. */
  autoTier?: boolean;
}

export type GraphDirection = 'lr' | 'tb' | 'bt';

export interface Point {
  x: number;
  y: number;
}

/** A saved plan. */
export interface Project {
  id: string;
  name: string;
  targets: Target[];
  /** item -> recipe id that makes it, or `'raw'` to supply it yourself. */
  choices: Record<ItemKey, string>;
  /** recipe id -> per-step overrides. */
  nodes: Record<string, NodeOverrides>;

  defaultTier: number;
  defaultCoil: number;
  gridTier: number;
  autoExpand: boolean;
  /** Let perfect-overclock steps pick the tier needing the fewest machines. Default on. */
  autoPerfectTier?: boolean;
  gen: { preset: number; eut: number };

  graphDir?: GraphDirection;
  /** Nodes you dragged, remembered per flow direction. */
  graphPos?: Partial<Record<GraphDirection, Record<string, Point>>>;
}

export type RateUnit = 's' | 'min' | 'h';
export type FluidUnitMode = 'auto' | 'mb';
/** How a recipe's cost is shared with its byproducts when ranking recipes. */
export type ByproductMode = 'split' | 'plan' | 'none';

/** Everything persisted to localStorage. */
export interface AppState {
  library: Recipe[];
  projects: Project[];
  activeId: string;
  unit: RateUnit;
  fluidUnits?: FluidUnitMode;
  /** Show every line's rate on the graph instead of only on hover. */
  alwaysRates?: boolean;
  /** Draw raw inputs and unused byproducts as marks on the step instead of separate nodes. */
  graphStubs?: boolean;
  byproductMode?: ByproductMode;
  pickSort?: string;
}
