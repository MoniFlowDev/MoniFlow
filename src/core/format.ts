import { RATE_UNITS, TICKS_PER_SECOND } from './units';
import type { FluidUnitMode, RateUnit } from './types';

/**
 * How amounts are shown. These are display preferences rather than plan data, so they live
 * here as module state instead of being threaded through every formatting call — the app
 * sets them once per render from `AppState`.
 */
let rateUnit: RateUnit = 's';
let fluidUnitMode: FluidUnitMode = 'auto';

export function setRateUnit(unit: RateUnit): void {
  rateUnit = unit;
}

export function setFluidUnitMode(mode: FluidUnitMode): void {
  fluidUnitMode = mode;
}

export function rateUnitLabel(): string {
  return RATE_UNITS[rateUnit].label;
}

export function rateUnitMultiplier(): number {
  return RATE_UNITS[rateUnit].multiplier;
}

/**
 * A number short enough to fit in a node or a table cell: `1.25`, `4.2k`, `18.3M`.
 * `digits` defaults to more precision for smaller numbers, and trailing zeros are dropped.
 */
export function formatNumber(n: number | null | undefined, digits?: number): string {
  if (n == null || !isFinite(n)) return '∞';
  const abs = Math.abs(n);
  const places = digits ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  const s = n.toFixed(places);
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

export function formatEut(eut: number): string {
  return `${formatNumber(eut)} EU/t`;
}

export function formatDuration(ticks: number): string {
  const seconds = ticks / TICKS_PER_SECOND;
  return seconds >= 60 ? `${formatNumber(seconds / 60)} min` : `${formatNumber(seconds)} s`;
}

/** A fluid amount in whichever unit fits: mB, B (a bucket is 1000 mB), kB, MB. */
export function formatFluid(mb: number): string {
  return formatFluidAmount(mb, fluidUnitMode);
}

function formatFluidAmount(mb: number, mode: FluidUnitMode): string {
  const abs = Math.abs(mb);
  if (mode === 'mb') {
    // Whole numbers with separators ("10,000 mB") read better than "10.0k mB"; only shorten past a million.
    if (abs >= 1000 && abs < 1e6) return `${Math.round(mb).toLocaleString('en-US')} mB`;
    return `${formatNumber(mb)} mB`;
  }
  if (abs < 1000) return `${formatNumber(mb)} mB`;
  if (abs < 1e6) return `${formatNumber(mb / 1000)} B`;
  if (abs < 1e9) return `${formatNumber(mb / 1e6)} kB`;
  return `${formatNumber(mb / 1e9)} MB`;
}

/** An item count or fluid amount for a recipe chip: `4×`, `144 mB`, `2.5 B`. */
export function formatAmount(amount: number, fluid?: boolean): string {
  return fluid ? formatFluid(amount) : `${formatNumber(amount)}×`;
}

/** A per-second rate, converted into whatever unit is currently selected. */
export function formatRate(ratePerSecond: number, fluid?: boolean): string {
  const { multiplier, label } = RATE_UNITS[rateUnit];
  const value = ratePerSecond * multiplier;
  return `${fluid ? formatFluid(value) : formatNumber(value)}${label}`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

/** Explicit preferences for reactive UI callers; legacy graph formatters keep their API. */
export function createFormatter(unit: RateUnit, fluids: FluidUnitMode) {
  const fluid = (mb: number): string => formatFluidAmount(mb, fluids);
  return {
    multiplier: RATE_UNITS[unit].multiplier,
    label: RATE_UNITS[unit].label,
    fluid,
    amount: (n: number, isFluid = false) => (isFluid ? fluid(n) : `${formatNumber(n)}×`),
    rate: (n: number, isFluid = false) =>
      `${isFluid ? fluid(n * RATE_UNITS[unit].multiplier) : formatNumber(n * RATE_UNITS[unit].multiplier)}${RATE_UNITS[unit].label}`,
  };
}
