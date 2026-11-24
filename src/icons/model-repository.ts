/**
 * Loading models and textures out of an instance's assets.
 *
 * Minecraft models inherit: a model names a parent, overrides some texture slots, and may or may
 * not carry its own geometry. Texture slots can also point at each other (`"#side"`), so resolving
 * one means following the chain. This class flattens all of that into a single `ResolvedModel` and
 * caches both models and decoded textures, because a single atlas build asks for the same parent
 * models thousands of times.
 */
import { tinted, type Drawable } from './canvas';
import { AssetFS, modelPath, texturePath } from './asset-fs';

/** A model after its parent chain has been flattened. */
export interface ResolvedModel {
  /** Texture slot -> reference, which may still be a `#slot` alias. */
  textures: Record<string, string>;
  /** Parent references, nearest last — used to guess whether a model is a block shape. */
  chain: string[];
  /** Inherits from `item/generated` or `item/handheld`, i.e. it is flat layered artwork. */
  layered: boolean;
  elements: unknown[] | null;
  display: Record<string, unknown>;
}

/** Guard against a cyclic or absurdly deep parent chain. */
const MAX_MODEL_DEPTH = 24;
/** Guard against a cyclic texture alias (`"#a": "#b", "#b": "#a"`). */
const MAX_ALIAS_HOPS = 10;
/** How many icon-set parents to walk (shiny -> metallic -> dull). */
const MAX_ICON_SET_HOPS = 8;

const MATERIAL_SET = /material_sets\/([^/]+)\//;

export class ModelRepository {
  private readonly models = new Map<string, Promise<ResolvedModel | null>>();
  private readonly textures = new Map<string, Promise<Drawable | null>>();

  constructor(
    readonly fs: AssetFS,
    /** GregTech icon set -> the set it falls back to, from the export. */
    private readonly iconSets: Record<string, unknown> = {},
  ) {}

  /** A decoded texture, or null when the instance does not have it. */
  texture(ref: string): Promise<Drawable | null> {
    const path = texturePath(ref);
    const cached = this.textures.get(path);
    if (cached) return cached;

    const loading = this.decodeTexture(path);
    this.textures.set(path, loading);
    return loading;
  }

  private async decodeTexture(path: string): Promise<Drawable | null> {
    const bytes = await this.fs.bytes(path);
    if (!bytes) return null;
    try {
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/png' }));
      // An animated texture is a vertical strip of frames; the first frame is the icon.
      if (bitmap.height > bitmap.width) {
        return await createImageBitmap(bitmap, 0, 0, bitmap.width, bitmap.width);
      }
      return bitmap;
    } catch {
      return null;
    }
  }

  /** A texture, optionally multiplied by a colour. */
  async layer(ref: string | null | undefined, color?: string | null): Promise<Drawable | null> {
    if (!ref) return null;
    const texture = await this.texture(ref);
    if (!texture) return null;
    return color ? tinted(texture, color) : texture;
  }

  /** A model by reference, or an inline model object. */
  model(ref: string | Record<string, unknown>, depth = 0): Promise<ResolvedModel | null> {
    const key = typeof ref === 'string' ? ref : null;
    if (key) {
      const cached = this.models.get(key);
      if (cached) return cached;
    }

    const loading = this.resolveModel(ref, depth);
    if (key) this.models.set(key, loading);
    return loading;
  }

  private async resolveModel(
    ref: string | Record<string, unknown>,
    depth: number,
  ): Promise<ResolvedModel | null> {
    const raw =
      typeof ref === 'string' ? await this.fs.json<Record<string, unknown>>(modelPath(ref)) : ref;
    if (!raw || depth > MAX_MODEL_DEPTH) return null;

    const fromBlockstate = await this.resolveBlockstateVariant(raw, depth);
    if (fromBlockstate) return fromBlockstate;

    const parentRef = raw['parent'] == null ? '' : String(raw['parent']);
    const base = parentRef
      ? ((await this.model(parentRef, depth + 1)) ?? emptyModel())
      : emptyModel();

    return {
      textures: {
        ...base.textures,
        ...(raw['texture_overrides'] as Record<string, string> | undefined),
        ...(raw['textures'] as Record<string, string> | undefined),
      },
      chain: parentRef ? [...base.chain, parentRef] : base.chain,
      layered: base.layered || /item\/(generated|handheld)/.test(parentRef),
      elements: Array.isArray(raw['elements']) ? raw['elements'] : base.elements,
      display: { ...base.display, ...(raw['display'] as Record<string, unknown> | undefined) },
    };
  }

  /**
   * GregTech machine "models" are really blockstates with one inline model per state. Any state
   * will do for an icon, so take the first and keep this model's texture overrides on top.
   */
  private async resolveBlockstateVariant(
    raw: Record<string, unknown>,
    depth: number,
  ): Promise<ResolvedModel | null> {
    const variants = raw['variants'];
    if (!variants || typeof variants !== 'object' || Array.isArray(variants)) return null;

    const first = Object.values(variants)[0] as Record<string, unknown> | undefined;
    const inner = (first?.['model'] ?? first) as Record<string, unknown> | undefined;
    if (!inner || typeof inner !== 'object') return null;

    const resolved = await this.model(inner, depth + 1);
    if (!resolved) return null;
    return {
      ...resolved,
      textures: {
        ...(raw['texture_overrides'] as Record<string, string> | undefined),
        ...resolved.textures,
      },
    };
  }

  /** Follow a texture slot through any `#alias` indirection to a real reference. */
  resolveSlot(textures: Record<string, string>, slot: string): string | null {
    let value: string | undefined = textures[slot];
    for (let i = 0; i < MAX_ALIAS_HOPS && typeof value === 'string' && value.startsWith('#'); i++) {
      value = textures[value.slice(1)];
    }
    return typeof value === 'string' && !value.startsWith('#') ? value : null;
  }

  /**
   * A GregTech material-set texture, falling back through the set's parents when a material does
   * not define its own: shiny -> metallic -> dull.
   */
  async materialSetTexture(
    ref: string | null | undefined,
    color?: string | null,
  ): Promise<Drawable | null> {
    if (!ref) return null;
    let current: string = ref;
    for (let i = 0; i < MAX_ICON_SET_HOPS; i++) {
      const layer = await this.layer(current, color);
      if (layer) return layer;

      const next = this.parentSetRef(current);
      if (!next) return null;
      current = next;
    }
    return null;
  }

  /** The same reference pointing at the icon set's parent, or null if there is no parent left. */
  parentSetRef(ref: string): string | null {
    const match = MATERIAL_SET.exec(ref);
    if (!match) return null;
    const set = match[1]!;
    const parent = (this.iconSets[set] as string | undefined) ?? (set !== 'dull' ? 'dull' : '');
    if (!parent) return null;
    return ref.replace(`material_sets/${set}/`, `material_sets/${parent}/`);
  }
}

function emptyModel(): ResolvedModel {
  return { textures: {}, chain: [], layered: false, elements: null, display: {} };
}
