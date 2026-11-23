import { describe, expect, it } from 'vitest';

import { assignCoordinates } from '../src/graph/coordinates';
import { DIRECTIONS } from '../src/graph/directions';
import { layoutGraph } from '../src/graph/layout';
import { buildGraph } from '../src/graph/model';
import { buildRecipeIndex } from '../src/solver/recipe-index';
import { solve } from '../src/solver/solve';
import { plan, recipe } from './fixture';

/** ore -> a -> b -> c, with `a` also feeding `d` directly, so `a -> d` skips two columns. */
const index = buildRecipeIndex([
  recipe('a', { inputs: [['ore', 1]], outputs: [['x', 1]] }),
  recipe('b', { inputs: [['x', 1]], outputs: [['y', 1]] }),
  recipe('c', { inputs: [['y', 1]], outputs: [['z', 1]] }),
  recipe('d', { inputs: [['z', 1], ['x', 1]], outputs: [['t', 1]] }),
]);
const solution = solve(plan({ targets: [{ item: 't', rate: 1 }] }), index);

describe('layout', () => {
  it('routes a line that skips columns through waypoints', () => {
    const graph = buildGraph(solution, { stubs: false });
    for (const edge of graph.edges) edge.w = 2;

    const layout = layoutGraph(graph);
    assignCoordinates(layout, DIRECTIONS.lr);

    const long = graph.edges.find((e) => e.from === 'a' && e.to === 'd');
    expect(long?.via).toHaveLength(2);
    // Each corridor runs along the flow axis, never backwards.
    expect(long!.via!.every((waypoint) => waypoint.seg && waypoint.seg.x2 >= waypoint.seg.x1)).toBe(
      true,
    );
  });

  it('finds an ordering with no crossings for a clean chain', () => {
    const graph = buildGraph(solution, { stubs: false });
    for (const edge of graph.edges) edge.w = 2;
    expect(layoutGraph(graph).crossings).toBe(0);
  });
});

describe('compact mode', () => {
  it('keeps raw inputs as nodes when switched off', () => {
    const graph = buildGraph(solution, { stubs: false });
    expect(graph.nodes.has('raw:ore')).toBe(true);
  });

  it('turns a raw input into a mark on the step that uses it', () => {
    const graph = buildGraph(solution, { stubs: true });
    expect(graph.nodes.has('raw:ore')).toBe(false);
    expect(graph.edges.filter((e) => e.stub === 'in')).toHaveLength(1);
  });
});
