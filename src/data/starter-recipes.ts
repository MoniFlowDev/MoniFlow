import type { Project, Recipe } from '../core/types';

/**
 * Example GregTech CEu-style recipes, so a fresh install has something to look at.
 * Numbers may differ in your Monifactory version — check them in EMI and edit them
 * in the Recipes tab. You are offered the chance to drop these when you import
 * your game's real recipes.
 */
export const STARTER_RECIPES: readonly Recipe[] = [
  {
    id: 'r_water_electrolysis',
    name: 'Water Electrolysis',
    machine: 'Electrolyzer',
    duration: 1500,
    eut: 30,
    inputs: [{ item: 'Water', amount: 1000, fluid: true }],
    outputs: [
      { item: 'Hydrogen', amount: 2000, fluid: true },
      { item: 'Oxygen', amount: 1000, fluid: true },
    ],
  },
  {
    id: 'r_so2',
    name: 'Sulfur Dioxide',
    machine: 'Chemical Reactor',
    duration: 60,
    eut: 8,
    inputs: [
      { item: 'Sulfur Dust', amount: 1 },
      { item: 'Oxygen', amount: 2000, fluid: true },
    ],
    outputs: [{ item: 'Sulfur Dioxide', amount: 1000, fluid: true }],
  },
  {
    id: 'r_so3',
    name: 'Sulfur Trioxide',
    machine: 'Chemical Reactor',
    duration: 200,
    eut: 7,
    inputs: [
      { item: 'Sulfur Dioxide', amount: 1000, fluid: true },
      { item: 'Oxygen', amount: 1000, fluid: true },
    ],
    outputs: [{ item: 'Sulfur Trioxide', amount: 1000, fluid: true }],
  },
  {
    id: 'r_sulfuric',
    name: 'Sulfuric Acid',
    machine: 'Chemical Reactor',
    duration: 320,
    eut: 8,
    inputs: [
      { item: 'Sulfur Trioxide', amount: 1000, fluid: true },
      { item: 'Water', amount: 1000, fluid: true },
    ],
    outputs: [{ item: 'Sulfuric Acid', amount: 1000, fluid: true }],
  },
  {
    id: 'r_ethylene',
    name: 'Ethylene (from Ethanol)',
    machine: 'Chemical Reactor',
    duration: 1200,
    eut: 120,
    inputs: [
      { item: 'Ethanol', amount: 1000, fluid: true },
      { item: 'Sulfuric Acid', amount: 1000, fluid: true },
    ],
    outputs: [
      { item: 'Ethylene', amount: 1000, fluid: true },
      { item: 'Diluted Sulfuric Acid', amount: 1000, fluid: true },
    ],
  },
  {
    id: 'r_dil_sulfuric',
    name: 'Re-concentrate Sulfuric Acid',
    machine: 'Distillery',
    duration: 600,
    eut: 120,
    inputs: [{ item: 'Diluted Sulfuric Acid', amount: 3000, fluid: true }],
    outputs: [
      { item: 'Sulfuric Acid', amount: 2000, fluid: true },
      { item: 'Water', amount: 1000, fluid: true },
    ],
  },
  {
    id: 'r_polyethylene',
    name: 'Polyethylene',
    machine: 'Large Chemical Reactor',
    duration: 160,
    eut: 30,
    inputs: [
      { item: 'Ethylene', amount: 144, fluid: true },
      { item: 'Oxygen', amount: 1000, fluid: true },
    ],
    outputs: [{ item: 'Polyethylene', amount: 216, fluid: true }],
  },
  {
    id: 'r_pe_sheet',
    name: 'Polyethylene Sheet',
    machine: 'Fluid Solidifier',
    duration: 20,
    eut: 7,
    inputs: [{ item: 'Polyethylene', amount: 144, fluid: true }],
    outputs: [{ item: 'Polyethylene Sheet', amount: 1 }],
  },
  {
    id: 'r_steel',
    name: 'Steel Ingot',
    machine: 'Electric Blast Furnace',
    duration: 500,
    eut: 120,
    temp: 1000,
    inputs: [
      { item: 'Iron Dust', amount: 1 },
      { item: 'Oxygen', amount: 200, fluid: true },
    ],
    outputs: [
      { item: 'Steel Ingot', amount: 1 },
      { item: 'Tiny Pile of Ash', amount: 1, chance: 100 },
    ],
  },
  {
    id: 'r_steel_plate',
    name: 'Steel Plate',
    machine: 'Bender',
    duration: 112,
    eut: 24,
    inputs: [{ item: 'Steel Ingot', amount: 1 }],
    outputs: [{ item: 'Steel Plate', amount: 1 }],
  },
  {
    id: 'r_steel_rod',
    name: 'Steel Rod',
    machine: 'Lathe',
    duration: 112,
    eut: 16,
    inputs: [{ item: 'Steel Ingot', amount: 1 }],
    outputs: [{ item: 'Steel Rod', amount: 2 }],
  },
  {
    id: 'r_copper_wire',
    name: '1x Copper Wire',
    machine: 'Wiremill',
    duration: 100,
    eut: 7,
    inputs: [{ item: 'Copper Ingot', amount: 1 }],
    outputs: [{ item: '1x Copper Wire', amount: 2 }],
  },
  {
    id: 'r_copper_cable',
    name: '1x Copper Cable',
    machine: 'Assembler',
    duration: 100,
    eut: 8,
    inputs: [
      { item: '1x Copper Wire', amount: 1 },
      { item: 'Rubber', amount: 144, fluid: true },
    ],
    outputs: [{ item: '1x Copper Cable', amount: 1 }],
  },
  {
    id: 'r_rubber',
    name: 'Rubber (vulcanize)',
    machine: 'Chemical Reactor',
    duration: 600,
    eut: 16,
    inputs: [
      { item: 'Raw Rubber Dust', amount: 3 },
      { item: 'Sulfur Dust', amount: 1 },
    ],
    outputs: [{ item: 'Rubber', amount: 1296, fluid: true }],
  },
  {
    id: 'r_raw_rubber',
    name: 'Raw Rubber Dust',
    machine: 'Extractor',
    duration: 300,
    eut: 2,
    inputs: [{ item: 'Sticky Resin', amount: 1 }],
    outputs: [{ item: 'Raw Rubber Dust', amount: 3 }],
  },
  {
    id: 'r_iron_dust',
    name: 'Iron Dust (macerate)',
    machine: 'Macerator',
    duration: 56,
    eut: 2,
    inputs: [{ item: 'Iron Ingot', amount: 1 }],
    outputs: [{ item: 'Iron Dust', amount: 1 }],
  },
  {
    id: 'r_motor_lv',
    name: 'LV Electric Motor',
    machine: 'Assembler',
    duration: 100,
    eut: 30,
    inputs: [
      { item: 'Steel Rod', amount: 2 },
      { item: '1x Copper Cable', amount: 2 },
      { item: '1x Copper Wire', amount: 4 },
      { item: 'Magnetic Iron Rod', amount: 1 },
    ],
    outputs: [{ item: 'LV Electric Motor', amount: 1 }],
  },
  {
    id: 'r_mag_iron_rod',
    name: 'Magnetic Iron Rod',
    machine: 'Polarizer',
    duration: 100,
    eut: 8,
    inputs: [{ item: 'Iron Rod', amount: 1 }],
    outputs: [{ item: 'Magnetic Iron Rod', amount: 1 }],
  },
  {
    id: 'r_iron_rod',
    name: 'Iron Rod',
    machine: 'Lathe',
    duration: 112,
    eut: 16,
    inputs: [{ item: 'Iron Ingot', amount: 1 }],
    outputs: [{ item: 'Iron Rod', amount: 2 }],
  },
];

/** The plan a fresh install opens on. */
export const STARTER_PROJECT: Pick<Project, 'name' | 'targets' | 'choices' | 'nodes'> = {
  name: 'Polyethylene line',
  targets: [{ item: 'Polyethylene Sheet', rate: 1 }],
  choices: {},
  nodes: {},
};
