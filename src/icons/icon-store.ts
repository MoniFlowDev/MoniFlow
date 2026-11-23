/**
 * The loaded atlas, and the three ways the UI asks for an icon.
 *
 * An icon is a window onto an atlas page, so showing one is a matter of pointing at the page with
 * the right offset: a `<span>` with a background position in HTML, or a nested `<svg>` with a
 * viewBox in the graph. Pages are also decoded into `Image` objects so we can sample an icon's
 * average colour, which is what gives each line on the graph its colour.
 */
import { ICON_PX } from './canvas';
import { locateSlot, type Atlas } from './atlas';
import { loadAux, saveAux } from '../import/game-store';
import { tier as tierAt } from '../data/tiers';
import type { Recipe } from '../core/types';

const STORE_KEY = 'icons';

/** The sampler downscales an icon to this before averaging, which is plenty and keeps it cheap. */
const SAMPLE_PX = 16;
/** Pixels dimmer than this in alpha are background, not part of the item. */
const MIN_ALPHA = 120;

/** Where an icon lives, ready to point CSS or SVG at. */
export interface IconLocation {
  url: string;
  /** Offset of the icon within its page, in page pixels. */
  x: number;
  y: number;
  /** Page dimensions. */
  w: number;
  h: number;
  /** Icon size in page pixels. */
  px: number;
}

export type Rgb = [r: number, g: number, b: number];

/** An older single-page atlas, before icons were split across pages. */
interface LegacyAtlas extends Omit<Atlas, 'pages'> {
  pages?: Atlas['pages'];
  blob?: Blob;
  width?: number;
  height?: number;
}

class IconStore {
  private atlas: Atlas | null = null;
  private urls: string[] = [];
  /** Decoded pages, available only once they finish loading; null until then. */
  private images: (HTMLImageElement | null)[] | null = null;
  private colorCache = new Map<string, Rgb | null>();
  private sampler: HTMLCanvasElement | null = null;
  private readonly listeners = new Set<() => void>();

  /** True once an atlas is loaded, whether or not its pages have decoded yet. */
  get loaded(): boolean {
    return this.atlas !== null;
  }

  /** True once pages have decoded, so `iconColor` can answer. */
  get colorsReady(): boolean {
    return this.images !== null;
  }

  get info(): Atlas | null {
    return this.atlas;
  }

  /** Called when an atlas is set, and again when its pages finish decoding. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  async load(): Promise<void> {
    const stored = await loadAux<LegacyAtlas>(STORE_KEY);
    if (stored && (stored.pages || stored.blob)) this.set(stored);
  }

  async save(atlas: Atlas): Promise<void> {
    await saveAux(STORE_KEY, atlas);
    this.set(atlas);
  }

  async clear(): Promise<void> {
    await saveAux(STORE_KEY, null);
    this.set(null);
  }

  set(data: LegacyAtlas | null): void {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];

    const atlas = data ? normalize(data) : null;
    this.atlas = atlas;
    this.images = null;
    this.colorCache = new Map();

    if (!atlas) {
      this.notify();
      return;
    }

    this.urls = atlas.pages.map((page) => URL.createObjectURL(page.blob));
    this.notify();
    void this.decodePages(atlas);
  }

  /** Decode the pages so icon colours can be sampled, then tell everyone to redraw. */
  private async decodePages(atlas: Atlas): Promise<void> {
    const images = await Promise.all(
      this.urls.map(async (url) => {
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
          return image;
        } catch {
          return null;
        }
      }),
    );
    // A newer atlas may have replaced this one while we were decoding.
    if (this.atlas !== atlas) return;
    this.images = images;
    this.notify();
  }

  /** The slot number for an item, or undefined when the atlas has no icon for it. */
  slot(key: string): number | undefined {
    return this.atlas?.index[key];
  }

  locate(key: string): IconLocation | null {
    const atlas = this.atlas;
    if (!atlas) return null;
    const slot = atlas.index[key];
    if (slot == null) return null;

    const at = locateSlot(atlas, slot);
    const page = atlas.pages[at.page];
    if (!page) return null;

    return {
      url: this.urls[at.page]!,
      x: at.x,
      y: at.y,
      w: page.width,
      h: page.height,
      px: atlas.px || ICON_PX,
    };
  }

  /** An icon as an HTML `<span>`, or null if there is none. */
  html(key: string, px = 16, className = ''): string | null {
    const at = this.locate(key);
    if (!at) return null;
    const scale = px / at.px;
    return (
      `<span class="ico ${className}" style="width:${px}px;height:${px}px;` +
      `background-image:url('${at.url}');` +
      `background-position:-${at.x * scale}px -${at.y * scale}px;` +
      `background-size:${at.w * scale}px ${at.h * scale}px"></span>`
    );
  }

  /** An icon as a nested `<svg>` cropping its atlas page, appended to `parent`. */
  svg(parent: SVGElement, key: string, x: number, y: number, px: number): SVGSVGElement | null {
    const at = this.locate(key);
    if (!at) return null;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('x', String(x));
    svg.setAttribute('y', String(y));
    svg.setAttribute('width', String(px));
    svg.setAttribute('height', String(px));
    svg.setAttribute('viewBox', `${at.x} ${at.y} ${at.px} ${at.px}`);
    svg.setAttribute('class', 'g-ico');

    const image = document.createElementNS(ns, 'image');
    image.setAttribute('href', at.url);
    image.setAttribute('width', String(at.w));
    image.setAttribute('height', String(at.h));
    svg.appendChild(image);

    parent.appendChild(svg);
    return svg;
  }

  /** Average colour of an item's icon over its opaque pixels, or null. */
  iconColor(key: string): Rgb | null {
    const cached = this.colorCache.get(key);
    if (cached !== undefined) return cached;

    const at = this.atlas;
    const slot = at?.index[key];
    if (at == null || slot == null || !this.images) return null;

    const position = locateSlot(at, slot);
    const image = this.images[position.page];
    if (!image) return null;

    if (!this.sampler) {
      this.sampler = document.createElement('canvas');
      this.sampler.width = SAMPLE_PX;
      this.sampler.height = SAMPLE_PX;
    }
    const ctx = this.sampler.getContext('2d', { willReadFrequently: true })!;
    const px = at.px || ICON_PX;
    ctx.clearRect(0, 0, SAMPLE_PX, SAMPLE_PX);
    ctx.drawImage(image, position.x, position.y, px, px, 0, 0, SAMPLE_PX, SAMPLE_PX);

    const { data } = ctx.getImageData(0, 0, SAMPLE_PX, SAMPLE_PX);
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < MIN_ALPHA) continue;
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
      n++;
    }

    const average: Rgb | null = n ? [r / n, g / n, b / n] : null;
    this.colorCache.set(key, average);
    return average;
  }

  /** The item whose icon pictures a recipe's machine, tier-specific when the game has one. */
  machineKey(recipe: Recipe | null | undefined, tierIndex: number | null): string | null {
    if (!this.atlas || !recipe?.type) return null;
    const byTier = this.atlas.machines[recipe.type];
    if (!byTier) return null;
    const name = tierIndex != null ? tierAt(tierIndex).name.toLowerCase() : null;
    return (name ? byTier[name] : null) ?? byTier[''] ?? Object.values(byTier)[0] ?? null;
  }
}

function normalize(data: LegacyAtlas): Atlas {
  if (data.pages) return data as Atlas;
  // Legacy single-blob atlas: wrap it as a one-page atlas.
  return {
    ...(data as Atlas),
    pages: [{ blob: data.blob!, width: data.width!, height: data.height! }],
    perPage: Infinity,
    px: data.px || 32,
  };
}

/** The one atlas the app shows. */
export const icons = new IconStore();
