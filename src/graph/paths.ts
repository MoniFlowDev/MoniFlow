/**
 * Drawing the lines.
 *
 * A short line is a single bezier between its two ports, with its control points along the flow
 * axis so it leaves and arrives square to the node. A long line follows the corridors the layout
 * reserved for it, which is what keeps it out of the nodes in between — but only while those
 * corridors still make sense, since dragging a node can leave them behind, and then a direct curve
 * is better than a detour. A line that goes backwards is a recycling loop, and routes around the
 * outside of both nodes.
 */
import type { DirectionSpec } from './directions';
import type { GraphEdge, GraphNode } from './model';

interface Point {
  x: number;
  y: number;
}

/** Below this, two points count as level and the segment between them is drawn straight. */
const STRAIGHT_TOLERANCE = 0.5;
/** Minimum flow-axis run in and out of a corridor for the detour to be worth taking. */
const MIN_CORRIDOR_RUN = 20;
/** How far back a target can be before the line is treated as a loop. */
const LOOP_THRESHOLD = 80;
/** Minimum reach of a bezier control point. */
const MIN_CONTROL = 50;
/** How far outside the nodes a loop is routed. */
const LOOP_CLEARANCE = 60;
const LOOP_CONTROL = 120;
const LOOP_CONTROL_VERTICAL = 100;

/** A smooth path through a list of points, with tangents along the flow axis. */
export function flowPath(points: readonly Point[], dir: DirectionSpec): string {
  let d = `M${points[0]!.x},${points[0]!.y}`;

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]!;
    const to = points[i]!;
    const level = dir.horizontal
      ? Math.abs(from.y - to.y) < STRAIGHT_TOLERANCE
      : Math.abs(from.x - to.x) < STRAIGHT_TOLERANCE;

    if (level) {
      d += ` L${to.x},${to.y}`;
    } else if (dir.horizontal) {
      const reach = (to.x - from.x) / 2;
      d += ` C${from.x + reach},${from.y} ${to.x - reach},${to.y} ${to.x},${to.y}`;
    } else {
      const reach = (to.y - from.y) / 2;
      d += ` C${from.x},${from.y + reach} ${to.x},${to.y - reach} ${to.x},${to.y}`;
    }
  }
  return d;
}

export function edgePath(
  from: GraphNode,
  to: GraphNode,
  edge: GraphEdge,
  dir: DirectionSpec,
): string {
  const start = startPoint(from, edge, dir);
  const end = endPoint(to, edge, dir);

  const viaCorridors = corridorPath(start, end, edge, dir);
  if (viaCorridors) return viaCorridors;

  return dir.horizontal
    ? horizontalPath(start, end, from, to)
    : verticalPath(start, end, from, to, dir);
}

function startPoint(node: GraphNode, edge: GraphEdge, dir: DirectionSpec): Point {
  if (dir.horizontal) return { x: node.x + node.w, y: edge.sp! };
  return { x: edge.sp!, y: dir.flip ? node.y : node.y + node.h };
}

function endPoint(node: GraphNode, edge: GraphEdge, dir: DirectionSpec): Point {
  if (dir.horizontal) return { x: node.x, y: edge.tp! };
  return { x: edge.tp!, y: dir.flip ? node.y + node.h : node.y };
}

/**
 * Route through the reserved corridors, if they are still usable: every point has to keep moving
 * forward along the flow axis, and there must be real distance into the first corridor and out of
 * the last — otherwise the detour looks like a kink rather than a route.
 */
function corridorPath(
  start: Point,
  end: Point,
  edge: GraphEdge,
  dir: DirectionSpec,
): string | null {
  if (!edge.via?.length || !edge.via.every((waypoint) => waypoint.seg)) return null;

  const points: Point[] = [start];
  for (const waypoint of edge.via) {
    const seg = waypoint.seg!;
    points.push({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
  }
  points.push(end);

  const sign = dir.horizontal ? 1 : dir.flip ? -1 : 1;
  const along = (p: Point): number => (dir.horizontal ? p.x : p.y * sign);

  for (let i = 1; i < points.length; i++) {
    if (along(points[i]!) < along(points[i - 1]!) - STRAIGHT_TOLERANCE) return null;
  }
  const entersCleanly = along(points[1]!) - along(start) > MIN_CORRIDOR_RUN;
  const exitsCleanly = along(end) - along(points[points.length - 2]!) > MIN_CORRIDOR_RUN;
  if (!entersCleanly || !exitsCleanly) return null;

  return flowPath(points, dir);
}

function horizontalPath(start: Point, end: Point, from: GraphNode, to: GraphNode): string {
  if (end.x > start.x - LOOP_THRESHOLD) {
    const reach = Math.max(MIN_CONTROL, Math.abs(end.x - start.x) * 0.5);
    return `M${start.x},${start.y} C${start.x + reach},${start.y} ${end.x - reach},${end.y} ${end.x},${end.y}`;
  }
  // A loop: route underneath both nodes.
  const below = Math.max(from.y + from.h, to.y + to.h) + LOOP_CLEARANCE;
  return (
    `M${start.x},${start.y} ` +
    `C${start.x + LOOP_CONTROL},${start.y} ${start.x + LOOP_CONTROL},${below} ${(start.x + end.x) / 2},${below} ` +
    `S${end.x - LOOP_CONTROL},${end.y} ${end.x},${end.y}`
  );
}

function verticalPath(
  start: Point,
  end: Point,
  from: GraphNode,
  to: GraphNode,
  dir: DirectionSpec,
): string {
  const sign = dir.flip ? -1 : 1;

  if ((end.y - start.y) * sign > -LOOP_THRESHOLD) {
    const reach = Math.max(MIN_CONTROL, Math.abs(end.y - start.y) * 0.5);
    return (
      `M${start.x},${start.y} ` +
      `C${start.x},${start.y + sign * reach} ${end.x},${end.y - sign * reach} ${end.x},${end.y}`
    );
  }
  // A loop: route to the right of both nodes.
  const beside = Math.max(from.x + from.w, to.x + to.w) + LOOP_CLEARANCE;
  const bend = sign * LOOP_CONTROL_VERTICAL;
  return (
    `M${start.x},${start.y} ` +
    `C${start.x},${start.y + bend} ${beside},${start.y + bend} ${beside},${(start.y + end.y) / 2} ` +
    `S${end.x},${end.y - bend} ${end.x},${end.y}`
  );
}
