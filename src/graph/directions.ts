/**
 * The three flow directions, and the one idea that keeps the layout code from being written three
 * times: instead of x and y, everything is expressed along two axes — the **flow axis**, which the
 * chain advances along, and the **cross axis**, which nodes spread out on. Horizontal layouts map
 * flow to x, vertical ones to y, and bottom-to-top also flips it. Only the few places that touch
 * real coordinates have to care which is which.
 */
import type { GraphDirection } from '../core/types';

export interface DirectionSpec {
  /** Flow runs along x (left to right) rather than y. */
  horizontal: boolean;
  /** Flow runs backwards along its axis (bottom to top). */
  flip: boolean;
  /** Space between columns along the flow axis. */
  rankGap: number;
  /** Space between nodes along the cross axis. */
  crossGap: number;
}

export const DIRECTIONS: Record<GraphDirection, DirectionSpec> = {
  lr: { horizontal: true, flip: false, rankGap: 96, crossGap: 20 },
  tb: { horizontal: false, flip: false, rankGap: 84, crossGap: 22 },
  bt: { horizontal: false, flip: true, rankGap: 84, crossGap: 22 },
};

export const DEFAULT_DIRECTION: GraphDirection = 'lr';

export function directionSpec(dir: string | undefined | null): DirectionSpec {
  return DIRECTIONS[(dir ?? '') as GraphDirection] ?? DIRECTIONS[DEFAULT_DIRECTION];
}

export function isDirection(value: unknown): value is GraphDirection {
  return typeof value === 'string' && value in DIRECTIONS;
}
