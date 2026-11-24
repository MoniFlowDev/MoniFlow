/**
 * The graph the flow tab draws: what the solution looks like as boxes and lines.
 *
 * A solved plan is a set of steps with rates. Turning that into a drawing means one node per step,
 * one per raw input, target and byproduct, and a line wherever something produced is consumed. When
 * several steps make the same item and several consume it, the flow is split between them in
 * proportion, which is the honest picture of a plant where everything feeds a shared bus.
 */
import { expectedAmount } from '../core/recipe';
import type { ItemKey } from '../core/types';
import type { SolvedStep, Solution } from '../solver/solve';

/** Default node sizes; recipe nodes grow to fit their port icons. */
export const NODE_W = 224;
export const NODE_H = 70;
export const ITEM_W = 172;
export const ITEM_H = 40;

/** Flows below this are rounding noise rather than real lines. */
const MIN_FLOW = 1e-9;

interface NodeBase {
  id: string;
  w: number;
  h: number;
  /** Filled in by `assignCoordinates`. */
  x: number;
  y: number;
  /** You dragged this node, so the automatic layout must leave it alone. */
  pinned?: boolean;
}

/** One recipe running at a rate. */
export interface RecipeNode extends NodeBase {
  kind: 'recipe';
  step: SolvedStep;
  /** Distinct input items, in the order their icons sit along the node's edge. */
  inPorts: ItemKey[];
  outPorts: ItemKey[];
  /** The drawn port icons, once the node has been rendered. */
  portElements?: { in: Map<ItemKey, SVGGElement>; out: Map<ItemKey, SVGGElement> };
}

/** A raw input, a target, or a leftover byproduct. */
export interface ItemNode extends NodeBase {
  kind: 'raw' | 'out' | 'sur';
  item: ItemKey;
  rate: number;
  fluid: boolean;
  /** Raw because you said so (hiding its chain), rather than for want of a recipe. */
  manual?: boolean;
  /** Something could make it, so the node offers to expand it. */
  expandable?: boolean;
}

export type GraphNode = RecipeNode | ItemNode;

/** A waypoint a long line is routed through, one per column it crosses. */
export interface Waypoint {
  id: string;
  kind: 'dummy';
  edge: GraphEdge;
  w: 0;
  h: 0;
  /** The corridor through this column, in travel order. Set by `assignCoordinates`. */
  seg?: { x1: number; y1: number; x2: number; y2: number };
}

/** Anything the layout positions: a real node or a waypoint. */
export type LayoutNode = GraphNode | Waypoint;

export interface GraphEdge {
  from: string;
  to: string;
  item: ItemKey;
  /** Per second. */
  rate: number;
  fluid: boolean;

  /**
   * In compact mode a raw input or unused byproduct is not a node at all: the line becomes a mark
   * on the step's own port icon. `'in'` marks an ingredient, `'out'` a byproduct.
   */
  stub?: 'in' | 'out';
  /** For a stub, whether the raw input was one you chose to supply. */
  manual?: boolean;

  /* --- filled in by the layout --- */
  /** Stroke width, which doubles as the layout weight. */
  w: number;
  /** A cycle-breaking back edge, drawn around the outside. */
  back?: boolean;
  /** Waypoints for a line that crosses more than one column. */
  via: Waypoint[] | null;

  /* --- filled in by the renderer --- */
  /** Cross-axis coordinate where the line leaves its source. */
  sp?: number;
  /** Cross-axis coordinate where it arrives at its target. */
  tp?: number;
  pathElement?: SVGPathElement;
  /** Where a stub's rate label goes: just outside the port icon, pointing away from the node. */
  stubEnd?: { cap: { x: number; y: number }; dir: { x: number; y: number } };
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

export interface BuildGraphOptions {
  /** Draw raw inputs and unused byproducts as marks on the step instead of separate nodes. */
  stubs?: boolean;
}

/** Node id prefixes, which also let the app tell what was clicked. */
export const RAW_PREFIX = 'raw:';
export const TARGET_PREFIX = 'out:';
export const BYPRODUCT_PREFIX = 'sur:';

export function buildGraph(solution: Solution, options: BuildGraphOptions = {}): Graph {
  const nodes = new Map<string, GraphNode>();
  const add = (node: GraphNode): void => void nodes.set(node.id, node);

  for (const step of solution.steps) {
    add({
      id: step.id,
      kind: 'recipe',
      step,
      w: NODE_W,
      h: NODE_H,
      x: 0,
      y: 0,
      inPorts: distinct(
        step.recipe.inputs.filter((io) => (Number(io.amount) || 0) > 0).map((io) => io.item),
      ),
      outPorts: distinct(step.recipe.outputs.map((io) => io.item)),
    });
  }

  for (const raw of solution.raw) {
    add({
      id: RAW_PREFIX + raw.item,
      kind: 'raw',
      item: raw.item,
      rate: raw.rate,
      fluid: raw.fluid,
      manual: raw.manual,
      expandable: raw.expandable,
      w: ITEM_W,
      h: ITEM_H,
      x: 0,
      y: 0,
    });
  }

  for (const target of solution.targets) {
    add({
      id: TARGET_PREFIX + target.item,
      kind: 'out',
      item: target.item,
      rate: target.rate,
      fluid: isFluid(solution, target.item),
      w: ITEM_W,
      h: ITEM_H,
      x: 0,
      y: 0,
    });
  }

  for (const byproduct of solution.surplus) {
    add({
      id: BYPRODUCT_PREFIX + byproduct.item,
      kind: 'sur',
      item: byproduct.item,
      rate: byproduct.rate,
      fluid: byproduct.fluid,
      w: ITEM_W,
      h: ITEM_H,
      x: 0,
      y: 0,
    });
  }

  const edges = buildEdges(solution);
  const graph: Graph = { nodes, edges };
  if (options.stubs) collapseToStubs(graph);
  return graph;
}

interface Endpoint {
  id: string;
  /** Per second through this endpoint. */
  amount: number;
  fluid: boolean;
}

/**
 * One line per producer/consumer pair, carrying that pair's share of the item. A producer making
 * half of the item's supply sends half of each consumer's demand.
 */
function buildEdges(solution: Solution): GraphEdge[] {
  const producers = new Map<ItemKey, Endpoint[]>();
  const consumers = new Map<ItemKey, Endpoint[]>();
  const push = (map: Map<ItemKey, Endpoint[]>, item: ItemKey, endpoint: Endpoint): void => {
    let list = map.get(item);
    if (!list) map.set(item, (list = []));
    list.push(endpoint);
  };

  for (const step of solution.steps) {
    for (const out of step.recipe.outputs) {
      push(producers, out.item, {
        id: step.id,
        amount: expectedAmount(out) * step.rate,
        fluid: !!out.fluid,
      });
    }
    for (const input of step.recipe.inputs) {
      push(consumers, input.item, {
        id: step.id,
        amount: (Number(input.amount) || 0) * step.rate,
        fluid: !!input.fluid,
      });
    }
  }

  for (const raw of solution.raw) {
    push(producers, raw.item, { id: RAW_PREFIX + raw.item, amount: raw.rate, fluid: raw.fluid });
  }
  for (const target of solution.targets) {
    push(consumers, target.item, {
      id: TARGET_PREFIX + target.item,
      amount: target.rate,
      fluid: isFluid(solution, target.item),
    });
  }
  for (const byproduct of solution.surplus) {
    push(consumers, byproduct.item, {
      id: BYPRODUCT_PREFIX + byproduct.item,
      amount: byproduct.rate,
      fluid: byproduct.fluid,
    });
  }

  const edges: GraphEdge[] = [];
  for (const [item, from] of producers) {
    const to = consumers.get(item);
    if (!to) continue;
    const supplied = from.reduce((sum, p) => sum + p.amount, 0);
    if (supplied <= 0) continue;

    for (const producer of from) {
      for (const consumer of to) {
        if (producer.id === consumer.id) continue; // a step feeding itself is not a line
        const flow = (producer.amount * consumer.amount) / supplied;
        if (flow < MIN_FLOW) continue;
        edges.push({
          from: producer.id,
          to: consumer.id,
          item,
          rate: flow,
          fluid: producer.fluid || consumer.fluid,
          w: 2,
          via: null,
        });
      }
    }
  }
  return edges;
}

/**
 * Compact mode: a raw input or unused byproduct that only touches recipe steps need not be a node
 * with a long line crossing the graph. Drop the node and mark the step's own port icon instead.
 * Anything wired straight to a target stays a node, since that line is the point.
 */
function collapseToStubs(graph: Graph): void {
  for (const [id, node] of [...graph.nodes]) {
    if (node.kind !== 'raw' && node.kind !== 'sur') continue;
    const isRaw = node.kind === 'raw';

    const own = graph.edges.filter((e) => (isRaw ? e.from : e.to) === id);
    const onlyTouchesSteps =
      own.length > 0 && own.every((e) => graph.nodes.get(isRaw ? e.to : e.from)?.kind === 'recipe');
    if (!onlyTouchesSteps) continue;

    graph.nodes.delete(id);
    for (const edge of own) {
      edge.stub = isRaw ? 'in' : 'out';
      edge.manual = node.manual;
    }
  }
}

/**
 * Whether an item is a fluid. Targets are stored as bare item keys with no fluid flag, so it has
 * to be read back off whichever recipe mentions the item.
 */
function isFluid(solution: Solution, item: ItemKey): boolean {
  for (const step of solution.steps) {
    for (const io of step.recipe.outputs) if (io.item === item) return !!io.fluid;
    for (const io of step.recipe.inputs) if (io.item === item) return !!io.fluid;
  }
  return solution.raw.find((r) => r.item === item)?.fluid ?? false;
}

function distinct<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
