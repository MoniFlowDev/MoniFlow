/**
 * The flow solver.
 *
 * Everything is in units per second. Starting from the targets, we repeatedly look for items
 * the plan is short of and scale up whichever recipe makes them, until nothing is short. That
 * fixed point is what makes loops work: re-concentrating diluted sulfuric acid feeds back into
 * its own chain, and the iteration settles on the rates where supply meets demand.
 *
 * Once the rates are known, each recipe becomes one step with machine counts and power.
 */
import { coilTemp } from '../data/coils';
import { machineUsesCoil } from '../data/machines';
import { tier } from '../data/tiers';
import { itemName } from '../core/item-names';
import { expectedAmount, netOutput } from '../core/recipe';
import { EPSILON } from '../core/units';
import type { ItemKey, NodeSettings, Project, Recipe, Target } from '../core/types';
import { bestPerfectTier, hasManualTier, nodeSettings } from './node-settings';
import { overclock, type OverclockResult } from './overclock';
import { resolveChoice, type RecipeIndex } from './recipe-index';

/** One recipe running at a known rate, with everything that follows from that. */
export interface SolvedStep {
  id: string;
  recipe: Recipe;
  settings: NodeSettings;
  useCoil: boolean;
  /** No machine time at all (crafting table, stonecutter): crafts per second instead of machines. */
  instant: boolean;
  /** Crafts per second the plan needs from this recipe. */
  rate: number;
  oc: OverclockResult;
  /** Machines needed, as a fraction. */
  machines: number;
  /** Machines to actually build, i.e. `machines` rounded up. */
  built: number;
  /** How busy each built machine will be, 0..1. */
  utilization: number;
  avgEut: number;
  peakEut: number;
  /** Amps one machine draws on its own tier. */
  amps: number;
  /** Outputs another step or a target consumes. */
  usedOutputs: ItemKey[];
  /** Outputs nothing in the plan wants. */
  spareOutputs: ItemKey[];
}

export interface RawInput {
  item: ItemKey;
  rate: number;
  fluid: boolean;
  /** You marked this raw yourself to hide its chain, rather than it having no recipe. */
  manual: boolean;
  /** Something in the library could make it. */
  expandable: boolean;
  /** Marked raw but the plan no longer needs it. */
  unused?: boolean;
}

export interface Byproduct {
  item: ItemKey;
  rate: number;
  fluid: boolean;
}

export interface SolutionTotals {
  avgEut: number;
  peakEut: number;
  /** Machines to build across every step. */
  machines: number;
  maxTier: number;
  /**
   * How far every target could scale before the first group of built machines hits 100%.
   * 1 means no slack at all.
   */
  headroom: number;
}

export interface Solution {
  steps: SolvedStep[];
  raw: RawInput[];
  surplus: Byproduct[];
  targets: Target[];
  /** item -> net per second after all steps; negative is a shortfall, positive a byproduct. */
  balance: Map<ItemKey, number>;
  warnings: string[];
  totals: SolutionTotals;
  /** recipe id -> crafts per second. */
  rates: Map<string, number>;
  iterations: number;
}

/** Enough passes for deep chains with loops; hitting this means the plan does not converge. */
const MAX_ITERATIONS = 400;
/** Below this a rate is noise from the iteration rather than a real requirement. */
const RATE_FLOOR = 1e-7;

export function solve(project: Project, index: RecipeIndex): Solution {
  const targets = project.targets.filter((t) => t.item && t.rate > 0);
  const { rates, balance, warnings, iterations } = findRates(project, index, targets);

  const steps = buildSteps(project, index, rates);
  const { raw, surplus } = splitBalance(project, index, balance);

  markOutputRoles(steps, targets);
  for (const step of steps) {
    if (step.oc.errors.length) warnings.push(`${step.recipe.name}: ${step.oc.errors.join(' ')}`);
  }

  return { steps, raw, surplus, targets, balance, warnings, totals: total(steps), rates, iterations };
}

/**
 * Scale recipes up until nothing is short. Each pass recomputes the whole balance from scratch
 * rather than nudging it, which keeps loops from drifting.
 */
function findRates(
  project: Project,
  index: RecipeIndex,
  targets: Target[],
): { rates: Map<string, number>; balance: Map<ItemKey, number>; warnings: string[]; iterations: number } {
  const warnings: string[] = [];
  const rates = new Map<string, number>();
  const unproducible = new Set<string>();

  const chosen = new Map<ItemKey, Recipe | null>();
  const recipeFor = (item: ItemKey): Recipe | null => {
    if (!chosen.has(item)) chosen.set(item, resolveChoice(project, index, item));
    return chosen.get(item)!;
  };

  let balance = new Map<ItemKey, number>();
  let iterations = 0;
  let converged = false;

  for (; iterations < MAX_ITERATIONS; iterations++) {
    balance = balanceFor(index, targets, rates);

    let changed = false;
    for (const [item, net] of balance) {
      if (net >= -EPSILON * Math.max(1, Math.abs(net))) continue;
      const deficit = -net;
      if (deficit < EPSILON) continue;

      const recipe = recipeFor(item);
      if (!recipe) continue; // supplied raw

      const perCraft = netOutput(recipe, item);
      if (perCraft <= 0) {
        unproducible.add(`${recipe.name} cannot net-produce ${itemName(item)}`);
        continue;
      }
      rates.set(recipe.id, (rates.get(recipe.id) ?? 0) + deficit / perCraft);
      changed = true;
    }
    if (!changed) {
      converged = true;
      break;
    }
  }

  if (!converged) {
    warnings.push(
      'Flow did not converge — there is probably a loop that consumes more than it produces. Mark one of the looped items as a raw input.',
    );
  }
  warnings.push(...unproducible);

  return { rates, balance, warnings, iterations };
}

/** Net per second of every item: what the targets take out, plus what the running recipes net. */
function balanceFor(
  index: RecipeIndex,
  targets: Target[],
  rates: Map<string, number>,
): Map<ItemKey, number> {
  const balance = new Map<ItemKey, number>();
  const add = (item: ItemKey, delta: number): void => {
    balance.set(item, (balance.get(item) ?? 0) + delta);
  };

  for (const t of targets) add(t.item, -t.rate);

  for (const [id, rate] of rates) {
    const recipe = index.byId.get(id);
    if (!recipe) continue;
    for (const input of recipe.inputs) add(input.item, -(Number(input.amount) || 0) * rate);
    for (const out of recipe.outputs) add(out.item, expectedAmount(out) * rate);
  }
  return balance;
}

/** Whatever the chain could not supply becomes a raw input; whatever it over-supplies, a byproduct. */
function splitBalance(
  project: Project,
  index: RecipeIndex,
  balance: Map<ItemKey, number>,
): { raw: RawInput[]; surplus: Byproduct[] } {
  const raw: RawInput[] = [];
  const surplus: Byproduct[] = [];

  for (const [item, net] of balance) {
    if (net < -RATE_FLOOR) {
      raw.push({
        item,
        rate: -net,
        fluid: index.fluids.has(item),
        manual: project.choices[item] === 'raw' && index.producers.has(item),
        expandable: index.producers.has(item),
      });
    } else if (net > RATE_FLOOR) {
      surplus.push({ item, rate: net, fluid: index.fluids.has(item) });
    }
  }

  raw.sort((a, b) => b.rate - a.rate);
  surplus.sort((a, b) => b.rate - a.rate);
  return { raw, surplus };
}

function buildSteps(
  project: Project,
  index: RecipeIndex,
  rates: Map<string, number>,
): SolvedStep[] {
  const steps: SolvedStep[] = [];

  for (const [id, rate] of rates) {
    if (rate < 1e-12) continue;
    const recipe = index.byId.get(id);
    if (!recipe) continue;

    const settings = nodeSettings(project, recipe);

    // Perfect-overclock steps you have not pinned to a tier get the tier needing the fewest machines.
    const autoPerfect =
      !hasManualTier(project, id) &&
      settings.ocMode === 'perfect' &&
      project.autoPerfectTier !== false &&
      recipe.duration > 0 &&
      recipe.eut > 0;
    if (autoPerfect) {
      const picked = bestPerfectTier(recipe, rate, settings, project);
      if (picked !== settings.tier) {
        settings.tier = picked;
        settings.autoTier = true;
      }
    }

    steps.push(
      recipe.duration > 0
        ? poweredStep(id, recipe, settings, rate)
        : instantStep(id, recipe, settings, rate),
    );
  }

  steps.sort((a, b) => b.avgEut - a.avgEut);
  return steps;
}

function poweredStep(
  id: string,
  recipe: Recipe,
  settings: NodeSettings,
  rate: number,
): SolvedStep {
  const useCoil = machineUsesCoil(recipe.machine) && !!recipe.temp;
  const oc = overclock(recipe, {
    tier: settings.tier,
    ocMode: settings.ocMode,
    parallel: settings.parallel,
    useCoil,
    coilTemp: coilTemp(settings.coil),
  });
  const machines = rate / oc.craftsPerSec;
  const built = Math.ceil(machines - EPSILON);

  return {
    id,
    recipe,
    settings,
    useCoil,
    instant: false,
    rate,
    oc,
    machines,
    built,
    utilization: built ? machines / built : 0,
    avgEut: machines * oc.eut,
    peakEut: built * oc.eut,
    amps: oc.eut / tier(settings.tier).v,
    usedOutputs: [],
    spareOutputs: [],
  };
}

function instantStep(
  id: string,
  recipe: Recipe,
  settings: NodeSettings,
  rate: number,
): SolvedStep {
  return {
    id,
    recipe,
    settings,
    useCoil: false,
    instant: true,
    rate,
    oc: {
      recipeTier: 0,
      tier: settings.tier,
      eut: 0,
      dur: 0,
      parallel: 1,
      ocs: 0,
      perfectOcs: 0,
      effTemp: null,
      craftsPerSec: Infinity,
      euPerCraft: 0,
      notes: ['Instant recipe: crafting table, autocrafter or similar'],
      errors: [],
    },
    machines: 0,
    built: 0,
    utilization: 1,
    avgEut: 0,
    peakEut: 0,
    amps: 0,
    usedOutputs: [],
    spareOutputs: [],
  };
}

/**
 * Work out, per step, which of its outputs the plan uses (feeding another step or a target) and
 * which are spare. Steps are then named after what they are actually for.
 */
export function markOutputRoles(steps: SolvedStep[], targets: Target[]): void {
  const consumers = new Map<ItemKey, Set<SolvedStep>>();
  for (const step of steps) {
    for (const input of step.recipe.inputs) {
      if (!((Number(input.amount) || 0) > 0)) continue;
      let set = consumers.get(input.item);
      if (!set) consumers.set(input.item, (set = new Set()));
      set.add(step);
    }
  }

  const targetItems = new Set(targets.map((t) => t.item));
  for (const step of steps) {
    // A step consuming its own output does not count as a user of it.
    const isUsed = (item: ItemKey): boolean =>
      targetItems.has(item) || [...(consumers.get(item) ?? [])].some((s) => s !== step);

    const outputs = [...new Set(step.recipe.outputs.map((o) => o.item))];
    step.usedOutputs = outputs.filter(isUsed);
    step.spareOutputs = outputs.filter((item) => !isUsed(item));
  }
}

function total(steps: SolvedStep[]): SolutionTotals {
  const powered = steps.filter((s) => !s.instant);
  return {
    avgEut: steps.reduce((sum, s) => sum + s.avgEut, 0),
    peakEut: steps.reduce((sum, s) => sum + s.peakEut, 0),
    machines: steps.reduce((sum, s) => sum + s.built, 0),
    maxTier: steps.reduce((max, s) => Math.max(max, s.settings.tier), 0),
    headroom: powered.length ? Math.min(...powered.map((s) => s.built / s.machines)) : 1,
  };
}
