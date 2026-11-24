/**
 * Drawing an ordinary item, from whatever the instance happens to provide.
 *
 * There is no single rule, so this works down a ladder of increasingly desperate strategies:
 * GregTech's generated icon, then the item model, then the block model, then the blockstate the
 * block model hides behind, and finally any texture simply named after the item (which is all a
 * KubeJS item or a code-rendered one will have). Whatever turns up is drawn as flat layers, as an
 * isometric cube, or as a real 3D render if the model has geometry.
 */
import { cubeIcon, flatIcon, tinted, type AnyCanvas, type Drawable } from './canvas';
import { splitResourceLocation } from './asset-fs';
import { gregtechIcon } from './gregtech-icons';
import type { ModelRepository, ResolvedModel } from './model-repository';
import { renderModel3D, type ModelElement } from './model-3d';

/** How many layers a flat generated item model can stack. */
const MAX_LAYERS = 5;

/** Textures the game tints with foliage colour instead of shipping them green. */
const FOLIAGE = /grass|leaves|vine|lily|fern/;
const FOLIAGE_COLOR = '#7ab55c';

/** Parent models that mean "this is a block shape", so it should be drawn as a cube. */
const BLOCK_SHAPE = /block\/(cube|block|orientable|template)/;

export async function itemIcon(
  repo: ModelRepository,
  key: string,
  gtIcons: Record<string, string>,
): Promise<AnyCanvas | null> {
  const spec = gtIcons[key];
  if (spec) {
    const generated = await gregtechIcon(repo, spec);
    if (generated) return generated;
  }

  const [namespace, path] = splitResourceLocation(key);
  const model = await findModel(repo, namespace, path);

  if (!model) return textureNamedAfterItem(repo, namespace, path);
  return drawModel(repo, model);
}

/** The item model, the block model, or whatever the blockstate points at. */
async function findModel(
  repo: ModelRepository,
  namespace: string,
  path: string,
): Promise<ResolvedModel | null> {
  const hasTextures = (m: ResolvedModel | null): m is ResolvedModel =>
    !!m && Object.keys(m.textures).length > 0;

  const item = await repo.model(`${namespace}:item/${path}`);
  if (hasTextures(item)) return item;

  const block = await repo.model(`${namespace}:block/${path}`);
  if (hasTextures(block)) return block;

  // A block item with no item model of its own: follow its blockstate to a real model.
  const ref = await blockstateModelRef(repo, namespace, path);
  if (ref) {
    const fromState = await repo.model(ref);
    if (hasTextures(fromState)) return fromState;
  }
  return null;
}

async function blockstateModelRef(
  repo: ModelRepository,
  namespace: string,
  path: string,
): Promise<string | null> {
  const state = await repo.fs.json<Record<string, unknown>>(
    `assets/${namespace}/blockstates/${path}.json`,
  );
  if (!state) return null;

  const firstModel = (value: unknown): string | null => {
    const entry = Array.isArray(value) ? value[0] : value;
    const model = (entry as Record<string, unknown> | undefined)?.['model'];
    return model == null ? null : String(model);
  };

  if (state['variants'] && typeof state['variants'] === 'object') {
    const ref = firstModel(Object.values(state['variants'] as Record<string, unknown>)[0]);
    if (ref) return ref;
  }
  if (Array.isArray(state['multipart'])) {
    const apply = (state['multipart'][0] as Record<string, unknown> | undefined)?.['apply'];
    const ref = firstModel(apply);
    if (ref) return ref;
  }
  return null;
}

/** Last resort: a texture named after the item, with no model anywhere. */
async function textureNamedAfterItem(
  repo: ModelRepository,
  namespace: string,
  path: string,
): Promise<AnyCanvas | null> {
  for (const ref of [
    `${namespace}:item/${path}`,
    `${namespace}:block/${path}`,
    `${namespace}:items/${path}`,
    `${namespace}:blocks/${path}`,
  ]) {
    const layer = await repo.layer(ref);
    if (layer) return flatIcon([layer]);
  }

  // Failing that, search every texture folder for one with the item's bare name.
  const found = repo.fs.findTexture(namespace, path);
  if (!found) return null;
  const ref = found.replace(/^assets\/([^/]+)\/textures\//, '$1:').replace(/\.png$/, '');
  const layer = await repo.layer(ref);
  return layer ? flatIcon([layer]) : null;
}

async function drawModel(repo: ModelRepository, model: ResolvedModel): Promise<AnyCanvas | null> {
  const textures = model.textures;

  // Flat artwork: an item model built from stacked `layerN` textures.
  const isFlatArtwork =
    textures['layer0'] &&
    (model.layered || !(textures['all'] || textures['side'] || textures['top']));
  if (isFlatArtwork) {
    const layers: Drawable[] = [];
    for (let i = 0; i < MAX_LAYERS; i++) {
      const layer = await repo.layer(repo.resolveSlot(textures, `layer${i}`));
      if (layer) layers.push(layer);
    }
    return layers.length ? flatIcon(layers) : null;
  }

  // Real geometry: render it properly, which is what makes an anvil look like an anvil.
  if (model.elements?.length) {
    const rendered = await render3D(repo, model);
    if (rendered) return rendered;
  }

  const cube = await drawCube(repo, model);
  if (cube) return cube;

  // Nothing identifiable: any texture it mentions is better than no icon.
  const fallbackRef =
    repo.resolveSlot(textures, 'particle') ??
    Object.keys(textures)
      .map((slot) => repo.resolveSlot(textures, slot))
      .find(Boolean) ??
    null;
  const layer = await repo.layer(fallbackRef);
  return layer ? flatIcon([layer]) : null;
}

/** An isometric cube from the model's top, front and side textures. */
async function drawCube(repo: ModelRepository, model: ResolvedModel): Promise<AnyCanvas | null> {
  const textures = model.textures;
  const pick = (...slots: string[]): string | null => {
    for (const slot of slots) {
      const ref = repo.resolveSlot(textures, slot);
      if (ref) return ref;
    }
    return null;
  };

  const looksLikeABlock =
    textures['all'] ||
    textures['side'] ||
    textures['top'] ||
    textures['front'] ||
    textures['north'] ||
    textures['end'] ||
    textures['texture'] ||
    model.chain.some((parent) => BLOCK_SHAPE.test(parent));
  if (!looksLikeABlock) return null;

  const topRef = pick('top', 'up', 'end', 'all', 'side', 'texture', 'particle');
  const frontRef = pick('front', 'north', 'side', 'all', 'texture', 'particle');
  const sideRef = pick('side', 'east', 'west', 'all', 'texture', 'particle', 'front');
  if (!topRef && !frontRef) return null;

  const top = [await repo.layer(topRef ?? frontRef)].filter(Boolean) as Drawable[];
  const front = [await repo.layer(frontRef ?? topRef)].filter(Boolean) as Drawable[];
  const side = [await repo.layer(sideRef ?? frontRef ?? topRef)].filter(Boolean) as Drawable[];

  const overlayTop = await repo.layer(repo.resolveSlot(textures, 'overlay_top'));
  const overlayFront = await repo.layer(repo.resolveSlot(textures, 'overlay_front'));
  if (overlayTop) top.push(overlayTop);
  if (overlayFront) front.push(overlayFront);

  if (!top.length || !front.length || !side.length) return null;
  return cubeIcon(top, front, side);
}

/** Load every texture the model's faces reference, then render its geometry. */
async function render3D(repo: ModelRepository, model: ResolvedModel): Promise<AnyCanvas | null> {
  const elements = model.elements as ModelElement[];
  const loaded = new Map<string, Drawable | null>();

  for (const element of elements) {
    if (!element?.faces) continue;
    for (const face of Object.values(element.faces)) {
      if (!face?.texture || loaded.has(face.texture)) continue;

      const ref = face.texture.startsWith('#')
        ? repo.resolveSlot(model.textures, face.texture.slice(1))
        : face.texture;
      let layer = ref ? await repo.layer(ref) : null;
      if (layer && face.tintindex != null && ref && FOLIAGE.test(ref)) {
        layer = tinted(layer, FOLIAGE_COLOR);
      }
      loaded.set(face.texture, layer);
    }
  }

  const gui = model.display['gui'] as Parameters<typeof renderModel3D>[2];
  return renderModel3D(elements, (ref) => loaded.get(ref) ?? null, gui);
}
