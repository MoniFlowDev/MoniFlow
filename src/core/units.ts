import type { RateUnit } from './types';

export const TICKS_PER_SECOND = 20;

/** Tolerance for the solver's fixed-point iteration and for rounding machine counts up. */
export const EPSILON = 1e-9;

export const RATE_UNITS: Record<RateUnit, { multiplier: number; label: string }> = {
  s: { multiplier: 1, label: '/s' },
  min: { multiplier: 60, label: '/min' },
  h: { multiplier: 3600, label: '/h' },
};
