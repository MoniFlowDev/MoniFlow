import { TIERS } from './tiers';

/** Power sources for the Power tab, as EU/t per generator. */
export interface GeneratorPreset {
  name: string;
  /** Zero marks the "Custom…" entry, where you type the EU/t yourself. */
  eut: number;
}

export const GENERATOR_PRESETS: readonly GeneratorPreset[] = [
  ...TIERS.slice(1, 6).map((t) => ({ name: `${t.name} single-block generator (1A)`, eut: t.v })),
  { name: 'Large Steam Turbine (base)', eut: 1024 },
  { name: 'Large Combustion Engine', eut: 2048 },
  { name: 'Large Gas Turbine (base)', eut: 4096 },
  { name: 'Extreme Combustion Engine', eut: 8192 },
  { name: 'Large Plasma Turbine (base)', eut: 16384 },
  { name: 'Custom…', eut: 0 },
];
