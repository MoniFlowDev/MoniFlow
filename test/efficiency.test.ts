import { describe, expect, it } from 'vitest';

import { Efficiency } from '../src/efficiency/recipe-stats';
import { rankRecipes } from '../src/efficiency/ranking';
import { buildRecipeIndex } from '../src/solver/recipe-index';
import { recipe, sampleGame } from './fixture';

const index = buildRecipeIndex(sampleGame().recipes);
const steelRecipes = index.producers.get('gtceu:steel_ingot')!.map((p) => p.recipe);

describe('ranking ways to make steel', () => {
  const efficiency = new Efficiency(index, {}, { byproducts: 'none', defaultTier: 1 });
  const ranked = rankRecipes(steelRecipes, 'gtceu:steel_ingot', efficiency, 'best');

  it('puts the arc furnace first, ahead of the blast furnace', () => {
    // The EBF costs 60,000 EU plus macerating the iron and electrolysing 200 mB of oxygen.
    expect(ranked[0]!.recipe.id).toContain('arc_furnace');
  });

  it('charges a recipe for its own step and for its whole ingredient tree', () => {
    const ebf = ranked.find((r) => r.recipe.id.includes('electric_blast'))!.stats;
    expect(ebf.stepEu).toBeCloseTo(60_000, 6);
    expect(ebf.chainEu).toBeCloseTo(60_000 + 112 + 200 * 45, 6);
  });

  it('counts raw materials in their own units: one ingot plus 56 mB of oxygen', () => {
    expect(ranked[0]!.stats.raw).toBeCloseTo(1.056, 9);
  });

  it('sorts by tier when asked to', () => {
    const byTier = rankRecipes(steelRecipes, 'gtceu:steel_ingot', efficiency, 'tier');
    expect(byTier[0]!.stats.tier).toBeLessThanOrEqual(byTier[1]!.stats.tier);
  });
});

describe('sharing a recipe cost with its byproducts', () => {
  it('splits by quantity, so oxygen pays a third of electrolysis', () => {
    // Electrolysis makes two buckets of hydrogen and one of oxygen.
    const efficiency = new Efficiency(index, {}, { byproducts: 'split', defaultTier: 1 });
    expect(efficiency.unitCost('gtceu:oxygen').eu).toBeCloseTo(15, 9);
  });

  it('charges a chanced byproduct its share: the steel pays 1/1.1 with 10% ash', () => {
    const efficiency = new Efficiency(index, {}, { byproducts: 'split', defaultTier: 1 });
    const ebf = efficiency.stats(
      index.byId.get('g:gtceu:electric_blast_furnace/steel_from_iron_dust')!,
      'gtceu:steel_ingot',
    );
    expect(ebf.stepEu).toBeCloseTo(60_000 / 1.1, 6);
    expect(ebf.byproductShare).toBeCloseTo(1 - 1 / 1.1, 9);
  });

  it('charges full cost in plan mode when the plan uses no byproducts', () => {
    const efficiency = new Efficiency(index, {}, {
      byproducts: 'plan',
      planUses: new Set(),
      defaultTier: 1,
    });
    expect(efficiency.unitCost('gtceu:oxygen').eu).toBeCloseTo(45, 9);
  });
});

describe('materials only recycling can make', () => {
  // Liquid titanium is only produced by melting something down. It must inherit the ingot's cost,
  // and melting a composite part must not be allowed to conjure material out of nothing.
  const titanium = buildRecipeIndex([
    recipe('ebf', {
      machine: 'Electric Blast Furnace',
      eut: 100,
      duration: 1000,
      inputs: [['gtceu:ti_dust', 1]],
      outputs: [['gtceu:ti_ingot', 1]],
    }),
    recipe('melt_ingot', {
      machine: 'Extractor',
      eut: 10,
      duration: 10,
      inputs: [['gtceu:ti_ingot', 1]],
      outputs: [['gtceu:ti', 144, true]],
      recycling: true,
    }),
    recipe('melt_part', {
      machine: 'Extractor',
      eut: 10,
      duration: 10,
      inputs: [['gtceu:ti_part', 1]],
      outputs: [['gtceu:ti', 576, true]],
      recycling: true,
    }),
    recipe('part', {
      machine: 'Assembler',
      eut: 1,
      duration: 1,
      inputs: [['gtceu:ti_plate', 1]],
      outputs: [['gtceu:ti_part', 1]],
    }),
    recipe('bender', {
      machine: 'Bender',
      eut: 10,
      duration: 10,
      inputs: [['gtceu:ti_ingot', 1]],
      outputs: [['gtceu:ti_plate', 1]],
    }),
    recipe('solidifier', {
      machine: 'Fluid Solidifier',
      eut: 10,
      duration: 10,
      inputs: [['gtceu:ti', 144, true]],
      outputs: [['gtceu:ti_plate', 1]],
    }),
  ]);
  const efficiency = new Efficiency(titanium, {}, { byproducts: 'split', defaultTier: 1 });

  it('prices the liquid as the ingot plus the melting step', () => {
    const liquid = efficiency.unitCost('gtceu:ti');
    expect(liquid.eu * 144).toBeCloseTo(100_000 + 100, 6);
    expect(liquid.recipe?.id).toBe('melt_ingot');
  });

  it('prefers bending an ingot over solidifying liquid made from the same ingot', () => {
    const ranked = rankRecipes(
      titanium.producers.get('gtceu:ti_plate')!.map((p) => p.recipe),
      'gtceu:ti_plate',
      efficiency,
      'best',
      1,
    );
    expect(ranked[0]!.recipe.id).toBe('bender');
  });
});
