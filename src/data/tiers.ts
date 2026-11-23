/** GregTech voltage tiers. Colours follow the in-game tier text, tuned for a dark background. */
export interface Tier {
  name: string;
  /** Volts, i.e. the EU/t one amp carries. */
  v: number;
  color: string;
}

export const TIERS: readonly Tier[] = [
  { name: 'ULV', v: 8, color: '#8a8a8a' },
  { name: 'LV', v: 32, color: '#c8c8c8' },
  { name: 'MV', v: 128, color: '#55ffff' },
  { name: 'HV', v: 512, color: '#ffaa00' },
  { name: 'EV', v: 2048, color: '#c05cff' },
  { name: 'IV', v: 8192, color: '#6f7cff' },
  { name: 'LuV', v: 32768, color: '#ff7cff' },
  { name: 'ZPM', v: 131072, color: '#ff5f5f' },
  { name: 'UV', v: 524288, color: '#1fc8c8' },
  { name: 'UHV', v: 2097152, color: '#d23a3a' },
  { name: 'UEV', v: 8388608, color: '#5fff7a' },
  { name: 'UIV', v: 33554432, color: '#2fb84a' },
  { name: 'UXV', v: 134217728, color: '#ffff66' },
  { name: 'OpV', v: 536870912, color: '#8f9bff' },
  { name: 'MAX', v: 2147483648, color: '#ff4f4f' },
];

/** Lowercase tier names, in tier order — how GregTech spells them in ids. */
export const TIER_KEYS: readonly string[] = TIERS.map((t) => t.name.toLowerCase());

/** The lowest tier that can run a recipe drawing `eut`. */
export function tierForEut(eut: number): number {
  for (let i = 0; i < TIERS.length; i++) {
    if (eut <= TIERS[i]!.v) return i;
  }
  return TIERS.length - 1;
}

export function tier(index: number): Tier {
  return TIERS[Math.min(Math.max(index, 0), TIERS.length - 1)]!;
}
