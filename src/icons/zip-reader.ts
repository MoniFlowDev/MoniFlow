/**
 * Reading a jar, which is a zip.
 *
 * We only ever need a handful of files out of a mod jar, so rather than inflate the whole archive
 * we parse the central directory off the end and decompress single entries on demand through the
 * platform's own `DecompressionStream`. Only models, textures and bundled jars are indexed; a
 * typical mod jar's class files are skipped entirely.
 */

/** Zip end-of-central-directory signature. */
const EOCD_SIGNATURE = 0x06054b50;
/** Central-directory file-header signature. */
const CD_SIGNATURE = 0x02014b50;

/** The EOCD sits in the last 64KB (22 fixed bytes plus up to 64KB of comment). */
const MAX_TAIL = 66_000;
const EOCD_SIZE = 22;
const CD_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

const STORED = 0;
const DEFLATED = 8;

/** Forge's "jar-in-jar": mods bundled inside other mods. */
const NESTED_JAR = /^META-INF\/jarjar\/[^/]+\.jar$/i;

interface Entry {
  method: number;
  compressedSize: number;
  offset: number;
}

export class ZipReader {
  readonly entries = new Map<string, Entry>();
  /** Paths of jars bundled inside this one. */
  readonly nestedJars: string[] = [];

  constructor(
    private readonly blob: Blob,
    readonly name: string,
  ) {}

  async open(): Promise<this> {
    const { size } = this.blob;
    const tailLength = Math.min(size, MAX_TAIL);
    const tail = new DataView(await this.blob.slice(size - tailLength).arrayBuffer());

    let eocd = -1;
    for (let i = tailLength - EOCD_SIZE; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${this.name} is not a zip/jar file`);

    const count = tail.getUint16(eocd + 10, true);
    const directorySize = tail.getUint32(eocd + 12, true);
    const directoryOffset = tail.getUint32(eocd + 16, true);
    const directory = new DataView(
      await this.blob.slice(directoryOffset, directoryOffset + directorySize).arrayBuffer(),
    );

    const decoder = new TextDecoder();
    let p = 0;
    for (let i = 0; i < count && p + CD_HEADER_SIZE <= directory.byteLength; i++) {
      if (directory.getUint32(p, true) !== CD_SIGNATURE) break;

      const entry: Entry = {
        method: directory.getUint16(p + 10, true),
        compressedSize: directory.getUint32(p + 20, true),
        offset: directory.getUint32(p + 42, true),
      };
      const nameLength = directory.getUint16(p + 28, true);
      const extraLength = directory.getUint16(p + 30, true);
      const commentLength = directory.getUint16(p + 32, true);
      const path = decoder.decode(
        new Uint8Array(directory.buffer, directory.byteOffset + p + CD_HEADER_SIZE, nameLength),
      );

      if (path.startsWith('assets/') && (path.endsWith('.json') || path.endsWith('.png'))) {
        this.entries.set(path, entry);
      } else if (NESTED_JAR.test(path)) {
        this.entries.set(path, entry);
        this.nestedJars.push(path);
      }

      p += CD_HEADER_SIZE + nameLength + extraLength + commentLength;
    }
    return this;
  }

  /** The bytes of one entry, or null if it is missing or uses a compression method we don't do. */
  async read(path: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(path);
    if (!entry) return null;

    // The central directory does not say how long the local header's variable fields are, so read it.
    const header = new DataView(
      await this.blob.slice(entry.offset, entry.offset + LOCAL_HEADER_SIZE).arrayBuffer(),
    );
    const start =
      entry.offset + LOCAL_HEADER_SIZE + header.getUint16(26, true) + header.getUint16(28, true);
    const data = this.blob.slice(start, start + entry.compressedSize);

    if (entry.method === STORED) return new Uint8Array(await data.arrayBuffer());
    if (entry.method === DEFLATED) {
      const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return null;
  }
}
