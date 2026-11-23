/**
 * Building the atlas.
 *
 * Icons are drawn in small batches so the work interleaves with the browser's event loop and the
 * progress bar actually moves, and written straight into the current page canvas. A page is
 * trimmed to the rows it used before being encoded, so a mostly-empty final page is not a 16MB
 * PNG of transparency.
 */
import { context, ICON_PX, makeCanvas, toPngBlob, type AnyCanvas } from './canvas';
import { ATLAS_COLS, PAGE_ICONS, type Atlas, type AtlasPage } from './atlas';
import { fluidIcon } from './gregtech-icons';
import { itemIcon } from './item-icons';
import { machineCandidates } from './machine-icons';
import type { ModelRepository } from './model-repository';

/** Icons drawn per await, balancing throughput against UI responsiveness. */
const BATCH = 48;

export interface AtlasItem {
  key: string;
  fluid: boolean;
}

export interface BuildAtlasOptions {
  items: readonly AtlasItem[];
  /** Recipe type ids, so each machine's own icon gets built too. */
  types: readonly string[];
  /** Every item id the game has, for resolving machine candidates. */
  itemIds: ReadonlySet<string>;
  /** Material name -> `<rgb>|<…>|<iconSet>`, for tinting fluids. */
  materials: Record<string, unknown>;
  /** Item id -> GregTech icon recipe. */
  gtIcons: Record<string, string>;
  onProgress?: (done: number, total: number, drawn: number) => void;
}

export async function buildAtlas(
  repo: ModelRepository,
  options: BuildAtlasOptions,
): Promise<Atlas> {
  const { items, types, itemIds, materials, gtIcons, onProgress } = options;

  const machines = resolveMachines(types, itemIds);
  const todo = withMachineItems(items, machines);

  const writer = new PageWriter();
  const index: Record<string, number> = {};
  let attempted = 0;

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const drawn = await Promise.all(
      batch.map(async (item) => {
        try {
          return item.fluid
            ? await fluidIcon(repo, item.key, materials)
            : await itemIcon(repo, item.key, gtIcons);
        } catch {
          return null;
        }
      }),
    );

    for (let j = 0; j < drawn.length; j++) {
      const icon = drawn[j];
      if (!icon) continue;
      index[batch[j]!.key] = await writer.add(icon);
    }

    attempted += batch.length;
    onProgress?.(attempted, todo.length, writer.count);
  }

  const pages = await writer.finish();

  // Drop machine candidates whose icon could not be drawn, so the UI never asks for a missing slot.
  for (const byTier of Object.values(machines)) {
    for (const [tier, key] of Object.entries(byTier)) {
      if (index[key] == null) delete byTier[tier];
    }
  }

  return {
    pages,
    index,
    machines,
    cols: ATLAS_COLS,
    perPage: PAGE_ICONS,
    px: ICON_PX,
    count: writer.count,
    total: todo.length,
    built: new Date().toISOString(),
  };
}

function resolveMachines(
  types: readonly string[],
  itemIds: ReadonlySet<string>,
): Record<string, Record<string, string>> {
  const machines: Record<string, Record<string, string>> = {};
  for (const type of types) {
    const candidates = machineCandidates(type, itemIds);
    if (Object.keys(candidates).length) machines[type] = candidates;
  }
  return machines;
}

/** The requested items, plus any machine item not already among them. */
function withMachineItems(
  items: readonly AtlasItem[],
  machines: Record<string, Record<string, string>>,
): AtlasItem[] {
  const requested = new Set(items.map((i) => i.key));
  const extra = new Set<string>();
  for (const byTier of Object.values(machines)) {
    for (const key of Object.values(byTier)) {
      if (!requested.has(key)) extra.add(key);
    }
  }
  return [...items, ...[...extra].map((key) => ({ key, fluid: false }))];
}

/** Fills one page canvas at a time, encoding each as it is filled. */
class PageWriter {
  private readonly pages: AtlasPage[] = [];
  private canvas: AnyCanvas | null = null;
  /** Slots used across all pages so far, which is also the next slot number. */
  count = 0;

  /** Draw an icon into the next slot and return that slot number. */
  async add(icon: AnyCanvas): Promise<number> {
    if (!this.canvas) {
      this.canvas = makeCanvas(ATLAS_COLS * ICON_PX, (PAGE_ICONS / ATLAS_COLS) * ICON_PX);
    }

    const local = this.count - this.pages.length * PAGE_ICONS;
    context(this.canvas).drawImage(
      icon,
      (local % ATLAS_COLS) * ICON_PX,
      Math.floor(local / ATLAS_COLS) * ICON_PX,
      ICON_PX,
      ICON_PX,
    );

    const slot = this.count++;
    if (this.count % PAGE_ICONS === 0) await this.closePage();
    return slot;
  }

  async finish(): Promise<AtlasPage[]> {
    await this.closePage();
    return this.pages;
  }

  /** Trim the page to the rows it used, encode it, and start fresh. */
  private async closePage(): Promise<void> {
    if (!this.canvas) return;

    const used = this.count - this.pages.length * PAGE_ICONS;
    const rows = Math.max(1, Math.ceil(used / ATLAS_COLS));
    const trimmed = makeCanvas(ATLAS_COLS * ICON_PX, rows * ICON_PX);
    context(trimmed).drawImage(this.canvas, 0, 0);

    this.pages.push({
      blob: await toPngBlob(trimmed),
      width: trimmed.width,
      height: trimmed.height,
    });
    this.canvas = null;
  }
}
