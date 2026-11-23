/* MoniFlow — static game data (GregTech CEu Modern / Monifactory) */
'use strict';

const TICKS_PER_SECOND = 20;

// Voltage tiers. Colors follow the in-game tier text colors, tuned for a dark background.
const TIERS = [
  { name: 'ULV', v: 8,          color: '#8a8a8a' },
  { name: 'LV',  v: 32,         color: '#c8c8c8' },
  { name: 'MV',  v: 128,        color: '#55ffff' },
  { name: 'HV',  v: 512,        color: '#ffaa00' },
  { name: 'EV',  v: 2048,       color: '#c05cff' },
  { name: 'IV',  v: 8192,       color: '#6f7cff' },
  { name: 'LuV', v: 32768,      color: '#ff7cff' },
  { name: 'ZPM', v: 131072,     color: '#ff5f5f' },
  { name: 'UV',  v: 524288,     color: '#1fc8c8' },
  { name: 'UHV', v: 2097152,    color: '#d23a3a' },
  { name: 'UEV', v: 8388608,    color: '#5fff7a' },
  { name: 'UIV', v: 33554432,   color: '#2fb84a' },
  { name: 'UXV', v: 134217728,  color: '#ffff66' },
  { name: 'OpV', v: 536870912,  color: '#8f9bff' },
  { name: 'MAX', v: 2147483648, color: '#ff4f4f' },
];

// Heating coils for the Electric Blast Furnace (and other coil multiblocks).
const COILS = [
  { name: 'Cupronickel', temp: 1800 },
  { name: 'Kanthal',     temp: 2700 },
  { name: 'Nichrome',    temp: 3600 },
  { name: 'RTM Alloy',   temp: 4500 },
  { name: 'HSS-G',       temp: 5400 },
  { name: 'Naquadah',    temp: 7200 },
  { name: 'Trinium',     temp: 9001 },
  { name: 'Tritanium',   temp: 10800 },
];

// Known machines. `oc` = default overclock mode, `coil` = uses coil temperature bonuses.
// Anything not listed is treated as a normal machine with standard overclocking.
const MACHINES = [
  { name: 'Electric Blast Furnace', multi: true, coil: true, oc: 'standard' },
  { name: 'Alloy Blast Smelter',    multi: true, coil: true, oc: 'standard' },
  { name: 'Large Chemical Reactor', multi: true, oc: 'perfect' },
  { name: 'Distillation Tower',     multi: true, oc: 'standard' },
  { name: 'Vacuum Freezer',         multi: true, oc: 'standard' },
  { name: 'Implosion Compressor',   multi: true, oc: 'standard' },
  { name: 'Pyrolyse Oven',          multi: true, coil: false, oc: 'standard' },
  { name: 'Cracker',                multi: true, oc: 'standard' },
  { name: 'Assembly Line',          multi: true, oc: 'standard' },
  { name: 'Fusion Reactor',         multi: true, oc: 'standard' },
  { name: 'Chemical Reactor',       oc: 'standard' },
  { name: 'Electrolyzer',           oc: 'standard' },
  { name: 'Centrifuge',             oc: 'standard' },
  { name: 'Mixer',                  oc: 'standard' },
  { name: 'Assembler',              oc: 'standard' },
  { name: 'Circuit Assembler',      oc: 'standard' },
  { name: 'Wiremill',               oc: 'standard' },
  { name: 'Bender',                 oc: 'standard' },
  { name: 'Lathe',                  oc: 'standard' },
  { name: 'Cutter',                 oc: 'standard' },
  { name: 'Extruder',               oc: 'standard' },
  { name: 'Compressor',             oc: 'standard' },
  { name: 'Extractor',              oc: 'standard' },
  { name: 'Macerator',              oc: 'standard' },
  { name: 'Ore Washer',             oc: 'standard' },
  { name: 'Thermal Centrifuge',     oc: 'standard' },
  { name: 'Chemical Bath',          oc: 'standard' },
  { name: 'Fluid Solidifier',       oc: 'standard' },
  { name: 'Fluid Extractor',        oc: 'standard' },
  { name: 'Distillery',             oc: 'standard' },
  { name: 'Forming Press',          oc: 'standard' },
  { name: 'Polarizer',              oc: 'standard' },
  { name: 'Laser Engraver',         oc: 'standard' },
  { name: 'Autoclave',              oc: 'standard' },
  { name: 'Arc Furnace',            oc: 'standard' },
  { name: 'Electric Furnace',       oc: 'standard' },
  { name: 'Canning Machine',        oc: 'standard' },
  { name: 'Sifter',                 oc: 'standard' },
  { name: 'Packer',                 oc: 'standard' },
  { name: 'Forge Hammer',           oc: 'standard' },
  { name: 'Brewery',                oc: 'standard' },
  { name: 'Fermenter',              oc: 'standard' },
  { name: 'Microverse Projector',   multi: true, oc: 'none' },
];

// Generator presets for the power planner (EU/t per generator).
const GENERATOR_PRESETS = [
  ...TIERS.slice(1, 6).map(t => ({ name: `${t.name} single-block generator (1A)`, eut: t.v })),
  { name: 'Large Steam Turbine (base)',     eut: 1024 },
  { name: 'Large Combustion Engine',        eut: 2048 },
  { name: 'Large Gas Turbine (base)',       eut: 4096 },
  { name: 'Extreme Combustion Engine',      eut: 8192 },
  { name: 'Large Plasma Turbine (base)',    eut: 16384 },
  { name: 'Custom…',                        eut: 0 },
];

// Starter recipe library. These are example GregTech CEu-style recipes that show how
// chains work — values may differ in your Monifactory version, so check them in EMI
// and edit them in the Recipes tab.
const STARTER_RECIPES = [
  {
    id: 'r_water_electrolysis', name: 'Water Electrolysis', machine: 'Electrolyzer',
    duration: 1500, eut: 30,
    inputs:  [{ item: 'Water', amount: 1000, fluid: true }],
    outputs: [{ item: 'Hydrogen', amount: 2000, fluid: true }, { item: 'Oxygen', amount: 1000, fluid: true }],
  },
  {
    id: 'r_so2', name: 'Sulfur Dioxide', machine: 'Chemical Reactor',
    duration: 60, eut: 8,
    inputs:  [{ item: 'Sulfur Dust', amount: 1 }, { item: 'Oxygen', amount: 2000, fluid: true }],
    outputs: [{ item: 'Sulfur Dioxide', amount: 1000, fluid: true }],
  },
  {
    id: 'r_so3', name: 'Sulfur Trioxide', machine: 'Chemical Reactor',
    duration: 200, eut: 7,
    inputs:  [{ item: 'Sulfur Dioxide', amount: 1000, fluid: true }, { item: 'Oxygen', amount: 1000, fluid: true }],
    outputs: [{ item: 'Sulfur Trioxide', amount: 1000, fluid: true }],
  },
  {
    id: 'r_sulfuric', name: 'Sulfuric Acid', machine: 'Chemical Reactor',
    duration: 320, eut: 8,
    inputs:  [{ item: 'Sulfur Trioxide', amount: 1000, fluid: true }, { item: 'Water', amount: 1000, fluid: true }],
    outputs: [{ item: 'Sulfuric Acid', amount: 1000, fluid: true }],
  },
  {
    id: 'r_ethylene', name: 'Ethylene (from Ethanol)', machine: 'Chemical Reactor',
    duration: 1200, eut: 120,
    inputs:  [{ item: 'Ethanol', amount: 1000, fluid: true }, { item: 'Sulfuric Acid', amount: 1000, fluid: true }],
    outputs: [{ item: 'Ethylene', amount: 1000, fluid: true }, { item: 'Diluted Sulfuric Acid', amount: 1000, fluid: true }],
  },
  {
    id: 'r_dil_sulfuric', name: 'Re-concentrate Sulfuric Acid', machine: 'Distillery',
    duration: 600, eut: 120,
    inputs:  [{ item: 'Diluted Sulfuric Acid', amount: 3000, fluid: true }],
    outputs: [{ item: 'Sulfuric Acid', amount: 2000, fluid: true }, { item: 'Water', amount: 1000, fluid: true }],
  },
  {
    id: 'r_polyethylene', name: 'Polyethylene', machine: 'Large Chemical Reactor',
    duration: 160, eut: 30,
    inputs:  [{ item: 'Ethylene', amount: 144, fluid: true }, { item: 'Oxygen', amount: 1000, fluid: true }],
    outputs: [{ item: 'Polyethylene', amount: 216, fluid: true }],
  },
  {
    id: 'r_pe_sheet', name: 'Polyethylene Sheet', machine: 'Fluid Solidifier',
    duration: 20, eut: 7,
    inputs:  [{ item: 'Polyethylene', amount: 144, fluid: true }],
    outputs: [{ item: 'Polyethylene Sheet', amount: 1 }],
  },
  {
    id: 'r_steel', name: 'Steel Ingot', machine: 'Electric Blast Furnace',
    duration: 500, eut: 120, temp: 1000,
    inputs:  [{ item: 'Iron Dust', amount: 1 }, { item: 'Oxygen', amount: 200, fluid: true }],
    outputs: [{ item: 'Steel Ingot', amount: 1 }, { item: 'Tiny Pile of Ash', amount: 1, chance: 100 }],
  },
  {
    id: 'r_steel_plate', name: 'Steel Plate', machine: 'Bender',
    duration: 112, eut: 24,
    inputs:  [{ item: 'Steel Ingot', amount: 1 }],
    outputs: [{ item: 'Steel Plate', amount: 1 }],
  },
  {
    id: 'r_steel_rod', name: 'Steel Rod', machine: 'Lathe',
    duration: 112, eut: 16,
    inputs:  [{ item: 'Steel Ingot', amount: 1 }],
    outputs: [{ item: 'Steel Rod', amount: 2 }],
  },
  {
    id: 'r_copper_wire', name: '1x Copper Wire', machine: 'Wiremill',
    duration: 100, eut: 7,
    inputs:  [{ item: 'Copper Ingot', amount: 1 }],
    outputs: [{ item: '1x Copper Wire', amount: 2 }],
  },
  {
    id: 'r_copper_cable', name: '1x Copper Cable', machine: 'Assembler',
    duration: 100, eut: 8,
    inputs:  [{ item: '1x Copper Wire', amount: 1 }, { item: 'Rubber', amount: 144, fluid: true }],
    outputs: [{ item: '1x Copper Cable', amount: 1 }],
  },
  {
    id: 'r_rubber', name: 'Rubber (vulcanize)', machine: 'Chemical Reactor',
    duration: 600, eut: 16,
    inputs:  [{ item: 'Raw Rubber Dust', amount: 3 }, { item: 'Sulfur Dust', amount: 1 }],
    outputs: [{ item: 'Rubber', amount: 1296, fluid: true }],
  },
  {
    id: 'r_raw_rubber', name: 'Raw Rubber Dust', machine: 'Extractor',
    duration: 300, eut: 2,
    inputs:  [{ item: 'Sticky Resin', amount: 1 }],
    outputs: [{ item: 'Raw Rubber Dust', amount: 3 }],
  },
  {
    id: 'r_iron_dust', name: 'Iron Dust (macerate)', machine: 'Macerator',
    duration: 56, eut: 2,
    inputs:  [{ item: 'Iron Ingot', amount: 1 }],
    outputs: [{ item: 'Iron Dust', amount: 1 }],
  },
  {
    id: 'r_motor_lv', name: 'LV Electric Motor', machine: 'Assembler',
    duration: 100, eut: 30,
    inputs:  [
      { item: 'Steel Rod', amount: 2 }, { item: '1x Copper Cable', amount: 2 },
      { item: '1x Copper Wire', amount: 4 }, { item: 'Magnetic Iron Rod', amount: 1 },
    ],
    outputs: [{ item: 'LV Electric Motor', amount: 1 }],
  },
  {
    id: 'r_mag_iron_rod', name: 'Magnetic Iron Rod', machine: 'Polarizer',
    duration: 100, eut: 8,
    inputs:  [{ item: 'Iron Rod', amount: 1 }],
    outputs: [{ item: 'Magnetic Iron Rod', amount: 1 }],
  },
  {
    id: 'r_iron_rod', name: 'Iron Rod', machine: 'Lathe',
    duration: 112, eut: 16,
    inputs:  [{ item: 'Iron Ingot', amount: 1 }],
    outputs: [{ item: 'Iron Rod', amount: 2 }],
  },
];

const STARTER_PROJECT = {
  name: 'Polyethylene line',
  targets: [{ item: 'Polyethylene Sheet', rate: 1 }],
  choices: {},
  nodes: {},
};
