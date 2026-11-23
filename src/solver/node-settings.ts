import { coilTemp } from '../data/coils';
import { defaultOverclockMode } from '../data/machines';
import { tierForEut } from '../data/tiers';
import { EPSILON } from '../core/units';
import type { NodeSettings, Project, Recipe } from '../core/types';
import { overclock } from './overclock';

/** Fill in a step's settings from your per-step overrides, falling back to the plan's defaults. */
export function nodeSettings(project: Project, recipe: Recipe): NodeSettings {
  const overrides = project.nodes[recipe.id] ?? {};
  const minTier = Math.max(1, tierForEut(recipe.eut || 0));
  return {
    tier: overrides.tier ?? Math.max(minTier, project.defaultTier ?? 1),
    ocMode: overrides.ocMode ?? defaultOverclockMode(recipe.machine),
    coil: overrides.coil ?? project.defaultCoil ?? 0,
    parallel: overrides.parallel ?? 1,
  };
}

export function hasManualTier(project: Project, recipeId: string): boolean {
  return project.nodes[recipeId]?.tier != null;
}

/**
 * Perfect overclocking makes each tier 4x faster for 4x the power, so the energy per item never
 * changes and a higher tier only ever saves machines. Pick the tier (capped at the plan's grid
 * tier) that needs the fewest machines; ties go to the lower tier, whose machines are cheaper and
 * draw fewer amps. The gain stops once the duration hits the one-tick floor.
 */
export function bestPerfectTier(
  recipe: Recipe,
  craftsPerSecond: number,
  settings: NodeSettings,
  project: Project,
): number {
  const minTier = Math.max(1, tierForEut(recipe.eut || 0));
  const cap = Math.max(minTier, project.gridTier ?? minTier);

  let bestTier = settings.tier;
  let fewest = Infinity;
  for (let t = minTier; t <= cap; t++) {
    const oc = overclock(recipe, {
      tier: t,
      ocMode: 'perfect',
      parallel: settings.parallel,
      useCoil: false,
      coilTemp: coilTemp(settings.coil),
    });
    const built = Math.ceil(craftsPerSecond / oc.craftsPerSec - EPSILON);
    if (built < fewest) {
      fewest = built;
      bestTier = t;
    }
  }
  return bestTier;
}
