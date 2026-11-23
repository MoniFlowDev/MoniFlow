/** Heating coils for the Electric Blast Furnace and other coil multiblocks. */
export interface Coil {
  name: string;
  /** Base temperature in kelvin, before the +100K per tier above MV bonus. */
  temp: number;
}

export const COILS: readonly Coil[] = [
  { name: 'Cupronickel', temp: 1800 },
  { name: 'Kanthal', temp: 2700 },
  { name: 'Nichrome', temp: 3600 },
  { name: 'RTM Alloy', temp: 4500 },
  { name: 'HSS-G', temp: 5400 },
  { name: 'Naquadah', temp: 7200 },
  { name: 'Trinium', temp: 9001 },
  { name: 'Tritanium', temp: 10800 },
];

export const DEFAULT_COIL_TEMP = COILS[0]!.temp;

export function coilTemp(index: number): number {
  return COILS[index]?.temp ?? DEFAULT_COIL_TEMP;
}
