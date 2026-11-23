/**
 * GregTech CEu overclocking.
 *
 * A machine run above the recipe's voltage trades power for speed: each overclock costs 4x the
 * EU/t and divides the duration by 2 (or by 4 when the overclock is "perfect", which keeps the
 * energy per craft the same). Coil multiblocks like the Electric Blast Furnace add heat bonuses
 * on top. Durations bottom out at one tick, past which a higher tier buys nothing.
 */
import { DEFAULT_COIL_TEMP } from '../data/coils';
import { tier, tierForEut } from '../data/tiers';
import { formatNumber } from '../core/format';
import { TICKS_PER_SECOND } from '../core/units';
import type { OverclockMode, Recipe } from '../core/types';

export interface OverclockOptions {
  tier: number;
  ocMode: OverclockMode;
  parallel?: number;
  /** Apply Electric Blast Furnace style heat bonuses. */
  useCoil?: boolean;
  coilTemp?: number;
}

/** Per-machine results of running one recipe at one tier. */
export interface OverclockResult {
  /** Lowest tier that can run the recipe at all. */
  recipeTier: number;
  tier: number;
  /** EU/t drawn by one machine, parallels included. */
  eut: number;
  /** Duration in ticks after overclocking, never below 1. */
  dur: number;
  parallel: number;
  ocs: number;
  perfectOcs: number;
  /** Coil temperature actually reached, or null when heat does not apply. */
  effTemp: number | null;
  /** Crafts per second for one machine. */
  craftsPerSec: number;
  euPerCraft: number;
  /** Things worth telling the user: coil discounts, parallel caps, hitting the tick floor. */
  notes: string[];
  /** Reasons this configuration cannot run: too low a tier, coils too cold. */
  errors: string[];
}

/** 5% off the EU cost for every 900K of surplus heat. */
const EU_DISCOUNT_PER_STEP = 0.95;
const HEAT_PER_DISCOUNT = 900;
/** Every 1800K of surplus heat upgrades one overclock to perfect. */
const HEAT_PER_PERFECT_OC = 1800;
/** Coils gain 100K per tier above MV. */
const HEAT_PER_TIER_ABOVE_MV = 100;
const MV = 2;

export function overclock(recipe: Recipe, opts: OverclockOptions): OverclockResult {
  const baseEut = Math.max(0, Number(recipe.eut) || 0);
  const baseDuration = Math.max(1, Number(recipe.duration) || 1);
  const recipeTier = tierForEut(baseEut);
  const maxVoltage = tier(opts.tier).v;
  const notes: string[] = [];
  const errors: string[] = [];

  if (baseEut > maxVoltage) {
    errors.push(
      `Needs at least ${tier(recipeTier).name} (${formatNumber(baseEut)} EU/t), machine is ${tier(opts.tier).name}.`,
    );
  }

  let eut = baseEut;
  let duration = baseDuration;
  let perfectBudget = 0;
  let effTemp: number | null = null;

  if (opts.useCoil && recipe.temp) {
    effTemp =
      (opts.coilTemp ?? DEFAULT_COIL_TEMP) + HEAT_PER_TIER_ABOVE_MV * Math.max(0, opts.tier - MV);
    if (effTemp < recipe.temp) {
      errors.push(
        `Coils too cold: ${formatNumber(effTemp)}K < ${formatNumber(recipe.temp)}K required.`,
      );
    } else {
      const surplus = effTemp - recipe.temp;
      const discounts = Math.floor(surplus / HEAT_PER_DISCOUNT);
      if (discounts > 0) {
        eut *= Math.pow(EU_DISCOUNT_PER_STEP, discounts);
        const saved = Math.round((1 - Math.pow(EU_DISCOUNT_PER_STEP, discounts)) * 100);
        notes.push(`${discounts}× coil discount (−${saved}% EU)`);
      }
      perfectBudget = Math.floor(surplus / HEAT_PER_PERFECT_OC);
    }
  }

  // Parallels run at base speed, so the voltage has to cover all of them at once.
  let parallel = Math.max(1, Math.floor(opts.parallel ?? 1));
  if (parallel > 1 && eut > 0) {
    const affordable = Math.max(1, Math.floor(maxVoltage / eut));
    if (affordable < parallel) {
      notes.push(`Parallel capped at ${affordable} by ${tier(opts.tier).name} voltage`);
      parallel = affordable;
    }
  }
  eut *= parallel;

  let ocs = 0;
  let perfectOcs = 0;
  let hitTickFloor = false;
  if (opts.ocMode !== 'none' && eut > 0) {
    while (eut * 4 <= maxVoltage) {
      const perfect = opts.ocMode === 'perfect' || perfectOcs < perfectBudget;
      const divisor = perfect ? 4 : 2;
      if (duration / divisor < 1) {
        hitTickFloor = true;
        break;
      }
      eut *= 4;
      duration /= divisor;
      if (perfect) perfectOcs++;
      ocs++;
    }
  }
  duration = Math.max(1, Math.floor(duration) || 1);

  if (hitTickFloor) notes.push('Hit 1-tick minimum: higher tier gives no more speed');
  if (ocs) {
    notes.push(
      `${ocs} overclock${ocs > 1 ? 's' : ''}${perfectOcs ? ` (${perfectOcs} perfect)` : ''}`,
    );
  }

  return {
    recipeTier,
    tier: opts.tier,
    eut,
    dur: duration,
    parallel,
    ocs,
    perfectOcs,
    effTemp,
    craftsPerSec: (parallel * TICKS_PER_SECOND) / duration,
    euPerCraft: (eut * duration) / parallel,
    notes,
    errors,
  };
}
