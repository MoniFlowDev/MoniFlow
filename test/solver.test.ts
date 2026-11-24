import { describe, expect, it } from 'vitest';

import { buildRecipeIndex } from '../src/solver/recipe-index';
import { solve } from '../src/solver/solve';
import { mergeNames, stepTitle, stepTitleOptions } from '../src/solver/step-title';
import { plan, recipe, sampleGame } from './fixture';

describe('solving a chain', () => {
  const index = buildRecipeIndex(sampleGame().recipes);

  const steelPlate = plan({
    targets: [{ item: 'gtceu:steel_plate', rate: 1 }],
    defaultTier: 2,
    choices: {
      'gtceu:steel_plate': 'g:gtceu:bender/bend_steel_ingot_to_plate',
      'gtceu:steel_ingot': 'g:gtceu:electric_blast_furnace/steel_from_iron_dust',
      'gtceu:iron_dust': 'g:gtceu:macerator/macerate_iron_ingot',
    },
  });

  it('works back from the target to the raw materials', () => {
    const solution = solve(steelPlate, index);
    expect(solution.warnings).toEqual([]);

    const raw = Object.fromEntries(solution.raw.map((r) => [r.item, r.rate]));
    expect(raw['minecraft:iron_ingot']).toBeCloseTo(1, 9);
    expect(raw['gtceu:oxygen']).toBeCloseTo(200, 9);
  });

  it('counts machines at the chosen tier', () => {
    const solution = solve(steelPlate, index);
    const ebf = solution.steps.find((s) => s.id.includes('electric_blast_furnace'))!;

    // MV cupronickel reaches 1800K against a 1000K requirement: 800K over, so no discount,
    // and MV cannot overclock a 120 EU/t recipe.
    expect(ebf.oc.eut).toBe(120);
    // 500 ticks per ingot, one ingot per craft: 25 machines for one per second.
    expect(ebf.machines).toBeCloseTo(25, 9);
  });

  it('never auto-expands a game recipe, since the game has loops and duplicates per item', () => {
    const solution = solve(plan({ targets: [{ item: 'gtceu:steel_plate', rate: 1 }] }), index);
    expect(solution.steps).toHaveLength(0);
    expect(solution.raw[0]!.expandable).toBe(true);
  });
});

describe('perfect overclocking picks its own tier', () => {
  // Energy per craft never changes under perfect overclocking, so a higher tier only saves machines.
  const index = buildRecipeIndex([
    recipe('lcr', {
      name: 'PE',
      machine: 'Large Chemical Reactor',
      eut: 30,
      duration: 160,
      inputs: [['a', 1]],
      outputs: [['pe', 1]],
    }),
  ]);
  const lcrPlan = (overrides = {}) =>
    plan({ targets: [{ item: 'pe', rate: 1 }], choices: { pe: 'lcr' }, ...overrides });

  it('takes the lowest tier that needs the fewest machines', () => {
    const step = solve(lcrPlan({ gridTier: 4 }), index).steps[0]!;
    // HV already gets it down to one machine, and EV cannot do better, so HV wins.
    expect(step.settings.tier).toBe(3);
    expect(step.built).toBe(1);
    expect(step.settings.autoTier).toBe(true);
  });

  it('never exceeds the grid tier', () => {
    const step = solve(lcrPlan({ gridTier: 2 }), index).steps[0]!;
    expect(step.settings.tier).toBe(2);
    expect(step.built).toBe(2);
  });

  it('leaves a tier you set yourself alone', () => {
    const step = solve(lcrPlan({ gridTier: 4, nodes: { lcr: { tier: 1 } } }), index).steps[0]!;
    expect(step.settings.tier).toBe(1);
    expect(step.built).toBe(8);
  });

  it('falls back to the default tier when switched off', () => {
    const step = solve(lcrPlan({ gridTier: 4, autoPerfectTier: false }), index).steps[0]!;
    expect(step.settings.tier).toBe(1);
  });
});

describe('naming a step after what the plan takes from it', () => {
  const index = buildRecipeIndex([
    recipe('el', {
      name: 'Water electrolysis',
      machine: 'Electrolyzer',
      src: 'game',
      eut: 30,
      duration: 100,
      inputs: [['minecraft:water', 1000, true]],
      outputs: [
        ['gtceu:hydrogen', 2000, true],
        ['gtceu:oxygen', 1000, true],
      ],
    }),
  ]);
  const electrolysis = (targets: { item: string; rate: number }[]) =>
    solve(plan({ targets, choices: { 'gtceu:hydrogen': 'el', 'gtceu:oxygen': 'el' } }), index)
      .steps[0]!;

  it('treats an output nothing wants as a byproduct', () => {
    const step = electrolysis([{ item: 'gtceu:hydrogen', rate: 100 }]);
    expect(step.usedOutputs).toEqual(['gtceu:hydrogen']);
    expect(step.spareOutputs).toEqual(['gtceu:oxygen']);
    expect(stepTitle(step, true)).toBe('Hydrogen');
  });

  it('names both outputs once both are wanted', () => {
    const step = electrolysis([
      { item: 'gtceu:hydrogen', rate: 100 },
      { item: 'gtceu:oxygen', rate: 10 },
    ]);
    expect(step.spareOutputs).toEqual([]);
    expect(stepTitle(step, true)).toBe('Hydrogen + Oxygen');
    expect(stepTitleOptions(step, true)).toEqual(['Hydrogen + Oxygen', 'Hydrogen + 1 more']);
  });
});

describe('mergeNames', () => {
  it('folds a shared prefix and suffix together', () => {
    expect(mergeNames('Sulfuric Heavy Fuel', 'Sulfuric Light Fuel')).toBe(
      'Sulfuric Heavy + Light Fuel',
    );
  });

  it('gives up when the names share nothing', () => {
    expect(mergeNames('Hydrogen', 'Oxygen')).toBeNull();
  });
});
