/**
 * Pointer handling for the graph: dragging nodes, panning, zooming, and the hover card.
 *
 * One gesture covers both dragging and clicking, so nothing is decided until the pointer has
 * either moved far enough to be a drag or come up without moving, which is a click. Dragging a
 * node only redraws the lines, at most once per frame, so it stays smooth on a large plan.
 */
import { edgeCardHtml, nodeCardHtml } from './hover-card';
import type { GraphView, HoverTarget } from './view';

/** Pointer movement, in pixels, before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Dragged nodes snap to this grid, which keeps hand-placed layouts tidy. */
const SNAP = 4;
/** Wheel-to-zoom sensitivity. */
const ZOOM_PER_WHEEL_UNIT = 0.0015;
/** Gap between the pointer and the hover card. */
const TIP_OFFSET = 16;
/** Keep-clear margin at the edges of the graph area. */
const TIP_MARGIN = 8;

type Gesture =
  | {
      mode: 'node';
      element: SVGElement;
      nodeId: string;
      from: { x: number; y: number };
      origin: { x: number; y: number };
      moved: boolean;
    }
  | {
      mode: 'pan';
      from: { x: number; y: number };
      origin: { x: number; y: number };
      moved: boolean;
    };

export function attachInteraction(
  view: GraphView,
  svg: SVGSVGElement,
  tip: HTMLElement | null,
): void {
  let gesture: Gesture | null = null;
  let pendingFrame = 0;

  const hideTip = (): void => {
    if (tip) tip.hidden = true;
  };

  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    hideTip();

    const target = event.target as Element;
    const onButton = target.closest('.g-btn');
    const nodeElement = onButton ? null : target.closest<SVGElement>('.g-node');
    const node = nodeElement && view.graph?.nodes.get(nodeElement.dataset['id']!);

    gesture = node
      ? {
          mode: 'node',
          element: nodeElement!,
          nodeId: node.id,
          from: { x: event.clientX, y: event.clientY },
          origin: { x: node.x, y: node.y },
          moved: false,
        }
      : {
          mode: 'pan',
          from: { x: event.clientX, y: event.clientY },
          origin: { x: view.transform.x, y: view.transform.y },
          moved: false,
        };
    svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener('pointermove', (event) => {
    if (!gesture) {
      updateHover(view, svg, tip, event);
      return;
    }

    const dx = event.clientX - gesture.from.x;
    const dy = event.clientY - gesture.from.y;

    if (!gesture.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
      gesture.moved = true;
      svg.classList.add(gesture.mode === 'node' ? 'dragging' : 'panning');
    }
    if (!gesture.moved) return;
    hideTip();

    if (gesture.mode === 'pan') {
      view.panBy(dx, dy, gesture.origin);
      return;
    }

    const node = view.graph?.nodes.get(gesture.nodeId);
    if (!node) return;
    const k = view.transform.k;
    view.moveNode(
      node,
      Math.round((gesture.origin.x + dx / k) / SNAP) * SNAP,
      Math.round((gesture.origin.y + dy / k) / SNAP) * SNAP,
      gesture.element,
    );

    if (!pendingFrame) {
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        view.drawEdges();
        view.highlight(view.selected);
      });
    }
  });

  const finish = (event: PointerEvent): void => {
    const done = gesture;
    gesture = null;
    svg.classList.remove('panning', 'dragging');
    if (!done) return;

    if (done.moved) {
      if (done.mode !== 'node') return;
      const node = view.graph?.nodes.get(done.nodeId);
      if (!node) return;
      view.drawEdges();
      view.highlight(view.selected);
      view.refreshBounds();
      view.handlers.onMove?.(node.id, { x: node.x, y: node.y }, view.dir);
      return;
    }

    // The pointer did not move: this was a click. Resolve what is under it now.
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const button = target?.closest<HTMLElement>('.g-btn');
    if (button) {
      view.handlers.onAction?.(button.dataset['act']!, button.dataset['arg']!);
      return;
    }
    const port = target?.closest<SVGElement>('.g-port[data-item]');
    const node = target?.closest<SVGElement>('.g-node');
    view.handlers.onSelect?.(port ? port.dataset['item']! : (node?.dataset['id'] ?? null));
  };

  svg.addEventListener('pointerup', finish);
  svg.addEventListener('pointercancel', () => {
    gesture = null;
    svg.classList.remove('panning', 'dragging');
  });

  svg.addEventListener('pointerleave', () => {
    view.setHover(null);
    hideTip();
  });

  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      view.zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * ZOOM_PER_WHEEL_UNIT),
      );
    },
    { passive: false },
  );

  new ResizeObserver(() => view.onResize()).observe(svg);
}

/** Work out what the pointer is over, highlight it, and position the card. */
function updateHover(
  view: GraphView,
  svg: SVGSVGElement,
  tip: HTMLElement | null,
  event: PointerEvent,
): void {
  const graph = view.graph;
  const target = event.target as Element;

  // A marked port stands in for a stub line, so it reports the line, not the node.
  const port = target.closest<SVGElement>('.g-port[data-item]');
  const nodeElement = port ? null : target.closest<SVGElement>('.g-node');
  const edgeElement = port || nodeElement ? null : target.closest<SVGElement>('.g-edge');

  let hover: HoverTarget | null = null;
  let html = '';

  if (graph && (port || edgeElement)) {
    const index = Number((port ?? edgeElement)!.dataset['e']);
    const edge = graph.edges[index];
    if (edge) {
      hover = { kind: 'edge', id: index };
      html = edgeCardHtml(edge, graph);
    }
  } else if (graph && nodeElement) {
    const node = graph.nodes.get(nodeElement.dataset['id']!);
    if (node) {
      hover = { kind: 'node', id: node.id };
      // Hovering a button shows its own tooltip rather than the node's card.
      if (!target.closest('.g-btn')) html = nodeCardHtml(node);
    }
  }

  view.setHover(hover);
  if (!tip) return;
  if (!hover || !html) {
    tip.hidden = true;
    return;
  }

  const key = `${hover.kind}:${hover.id}`;
  if (tip.dataset['key'] !== key) {
    tip.innerHTML = html;
    tip.dataset['key'] = key;
  }
  tip.hidden = false;
  positionTip(tip, svg, event);
}

/** Below and right of the pointer, flipped or clamped when that would run off the edge. */
function positionTip(tip: HTMLElement, svg: SVGSVGElement, event: PointerEvent): void {
  const area = svg.parentElement?.getBoundingClientRect();
  if (!area) return;

  let x = event.clientX - area.left + TIP_OFFSET;
  let y = event.clientY - area.top + TIP_OFFSET;

  if (x + tip.offsetWidth > area.width - TIP_MARGIN) {
    x = event.clientX - area.left - tip.offsetWidth - TIP_OFFSET;
  }
  if (y + tip.offsetHeight > area.height - TIP_MARGIN) {
    y = Math.max(TIP_MARGIN, area.height - tip.offsetHeight - TIP_MARGIN);
  }

  tip.style.left = `${Math.max(TIP_MARGIN, x)}px`;
  tip.style.top = `${y}px`;
}
