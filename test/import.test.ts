import { describe, expect, it } from 'vitest';

import { itemName, prettifyId } from '../src/core/item-names';
import { stripFormatting, toHtml } from '../src/core/mc-text';
import { normalizeTools } from '../src/import/leftovers';
import { machineFromType } from '../src/import/machine-names';
import type { Recipe } from '../src/core/types';
import { recipesById, sampleGame } from './fixture';

const game = sampleGame();
const byId = recipesById(game);

describe('parsing an export', () => {
  it('counts what it parsed, skipped and could not read', () => {
    // 13 usable entries, plus one generator fuel and one deliberately broken string.
    expect(game.stats.parsed).toBe(13);
    expect(game.stats.other).toBe(5);
    expect(game.stats.generators).toBe(1);
    expect(game.stats.errors).toBe(1);
  });

  it('reads a GregTech blast furnace recipe whole', () => {
    const ebf = byId['g:gtceu:electric_blast_furnace/steel_from_iron_dust']!;
    expect(ebf.machine).toBe('Electric Blast Furnace');
    expect(ebf.name).toBe('Steel Ingot');
    expect(ebf.eut).toBe(120);
    expect(ebf.temp).toBe(1000);
    // The item tag and the fluid tag both resolved to concrete ids.
    expect(ebf.inputs).toEqual([
      { item: 'gtceu:iron_dust', amount: 1 },
      { item: 'gtceu:oxygen', amount: 200, fluid: true },
    ]);
    expect(ebf.outputs[1]!.chance).toBe(10);
  });

  it('accepts EU written as a plain number, as older GTCEu does', () => {
    expect(byId['g:gtceu:macerator/macerate_iron_ingot']!.eut).toBe(2);
  });

  it('leaves out a programmed circuit, which configures rather than feeds the machine', () => {
    expect(byId['g:gtceu:bender/bend_steel_ingot_to_plate']!.inputs).toHaveLength(1);
  });

  it('keeps the cleanroom requirement', () => {
    expect(byId['g:gtceu:circuit_assembler/cleanroom_example']!.cond).toBe('Cleanroom');
  });

  it('reads the exporter compact form', () => {
    const mixer = byId['g:gtceu:mixer/manual_fallback_example']!;
    expect(mixer.eut).toBe(30);
    expect(mixer.outputs[1]!.chance).toBe(25);
    expect(mixer.inputs[1]!.fluid).toBe(true);
  });

  it('reads vanilla and other mods through the generic recipe API', () => {
    const block = byId['g:minecraft:iron_block']!;
    expect(block.machine).toBe('Crafting Table');
    expect(block.duration).toBe(0);
    expect(block.inputs[0]!.amount).toBe(9);

    expect(byId['g:minecraft:iron_ingot_from_smelting']!.machine).toBe('Furnace');

    const create = byId['g:create:mixing/example']!;
    expect(create.machine).toBe('Mixing (Create)');
    expect(create.outputs[0]!.chance).toBe(50);
  });
});

describe('ingredients that come back', () => {
  it('charges a tool one use per craft', () => {
    const mortar = byId['g:gtceu:shaped/mortar_steel_dust']!;
    const tool = mortar.inputs.find((i) => i.item === 'gtceu:iron_mortar')!;
    expect(tool.uses).toBe(256);
    expect(tool.amount).toBeCloseTo(1 / 256, 12);
  });

  it('hands back an emptied container as an output', () => {
    const clay = byId['g:minecraft:clay_from_bucket']!;
    expect(clay.outputs).toContainEqual({
      item: 'minecraft:bucket',
      amount: 1,
      returned: true,
    });
  });
});

describe('normalizeTools', () => {
  const toolContext = {
    gtIcons: {
      'gtceu:mv_neutronium_wrench': 'tool|gtceu:item/tools/mv_wrench|fff|000',
      'gtceu:iron_wrench': 'tool|gtceu:item/tools/wrench|eee|999',
    },
    itemInfo: { 'gtceu:iron_wrench': 'd:128' },
    names: {},
  };

  function wrenchRecipe(): Recipe {
    return {
      id: 't',
      name: 't',
      machine: 'Crafting Table',
      mod: 'gtceu',
      eut: 0,
      duration: 0,
      inputs: [
        { item: 'gtceu:mv_neutronium_wrench', amount: 1 },
        { item: 'gtceu:steel_plate', amount: 2 },
      ],
      outputs: [{ item: 'x', amount: 1 }],
    };
  }

  it('swaps an arbitrary "any wrench" pick for a basic one and charges one use', () => {
    const recipes = [wrenchRecipe()];
    normalizeTools(recipes, toolContext);

    const wrench = recipes[0]!.inputs[0]!;
    expect(wrench.item).toBe('gtceu:iron_wrench');
    expect(wrench.uses).toBe(128);
    expect(wrench.amount).toBeCloseTo(1 / 128, 12);
    expect(recipes[0]!.inputs[1]!.amount).toBe(2);
  });

  it('is idempotent, so a re-import does not compound the cost', () => {
    const recipes = [wrenchRecipe()];
    normalizeTools(recipes, toolContext);
    normalizeTools(recipes, { gtIcons: {}, itemInfo: {}, names: {} });

    expect(recipes[0]!.inputs[0]!.amount).toBeCloseTo(1 / 128, 12);
  });
});

describe('item names', () => {
  it('uses the name the game reported', () => {
    expect(itemName('gtceu:copper_single_wire')).toBe('1x Copper Wire');
  });

  it('falls back to prettifying an unknown id', () => {
    expect(itemName('gtceu:some_unknown_thing')).toBe('Some Unknown Thing');
  });

  it('reads a tag path category-first', () => {
    expect(prettifyId('#forge:dusts/sulfur')).toBe('Sulfur Dust (any)');
    expect(prettifyId('#gtceu:circuits/zpm')).toBe('ZPM Circuit (any)');
  });
});

describe('Minecraft formatting codes', () => {
  it('renders a colour code as a span', () => {
    expect(toHtml('§5Advanced Alloy Smelter III§r')).toBe(
      '<span style="color:#c040c0">Advanced Alloy Smelter III</span>',
    );
  });

  it('strips codes for plain text', () => {
    expect(stripFormatting('§aOverworldian§f Matter')).toBe('Overworldian Matter');
  });

  it('escapes the text it wraps', () => {
    expect(toHtml('<x>§lB')).toBe('&lt;x&gt;<span style="font-weight:700">B</span>');
  });
});

describe('machine names', () => {
  it('maps every flavour of crafting recipe onto the crafting table', () => {
    expect(machineFromType('minecraft:crafting_shaped')).toBe('Crafting Table');
    expect(machineFromType('gtceu:crafting_shaped_strict')).toBe('Crafting Table');
  });
});
