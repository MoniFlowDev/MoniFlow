/**
 * The card that follows the pointer around the graph.
 *
 * The nodes themselves only have room for the headline numbers, so hovering one shows the rest:
 * machines and how busy they will be, power, craft time, and every input and output with its real
 * rate. Hovering a line says what it carries and where it goes.
 */
import { formatDuration, formatEut, formatNumber, formatRate } from '../core/format';
import { escapeHtml } from '../core/html';
import { itemColor } from '../core/item-color';
import { itemNameHtml } from '../core/item-names';
import { expectedAmount } from '../core/recipe';
import { tier as tierAt } from '../data/tiers';
import type { ItemKey, RecipeIO } from '../core/types';
import { icons } from '../icons/icon-store';
import { fluidColor } from '../icons/line-color';
import type { Graph, GraphEdge, GraphNode } from './model';

const KIND_LABELS = {
  raw: 'Raw input',
  out: 'Target',
  sur: 'Byproduct (left over)',
} as const;

const EDGE_ENDPOINT_LABELS = {
  raw: 'raw input',
  out: 'target',
  sur: 'byproduct',
} as const;

/** An item icon for the card, falling back to a coloured dot. */
function icon(item: ItemKey, fluid: boolean, px = 16): string {
  const html = icons.html(item, px);
  if (html && fluid) {
    return `<span class="fl-wrap" style="width:${px}px;height:${px}px;background:${fluidColor(item)}">${html}</span>`;
  }
  if (html) return html;
  return `<span class="tip-dot${fluid ? ' fluid' : ''}" style="background:${itemColor(item, fluid)}"></span>`;
}

/** One row per ingredient or product, with the rate it actually runs at. */
function ioRows(list: readonly RecipeIO[], rate: number, isOutput: boolean): string {
  const rows = list.map((io) => {
    const amount = isOutput ? expectedAmount(io) : Number(io.amount) || 0;

    const note = io.uses
      ? `<span class="tip-note">tool · ${io.uses.toLocaleString()} uses</span>`
      : io.kept
        ? '<span class="tip-note">kept</span>'
        : io.chance != null && Number(io.chance) !== 100
          ? `<span class="tip-note">${io.chance}%</span>`
          : '';

    const value = io.kept ? '—' : formatRate(amount * rate, io.fluid);
    return (
      `<div class="tip-row">${icon(io.item, !!io.fluid)}` +
      `<span class="tip-name">${itemNameHtml(io.item)}${note}</span>` +
      `<span class="tip-rate">${value}</span></div>`
    );
  });
  return rows.join('') || '<div class="tip-row muted">nothing</div>';
}

export function nodeCardHtml(node: GraphNode): string {
  return node.kind === 'recipe' ? stepCard(node) : itemCard(node);
}

function stepCard(node: Extract<GraphNode, { kind: 'recipe' }>): string {
  const step = node.step;
  const recipe = step.recipe;
  const unpowered = !step.instant && !(recipe.eut > 0);
  const tier = step.instant ? null : tierAt(step.settings.tier);

  const machineKey = icons.machineKey(recipe, step.instant ? null : step.settings.tier);
  const machineIcon = machineKey ? (icons.html(machineKey, 18) ?? '') : '';

  const used = step.usedOutputs;
  const title =
    recipe.src !== 'game' && used.length <= 1
      ? escapeHtml(recipe.name)
      : (used.length ? used : recipe.outputs.slice(0, 1).map((o) => o.item))
          .map(itemNameHtml)
          .join(' + ');

  const rows = step.instant
    ? `<span>Crafts</span><b>${formatRate(step.rate)}</b><span>Machine</span><b>none (instant)</b>`
    : [
        `<span>Machines</span><b>${formatNumber(step.machines, 2)} → build ${step.built} ` +
          `<em>(${Math.round(step.utilization * 100)}% busy)</em></b>`,
        `<span>Power</span><b>${
          unpowered ? 'none' : `${formatEut(step.avgEut)} avg · ${formatEut(step.peakEut)} peak`
        }</b>`,
        `<span>Each machine</span><b>${unpowered ? '' : `${formatEut(step.oc.eut)} · `}` +
          `${formatDuration(step.oc.dur)} per craft</b>`,
        `<span>Crafts</span><b>${formatRate(step.rate)}</b>`,
      ].join('');

  const spare = step.spareOutputs.map(itemNameHtml).join(', ');
  const spareRow = spare ? `<span>Byproducts</span><b class="tip-spare">${spare}</b>` : '';
  const warning = step.oc.errors.length
    ? `<div class="tip-warn">⚠ ${escapeHtml(step.oc.errors.join(' '))}</div>`
    : '';

  // Ingredients that are kept still belong in the list, even though their amount is zero.
  const inputs = recipe.inputs.filter((io) => (Number(io.amount) || 0) > 0 || io.kept);

  return `
    <div class="tip-head">${
      tier ? `<span class="tier" style="color:${tier.color}">${tier.name}</span>` : ''
    }${machineIcon}<span>${escapeHtml(recipe.machine)}</span></div>
    <div class="tip-title">${title}</div>
    <div class="tip-grid">${rows}${spareRow}</div>${warning}
    <div class="tip-io">
      <div><div class="tip-sub">Uses</div>${ioRows(inputs, step.rate, false)}</div>
      <div><div class="tip-sub">Makes</div>${ioRows(recipe.outputs, step.rate, true)}</div>
    </div>
    <div class="tip-hint">Click for details · drag to move</div>`;
}

function itemCard(node: Extract<GraphNode, { kind: 'raw' | 'out' | 'sur' }>): string {
  const label = node.kind === 'raw' && node.manual
    ? 'Supplied by you · chain hidden'
    : KIND_LABELS[node.kind];

  const hint = node.manual
    ? 'Click + to show the chain that makes it again'
    : node.kind === 'raw' && node.expandable
      ? 'Click + to pick a recipe for it'
      : 'Click for details · drag to move';

  return `
    <div class="tip-head"><span>${label}</span></div>
    <div class="tip-title">${icon(node.item, node.fluid, 20)} ${itemNameHtml(node.item)}</div>
    <div class="tip-grid"><span>Rate</span><b>${formatRate(node.rate, node.fluid)}</b></div>
    <div class="tip-hint">${hint}</div>`;
}

export function edgeCardHtml(edge: GraphEdge, graph: Graph): string {
  const title = `<div class="tip-title">${icon(edge.item, edge.fluid, 20)} ${itemNameHtml(edge.item)}</div>`;

  if (edge.stub) {
    const step = graph.nodes.get(edge.stub === 'in' ? edge.to : edge.from);
    const machine = step?.kind === 'recipe' ? escapeHtml(step.step.recipe.machine) : '';
    const note =
      edge.stub === 'in'
        ? edge.manual
          ? 'Raw input you supply (chain hidden)'
          : 'Raw input'
        : 'Byproduct, not used in this plan';

    return `${title}
      <div class="tip-grid"><span>Flow</span><b>${formatRate(edge.rate, edge.fluid)}</b>` +
      `<span>${edge.stub === 'in' ? 'Into' : 'From'}</span><b>${machine}</b></div>
      <div class="tip-foot">${note} · click for details</div>`;
  }

  const endpointName = (id: string): string => {
    const node = graph.nodes.get(id);
    if (!node) return '';
    return node.kind === 'recipe'
      ? escapeHtml(node.step.recipe.machine)
      : EDGE_ENDPOINT_LABELS[node.kind];
  };

  return `${title}
    <div class="tip-grid"><span>Flow</span><b>${formatRate(edge.rate, edge.fluid)}</b>` +
    `<span>From</span><b>${endpointName(edge.from)}</b>` +
    `<span>To</span><b>${endpointName(edge.to)}</b></div>`;
}
