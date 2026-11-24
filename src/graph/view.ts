/**
 * The flow graph on screen: rendering, pan and zoom, selection and highlighting.
 *
 * Rendering happens in three layers — lines under nodes, nodes, then rate labels on top — because
 * lines and labels are redrawn on their own whenever a node is dragged, without rebuilding the
 * nodes. Pointer handling lives next door in `interaction.ts` and drives this class through its
 * public methods.
 */
import { formatRate } from '../core/format';
import { itemName } from '../core/item-names';
import type { GraphDirection, Project } from '../core/types';
import { itemLineColor } from '../icons/line-color';
import type { Solution } from '../solver/solve';
import { assignCoordinates, computeBounds, resolveOverlaps, type Bounds } from './coordinates';
import { DEFAULT_DIRECTION, directionSpec, isDirection, type DirectionSpec } from './directions';
import { exportGraphSvg } from './export-svg';
import { layoutGraph, type Layout } from './layout';
import { buildGraph, NODE_H, NODE_W, type Graph, type GraphEdge, type GraphNode } from './model';
import { drawNode, placePorts, sizeForPorts } from './node-renderer';
import { edgePath } from './paths';
import { edgeHeading, markStubPort, portCoord, sortPorts, spreadPorts } from './ports';
import { drawItemIcon, el } from './svg';

/** Line thickness: a floor so every line is visible, plus a share by rate. */
const MIN_EDGE_WIDTH = 2;
const EDGE_WIDTH_RANGE = 12;

/** Zoom limits, and how fast the wheel zooms. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 3;

/** Padding left around the drawing when fitting it to the viewport. */
const FIT_PADDING = 50;
/** Room reserved at the bottom for the legend overlay. */
const LEGEND_HEIGHT = 30;
/** Never zoom in past this when fitting, or a two-node plan fills the screen. */
const MAX_FIT_ZOOM = 1.1;

/** Fractions along a line to try placing its rate label, best first. */
const LABEL_POSITIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
const LABEL_HEIGHT = 20;
/** Rough label width per character, plus room for the icon badge. */
const LABEL_CHAR_WIDTH = 6.1;
const LABEL_EXTRA_WIDTH = 30;
/** Longest item name shown on a line label. */
const LABEL_NAME_CHARS = 20;

export interface GraphViewHandlers {
  onSelect?: (id: string | null) => void;
  onAction?: (action: string, argument: string) => void;
  onMove?: (id: string, position: { x: number; y: number }, dir: GraphDirection) => void;
}

/** What the pointer is over: a node, or an edge by its index. */
export type HoverTarget = { kind: 'node'; id: string } | { kind: 'edge'; id: number };

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class GraphView {
  readonly transform = { x: 0, y: 0, k: 1 };
  bounds: Bounds | null = null;
  graph: Graph | null = null;
  dir: GraphDirection = DEFAULT_DIRECTION;

  /** Draw raw inputs and unused byproducts as marks on the step instead of separate nodes. */
  stubs = true;
  /** Show every line's rate, rather than only on hover or selection. */
  showLabels = false;

  selected: string | null = null;
  hover: HoverTarget | null = null;
  handlers: GraphViewHandlers = {};

  private svg: SVGSVGElement | null = null;
  private root: SVGGElement | null = null;
  private edgeLayer: SVGGElement | null = null;
  private labelLayer: SVGGElement | null = null;
  private layout: Layout | null = null;
  /** The last rendered node set, so the view only re-fits when the shape of the plan changes. */
  private lastShape = '';
  /** A fit was requested while the viewport had no size yet. */
  private refitWhenSized = false;

  attach(svg: SVGSVGElement, handlers: GraphViewHandlers): void {
    this.svg = svg;
    this.handlers = handlers;
  }

  get element(): SVGSVGElement | null {
    return this.svg;
  }

  get spec(): DirectionSpec {
    return directionSpec(this.dir);
  }

  /** Forget which plan was last drawn, so the next render re-fits the view. */
  resetViewMemory(): void {
    this.lastShape = '';
  }

  /** Draw the solution. Returns false when there is nothing to draw. */
  render(solution: Solution, project: Project): boolean {
    const svg = this.svg;
    if (!svg) return false;

    svg.replaceChildren();
    addDropShadow(svg);
    this.root = el('g', null, svg);

    const graph = buildGraph(solution, { stubs: this.stubs });
    if (!graph.nodes.size) {
      this.bounds = null;
      this.graph = null;
      return false;
    }

    this.dir = isDirection(project.graphDir) ? project.graphDir : DEFAULT_DIRECTION;
    const dir = this.spec;

    for (const node of graph.nodes.values()) {
      if (node.kind === 'recipe') sizeForPorts(node, dir, NODE_W, NODE_H);
    }
    setEdgeWidths(graph.edges);

    const layout = layoutGraph(graph);
    assignCoordinates(layout, dir);
    this.applyPinnedPositions(graph, project, dir);

    this.layout = layout;
    this.graph = graph;
    this.bounds = computeBounds(graph);

    this.edgeLayer = el('g', null, this.root);
    const nodeLayer = el('g', null, this.root);
    this.labelLayer = el('g', null, this.root);
    for (const node of graph.nodes.values()) drawNode(nodeLayer, node, dir);
    this.drawEdges();

    // Re-fit only when the plan's shape changed; otherwise keep where the user had panned to.
    const shape = `${this.dir}#${[...graph.nodes.keys()].sort().join('|')}`;
    if (shape !== this.lastShape) {
      this.lastShape = shape;
      this.fit();
    } else {
      this.applyTransform();
    }
    this.highlight(this.selected);
    return true;
  }

  /** Positions you dragged win over the automatic layout; everything else moves out of the way. */
  private applyPinnedPositions(graph: Graph, project: Project, dir: DirectionSpec): void {
    const pinned = project.graphPos?.[this.dir] ?? {};
    let any = false;
    for (const [id, node] of graph.nodes) {
      const position = pinned[id];
      if (!position) continue;
      node.x = position.x;
      node.y = position.y;
      node.pinned = true;
      any = true;
    }
    if (any) resolveOverlaps(graph, dir);
  }

  /** Redraw the lines and labels from the current node positions. */
  drawEdges(): void {
    const graph = this.graph;
    const layout = this.layout;
    if (!graph || !layout || !this.edgeLayer || !this.labelLayer) return;
    const dir = this.spec;

    this.edgeLayer.replaceChildren();
    this.labelLayer.replaceChildren();

    // Order the port icons by where their lines go, then move them to their new slots.
    sortPorts(graph, layout, dir);
    for (const node of graph.nodes.values()) {
      if (node.kind === 'recipe' && node.portElements) placePorts(node, dir);
    }
    this.placeEndpoints(graph, layout, dir);

    graph.edges.forEach((edge, index) => {
      if (edge.stub) {
        markStubPort(graph, edge, index, dir);
        return;
      }
      const from = graph.nodes.get(edge.from);
      const to = graph.nodes.get(edge.to);
      if (!from || !to) return;

      const color = itemLineColor(edge.item, edge.fluid);
      const d = edgePath(from, to, edge, dir);
      const group = el(
        'g',
        { class: 'g-edge', 'data-from': edge.from, 'data-to': edge.to, 'data-e': index },
        this.edgeLayer,
      );
      // A wide invisible stroke underneath makes a thin line easy to hover.
      el('path', { d, class: 'hit', 'stroke-width': Math.max(10, edge.w + 6) }, group);
      edge.pathElement = el(
        'path',
        { d, class: 'flow', stroke: color, 'stroke-width': edge.w },
        group,
      );
      el(
        'path',
        { d, class: 'anim', 'stroke-width': Math.max(1.5, edge.w * 0.35), stroke: color },
        group,
      );
    });

    this.drawLabels();
    this.applyHover();
  }

  /** Decide where every line meets its two nodes. */
  private placeEndpoints(graph: Graph, layout: Layout, dir: DirectionSpec): void {
    for (const [id, node] of graph.nodes) {
      const outgoing = layout.outgoing.get(id) ?? [];
      const incoming = layout.incoming.get(id) ?? [];

      if (node.kind === 'recipe') {
        // Each line attaches at its item's own port icon.
        for (const edge of outgoing) edge.sp = portCoord(node, edge.item, true, dir);
        for (const edge of incoming) edge.tp = portCoord(node, edge.item, false, dir);
        continue;
      }
      // An item node has no icons, so spread the lines along its edge, ordered by where they head.
      const byHeading = (fromStart: boolean) => (a: GraphEdge, b: GraphEdge) =>
        edgeHeading(graph, a, fromStart, dir) - edgeHeading(graph, b, fromStart, dir);
      spreadPorts([...outgoing].sort(byHeading(true)), node, 'sp', dir);
      spreadPorts([...incoming].sort(byHeading(false)), node, 'tp', dir);
    }

    // Stubs have only one real end.
    for (const edge of graph.edges) {
      if (edge.stub === 'in') {
        const node = graph.nodes.get(edge.to);
        if (node) edge.tp = portCoord(node, edge.item, false, dir);
      } else if (edge.stub === 'out') {
        const node = graph.nodes.get(edge.from);
        if (node) edge.sp = portCoord(node, edge.item, true, dir);
      }
    }
  }

  /**
   * Rate labels. Each is tried at a few points along its line and takes the least crowded spot,
   * counting the nodes and the labels already placed. Thickest lines are placed first, since they
   * are the ones most worth reading.
   */
  private drawLabels(): void {
    const graph = this.graph;
    if (!graph || !this.labelLayer) return;

    const taken: Rect[] = [...graph.nodes.values()].map((node) => ({
      x: node.x - 4,
      y: node.y - 4,
      w: node.w + 8,
      h: node.h + 8,
    }));
    const crowding = (rect: Rect): number => taken.filter((other) => overlaps(rect, other)).length;

    const byWidth = [...graph.edges].sort((a, b) => b.w - a.w);
    for (const edge of byWidth) {
      if (edge.stub && !edge.stubEnd) continue;

      const label = `${truncateName(edge.item)}  ${formatRate(edge.rate, edge.fluid)}`;
      const width = label.length * LABEL_CHAR_WIDTH + LABEL_EXTRA_WIDTH;
      const spot = edge.stub
        ? stubLabelSpot(edge, width, crowding)
        : lineLabelSpot(edge, width, crowding);
      if (!spot) continue;

      taken.push(spot.rect);
      drawLabel(this.labelLayer, graph, edge, label, spot);
    }
  }

  /* ------------------------------ selection and hover ------------------------------ */

  highlight(id: string | null): void {
    this.selected = id;
    if (!this.root) return;

    const connected = new Set<string>();
    if (id) {
      connected.add(id);
      this.root.querySelectorAll<SVGElement>('.g-edge').forEach((edge) => {
        if (edge.dataset['from'] === id) connected.add(edge.dataset['to']!);
        if (edge.dataset['to'] === id) connected.add(edge.dataset['from']!);
      });
    }

    this.root.querySelectorAll<SVGElement>('.g-node').forEach((node) => {
      node.classList.toggle('selected', node.dataset['id'] === id);
      node.classList.toggle('dim', !!id && !connected.has(node.dataset['id']!));
    });
    this.root.querySelectorAll<SVGElement>('.g-edge, .g-label').forEach((element) => {
      const attached = !!id && (element.dataset['from'] === id || element.dataset['to'] === id);
      element.classList.toggle('dim', !!id && !attached && element.classList.contains('g-edge'));
      element.classList.toggle('sel', attached);
    });
  }

  setLabels(always: boolean): void {
    this.showLabels = always;
    this.svg?.parentElement?.classList.toggle('labels-always', always);
  }

  setHover(target: HoverTarget | null): void {
    const same =
      this.hover === target ||
      (!!target && !!this.hover && target.kind === this.hover.kind && target.id === this.hover.id);
    if (same) return;
    this.hover = target;
    this.applyHover();
  }

  /** Light up what the pointer is over, plus whatever it connects to. */
  applyHover(): void {
    if (!this.root) return;
    this.root.querySelectorAll('.hot').forEach((node) => node.classList.remove('hot'));

    const target = this.hover;
    this.svg?.classList.toggle('hovering', !!target);
    if (!target) return;

    const mark = (selector: string): void =>
      this.root!.querySelectorAll(selector).forEach((node) => node.classList.add('hot'));

    if (target.kind === 'node') {
      mark(`.g-node[data-id="${cssEscape(target.id)}"]`);
      this.root.querySelectorAll<SVGElement>('.g-edge, .g-label').forEach((element) => {
        const from = element.dataset['from'];
        const to = element.dataset['to'];
        if (from !== target.id && to !== target.id) return;
        element.classList.add('hot');
        mark(`.g-node[data-id="${cssEscape(from === target.id ? to! : from!)}"]`);
      });
      return;
    }

    mark(`[data-e="${target.id}"]`);
    const edge = this.graph?.edges[target.id];
    if (!edge) return;
    mark(`.g-node[data-id="${cssEscape(edge.from)}"]`);
    mark(`.g-node[data-id="${cssEscape(edge.to)}"]`);
  }

  /* ------------------------------ pan and zoom ------------------------------ */

  applyTransform(): void {
    this.root?.setAttribute(
      'transform',
      `translate(${this.transform.x},${this.transform.y}) scale(${this.transform.k})`,
    );
  }

  /** Zoom about a point in viewport coordinates, keeping that point still. */
  zoomAt(px: number, py: number, factor: number): void {
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.transform.k * factor));
    const applied = scale / this.transform.k;
    this.transform.x = px - (px - this.transform.x) * applied;
    this.transform.y = py - (py - this.transform.y) * applied;
    this.transform.k = scale;
    this.applyTransform();
  }

  zoomBy(factor: number): void {
    if (!this.svg) return;
    const rect = this.svg.getBoundingClientRect();
    this.zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  panBy(dx: number, dy: number, from: { x: number; y: number }): void {
    this.transform.x = from.x + dx;
    this.transform.y = from.y + dy;
    this.applyTransform();
  }

  fit(): void {
    if (!this.bounds || !this.svg) return;
    const rect = this.svg.getBoundingClientRect();
    // The viewport has no size yet (a hidden tab); fit once it does.
    if (rect.width < 10 || rect.height < 10) {
      this.refitWhenSized = true;
      return;
    }
    this.refitWhenSized = false;

    const bounds = this.bounds;
    const scale = Math.min(
      MAX_FIT_ZOOM,
      (rect.width - FIT_PADDING * 2) / Math.max(1, bounds.width),
      (rect.height - FIT_PADDING * 2 - LEGEND_HEIGHT) / Math.max(1, bounds.height),
    );
    this.transform.k = Math.max(MIN_ZOOM, scale);
    this.transform.x =
      (rect.width - bounds.width * this.transform.k) / 2 - bounds.minX * this.transform.k;
    this.transform.y =
      (rect.height - LEGEND_HEIGHT - bounds.height * this.transform.k) / 2 -
      bounds.minY * this.transform.k;
    this.applyTransform();
  }

  /** Called when the viewport resizes, in case a fit was deferred. */
  onResize(): void {
    if (this.bounds && this.refitWhenSized) this.fit();
  }

  /** Pan so a node is fully visible — used when selecting one from a table. */
  ensureVisible(id: string): void {
    const node = this.graph?.nodes.get(id);
    if (!node || !this.svg) return;
    const rect = this.svg.getBoundingClientRect();
    if (rect.width < 10) return;

    const k = this.transform.k;
    const left = node.x * k + this.transform.x;
    const top = node.y * k + this.transform.y;
    const right = left + node.w * k;
    const bottom = top + node.h * k;
    if (left >= 0 && top >= 0 && right <= rect.width && bottom <= rect.height) return;

    this.transform.x = rect.width / 2 - (node.x + node.w / 2) * k;
    this.transform.y = rect.height / 2 - (node.y + node.h / 2) * k;
    this.applyTransform();
  }

  /** Move a node to new graph coordinates and redraw what depends on it. */
  moveNode(node: GraphNode, x: number, y: number, element: SVGElement): void {
    node.x = x;
    node.y = y;
    element.setAttribute('transform', `translate(${x},${y})`);
  }

  /** Recompute the bounds after a drag, so fitting and export stay correct. */
  refreshBounds(): void {
    if (this.graph) this.bounds = computeBounds(this.graph);
  }

  exportSvg(): string | null {
    if (!this.bounds || !this.svg) return null;
    return exportGraphSvg(this.svg, this.bounds);
  }
}

/* ------------------------------ helpers ------------------------------ */

function addDropShadow(svg: SVGSVGElement): void {
  const defs = el('defs', null, svg);
  const filter = el(
    'filter',
    { id: 'shadow', x: '-20%', y: '-20%', width: '140%', height: '160%' },
    defs,
  );
  el(
    'feDropShadow',
    { dx: 0, dy: 3, stdDeviation: 5, 'flood-color': '#000', 'flood-opacity': 0.45 },
    filter,
  );
}

/**
 * Line thickness from rate. Items and fluids are normalised separately, since a recipe moving
 * 1000 mB of a fluid and one moving a single item are comparable in importance. The square root
 * keeps a 100x rate difference from producing a 100x thicker line.
 */
function setEdgeWidths(edges: readonly GraphEdge[]): void {
  const peak = (fluid: boolean): number =>
    Math.max(1e-9, ...edges.filter((e) => e.fluid === fluid).map((e) => e.rate));
  const maxItem = peak(false);
  const maxFluid = peak(true);

  for (const edge of edges) {
    const share = edge.rate / (edge.fluid ? maxFluid : maxItem);
    edge.w = MIN_EDGE_WIDTH + EDGE_WIDTH_RANGE * Math.sqrt(share);
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function truncateName(item: string): string {
  const name = itemName(item);
  return name.length > LABEL_NAME_CHARS ? `${name.slice(0, LABEL_NAME_CHARS - 1)}…` : name;
}

interface LabelSpot {
  rect: Rect;
  centre: { x: number; y: number };
  crowded: number;
}

/** A stub's label sits just outside its port icon, pointing away from the node. */
function stubLabelSpot(
  edge: GraphEdge,
  width: number,
  crowding: (rect: Rect) => number,
): LabelSpot | null {
  const end = edge.stubEnd;
  if (!end) return null;
  const { cap, dir } = end;

  const rect: Rect = {
    x: dir.x < 0 ? cap.x - 6 - width : dir.x > 0 ? cap.x + 6 : cap.x - width / 2,
    y: dir.y < 0 ? cap.y - 6 - LABEL_HEIGHT : dir.y > 0 ? cap.y + 6 : cap.y - LABEL_HEIGHT / 2,
    w: width,
    h: LABEL_HEIGHT,
  };
  return {
    rect,
    centre: { x: rect.x + width / 2, y: rect.y + LABEL_HEIGHT / 2 },
    crowded: crowding(rect),
  };
}

function lineLabelSpot(
  edge: GraphEdge,
  width: number,
  crowding: (rect: Rect) => number,
): LabelSpot | null {
  const path = edge.pathElement;
  const length = path?.getTotalLength?.() ?? 0;
  if (!path || !length) return null;

  let best: LabelSpot | null = null;
  for (const fraction of LABEL_POSITIONS) {
    const point = path.getPointAtLength(length * fraction);
    const rect: Rect = {
      x: point.x - width / 2,
      y: point.y - LABEL_HEIGHT / 2,
      w: width,
      h: LABEL_HEIGHT,
    };
    const crowded = crowding(rect);
    if (!best || crowded < best.crowded) best = { rect, centre: point, crowded };
    if (crowded === 0) break;
  }
  return best;
}

/**
 * Each label is both a full pill (icon, name and rate) and a bare icon badge. Which one shows is
 * up to CSS: the pill on hover, on selection, or with "All rates" on; the badge the rest of the
 * time, so you can still see what a line carries.
 */
function drawLabel(
  layer: SVGGElement,
  graph: Graph,
  edge: GraphEdge,
  label: string,
  spot: LabelSpot,
): void {
  const group = el(
    'g',
    {
      class: `g-label${spot.crowded ? ' crowded' : ''}`,
      'data-from': edge.from,
      'data-to': edge.to,
      'data-e': graph.edges.indexOf(edge),
    },
    layer,
  );

  const full = el('g', { class: 'lbl-full' }, group);
  el(
    'rect',
    { x: spot.rect.x, y: spot.rect.y, width: spot.rect.w, height: spot.rect.h, rx: 9 },
    full,
  );
  el('text', { x: spot.rect.x + 25, y: spot.centre.y + 3.5 }, full).textContent = label;

  const iconX = spot.rect.x + 3;
  const iconY = spot.centre.y - 8;

  // A stub's port icon is already right there, so it needs no badge of its own.
  if (edge.stub) {
    drawItemIcon(full, edge.item, edge.fluid, iconX, iconY, 16);
    return;
  }

  const badge = el('g', { class: 'lbl-icon' }, group);
  el('circle', { cx: spot.rect.x + 11, cy: spot.centre.y, r: 11 }, badge);
  drawItemIcon(badge, edge.item, edge.fluid, iconX, iconY, 16);
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}
