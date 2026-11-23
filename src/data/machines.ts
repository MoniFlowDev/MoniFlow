import type { OverclockMode } from '../core/types';

export interface MachineSpec {
  name: string;
  /** Multiblock, shown as such in the build list. */
  multi?: boolean;
  /** Gets Electric Blast Furnace style coil temperature bonuses. */
  coil?: boolean;
  oc: OverclockMode;
}

/** Machines we know something special about. Anything unlisted gets standard overclocking. */
export const MACHINES: readonly MachineSpec[] = [
  { name: 'Electric Blast Furnace', multi: true, coil: true, oc: 'standard' },
  { name: 'Alloy Blast Smelter', multi: true, coil: true, oc: 'standard' },
  { name: 'Large Chemical Reactor', multi: true, oc: 'perfect' },
  { name: 'Distillation Tower', multi: true, oc: 'standard' },
  { name: 'Vacuum Freezer', multi: true, oc: 'standard' },
  { name: 'Implosion Compressor', multi: true, oc: 'standard' },
  { name: 'Pyrolyse Oven', multi: true, coil: false, oc: 'standard' },
  { name: 'Cracker', multi: true, oc: 'standard' },
  { name: 'Assembly Line', multi: true, oc: 'standard' },
  { name: 'Fusion Reactor', multi: true, oc: 'standard' },
  { name: 'Chemical Reactor', oc: 'standard' },
  { name: 'Electrolyzer', oc: 'standard' },
  { name: 'Centrifuge', oc: 'standard' },
  { name: 'Mixer', oc: 'standard' },
  { name: 'Assembler', oc: 'standard' },
  { name: 'Circuit Assembler', oc: 'standard' },
  { name: 'Wiremill', oc: 'standard' },
  { name: 'Bender', oc: 'standard' },
  { name: 'Lathe', oc: 'standard' },
  { name: 'Cutter', oc: 'standard' },
  { name: 'Extruder', oc: 'standard' },
  { name: 'Compressor', oc: 'standard' },
  { name: 'Extractor', oc: 'standard' },
  { name: 'Macerator', oc: 'standard' },
  { name: 'Ore Washer', oc: 'standard' },
  { name: 'Thermal Centrifuge', oc: 'standard' },
  { name: 'Chemical Bath', oc: 'standard' },
  { name: 'Fluid Solidifier', oc: 'standard' },
  { name: 'Fluid Extractor', oc: 'standard' },
  { name: 'Distillery', oc: 'standard' },
  { name: 'Forming Press', oc: 'standard' },
  { name: 'Polarizer', oc: 'standard' },
  { name: 'Laser Engraver', oc: 'standard' },
  { name: 'Autoclave', oc: 'standard' },
  { name: 'Arc Furnace', oc: 'standard' },
  { name: 'Electric Furnace', oc: 'standard' },
  { name: 'Canning Machine', oc: 'standard' },
  { name: 'Sifter', oc: 'standard' },
  { name: 'Packer', oc: 'standard' },
  { name: 'Forge Hammer', oc: 'standard' },
  { name: 'Brewery', oc: 'standard' },
  { name: 'Fermenter', oc: 'standard' },
  { name: 'Microverse Projector', multi: true, oc: 'none' },
];

const BY_LOWER_NAME = new Map(MACHINES.map((m) => [m.name.toLowerCase(), m]));

export function machineSpec(name: string | undefined | null): MachineSpec | null {
  return BY_LOWER_NAME.get(String(name ?? '').toLowerCase()) ?? null;
}

export function machineUsesCoil(name: string | undefined | null): boolean {
  return machineSpec(name)?.coil === true;
}

export function defaultOverclockMode(name: string | undefined | null): OverclockMode {
  return machineSpec(name)?.oc ?? 'standard';
}
