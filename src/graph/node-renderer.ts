/**
 * Drawing one node.
 *
 * A recipe node has to say a lot in 224 by 70 pixels: which machine, at what tier, what it makes,
 * how many you need, how much power it draws, how busy it will be, and one icon per ingredient and
 * product. Everything is sized from the node's own width so it still works when the node grows to
 * fit more ports.
 */
import { tier as tierAt } from '../data/tiers';
import { formatEut, formatNumber, formatRate } from '../core/format';
import { itemNameRaw } from '../core/item-names';
import type { ItemKey } from '../core/types';
import { icons } from '../icons/icon-store';
import { stepTitleOptions } from '../solver/step-title';
import type { SolvedStep } from '../solver/solve';
import type { DirectionSpec } from './directions';
import type { GraphNode, ItemNode, RecipeNode } from './model';
import { portPoint, PORT_STEP } from './ports';
import { button, drawItemIcon, el, fitTitle, formattedText, text, truncate } from './svg';

/** Stand-in tier badges for steps that have no voltage tier. */
const INSTANT_BADGE = { name: 'CRAFT', color: '#8fa8c0' };
const UNPOWERED_BADGE = { name: 'NO EU', color: '#8fa8c0' };

const COLORS = {
  raw: '#8fa8c0',
  manual: '#b48cff',
  target: '#5fd38d',
  byproduct: '#b48cff',
  machines: '#ffb347',
  label: '#9fb0c2',
  muted: '#6d8197',
  body: '#c9d6e3',
  bright: '#e3ebf3',
  bad: '#ff6b6b',
  track: '#0e141b',
};

/** Utilisation bar colours: comfortable, tight, wasteful. */
const UTILISATION_COLORS = { high: '#5fd38d', medium: '#ffcf5c', low: '#ff8c3a' };

const MONO = 'Consolas, monospace';

/** Horizontal padding inside a node; vertical layouts need less, as ports sit above and below. */
const PAD_HORIZONTAL = 16;
const PAD_VERTICAL = 10;

export function drawNode(
  layer: SVGElement,
  node: GraphNode,
  dir: DirectionSpec,
): void {
  const group = el(
    'g',
    { class: `g-node g-node-${node.kind}`, 'data-id': node.id, transform: `translate(${node.x},${node.y})` },
    layer,
  );

  // A clip path keeps the tier stripe, header tint and utilisation bar inside the rounded corners.
  const clipId = `clip-${node.id.replace(/[^a-z0-9_-]/gi, '_')}`;
  const clipPath = el('clipPath', { id: clipId }, group);
  el('rect', { width: node.w, height: node.h, rx: 8 }, clipPath);
  const clip = `url(#${clipId})`;

  if (node.kind === 'recipe') drawRecipeNode(group, node, clip, dir);
  else drawItemNode(group, node, clip);
}

function drawRecipeNode(
  group: SVGGElement,
  node: RecipeNode,
  clip: string,
  dir: DirectionSpec,
): void {
  const step = node.step;
  const { w: width, h: height } = node;
  const unpowered = !step.instant && !(step.recipe.eut > 0);
  const badge = step.instant
    ? INSTANT_BADGE
    : unpowered
      ? UNPOWERED_BADGE
      : tierAt(step.settings.tier);
  const broken = step.oc.errors.length > 0;

  el(
    'rect',
    {
      class: 'card',
      width,
      height,
      rx: 8,
      filter: 'url(#shadow)',
      stroke: broken ? COLORS.bad : null,
    },
    group,
  );
  el('rect', { width, height: 22, fill: badge.color, opacity: 0.16, 'clip-path': clip }, group);
  el('rect', { width: 3, height, fill: badge.color, 'clip-path': clip }, group);

  const padLeft = dir.horizontal ? PAD_HORIZONTAL : PAD_VERTICAL;
  const padRight = padLeft;

  drawHeader(group, node, badge, broken, padLeft, padRight);
  const titleRoom = drawByproductPill(group, step, width, padLeft, padRight);
  drawTitle(group, step, padLeft, titleRoom);
  drawNumbers(group, step, { width, height, unpowered, padLeft, padRight, clip });
  drawPorts(group, node, dir);
}

/** Machine icon, tier badge and machine name along the top. */
function drawHeader(
  group: SVGGElement,
  node: RecipeNode,
  badge: { name: string; color: string },
  broken: boolean,
  padLeft: number,
  padRight: number,
): void {
  const step = node.step;
  let x = padLeft;

  const machineIcon = icons.machineKey(step.recipe, step.instant ? null : step.settings.tier);
  if (machineIcon && icons.svg(group, machineIcon, x, 3, 16)) x += 20;

  text(group, x, 15, badge.name, {
    'font-size': 10.5,
    'font-weight': 700,
    fill: badge.color,
    'font-family': MONO,
  });
  x += badge.name.length * 7 + 6;

  // Whatever is left after the icon, badge, warning glyph and hide button.
  const extraPad = padRight - PAD_VERTICAL;
  const room = Math.max(6, Math.floor((node.w - x - (broken ? 44 : 28) - extraPad) / 6.2));
  text(group, x, 15, truncate(step.recipe.machine, room), { 'font-size': 11, fill: COLORS.body });

  if (broken) {
    text(group, node.w - 30 - extraPad, 16, '⚠', {
      'font-size': 12,
      fill: COLORS.bad,
      'text-anchor': 'end',
    });
  }
  button(
    group,
    node.w - 22 - extraPad,
    2,
    '−',
    'hide',
    node.id,
    'Hide this chain: supply its product as a raw input',
    18,
  );
}

/** A "+N" pill for outputs the plan does not use. Returns the room left for the title. */
function drawByproductPill(
  group: SVGGElement,
  step: SolvedStep,
  width: number,
  padLeft: number,
  padRight: number,
): number {
  const room = width - padLeft - padRight;

  const spare = step.spareOutputs.length;
  if (!spare) return room;

  const label = `+${spare}`;
  const pillWidth = label.length * 6 + 8;
  const pill = el('g', { class: 'g-spare' }, group);
  el(
    'rect',
    {
      x: width - padRight - pillWidth,
      y: 30,
      width: pillWidth,
      height: 15,
      rx: 7.5,
      fill: COLORS.byproduct,
      'fill-opacity': 0.16,
      stroke: COLORS.byproduct,
      'stroke-opacity': 0.5,
    },
    pill,
  );
  text(pill, width - padRight - pillWidth / 2, 41, label, {
    'font-size': 9.5,
    'font-weight': 700,
    fill: '#c9b0ff',
    'text-anchor': 'middle',
  });

  return room - pillWidth - 5;
}

function drawTitle(group: SVGGElement, step: SolvedStep, padLeft: number, room: number): void {
  const fitted = fitTitle(stepTitleOptions(step, true), room);
  formattedText(group, padLeft, 41, fitted.text, fitted.chars, {
    'font-size': fitted.size,
    'font-weight': 600,
  });
}

/** Machine count, power, and the utilisation bar along the bottom edge. */
interface NumbersLayout {
  width: number;
  height: number;
  unpowered: boolean;
  padLeft: number;
  padRight: number;
  clip: string;
}

function drawNumbers(group: SVGGElement, step: SolvedStep, at: NumbersLayout): void {
  const { width, height, unpowered, padLeft, padRight, clip } = at;

  if (step.instant) {
    text(group, padLeft, 60, `${formatRate(step.rate)} crafts`, {
      'font-size': 12,
      'font-weight': 700,
      fill: COLORS.raw,
      'font-family': MONO,
    });
    text(group, width - padRight, 60, 'instant', {
      'font-size': 10.5,
      fill: COLORS.muted,
      'text-anchor': 'end',
    });
    return;
  }

  const count = `×${formatNumber(step.machines, 2)}`;
  text(group, padLeft, 60, count, {
    'font-size': 13,
    'font-weight': 700,
    fill: COLORS.machines,
    'font-family': MONO,
  });
  text(group, padLeft + count.length * 8 + 5, 60, `build ${step.built}`, {
    'font-size': 10.5,
    fill: COLORS.label,
  });
  text(group, width - padRight, 60, unpowered ? 'no power' : formatEut(step.avgEut), {
    'font-size': 10.5,
    fill: unpowered ? COLORS.muted : COLORS.bright,
    'text-anchor': 'end',
    'font-family': MONO,
  });

  const busy = Math.min(1, step.utilization);
  const barColor =
    busy > 0.85
      ? UTILISATION_COLORS.high
      : busy > 0.5
        ? UTILISATION_COLORS.medium
        : UTILISATION_COLORS.low;
  el('rect', { x: 0, y: height - 3, width, height: 3, fill: COLORS.track, 'clip-path': clip }, group);
  el('rect', { x: 0, y: height - 3, width: width * busy, height: 3, fill: barColor, 'clip-path': clip }, group);
}

function drawItemNode(group: SVGGElement, node: ItemNode, clip: string): void {
  const color =
    node.kind === 'raw'
      ? node.manual
        ? COLORS.manual
        : COLORS.raw
      : node.kind === 'out'
        ? COLORS.target
        : COLORS.byproduct;

  el(
    'rect',
    {
      class: 'card',
      width: node.w,
      height: node.h,
      rx: 8,
      filter: 'url(#shadow)',
      stroke: color,
      'stroke-opacity': node.manual ? 0.9 : 0.45,
      // A dashed border marks an item you chose to supply yourself.
      'stroke-dasharray': node.manual ? '4 3' : null,
    },
    group,
  );
  el('rect', { width: 4, height: node.h, fill: color, 'clip-path': clip }, group);
  drawItemIcon(group, node.item, node.fluid, 11, (node.h - 22) / 2, 22);

  const hasButton = node.manual || (node.kind === 'raw' && node.expandable);
  formattedText(group, 40, 17, itemNameRaw(node.item), hasButton ? 16 : 19, {
    'font-size': 12,
    'font-weight': 600,
  });
  text(group, 40, 31, formatRate(node.rate, node.fluid), {
    'font-size': 10,
    fill: COLORS.label,
    'font-family': MONO,
  });

  if (node.manual) {
    button(group, node.w - 26, (node.h - 18) / 2, '+', 'expand', node.item,
      'Show the chain that makes this again', 18, 'faint');
  } else if (node.kind === 'raw' && node.expandable) {
    button(group, node.w - 26, (node.h - 18) / 2, '+', 'pick', node.item,
      'Pick a recipe to make this', 18, 'faint');
  }
}

/** One icon per ingredient and product, on the sides where their lines attach. */
function drawPorts(group: SVGGElement, node: RecipeNode, dir: DirectionSpec): void {
  const fluids = new Set<ItemKey>();
  for (const io of [...node.step.recipe.inputs, ...node.step.recipe.outputs]) {
    if (io.fluid) fluids.add(io.item);
  }

  node.portElements = { in: new Map(), out: new Map() };

  const badge = (item: ItemKey, isOutput: boolean): void => {
    const port = el('g', { class: `g-port ${isOutput ? 'out' : 'in'}` }, group);
    el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 6 }, port);
    drawItemIcon(port, item, fluids.has(item), -8, -8, 16);
    (isOutput ? node.portElements!.out : node.portElements!.in).set(item, port);
  };

  for (const item of node.inPorts) badge(item, false);
  for (const item of node.outPorts) badge(item, true);
  placePorts(node, dir);
}

/** Move a node's port icons to their current slots, after a reorder or a drag. */
export function placePorts(node: RecipeNode, dir: DirectionSpec): void {
  if (!node.portElements) return;
  for (const [isOutput, ports] of [
    [false, node.portElements.in],
    [true, node.portElements.out],
  ] as const) {
    for (const [item, element] of ports) {
      const point = portPoint(node, item, isOutput, dir);
      element.setAttribute('transform', `translate(${point.x},${point.y})`);
    }
  }
}

/** Grow a recipe node so every port icon has room on the side lines attach to. */
export function sizeForPorts(node: RecipeNode, dir: DirectionSpec, baseW: number, baseH: number): void {
  const ports = Math.max(node.inPorts.length, node.outPorts.length);
  if (dir.horizontal) node.h = Math.max(baseH, ports * PORT_STEP + 14);
  else node.w = Math.max(baseW, ports * PORT_STEP + 28);
}
