/**
 * SVG primitives for the graph.
 *
 * The graph is built as real SVG elements rather than a markup string, because nodes get dragged
 * and highlighted and their lines redrawn without a full re-render. These helpers keep the drawing
 * code readable: create an element with attributes, place a line of text, measure text so a title
 * can be fitted to the room available.
 */
import { itemColor } from '../core/item-color';
import { stripFormatting, toSegments } from '../core/mc-text';
import type { ItemKey } from '../core/types';
import { icons } from '../icons/icon-store';
import { fluidColor } from '../icons/line-color';

export const SVG_NS = 'http://www.w3.org/2000/svg';

type Attrs = Record<string, string | number | boolean | null | undefined>;

/** Create an SVG element, set the attributes that are not null, and append it. */
export function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  parent?: SVGElement | null,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value != null) node.setAttribute(name, String(value));
    }
  }
  parent?.appendChild(node);
  return node;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A line of plain text. */
export function text(
  parent: SVGElement,
  x: number,
  y: number,
  content: string,
  attrs?: Attrs,
): SVGTextElement {
  const node = el('text', { x, y, class: 'g-text', ...attrs }, parent);
  node.textContent = content;
  return node;
}

/**
 * A line of text with Minecraft `§` formatting rendered as coloured spans, cut to `maxChars`
 * visible characters.
 */
export function formattedText(
  parent: SVGElement,
  x: number,
  y: number,
  raw: string,
  maxChars: number,
  attrs?: Attrs,
): SVGTextElement {
  const node = el('text', { x, y, class: 'g-text', ...attrs }, parent);
  const segments = toSegments(raw);
  const total = segments.reduce((sum, seg) => sum + seg.text.length, 0);

  // Leave a character for the ellipsis when there is more text than room.
  let remaining = total > maxChars ? maxChars - 1 : maxChars;

  for (const segment of segments) {
    if (remaining <= 0) break;
    const visible = segment.text.slice(0, remaining);
    remaining -= visible.length;

    const span = el('tspan', null, node);
    if (segment.color) span.setAttribute('fill', segment.color);
    if (segment.bold) span.setAttribute('font-weight', '700');
    if (segment.italic) span.setAttribute('font-style', 'italic');
    if (segment.underline || segment.strike) {
      span.setAttribute('text-decoration', segment.underline ? 'underline' : 'line-through');
    }
    span.textContent = visible;
  }

  if (total > maxChars) el('tspan', null, node).textContent = '…';
  return node;
}

/** A small square button drawn into a node. */
export function button(
  parent: SVGElement,
  x: number,
  y: number,
  glyph: string,
  action: string,
  argument: string,
  title: string,
  size = 20,
  className = '',
): SVGGElement {
  const group = el(
    'g',
    {
      class: `g-btn${className ? ` ${className}` : ''}`,
      'data-act': action,
      'data-arg': argument,
      transform: `translate(${x},${y})`,
    },
    parent,
  );
  el('rect', { width: size, height: size, rx: 5 }, group);
  // No `g-text` class here: button glyphs are styled by `.g-btn text`.
  el('text', { x: size / 2, y: size / 2 + 4.5, 'text-anchor': 'middle' }, group).textContent = glyph;
  el('title', null, group).textContent = title;
  return group;
}

/** An item's icon, or a coloured shape standing in for one when the atlas has nothing. */
export function drawItemIcon(
  parent: SVGElement,
  item: ItemKey,
  fluid: boolean,
  x: number,
  y: number,
  px: number,
): void {
  // Fluids sit on a disc of their own colour, because gas textures are nearly transparent.
  if (fluid && icons.slot(item) != null) {
    el('circle', { cx: x + px / 2, cy: y + px / 2, r: px / 2, fill: fluidColor(item) }, parent);
  }
  if (icons.svg(parent, item, x, y, px)) return;

  if (fluid) {
    el(
      'circle',
      { cx: x + px / 2, cy: y + px / 2, r: px * 0.38, fill: itemColor(item, true) },
      parent,
    );
  } else {
    el(
      'rect',
      {
        x: x + px * 0.12,
        y: y + px * 0.12,
        width: px * 0.76,
        height: px * 0.76,
        rx: px * 0.18,
        fill: itemColor(item, false),
      },
      parent,
    );
  }
}

/* ------------------------------ fitting a title ------------------------------ */

const FONT = "system-ui, 'Segoe UI', sans-serif";
/** Title sizes to try, largest first. */
const TITLE_SIZES = [12.5, 11.5];
const TITLE_WEIGHT = 600;
/** Rough fallback when there is no canvas to measure with (tests, workers). */
const AVERAGE_CHAR_RATIO = 0.56;

const measurer =
  typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;

export function textWidth(content: string, size: number, weight = 400): number {
  if (!measurer) return content.length * size * AVERAGE_CHAR_RATIO;
  measurer.font = `${weight} ${size}px ${FONT}`;
  return measurer.measureText(content).width;
}

export interface FittedTitle {
  /** The chosen option, possibly shortened. */
  text: string;
  size: number;
  /** Character budget to pass to `formattedText`. */
  chars: number;
}

/**
 * Pick the longest title option that fits the width, trying full size first and then one size
 * down. If none fit, shorten the shortest option — but keep any "+ N more" suffix intact, since
 * that is the part that says the title is incomplete.
 */
export function fitTitle(options: readonly string[], room: number): FittedTitle {
  for (const size of TITLE_SIZES) {
    for (const option of options) {
      const plain = stripFormatting(option);
      if (textWidth(plain, size, TITLE_WEIGHT) <= room) {
        return { text: option, size, chars: plain.length };
      }
    }
  }

  const shortest = options[options.length - 1]!;
  const plain = stripFormatting(shortest);
  const size = TITLE_SIZES[TITLE_SIZES.length - 1]!;

  const withSuffix = /^(.*?)( \+ \d+ more)$/.exec(plain);
  const head = withSuffix ? withSuffix[1]! : plain;
  const suffix = withSuffix ? withSuffix[2]! : '';

  let chars = head.length;
  while (chars > 1 && textWidth(`${head.slice(0, chars)}…${suffix}`, size, TITLE_WEIGHT) > room) {
    chars--;
  }

  // Without a suffix the character budget alone shortens it; with one, build the string ourselves.
  if (!suffix) return { text: shortest, size, chars };
  return { text: `${head.slice(0, chars).trimEnd()}…${suffix}`, size, chars: Infinity };
}
