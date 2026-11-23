/**
 * GregTech items, which are generated rather than drawn.
 *
 * GregTech has one texture per *shape* (ingot, dust, plate…) and tints it with the material's
 * colour, so there is no "steel ingot" texture to find — only `material_sets/metallic/ingot`
 * plus `#C8C8C8`. The exporter writes out the recipe for each item as a pipe-separated string,
 * and this module turns those back into pictures:
 *
 *   `item|<base>|<secondary>|…|<rgb>|<secondaryRgb>|…|<oreBase>`
 *   `pipe|<wire|cable|pipe>|<typeName>|<thickness>|<rgb>|…|<iconSet>`
 *   `tool|<modelRef>|<rgb>`
 */
import { cubeIcon, flatIcon, makeCanvas, context, type AnyCanvas, type Drawable } from './canvas';
import { splitResourceLocation } from './asset-fs';
import type { ModelRepository } from './model-repository';
import { renderModel3D, type ModelElement } from './model-3d';

/** How many layers a generated item model can stack. */
const MAX_LAYERS = 6;
/** How many icon-set parents to walk looking for a model (shiny -> metallic -> dull). */
const MAX_ICON_SET_HOPS = 8;
/** How many layers a tool model can stack. */
const MAX_TOOL_LAYERS = 5;
/** GregTech tints a tool's head, which is always layer 1. */
const TOOL_HEAD_LAYER = 1;

/** Cable insulation is drawn dark grey regardless of the wire inside. */
const INSULATION_COLOR = '#404040';
/** Wire sizes, in the order GregTech numbers their insulation textures. */
const WIRE_SIZES = ['single', 'double', 'quadruple', 'octal', 'hex'];
const PIPE_SIZES = ['tiny', 'small', 'normal', 'large', 'huge', 'quadruple', 'nonuple'];

/** Vanilla water has no material entry, so its colour is hard-coded as the game does. */
const WATER_COLOR = '#3f76e4';

/** Draw one GregTech item from its exported icon recipe. */
export async function gregtechIcon(
  repo: ModelRepository,
  spec: string,
): Promise<AnyCanvas | null> {
  const parts = spec.split('|');
  if (parts[0] === 'pipe') return pipeIcon(repo, parts);
  if (parts[0] === 'tool') return toolIcon(repo, parts);

  const [kind, base, secondary, , rgb, secondaryRgb, , oreBase] = parts;
  const primaryColor = `#${rgb}`;
  const secondaryColor = `#${secondaryRgb}`;

  // Items usually have a model for their material style, which already stacks the right layers
  // (base + secondary + highlight + any glow). Layer 0 takes the material colour, layer 1 the
  // secondary colour, and the rest are drawn as-is.
  if (kind === 'item') {
    const layers = await materialModelLayers(repo, base, primaryColor, secondaryColor);
    if (layers) return flatIcon(layers);
  }

  const layers: Drawable[] = [];
  const baseLayer = await repo.materialSetTexture(base, primaryColor);
  if (!baseLayer) return null;
  layers.push(baseLayer);

  const secondaryLayer = await repo.materialSetTexture(secondary, secondaryColor);
  if (secondaryLayer) layers.push(secondaryLayer);

  // The export's own "overlay" field just repeats the secondary texture, so derive the name instead.
  const overlayRef = `${String(base).replace(/(_secondary)?$/, '')}_overlay`;
  const overlay = await repo.materialSetTexture(overlayRef, null);
  if (overlay) layers.push(overlay);

  if (kind === 'block' && oreBase) {
    const ore = await oreCube(repo, oreBase, layers);
    if (ore) return ore;
  }
  return kind === 'block' ? cubeIcon(layers, layers, layers) : flatIcon(layers);
}

/** An ore block: the host stone, with the ore texture laid over it. */
async function oreCube(
  repo: ModelRepository,
  oreBase: string,
  oreLayers: readonly Drawable[],
): Promise<AnyCanvas | null> {
  const model = await repo.model(oreBase);
  const textures = model?.textures ?? {};
  const stoneRef =
    repo.resolveSlot(textures, 'all') ??
    repo.resolveSlot(textures, 'side') ??
    repo.resolveSlot(textures, 'texture') ??
    repo.resolveSlot(textures, 'particle') ??
    repo.resolveSlot(textures, 'end');

  const stone = await repo.layer(stoneRef);
  if (!stone) return null;

  const layers = [stone, ...oreLayers];
  return cubeIcon(layers, layers, layers);
}

/**
 * Layers from a GregTech material-set item model, following the icon set's parents if this
 * material's own set has no model.
 */
async function materialModelLayers(
  repo: ModelRepository,
  textureRef: string | undefined,
  primary: string,
  secondary: string,
): Promise<Drawable[] | null> {
  let ref = String(textureRef ?? '');
  if (!ref.includes('material_sets/')) return null;

  for (let hop = 0; hop < MAX_ICON_SET_HOPS && ref; hop++) {
    const model = await repo.model(ref);
    if (model?.textures['layer0']) {
      const layers: Drawable[] = [];
      for (let i = 0; i < MAX_LAYERS; i++) {
        const slot = repo.resolveSlot(model.textures, `layer${i}`);
        if (!slot) continue;
        const color = i === 0 ? primary : i === 1 ? secondary : null;
        const layer = await repo.materialSetTexture(slot, color);
        if (layer) layers.push(layer);
      }
      if (layers.length) return layers;
    }
    ref = repo.parentSetRef(ref) ?? '';
  }
  return null;
}

/**
 * Wires, cables and pipes, which are blocks only as thick as their type: drawn as a real 3D
 * segment so an octal cable looks fatter than a single one, with the right end cap.
 */
async function pipeIcon(repo: ModelRepository, parts: string[]): Promise<AnyCanvas | null> {
  const [, kind, typeName, thickness, rgb, , iconSet] = parts;
  const color = `#${rgb}`;
  const set = iconSet || 'dull';

  // Thickness is a fraction of a block; a face spans from 8-h to 8+h in model space.
  const fraction = Math.min(1, Math.max(0.1875, Number(thickness) || 0.5));
  const half = fraction * 8;

  const faces =
    kind === 'wire' || kind === 'cable'
      ? await wireFaces(repo, kind, String(typeName), color, set, half)
      : await plainPipeFaces(repo, String(typeName), color);
  if (!faces?.side) return null;

  const elements: ModelElement[] = [
    {
      from: [8 - half, 8 - half, 0],
      to: [8 + half, 8 + half, 16],
      faces: {
        north: { texture: '#end' },
        south: { texture: '#end' },
        up: { texture: '#side' },
        down: { texture: '#side' },
        east: { texture: '#side' },
        west: { texture: '#side' },
      },
    },
  ];

  return renderModel3D(elements, (ref) => (ref === '#end' ? faces.end : faces.side), {
    rotation: [30, 225, 0],
    translation: [0, 0, 0],
    scale: [0.8, 0.8, 0.8],
  });
}

interface PipeFaces {
  side: Drawable | null;
  end: Drawable | null;
}

async function wireFaces(
  repo: ModelRepository,
  kind: string,
  typeName: string,
  color: string,
  set: string,
  half: number,
): Promise<PipeFaces> {
  const wireSide = await repo.materialSetTexture(`gtceu:block/material_sets/${set}/wire_side`, color);
  const wireEnd =
    (await repo.materialSetTexture(`gtceu:block/material_sets/${set}/wire_end`, color)) ?? wireSide;

  if (kind === 'wire') return { side: wireSide, end: wireEnd };

  // A cable is insulated: rubber outside, with the wire core showing at the cut ends.
  const sizeIndex = Math.max(0, WIRE_SIZES.findIndex((size) => typeName.includes(size)));
  const insulation =
    (await repo.layer(`gtceu:block/cable/insulation_${sizeIndex}`, INSULATION_COLOR)) ??
    (await repo.layer('gtceu:block/cable/insulation_0', INSULATION_COLOR));

  if (!insulation || !wireEnd) return { side: insulation ?? wireSide, end: wireEnd };

  const size = 16;
  const canvas = makeCanvas(size, size);
  const ctx = context(canvas);
  ctx.drawImage(insulation, 0, 0, size, size);
  const core = Math.max(2, Math.round(half * 2 * 0.6));
  ctx.drawImage(wireEnd, (size - core) / 2, (size - core) / 2, core, core);

  return { side: insulation, end: canvas };
}

async function plainPipeFaces(
  repo: ModelRepository,
  typeName: string,
  color: string,
): Promise<PipeFaces> {
  const side = await repo.layer('gtceu:block/pipe/pipe_side', color);
  const size = PIPE_SIZES.find((s) => typeName.includes(s)) ?? 'normal';
  const end =
    (await repo.layer(`gtceu:block/pipe/pipe_${size}_in`, color)) ??
    (await repo.layer('gtceu:block/pipe/pipe_normal_in', color)) ??
    side;
  return { side, end };
}

async function toolIcon(repo: ModelRepository, parts: string[]): Promise<AnyCanvas | null> {
  const [, modelRef, rgb] = parts;
  const model = await repo.model(String(modelRef));
  if (!model) return null;

  const layers: Drawable[] = [];
  for (let i = 0; i < MAX_TOOL_LAYERS; i++) {
    const ref = repo.resolveSlot(model.textures, `layer${i}`);
    if (!ref) continue;
    const layer = await repo.layer(ref, i === TOOL_HEAD_LAYER ? `#${rgb}` : null);
    if (layer) layers.push(layer);
  }
  return layers.length ? flatIcon(layers) : null;
}

/**
 * A fluid, drawn as a round icon. GregTech's fluid textures are near-white and tinted in game, so
 * the material colour has to be applied here or gases come out invisible.
 */
export async function fluidIcon(
  repo: ModelRepository,
  key: string,
  materials: Record<string, unknown>,
): Promise<AnyCanvas | null> {
  const [namespace, path] = splitResourceLocation(key);

  if (key === 'minecraft:water' || key === 'minecraft:flowing_water') {
    const layer = await repo.layer('minecraft:block/water_still', WATER_COLOR);
    return layer ? flatIcon([layer], true) : null;
  }

  const attempts: [ref: string, color: string | null][] = [];

  if (namespace === 'gtceu') {
    const materialName = path.replace(/^(molten|liquid)_/, '').replace(/_(plasma|gas)$/, '');
    const material = (materials[materialName] ?? materials[path]) as string | undefined;

    attempts.push([
      `gtceu:block/fluids/fluid.${path}`,
      material ? `#${material.split('|')[0]}` : null,
    ]);

    if (material) {
      const [rgb, , set] = material.split('|');
      const state = /^molten_/.test(path)
        ? 'molten'
        : /_plasma$/.test(path)
          ? 'plasma'
          : /_gas$/.test(path)
            ? 'gas'
            : 'liquid';
      attempts.push([`gtceu:block/fluids/fluid.${materialName}`, `#${rgb}`]);
      attempts.push([`gtceu:block/material_sets/${set}/${state}`, `#${rgb}`]);
      attempts.push([`gtceu:block/material_sets/dull/${state}`, `#${rgb}`]);
    }
  }

  // Where other mods tend to keep their still-fluid textures.
  for (const ref of [
    `${namespace}:block/${path}_still`,
    `${namespace}:block/fluid/${path}_still`,
    `${namespace}:fluid/${path}_still`,
    `${namespace}:block/fluids/${path}_still`,
    `${namespace}:block/${path}`,
    `${namespace}:fluid/${path}`,
  ]) {
    attempts.push([ref, null]);
  }

  for (const [ref, color] of attempts) {
    const layer = ref.includes('material_sets')
      ? await repo.materialSetTexture(ref, color)
      : await repo.layer(ref, color);
    if (layer) return flatIcon([layer], true);
  }
  return null;
}
