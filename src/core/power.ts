import { tier } from '../data/tiers';
import { formatNumber } from './format';

/** A power draw expressed as amps on a given grid tier: `3.2A HV`. */
export function ampsLabel(eut: number, tierIndex: number): string {
  const t = tier(tierIndex);
  return `${formatNumber(eut / t.v)}A ${t.name}`;
}
