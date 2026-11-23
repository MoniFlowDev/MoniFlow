import { coilTemp } from '../data/coils';
import { TIERS, tierForEut } from '../data/tiers';
import { EPSILON } from '../core/units';
import { overclock, type OverclockResult } from './overclock';
import type { SolvedStep } from './solve';

export interface TierOption {
  tier: number;
  oc: OverclockResult;
  machines: number;
  built: number;
  avgEut: number;
}

/**
 * What every tier would cost this step, for the comparison table in the drawer. Stops once the
 * duration has been at the one-tick floor for a tier, since nothing changes above that.
 */
export function tierComparison(step: SolvedStep): TierOption[] {
  if (step.instant) return [];

  const { recipe, settings } = step;
  const start = Math.max(1, tierForEut(recipe.eut));
  const options: TierOption[] = [];

  for (let t = start; t < TIERS.length; t++) {
    const oc = overclock(recipe, {
      tier: t,
      ocMode: settings.ocMode,
      parallel: settings.parallel,
      useCoil: step.useCoil,
      coilTemp: coilTemp(settings.coil),
    });
    const machines = step.rate / oc.craftsPerSec;
    options.push({ tier: t, oc, machines, built: Math.ceil(machines - EPSILON), avgEut: machines * oc.eut });
    if (oc.dur <= 1 && t > start + 1) break;
  }
  return options;
}
