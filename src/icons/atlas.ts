/**
 * The icon atlas: every item's icon packed into a handful of PNG pages.
 *
 * A Monifactory install has tens of thousands of items, and the UI shows icons everywhere — in
 * the graph, the picker, the sidebars. One sprite sheet per few thousand icons means the whole
 * lot is a few image loads rather than tens of thousands, and an icon is then a background
 * offset. Pages are capped because browsers refuse to allocate canvases beyond a few thousand
 * pixels square.
 */
import { ICON_PX } from './canvas';

/** Icons per row in a page. */
export const ATLAS_COLS = 64;
/** Icons per page: 64 x 64 at 64px each is a 4096 x 4096 image. */
export const PAGE_ICONS = ATLAS_COLS * ATLAS_COLS;

export interface AtlasPage {
  blob: Blob;
  width: number;
  height: number;
}

export interface Atlas {
  pages: AtlasPage[];
  /** Item key -> slot number, counting across all pages. */
  index: Record<string, number>;
  /** Recipe type -> tier name (`''` for untiered) -> item key whose icon pictures the machine. */
  machines: Record<string, Record<string, string>>;
  cols: number;
  perPage: number;
  px: number;
  /** Icons actually drawn. */
  count: number;
  /** Icons attempted, including the ones with no artwork to find. */
  total: number;
  built: string;
}

/** Where one slot lives: which page, and where on it. */
export interface SlotLocation {
  page: number;
  x: number;
  y: number;
}

export function locateSlot(atlas: Atlas, slot: number): SlotLocation {
  // Legacy single-page atlases stored `perPage: Infinity`.
  const perPage = isFinite(atlas.perPage) ? atlas.perPage : 0;
  const page = perPage ? Math.floor(slot / perPage) : 0;
  const local = slot - page * perPage;
  const px = atlas.px || ICON_PX;
  return {
    page,
    x: (local % atlas.cols) * px,
    y: Math.floor(local / atlas.cols) * px,
  };
}
