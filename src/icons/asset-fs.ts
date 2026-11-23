/**
 * One flat view of every `assets/` file in an instance.
 *
 * Minecraft resolves assets by priority, and so do we: loose KubeJS files override mod jars, which
 * override the vanilla jar. Since the first source to claim a path wins, callers just add sources
 * in that order and then look paths up without caring where they came from.
 */
import type { ZipReader } from './zip-reader';

type Source = { file: File; zip?: undefined } | { zip: ZipReader; file?: undefined };

/** `assets/<namespace>/textures/<optional dirs>/<name>.png` */
const TEXTURE_PATH = /^assets\/([^/]+)\/textures\/(.+\/)?([^/]+)\.png$/;

export class AssetFS {
  private readonly sources = new Map<string, Source>();
  private readonly jsonCache = new Map<string, unknown>();
  /** Built lazily on first use, since it costs a pass over every asset path. */
  private texturesByName: Map<string, string> | null = null;

  addFile(path: string, file: File): void {
    if (!this.sources.has(path)) this.sources.set(path, { file });
    this.texturesByName = null;
  }

  addZip(zip: ZipReader): void {
    for (const path of zip.entries.keys()) {
      if (path.startsWith('assets/') && !this.sources.has(path)) this.sources.set(path, { zip });
    }
    this.texturesByName = null;
  }

  has(path: string): boolean {
    return this.sources.has(path);
  }

  /**
   * Find a texture by namespace and bare file name, whatever subfolder it sits in. Some mods (and
   * anything that renders its items in code) have no model to follow, and a texture named after
   * the item is the only lead. Item textures win over block textures of the same name.
   */
  findTexture(namespace: string, name: string): string | null {
    if (!this.texturesByName) {
      this.texturesByName = new Map();
      for (const path of this.sources.keys()) {
        const match = TEXTURE_PATH.exec(path);
        if (!match) continue;
        const key = `${match[1]}|${match[3]}`;
        const previous = this.texturesByName.get(key);
        const isItem = /\/textures\/item/.test(path);
        if (!previous || (isItem && !/\/textures\/item/.test(previous))) {
          this.texturesByName.set(key, path);
        }
      }
    }
    return this.texturesByName.get(`${namespace}|${name}`) ?? null;
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const source = this.sources.get(path);
    if (!source) return null;
    try {
      if (source.file) return new Uint8Array(await source.file.arrayBuffer());
      return await source.zip!.read(path);
    } catch {
      return null;
    }
  }

  /** Parsed JSON at a path, or null. Misses are cached too, since models miss constantly. */
  async json<T = unknown>(path: string): Promise<T | null> {
    if (this.jsonCache.has(path)) return this.jsonCache.get(path) as T | null;

    let value: T | null = null;
    const bytes = await this.bytes(path);
    if (bytes) {
      try {
        value = JSON.parse(new TextDecoder().decode(bytes)) as T;
      } catch {
        value = null;
      }
    }
    this.jsonCache.set(path, value);
    return value;
  }
}

/** Split a resource location into namespace and path, defaulting to `minecraft`. */
export function splitResourceLocation(ref: string): [namespace: string, path: string] {
  const s = String(ref).replace(/^#/, '');
  const colon = s.indexOf(':');
  return colon < 0 ? ['minecraft', s] : [s.slice(0, colon), s.slice(colon + 1)];
}

export function modelPath(ref: string): string {
  const [namespace, path] = splitResourceLocation(ref);
  return `assets/${namespace}/models/${path}.json`;
}

export function texturePath(ref: string): string {
  const [namespace, path] = splitResourceLocation(ref);
  const clean = path.replace(/^textures\//, '').replace(/\.png$/, '');
  return `assets/${namespace}/textures/${clean}.png`;
}
