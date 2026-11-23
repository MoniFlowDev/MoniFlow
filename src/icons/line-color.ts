/**
 * What colour should a line on the graph be?
 *
 * The best answer is the item's own colour, so steel lines look like steel: GregTech's material
 * colour where the export has one, otherwise the average colour of the item's icon, otherwise a
 * stable colour generated from its name. Whatever the source, the result is then toned for a dark
 * background — lightness held in a readable band, saturation capped so lines never go neon or
 * compete with the tier colours on the nodes, and near-greys left neutral.
 *
 * Colours are cached, but only once the atlas has decoded: before that the icon colour is not
 * available yet, and caching early would freeze in the fallback.
 */
import { itemColor } from '../core/item-color';
import type { ItemKey } from '../core/types';
import { icons, type Rgb } from './icon-store';

/** Below this saturation an item reads as grey, and forcing colour onto it looks wrong. */
const GREY_SATURATION = 0.12;
/** Readable band for greys on a dark background. */
const GREY_LIGHTNESS = { min: 0.58, max: 0.8 };
/** Readable band for colours, kept away from both neon and mud. */
const COLOR_SATURATION = { min: 0.35, max: 0.72 };
const COLOR_LIGHTNESS = { min: 0.56, max: 0.72 };

const lineColors = new Map<ItemKey, string>();

/**
 * Icon data from the current import. Set when game data loads, because line colours are wanted
 * from the renderer, far from where the import lives.
 */
let gtIcons: Record<string, string> = {};
let gtMaterials: Record<string, unknown> = {};

export function setIconMaterialData(
  iconsByItem: Record<string, string>,
  materials: Record<string, unknown>,
): void {
  gtIcons = iconsByItem;
  gtMaterials = materials;
  lineColors.clear();
}

/** Drop cached colours, e.g. after a new atlas finishes decoding. */
export function clearLineColorCache(): void {
  lineColors.clear();
}

export function itemLineColor(item: ItemKey, fluid?: boolean): string {
  const cached = lineColors.get(item);
  if (cached) return cached;

  const rgb = materialRgb(item) ?? (fluid ? hexToRgb(fluidColor(item)) : null) ?? icons.iconColor(item);
  const color = rgb ? toneForDarkBackground(rgb) : itemColor(item, fluid);

  // Only cache once icon colours are available (or will never be), so lines update after loading.
  if (!icons.loaded || icons.colorsReady) lineColors.set(item, color);
  return color;
}

/**
 * The colour to fill behind a fluid icon. GregTech's fluid textures are nearly transparent until
 * the game tints them, so without this a gas is invisible.
 */
export function fluidColor(item: ItemKey): string {
  const path = String(item).split(':').pop()!;
  const name = path.replace(/^(molten|liquid)_/, '').replace(/_(plasma|gas)$/, '');
  const material = (gtMaterials[name] ?? gtMaterials[path]) as string | undefined;

  // Plenty of fluids have no real material colour (white, icon set "fluid") because the colour is
  // painted into the texture itself. Sample the icon for those.
  if (material && !/^ffffff\|/i.test(material)) return `#${material.split('|')[0]}`;

  const sampled = icons.iconColor(item);
  if (sampled) return `#${sampled.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

  return material ? '#ffffff' : itemColor(item, true);
}

/** The GregTech material colour for an item, from its exported icon recipe. */
function materialRgb(item: ItemKey): Rgb | null {
  const spec = gtIcons[item];
  if (!spec) return null;
  const parts = spec.split('|');
  // Tools carry their colour in a different slot than items and blocks.
  const hex = parts[0] === 'tool' ? parts[2] : parts[4];
  return /^[0-9a-f]{6}$/i.test(hex ?? '') ? hexToRgb(`#${hex}`) : null;
}

function clamp(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

function toneForDarkBackground(rgb: Rgb): string {
  let [hue, saturation, lightness] = rgbToHsl(rgb);
  if (saturation < GREY_SATURATION) {
    saturation = 0;
    lightness = clamp(lightness, GREY_LIGHTNESS);
  } else {
    saturation = clamp(saturation, COLOR_SATURATION);
    lightness = clamp(lightness, COLOR_LIGHTNESS);
  }
  return `hsl(${hue.toFixed(0)} ${(saturation * 100).toFixed(0)}% ${(lightness * 100).toFixed(0)}%)`;
}

function hexToRgb(hex: string): Rgb | null {
  if (!hex.startsWith('#')) return null;
  const value = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl([r255, g255, b255]: Rgb): [hue: number, saturation: number, lightness: number] {
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hue =
    max === r
      ? (g - b) / delta + (g < b ? 6 : 0)
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;

  return [hue * 60, saturation, lightness];
}
