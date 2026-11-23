/**
 * Finding the assets in a Minecraft instance.
 *
 * You point MoniFlow at your instance folder and we read it in place — nothing is uploaded or
 * copied. Two browser APIs can deliver a folder (a `showDirectoryPicker` handle, or an
 * `<input webkitdirectory>` file list), and both are handled here so the rest of the icon code
 * only ever sees an `AssetFS`.
 *
 * Mod jars can contain other mod jars (Forge's "jar-in-jar", e.g. AE2 bundled inside Monilabs),
 * so jars are read recursively.
 */
import { AssetFS } from './asset-fs';
import { ZipReader } from './zip-reader';

/** How deep to follow bundled jars. Two levels covers every real pack. */
const MAX_JAR_DEPTH = 2;
/** Report progress every this many jars. */
const PROGRESS_EVERY = 20;

/** Either API the browser might give us for a chosen folder. */
export type InstanceSource = FileSystemDirectoryHandle | FileList | File[];

export type StatusReporter = (message: string) => void;

export interface InstanceAssets {
  fs: AssetFS;
  jars: number;
  loose: number;
  vanilla: boolean;
}

export async function collectInstanceAssets(
  source: InstanceSource | null,
  vanillaJar: File | null,
  onStatus?: StatusReporter,
): Promise<InstanceAssets> {
  const { jars, loose } = isDirectoryHandle(source)
    ? await readDirectoryHandle(source)
    : readFileList(source);

  onStatus?.(`Found ${jars.length} mod jars and ${loose.length} KubeJS asset files`);

  const fs = new AssetFS();
  // Loose KubeJS files first: they override what the jars provide.
  for (const [path, file] of loose) fs.addFile(path, file);

  let nested = 0;
  const addJar = async (blob: Blob, name: string, depth: number): Promise<void> => {
    let zip: ZipReader;
    try {
      zip = await new ZipReader(blob, name).open();
    } catch {
      return; // not a readable jar; skip it rather than failing the whole build
    }
    fs.addZip(zip);

    if (depth >= MAX_JAR_DEPTH) return;
    for (const path of zip.nestedJars) {
      const bytes = await zip.read(path);
      if (!bytes) continue;
      nested++;
      await addJar(new Blob([bytes as BlobPart]), path.split('/').pop()!, depth + 1);
    }
  };

  let read = 0;
  for (const jar of jars) {
    await addJar(jar, jar.name, 0);
    if (++read % PROGRESS_EVERY === 0) onStatus?.(`Reading mod jars… ${read}/${jars.length}`);
  }
  onStatus?.(`Read ${jars.length} mod jars (+${nested} bundled inside them)`);

  if (vanillaJar) {
    try {
      fs.addZip(await new ZipReader(vanillaJar, vanillaJar.name).open());
    } catch {
      onStatus?.('Could not read the Minecraft jar');
    }
  }

  return { fs, jars: jars.length, loose: loose.length, vanilla: !!vanillaJar };
}

interface CollectedFiles {
  jars: File[];
  /** `[assets-relative path, file]` */
  loose: [string, File][];
}

function isDirectoryHandle(source: unknown): source is FileSystemDirectoryHandle {
  return !!source && (source as FileSystemDirectoryHandle).kind === 'directory';
}

// Directory iteration yields the base handle type, so narrow it by its `kind` discriminant.
function isFile(handle: FileSystemHandle): handle is FileSystemFileHandle {
  return handle.kind === 'file';
}

function isDirectory(handle: FileSystemHandle): handle is FileSystemDirectoryHandle {
  return handle.kind === 'directory';
}

async function readDirectoryHandle(root: FileSystemDirectoryHandle): Promise<CollectedFiles> {
  const jars: File[] = [];
  const loose: [string, File][] = [];

  const subdirectory = async (
    dir: FileSystemDirectoryHandle,
    name: string,
  ): Promise<FileSystemDirectoryHandle | null> => {
    try {
      return await dir.getDirectoryHandle(name);
    } catch {
      return null;
    }
  };

  // Accept either the instance folder or the `minecraft` folder inside it.
  let base = root;
  const minecraft =
    (await subdirectory(base, 'minecraft')) ?? (await subdirectory(base, '.minecraft'));
  if (!(await subdirectory(base, 'mods')) && minecraft) base = minecraft;

  const mods = await subdirectory(base, 'mods');
  if (mods) {
    for await (const [name, handle] of mods.entries()) {
      if (isFile(handle) && /\.jar$/i.test(name)) jars.push(await handle.getFile());
    }
  }

  const kubejs = await subdirectory(base, 'kubejs');
  const assets = kubejs ? await subdirectory(kubejs, 'assets') : null;
  if (assets) await walkAssets(assets, 'assets/', loose);

  return { jars, loose };
}

async function walkAssets(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: [string, File][],
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    if (isDirectory(handle)) await walkAssets(handle, `${prefix}${name}/`, out);
    else if (isFile(handle) && /\.(png|json)$/i.test(name)) {
      out.push([`${prefix}${name}`, await handle.getFile()]);
    }
  }
}

/** The `<input webkitdirectory>` path: every file at once, with its relative path attached. */
function readFileList(source: FileList | File[] | null): CollectedFiles {
  const jars: File[] = [];
  const loose: [string, File][] = [];
  if (!source) return { jars, loose };

  for (const file of Array.from(source)) {
    const relative = (file.webkitRelativePath || file.name).replace(/\\/g, '/');

    if (/(^|\/)mods\/[^/]+\.jar$/i.test(relative)) {
      jars.push(file);
      continue;
    }
    const asset = /(^|\/)kubejs\/(assets\/.+\.(png|json))$/i.exec(relative);
    if (asset) loose.push([asset[2]!, file]);
  }
  return { jars, loose };
}
