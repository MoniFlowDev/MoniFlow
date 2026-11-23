/**
 * Ports: where a line meets a node.
 *
 * A recipe node shows one icon per ingredient along one edge and one per product along the other,
 * and each item's line attaches at its own icon. The order of those icons is not fixed — it is
 * chosen from where each line is heading, so lines arrive in the same order they leave and do not
 * cross right at the node. Item nodes have no icons, so their lines are simply spread along the
 * edge, thickest getting the most room.
 */
import type { ItemKey } from '../core/types';
import type { DirectionSpec } from './directions';
import type { Graph, GraphEdge, GraphNode, RecipeNode } from './model';
import type { Layout } from './layout';

/** Spacing of port icons along a node edge. */
export const PORT_STEP = 24;
/** How far outside the node the icons sit. */
export const PORT_OUT = 3;

/** Padding kept clear at each end of a node edge. */
const PORT_PADDING = 8;
/** Padding for spread line endpoints, which need a little more room than icons. */
const SPREAD_PADDING = 16;
/** Largest gap left between spread endpoints. */
const MAX_SPREAD_GAP = 6;

/** Cross-axis coordinate of an item's port on a node, in graph space. */
export function portCoord(
  node: GraphNode,
  item: ItemKey,
  isOutput: boolean,
  dir: DirectionSpec,
): number {
  const list = node.kind === 'recipe' ? (isOutput ? node.outPorts : node.inPorts) : [];
  const count = Math.max(1, list.length);
  const indexInList = Math.max(0, list.indexOf(item));

  const span = dir.horizontal ? node.h : node.w;
  const start = dir.horizontal ? node.y : node.x;
  const step = Math.min(PORT_STEP, (span - PORT_PADDING) / count);

  return start + span / 2 + (indexInList - (count - 1) / 2) * step;
}

/** Where an item's port icon sits, relative to the node's own origin. */
export function portPoint(
  node: GraphNode,
  item: ItemKey,
  isOutput: boolean,
  dir: DirectionSpec,
): { x: number; y: number } {
  const cross = portCoord(node, item, isOutput, dir) - (dir.horizontal ? node.y : node.x);

  if (dir.horizontal) {
    return { x: isOutput ? node.w + PORT_OUT : -PORT_OUT, y: cross };
  }
  // Top to bottom puts outputs at the bottom; bottom to top is the other way round.
  const atBottom = dir.flip ? !isOutput : isOutput;
  return { x: cross, y: atBottom ? node.h + PORT_OUT : -PORT_OUT };
}

/**
 * Spread a set of line endpoints along one side of an item node, giving each a share of the edge
 * proportional to its thickness. Scaled down if the lines together need more room than there is.
 */
export function spreadPorts(
  edges: readonly GraphEdge[],
  node: GraphNode,
  key: 'sp' | 'tp',
  dir: DirectionSpec,
): void {
  if (!edges.length) return;

  const span = dir.horizontal ? node.h : node.w;
  const start = dir.horizontal ? node.y : node.x;
  const available = span - SPREAD_PADDING;

  const totalWidth = edges.reduce((sum, e) => sum + e.w, 0);
  const gap =
    edges.length > 1
      ? Math.max(0, Math.min(MAX_SPREAD_GAP, (available - totalWidth) / (edges.length - 1)))
      : 0;
  const needed = totalWidth + gap * (edges.length - 1);
  const scale = needed > available ? available / needed : 1;

  let cursor = start + span / 2 - Math.min(needed, available) / 2;
  for (const edge of edges) {
    const width = edge.w * scale;
    edge[key] = cursor + width / 2;
    cursor += width + gap * scale;
  }
}

/**
 * The cross-axis position a line is aiming for as it leaves one end: its nearest waypoint if it
 * has one, otherwise the centre of the node at the far end.
 */
export function edgeHeading(
  graph: Graph,
  edge: GraphEdge,
  fromStart: boolean,
  dir: DirectionSpec,
): number {
  if (edge.via?.length) {
    const waypoint = fromStart ? edge.via[0]! : edge.via[edge.via.length - 1]!;
    if (waypoint.seg) return dir.horizontal ? waypoint.seg.y1 : waypoint.seg.x1;
  }
  const other = graph.nodes.get(fromStart ? edge.to : edge.from);
  if (!other) return 0;
  return dir.horizontal ? other.y + other.h / 2 : other.x + other.w / 2;
}

/**
 * Order each recipe node's port icons by where their lines connect, so the lines arrive in order
 * instead of crossing. Two passes: the first aims at the other node's centre (nothing better is
 * known yet), the second at the other end's actual port, now that it has been placed.
 */
export function sortPorts(graph: Graph, layout: Layout, dir: DirectionSpec): void {
  const centreOf = (node: GraphNode): number =>
    dir.horizontal ? node.y + node.h / 2 : node.x + node.w / 2;

  for (let pass = 0; pass < 2; pass++) {
    for (const [id, node] of graph.nodes) {
      if (node.kind !== 'recipe') continue;

      const order = (items: ItemKey[], edges: readonly GraphEdge[], isOutput: boolean): ItemKey[] => {
        // Each item can have several lines; aim at their average.
        const headings = new Map<ItemKey, number[]>();
        for (const edge of edges) {
          if (edge.stub) continue;
          const other = graph.nodes.get(isOutput ? edge.to : edge.from);
          if (!other) continue;

          const heading = edge.via?.length
            ? edgeHeading(graph, edge, isOutput, dir)
            : pass === 0 || other.kind !== 'recipe'
              ? centreOf(other)
              : portCoord(other, edge.item, !isOutput, dir);

          let list = headings.get(edge.item);
          if (!list) headings.set(edge.item, (list = []));
          list.push(heading);
        }

        const averageOf = (item: ItemKey): number | null => {
          const list = headings.get(item);
          return list ? list.reduce((a, b) => a + b, 0) / list.length : null;
        };
        // Items with no line at all (stubs, unused outputs) keep their original order, at the end.
        const original = new Map(items.map((item, i) => [item, i]));

        return [...items].sort((a, b) => {
          const left = averageOf(a);
          const right = averageOf(b);
          if (left == null && right == null) return original.get(a)! - original.get(b)!;
          if (left == null) return 1;
          if (right == null) return -1;
          return left - right || original.get(a)! - original.get(b)!;
        });
      };

      const recipeNode = node as RecipeNode;
      recipeNode.inPorts = order(recipeNode.inPorts, layout.incoming.get(id) ?? [], false);
      recipeNode.outPorts = order(recipeNode.outPorts, layout.outgoing.get(id) ?? [], true);
    }
  }
}

/**
 * Compact mode: instead of a line, mark the step's own port icon — a dashed border for a raw
 * input, purple for an unused byproduct — and make it hoverable and clickable in the line's place.
 */
export function markStubPort(
  graph: Graph,
  edge: GraphEdge,
  edgeIndex: number,
  dir: DirectionSpec,
): void {
  const isInput = edge.stub === 'in';
  const node = graph.nodes.get(isInput ? edge.to : edge.from);
  if (node?.kind !== 'recipe') return;

  const ports = isInput ? node.portElements?.in : node.portElements?.out;
  const element = ports?.get(edge.item);
  if (!element) return;

  element.classList.add(isInput ? 'raw' : 'spare');
  element.classList.toggle('manual', !!edge.manual);
  element.dataset['e'] = String(edgeIndex);
  // The app reads this to select the item rather than the step.
  element.dataset['item'] = (isInput ? 'raw:' : 'sur:') + edge.item;

  // Where the rate label goes: just outside the icon, pointing away from the node.
  const point = portPoint(node, edge.item, !isInput, dir);
  const away = dir.horizontal
    ? { x: isInput ? -1 : 1, y: 0 }
    : { x: 0, y: point.y > node.h / 2 ? 1 : -1 };

  edge.stubEnd = {
    cap: { x: node.x + point.x + away.x * 10, y: node.y + point.y + away.y * 10 },
    dir: away,
  };
}
