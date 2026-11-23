/**
 * Turning the layout into coordinates.
 *
 * Columns are laid out one after another along the flow axis. Within a column, nodes start packed
 * and centred, then a few passes pull each one toward the weighted average of its neighbours'
 * positions while a two-sided sweep keeps them in order and never overlapping. That is what makes
 * a straight chain come out straight, and a line that skips columns run through the gap reserved
 * for it rather than over the nodes.
 */
import type { DirectionSpec } from './directions';
import type { Graph, GraphNode, LayoutNode, Waypoint } from './model';
import type { Layout } from './layout';

/** Passes of pulling nodes toward their neighbours. Even passes look back, odd ones forward. */
const REFINE_PASSES = 16;
/** How much of each pass is the neighbours' pull versus staying put. */
const PULL = 0.85;
/** Waypoints pull twice as hard as nodes, which is what keeps long lines straight. */
const WAYPOINT_PULL = 2;

/** Cross-axis spacing, which is tighter around the invisible waypoints. */
const GAP_BETWEEN_WAYPOINTS = 6;
const GAP_BESIDE_WAYPOINT = 12;
/** Minimum cross-axis room a waypoint claims, so a thin line still gets a corridor. */
const MIN_WAYPOINT_WIDTH = 4;

/** Clearance kept when pushing automatically placed nodes away from ones you dragged. */
const OVERLAP_GAP = 12;
/** Safety valve on the push loop. */
const MAX_PUSHES = 60;

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

function isWaypoint(node: LayoutNode): node is Waypoint {
  return node.kind === 'dummy';
}

export function assignCoordinates(layout: Layout, dir: DirectionSpec): void {
  const { all } = layout;
  const layers = layout.columnKeys.map((key) => layout.columns.get(key)!);

  /** How much room a node takes along the flow axis. */
  const flowSize = (node: LayoutNode): number =>
    isWaypoint(node) ? 0 : dir.horizontal ? node.w : node.h;

  /** How much room it takes along the cross axis. */
  const crossSize = (node: LayoutNode): number =>
    isWaypoint(node)
      ? Math.max(MIN_WAYPOINT_WIDTH, node.edge.w || 2)
      : dir.horizontal ? node.h : node.w;

  const flow = placeColumns(layers, all, dir, flowSize);
  const centre = spreadAcross(layers, all, dir, crossSize);
  refine(layers, all, layout, centre, crossSize, dir);

  // Shift everything so the cross axis starts at zero.
  let minCross = Infinity;
  for (const [id, node] of all) {
    minCross = Math.min(minCross, centre.get(id)! - crossSize(node) / 2);
  }
  const alongFlow = (value: number): number => (dir.flip ? flow.length - value : value);

  for (const [id, node] of all) {
    const cross = centre.get(id)! - minCross;
    const span = flow.spans.get(id)!;

    if (isWaypoint(node)) {
      // The corridor this line travels through in this column, in travel order.
      const from = alongFlow(span.start);
      const to = alongFlow(span.end);
      node.seg = dir.horizontal
        ? { x1: from, y1: cross, x2: to, y2: cross }
        : { x1: cross, y1: from, x2: cross, y2: to };
      continue;
    }

    const crossStart = cross - crossSize(node) / 2;
    if (dir.horizontal) {
      node.x = span.position;
      node.y = crossStart;
    } else {
      node.x = crossStart;
      node.y = dir.flip ? flow.length - span.position - node.h : span.position;
    }
  }
}

interface FlowSpan {
  /** Where the node itself sits along the flow axis. */
  position: number;
  /** The column's extent, which is also the corridor a waypoint spans. */
  start: number;
  end: number;
}

/** Lay the columns out one after another along the flow axis, centring each node in its column. */
function placeColumns(
  layers: readonly string[][],
  all: Map<string, LayoutNode>,
  dir: DirectionSpec,
  flowSize: (node: LayoutNode) => number,
): { spans: Map<string, FlowSpan>; length: number } {
  const spans = new Map<string, FlowSpan>();
  let cursor = 0;

  for (const ids of layers) {
    const extent = Math.max(0, ...ids.map((id) => flowSize(all.get(id)!)));
    for (const id of ids) {
      const node = all.get(id)!;
      spans.set(id, {
        position: cursor + (extent - flowSize(node)) / 2,
        start: cursor,
        end: cursor + extent,
      });
    }
    cursor += extent + dir.rankGap;
  }

  return { spans, length: Math.max(0, cursor - dir.rankGap) };
}

/** Starting cross-axis positions: packed in column order and centred on zero. */
function spreadAcross(
  layers: readonly string[][],
  all: Map<string, LayoutNode>,
  dir: DirectionSpec,
  crossSize: (node: LayoutNode) => number,
): Map<string, number> {
  const centre = new Map<string, number>();

  for (const ids of layers) {
    let cursor = 0;
    const midpoints = ids.map((id, i) => {
      const node = all.get(id)!;
      if (i) cursor += gapBetween(all.get(ids[i - 1]!)!, node, dir);
      const middle = cursor + crossSize(node) / 2;
      cursor += crossSize(node);
      return middle;
    });
    ids.forEach((id, i) => centre.set(id, midpoints[i]! - cursor / 2));
  }
  return centre;
}

function gapBetween(a: LayoutNode, b: LayoutNode, dir: DirectionSpec): number {
  const aIsWaypoint = a.kind === 'dummy';
  const bIsWaypoint = b.kind === 'dummy';
  if (aIsWaypoint && bIsWaypoint) return GAP_BETWEEN_WAYPOINTS;
  if (aIsWaypoint || bIsWaypoint) return GAP_BESIDE_WAYPOINT;
  return dir.crossGap;
}

/**
 * Alternate sweeps pulling each node toward its predecessors and then its successors. Each pass
 * computes where every node would like to be, then enforces the spacing twice — once from each
 * end — and takes the midpoint, which keeps the column's order intact while honouring the pulls.
 */
function refine(
  layers: readonly string[][],
  all: Map<string, LayoutNode>,
  layout: Layout,
  centre: Map<string, number>,
  crossSize: (node: LayoutNode) => number,
  dir: DirectionSpec,
): void {
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    const forward = pass % 2 === 0;

    for (const ids of forward ? layers : [...layers].reverse()) {
      if (!ids.length) continue;

      const desired = ids.map((id) => {
        let neighbours = forward ? layout.linksIn.get(id)! : layout.linksOut.get(id)!;
        if (!neighbours.length) {
          neighbours = [...layout.linksIn.get(id)!, ...layout.linksOut.get(id)!];
        }
        if (!neighbours.length) return centre.get(id)!;

        const extra = isWaypoint(all.get(id)!) ? WAYPOINT_PULL : 1;
        let weighted = 0;
        let weight = 0;
        for (const link of neighbours) {
          const w = (1 + link.w) * extra;
          weighted += centre.get(link.id)! * w;
          weight += w;
        }
        return PULL * (weighted / weight) + (1 - PULL) * centre.get(id)!;
      });

      const separation = (i: number): number => {
        const a = all.get(ids[i]!)!;
        const b = all.get(ids[i + 1]!)!;
        return (crossSize(a) + crossSize(b)) / 2 + gapBetween(a, b, dir);
      };

      // Push down from the top, then up from the bottom, and settle in the middle.
      const fromStart = desired.slice();
      const fromEnd = desired.slice();
      for (let i = 1; i < ids.length; i++) {
        fromStart[i] = Math.max(fromStart[i]!, fromStart[i - 1]! + separation(i - 1));
      }
      for (let i = ids.length - 2; i >= 0; i--) {
        fromEnd[i] = Math.min(fromEnd[i]!, fromEnd[i + 1]! - separation(i));
      }
      ids.forEach((id, i) => centre.set(id, (fromStart[i]! + fromEnd[i]!) / 2));
    }
  }
}

export function computeBounds(graph: Graph): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of graph.nodes.values()) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, width: 0, height: 0 };
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Nodes you dragged stay exactly where you put them. Automatically placed ones that now collide
 * with anything get pushed along the cross axis until they are clear — down for a left-to-right
 * layout, right for a vertical one.
 */
export function resolveOverlaps(graph: Graph, dir: DirectionSpec): void {
  const nodes = [...graph.nodes.values()];
  const collides = (a: GraphNode, b: GraphNode): boolean =>
    a.x < b.x + b.w + OVERLAP_GAP &&
    a.x + a.w + OVERLAP_GAP > b.x &&
    a.y < b.y + b.h + OVERLAP_GAP &&
    a.y + a.h + OVERLAP_GAP > b.y;

  const movable = nodes
    .filter((node) => !node.pinned)
    .sort((a, b) => (dir.horizontal ? a.y - b.y : a.x - b.x));

  for (const node of movable) {
    for (let push = 0; push < MAX_PUSHES; push++) {
      const blocker = nodes.find((other) => other !== node && collides(node, other));
      if (!blocker) break;
      if (dir.horizontal) node.y = blocker.y + blocker.h + OVERLAP_GAP;
      else node.x = blocker.x + blocker.w + OVERLAP_GAP;
    }
  }
}
