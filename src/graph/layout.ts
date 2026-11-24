/**
 * Layered graph layout, the Sugiyama way.
 *
 * Four steps, in order:
 *
 *  1. **Break cycles.** Recycling loops make the graph cyclic, which has no layering. A DFS marks
 *     the back edges; they are drawn around the outside of the graph instead.
 *  2. **Assign columns.** Each step goes as far right as its deepest ingredient, then gets pulled
 *     back toward whatever consumes it, so a line travels as short a distance as it can.
 *  3. **Route long lines.** A line crossing several columns gets one invisible waypoint per column,
 *     so it travels through the gaps between nodes rather than straight over them.
 *  4. **Order each column.** Repeated barycentre sweeps (put each node near the average position of
 *     its neighbours) followed by swapping adjacent pairs while that removes crossings.
 */
import type { GraphEdge, Graph, LayoutNode } from './model';

/** Column 0 is reserved for raw inputs, so steps start at 1. */
const FIRST_STEP_COLUMN = 1;
/** Passes of pulling steps rightward toward their consumers. */
const COMPACTION_PASSES = 3;
/** Barycentre sweeps. Even passes go forwards, odd passes back. */
const SWEEPS = 24;
/** Rounds of swapping adjacent nodes while it still helps. */
const SWAP_ROUNDS = 12;
/** Default layout weight for an edge whose width has not been set yet. */
const DEFAULT_WEIGHT = 2;

/** Nodes are ordered within a column by kind first, so inputs lead and byproducts trail. */
const KIND_ORDER: Record<string, number> = { raw: 0, recipe: 1, dummy: 1, out: 2, sur: 3 };

/** A neighbouring node in the adjacent column, and how strongly it pulls. */
interface Link {
  id: string;
  w: number;
}

export interface Layout {
  /** Column index -> node ids, in display order. */
  columns: Map<number, string[]>;
  /** Column indices, ascending. */
  columnKeys: number[];
  /** Node id -> its edges, excluding stubs. */
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  /** Every positioned thing: real nodes plus the waypoints of long lines. */
  all: Map<string, LayoutNode>;
  /** Links to the previous / next column, waypoints included. */
  linksIn: Map<string, Link[]>;
  linksOut: Map<string, Link[]>;
  /** Line crossings in the final ordering, mostly useful for tests. */
  crossings: number;
}

export function layoutGraph(graph: Graph): Layout {
  const { outgoing, incoming } = buildAdjacency(graph);
  markBackEdges(graph, outgoing, incoming);

  const rank = assignColumns(graph, outgoing, incoming);
  const { all, columns, linksIn, linksOut } = routeLongEdges(graph, rank);

  const columnKeys = [...columns.keys()].sort((a, b) => a - b);
  const layers = columnKeys.map((key) => columns.get(key)!);
  const crossings = orderWithinColumns(layers, all, linksIn, linksOut);

  return { columns, columnKeys, outgoing, incoming, all, linksIn, linksOut, crossings };
}

function buildAdjacency(graph: Graph): {
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
} {
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  for (const id of graph.nodes.keys()) {
    outgoing.set(id, []);
    incoming.set(id, []);
  }
  for (const edge of graph.edges) {
    if (edge.stub) continue;
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }
  return { outgoing, incoming };
}

/** Depth-first search; an edge back into a node still on the stack is a cycle edge. */
function markBackEdges(
  graph: Graph,
  outgoing: Map<string, GraphEdge[]>,
  incoming: Map<string, GraphEdge[]>,
): void {
  const OPEN = 1;
  const DONE = 2;
  const state = new Map<string, number>();

  const visit = (id: string): void => {
    state.set(id, OPEN);
    for (const edge of outgoing.get(id) ?? []) {
      const seen = state.get(edge.to);
      if (seen === OPEN) edge.back = true;
      else if (!seen) visit(edge.to);
    }
    state.set(id, DONE);
  };

  // Start from the nodes with the fewest inputs, which are the natural entry points.
  const order = [...graph.nodes.keys()].sort(
    (a, b) => (incoming.get(a)?.length ?? 0) - (incoming.get(b)?.length ?? 0),
  );
  for (const id of order) if (!state.get(id)) visit(id);
}

/**
 * Longest-path columns for steps, then everything else placed relative to them: targets at the
 * far end, raw inputs just before whatever uses them, byproducts just after whatever makes them.
 */
function assignColumns(
  graph: Graph,
  outgoing: Map<string, GraphEdge[]>,
  incoming: Map<string, GraphEdge[]>,
): Map<string, number> {
  const rank = new Map<string, number>();

  const rankOf = (id: string, onPath = new Set<string>()): number => {
    const known = rank.get(id);
    if (known != null) return known;
    if (onPath.has(id)) return FIRST_STEP_COLUMN; // a cycle the back-edge pass did not catch
    onPath.add(id);

    let column = FIRST_STEP_COLUMN;
    for (const edge of incoming.get(id) ?? []) {
      if (edge.back) continue;
      if (graph.nodes.get(edge.from)?.kind !== 'recipe') continue;
      column = Math.max(column, rankOf(edge.from, onPath) + 1);
    }

    onPath.delete(id);
    rank.set(id, column);
    return column;
  };

  let lastColumn = FIRST_STEP_COLUMN;
  const stepIds: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.kind !== 'recipe') continue;
    stepIds.push(id);
    lastColumn = Math.max(lastColumn, rankOf(id));
  }

  compactTowardConsumers(graph, outgoing, rank, stepIds);

  for (const [id, node] of graph.nodes) {
    if (node.kind === 'out') {
      rank.set(id, lastColumn + 1);
    } else if (node.kind === 'raw') {
      const consumers = (outgoing.get(id) ?? [])
        .map((e) => rank.get(e.to))
        .filter((r): r is number => r != null);
      rank.set(id, consumers.length ? Math.max(0, Math.min(...consumers) - 1) : 0);
    }
  }
  // Byproducts come after their producers, which the loop above may just have moved.
  for (const [id, node] of graph.nodes) {
    if (node.kind !== 'sur') continue;
    const producers = (incoming.get(id) ?? [])
      .map((e) => rank.get(e.from))
      .filter((r): r is number => r != null);
    rank.set(id, producers.length ? Math.max(...producers) + 1 : lastColumn + 1);
  }

  return rank;
}

/**
 * Longest-path ranking leaves a step as early as possible, which can strand it columns away from
 * whatever uses it. Pull each step rightward to just before its earliest consumer — unless it also
 * feeds a target, which belongs at the far end and would drag the step with it.
 */
function compactTowardConsumers(
  graph: Graph,
  outgoing: Map<string, GraphEdge[]>,
  rank: Map<string, number>,
  stepIds: readonly string[],
): void {
  for (let pass = 0; pass < COMPACTION_PASSES; pass++) {
    // Rightmost first, so a step moved this pass can pull the ones feeding it next.
    const order = [...stepIds].sort((a, b) => rank.get(b)! - rank.get(a)!);

    for (const id of order) {
      const edges = outgoing.get(id) ?? [];
      const feedsTarget = edges.some((e) => graph.nodes.get(e.to)?.kind === 'out');
      if (feedsTarget) continue;

      const consumerColumns = edges
        .filter((e) => !e.back && graph.nodes.get(e.to)?.kind === 'recipe')
        .map((e) => rank.get(e.to)!);
      if (!consumerColumns.length) continue;

      const wanted = Math.min(...consumerColumns) - 1;
      if (wanted > rank.get(id)!) rank.set(id, wanted);
    }
  }
}

/**
 * Give every line that crosses more than one column a waypoint in each column it passes through.
 * The ordering pass then treats those waypoints as nodes, which is what reserves a clear corridor
 * for the line instead of letting it cut across the boxes in between.
 */
function routeLongEdges(
  graph: Graph,
  rank: Map<string, number>,
): {
  all: Map<string, LayoutNode>;
  columns: Map<number, string[]>;
  linksIn: Map<string, Link[]>;
  linksOut: Map<string, Link[]>;
} {
  const all = new Map<string, LayoutNode>(graph.nodes);
  const linksIn = new Map<string, Link[]>();
  const linksOut = new Map<string, Link[]>();
  for (const id of all.keys()) {
    linksIn.set(id, []);
    linksOut.set(id, []);
  }

  const columns = new Map<number, string[]>();
  const place = (id: string, column: number): void => {
    let list = columns.get(column);
    if (!list) columns.set(column, (list = []));
    list.push(id);
  };
  for (const id of graph.nodes.keys()) place(id, rank.get(id)!);

  const link = (from: string, to: string, weight: number): void => {
    linksOut.get(from)!.push({ id: to, w: weight });
    linksIn.get(to)!.push({ id: from, w: weight });
  };

  graph.edges.forEach((edge, index) => {
    edge.via = null;
    if (edge.stub) return;

    const start = rank.get(edge.from)!;
    const end = rank.get(edge.to)!;
    // Back edges and anything not moving forward are drawn freehand around the outside.
    if (edge.back || end <= start) return;

    const weight = edge.w || DEFAULT_WEIGHT;
    let previous = edge.from;
    if (end - start > 1) edge.via = [];

    for (let column = start + 1; column < end; column++) {
      const id = `~${index}:${column}`;
      const waypoint: LayoutNode = { id, kind: 'dummy', edge, w: 0, h: 0 };
      all.set(id, waypoint);
      linksIn.set(id, []);
      linksOut.set(id, []);
      place(id, column);
      link(previous, id, weight);
      edge.via!.push(waypoint);
      previous = id;
    }
    link(previous, edge.to, weight);
  });

  return { all, columns, linksIn, linksOut };
}

/**
 * Order the nodes within each column to minimise line crossings. Barycentre sweeps get close
 * quickly; swapping adjacent pairs cleans up what they leave behind. The best ordering seen is
 * kept, since a sweep can make things worse.
 */
function orderWithinColumns(
  layers: string[][],
  all: Map<string, LayoutNode>,
  linksIn: Map<string, Link[]>,
  linksOut: Map<string, Link[]>,
): number {
  const position = new Map<string, number>();
  const renumber = (ids: readonly string[]): void => ids.forEach((id, i) => position.set(id, i));
  layers.forEach(renumber);

  /** Crossings between this column's outgoing links, counted pairwise. */
  const crossingsFrom = (column: readonly string[]): number => {
    const segments: [number, number][] = [];
    for (const id of column) {
      for (const link of linksOut.get(id) ?? []) {
        segments.push([position.get(id)!, position.get(link.id)!]);
      }
    }
    let count = 0;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const [a1, b1] = segments[i]!;
        const [a2, b2] = segments[j]!;
        // Two lines cross exactly when their endpoints are in opposite orders.
        if ((a1 - a2) * (b1 - b2) < 0) count++;
      }
    }
    return count;
  };
  const totalCrossings = (): number => layers.reduce((sum, ids) => sum + crossingsFrom(ids), 0);

  let fewest = totalCrossings();
  let best = layers.map((ids) => ids.slice());

  for (let sweep = 0; sweep < SWEEPS && fewest > 0; sweep++) {
    const forward = sweep % 2 === 0;
    for (const ids of forward ? layers : [...layers].reverse()) {
      const barycentre = new Map(
        ids.map((id) => {
          // Look at the column we are sweeping from; fall back to both sides for a loose node.
          let neighbours = forward ? linksIn.get(id)! : linksOut.get(id)!;
          if (!neighbours.length) neighbours = [...linksIn.get(id)!, ...linksOut.get(id)!];
          if (!neighbours.length) return [id, position.get(id)!] as const;

          let weighted = 0;
          let weight = 0;
          for (const link of neighbours) {
            weighted += position.get(link.id)! * link.w;
            weight += link.w;
          }
          return [id, weighted / weight] as const;
        }),
      );

      ids.sort(
        (a, b) => barycentre.get(a)! - barycentre.get(b)! || kindRank(all, a) - kindRank(all, b),
      );
      renumber(ids);
    }

    const count = totalCrossings();
    if (count < fewest) {
      fewest = count;
      best = layers.map((ids) => ids.slice());
    }
  }

  // Restore the best ordering seen, then polish it by swapping neighbours.
  layers.forEach((ids, i) => {
    ids.splice(0, ids.length, ...best[i]!);
    renumber(ids);
  });
  swapAdjacentPairs(layers, position, linksIn, linksOut);

  return totalCrossings();
}

function kindRank(all: Map<string, LayoutNode>, id: string): number {
  return KIND_ORDER[all.get(id)!.kind] ?? 1;
}

/** Swap neighbouring nodes while doing so reduces crossings against both adjacent columns. */
function swapAdjacentPairs(
  layers: string[][],
  position: Map<string, number>,
  linksIn: Map<string, Link[]>,
  linksOut: Map<string, Link[]>,
): void {
  /** Crossings caused by `first` sitting before `second`. */
  const crossingsOf = (first: string, second: string): number => {
    let count = 0;
    for (const side of [linksIn, linksOut]) {
      for (const a of side.get(first) ?? []) {
        for (const b of side.get(second) ?? []) {
          if (position.get(a.id)! > position.get(b.id)!) count++;
        }
      }
    }
    return count;
  };

  for (let round = 0, improved = true; round < SWAP_ROUNDS && improved; round++) {
    improved = false;
    for (const ids of layers) {
      for (let i = 0; i + 1 < ids.length; i++) {
        const first = ids[i]!;
        const second = ids[i + 1]!;
        if (crossingsOf(second, first) >= crossingsOf(first, second)) continue;
        ids[i] = second;
        ids[i + 1] = first;
        position.set(second, i);
        position.set(first, i + 1);
        improved = true;
      }
    }
  }
}
