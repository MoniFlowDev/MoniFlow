/* MoniFlow — item and machine icons, built in the browser from your instance's own assets */
'use strict';

const ICON_PX = 64;          // size of one icon in the atlas (16px textures scale 4x, pixel-perfect)
const ATLAS_COLS = 64;       // icons per row in one atlas page
const PAGE_ICONS = 4096;     // icons per page (64 x 64 icons = 4096 x 4096 px at 64px)

/* ---------------- zip reading (jar = zip) ---------------- */

class ZipReader {
  constructor(blob, name) { this.blob = blob; this.name = name; this.entries = new Map(); this.nested = []; }

  async open() {
    const size = this.blob.size;
    const tailLen = Math.min(size, 66000);
    const tail = new DataView(await this.blob.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(`${this.name} is not a zip/jar file`);
    const count = tail.getUint16(eocd + 10, true);
    const cdSize = tail.getUint32(eocd + 12, true);
    const cdOff = tail.getUint32(eocd + 16, true);
    const cd = new DataView(await this.blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const dec = new TextDecoder();
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      const csize = cd.getUint32(p + 20, true);
      const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
      const off = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      // Only models and textures matter for icons.
      if (name.startsWith('assets/') && (name.endsWith('.json') || name.endsWith('.png'))) this.entries.set(name, { method, csize, off });
      else if (/^META-INF\/jarjar\/[^/]+\.jar$/i.test(name)) { this.entries.set(name, { method, csize, off }); this.nested.push(name); }
      p += 46 + nlen + xlen + clen;
    }
    return this;
  }

  async read(name) {
    const e = this.entries.get(name);
    if (!e) return null;
    const lh = new DataView(await this.blob.slice(e.off, e.off + 30).arrayBuffer());
    const start = e.off + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const data = this.blob.slice(start, start + e.csize);
    if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
    if (e.method === 8) {
      const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return null;
  }
}

/** Layered view of every assets/ file: loose files (KubeJS) > mod jars > vanilla jar. */
class AssetFS {
  constructor() { this.map = new Map(); this.jsonCache = new Map(); }
  addFile(path, file) { if (!this.map.has(path)) this.map.set(path, { file }); }
  addZip(zip) { for (const name of zip.entries.keys()) if (name.startsWith('assets/') && !this.map.has(name)) this.map.set(name, { zip }); }
  has(path) { return this.map.has(path); }
  /** Texture path by namespace + file name, searching subfolders (item textures preferred). */
  findTexture(ns, name) {
    if (!this.byName) {
      this.byName = new Map();
      for (const p of this.map.keys()) {
        const m = p.match(/^assets\/([^/]+)\/textures\/(.+\/)?([^/]+)\.png$/);
        if (!m) continue;
        const k = `${m[1]}|${m[3]}`;
        const prev = this.byName.get(k);
        if (!prev || (/\/textures\/item/.test(p) && !/\/textures\/item/.test(prev))) this.byName.set(k, p);
      }
    }
    return this.byName.get(`${ns}|${name}`) || null;
  }
  async bytes(path) {
    const s = this.map.get(path);
    if (!s) return null;
    try { return s.file ? new Uint8Array(await s.file.arrayBuffer()) : await s.zip.read(path); } catch (e) { return null; }
  }
  async json(path) {
    if (this.jsonCache.has(path)) return this.jsonCache.get(path);
    let v = null;
    const b = await this.bytes(path);
    if (b) { try { v = JSON.parse(new TextDecoder().decode(b)); } catch (e) { v = null; } }
    this.jsonCache.set(path, v);
    return v;
  }
}

const splitRL = ref => {
  let s = String(ref).replace(/^#/, '');
  const i = s.indexOf(':');
  return i < 0 ? ['minecraft', s] : [s.slice(0, i), s.slice(i + 1)];
};
const modelPath = ref => { const [ns, p] = splitRL(ref); return `assets/${ns}/models/${p}.json`; };
const texturePath = ref => {
  let [ns, p] = splitRL(ref);
  p = p.replace(/^textures\//, '').replace(/\.png$/, '');
  return `assets/${ns}/textures/${p}.png`;
};

/* ---------------- drawing helpers ---------------- */

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tinted(src, color) {
  const c = makeCanvas(src.width, src.height);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(src, 0, 0);
  if (!color) return c;
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(src, 0, 0);
  return c;
}

/** Stack layers (bitmaps/canvases, already tinted) into one square face. */
function stack(layers, shade) {
  const n = Math.max(...layers.map(l => l.width));
  const c = makeCanvas(n, n);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  for (const l of layers) x.drawImage(l, 0, 0, l.width, l.height, 0, 0, n, n);
  if (shade) {
    x.globalCompositeOperation = 'source-atop';
    x.fillStyle = `rgba(0,0,0,${shade})`;
    x.fillRect(0, 0, n, n);
  }
  return c;
}

function flatIcon(layers, round) {
  const c = makeCanvas(ICON_PX, ICON_PX);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const P = ICON_PX, inset = round ? Math.round(P / 16) : 0;
  if (round) { x.beginPath(); x.arc(P / 2, P / 2, P / 2 - inset, 0, Math.PI * 2); x.clip(); }
  const face = stack(layers);
  x.drawImage(face, 0, 0, face.width, face.height, inset, inset, P - inset * 2, P - inset * 2);
  return c;
}

/** Isometric block: top, front (left) and side (right) faces. Drawn at 2x, then scaled down smoothly. */
function cubeIcon(top, front, side) {
  const P = ICON_PX, B = P * 2, u = B / 64;
  const big = makeCanvas(B, B);
  const x = big.getContext('2d');
  x.imageSmoothingEnabled = false;
  const draw = (face, a, b, c, d, e, f) => {
    const n = face.width;
    x.setTransform(a / n, b / n, c / n, d / n, e, f);
    x.drawImage(face, 0, 0);
  };
  draw(stack(top), 28 * u, 14 * u, -28 * u, 14 * u, 32 * u, 4 * u);
  draw(stack(front, 0.2), 28 * u, 14 * u, 0, 28 * u, 4 * u, 18 * u);
  draw(stack(side, 0.4), 28 * u, -14 * u, 0, 28 * u, 32 * u, 32 * u);
  x.setTransform(1, 0, 0, 1, 0, 0);
  const c = makeCanvas(ICON_PX, ICON_PX);
  const y = c.getContext('2d');
  y.imageSmoothingEnabled = true;
  y.drawImage(big, 0, 0, B, B, 0, 0, P, P);
  return c;
}

/* ---------------- 3D block-model rendering ---------------- */

// Minecraft's default inventory camera for blocks (from minecraft:block/block).
const DEFAULT_GUI = { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.625, 0.625, 0.625] };
const FACE_SHADE = { up: 1.0, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };

/** Face corners as [top-left, top-right, bottom-right, bottom-left] in texture orientation. */
function faceCorners(dir, f, t) {
  const [fx, fy, fz] = f, [tx, ty, tz] = t;
  switch (dir) {
    case 'north': return [[tx, ty, fz], [fx, ty, fz], [fx, fy, fz], [tx, fy, fz]];
    case 'south': return [[fx, ty, tz], [tx, ty, tz], [tx, fy, tz], [fx, fy, tz]];
    case 'west': return [[fx, ty, fz], [fx, ty, tz], [fx, fy, tz], [fx, fy, fz]];
    case 'east': return [[tx, ty, tz], [tx, ty, fz], [tx, fy, fz], [tx, fy, tz]];
    case 'up': return [[fx, ty, fz], [tx, ty, fz], [tx, ty, tz], [fx, ty, tz]];
    case 'down': return [[fx, fy, tz], [tx, fy, tz], [tx, fy, fz], [fx, fy, fz]];
  }
  return null;
}

/** UVs Minecraft uses when a face doesn't specify any. */
function defaultUV(dir, f, t) {
  const [fx, fy, fz] = f, [tx, ty, tz] = t;
  switch (dir) {
    case 'north': return [16 - tx, 16 - ty, 16 - fx, 16 - fy];
    case 'south': return [fx, 16 - ty, tx, 16 - fy];
    case 'west': return [fz, 16 - ty, tz, 16 - fy];
    case 'east': return [16 - tz, 16 - ty, 16 - fz, 16 - fy];
    case 'up': return [fx, fz, tx, tz];
    case 'down': return [fx, 16 - tz, tx, 16 - fz];
  }
  return [0, 0, 16, 16];
}

function rotateAround(p, origin, axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p[0] - origin[0], y = p[1] - origin[1], z = p[2] - origin[2];
  let r;
  if (axis === 'x') r = [x, y * c - z * s, y * s + z * c];
  else if (axis === 'y') r = [x * c + z * s, y, -x * s + z * c];
  else r = [x * c - y * s, x * s + y * c, z];
  return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

/** Rotation matrix for Minecraft's display rotation (JOML rotationXYZ: Rx * Ry * Rz). */
function displayMatrix(rot) {
  const [ax, ay, az] = rot.map(d => d * Math.PI / 180);
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A, B) => A.map((row, i) => B[0].map((_, j) => row.reduce((s, v, k) => s + v * B[k][j], 0)));
  return mul(mul(Rx, Ry), Rz);
}

const shadeCache = new WeakMap();
function shadedTexture(tex, shade) {
  if (shade >= 0.999) return tex;
  let m = shadeCache.get(tex);
  if (!m) { m = new Map(); shadeCache.set(tex, m); }
  const key = shade.toFixed(2);
  if (m.has(key)) return m.get(key);
  const c = makeCanvas(tex.width, tex.height);
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  x.drawImage(tex, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = `rgba(0,0,0,${(1 - shade).toFixed(3)})`;
  x.fillRect(0, 0, c.width, c.height);
  m.set(key, c);
  return c;
}

/**
 * Render model elements the way the inventory shows them.
 * texFor(textureRef) -> bitmap/canvas (already loaded). Drawn at 2x and scaled down smoothly.
 */
function renderModel3D(elements, texFor, gui) {
  const g = Object.assign({}, DEFAULT_GUI, gui || {});
  const R = displayMatrix(g.rotation || [0, 0, 0]);
  const S = g.scale || [1, 1, 1], T = g.translation || [0, 0, 0];
  const transform = p => {
    const v = [(p[0] - 8) / 16 * S[0], (p[1] - 8) / 16 * S[1], (p[2] - 8) / 16 * S[2]];
    return [
      R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2] + T[0] / 16,
      R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2] + T[1] / 16,
      R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2] + T[2] / 16,
    ];
  };
  const quads = [];
  for (const el of elements || []) {
    if (!el || !el.from || !el.to || !el.faces) continue;
    const rot = el.rotation && el.rotation.angle ? el.rotation : null;
    for (const dir of Object.keys(el.faces)) {
      const face = el.faces[dir];
      const tex = face && texFor(face.texture);
      if (!tex) continue;
      let pts = faceCorners(dir, el.from, el.to);
      if (!pts) continue;
      if (rot) pts = pts.map(p => rotateAround(p, rot.origin || [8, 8, 8], rot.axis || 'y', rot.angle));
      const c = pts.map(transform);
      // Outward normal = down x right; visible when it points at the camera (+z).
      const a = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]];
      const b = [c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]];
      const nz = b[0] * a[1] - b[1] * a[0];
      if (nz <= 1e-7) continue;
      quads.push({
        c, tex, dir,
        depth: (c[0][2] + c[1][2] + c[2][2] + c[3][2]) / 4,
        uv: Array.isArray(face.uv) && face.uv.length === 4 ? face.uv : defaultUV(dir, el.from, el.to),
        rotation: ((Number(face.rotation) || 0) / 90 | 0) & 3,
        shade: el.shade === false ? 1 : FACE_SHADE[dir] || 1,
      });
    }
  }
  if (!quads.length) return null;
  quads.sort((p, q) => p.depth - q.depth);

  const PX = ICON_PX * 2;
  const big = makeCanvas(PX, PX);
  const ctx = big.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (const q of quads) {
    const sp = q.c.map(v => [PX / 2 + v[0] * PX, PX / 2 - v[1] * PX]);
    const k = q.tex.width / 16;
    const [u1, v1, u2, v2] = q.uv;
    const base = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
    const tc = [0, 1, 2, 3].map(i => base[(i + q.rotation) % 4]).map(([u, v]) => [u * k, v * k]);
    const du1 = tc[1][0] - tc[0][0], dv1 = tc[1][1] - tc[0][1];
    const du3 = tc[3][0] - tc[0][0], dv3 = tc[3][1] - tc[0][1];
    const det = du1 * dv3 - du3 * dv1;
    if (Math.abs(det) < 1e-9) continue;
    const ex1 = sp[1][0] - sp[0][0], ey1 = sp[1][1] - sp[0][1];
    const ex3 = sp[3][0] - sp[0][0], ey3 = sp[3][1] - sp[0][1];
    const A = (ex1 * dv3 - ex3 * dv1) / det, C = (ex3 * du1 - ex1 * du3) / det;
    const B = (ey1 * dv3 - ey3 * dv1) / det, D = (ey3 * du1 - ey1 * du3) / det;
    const E = sp[0][0] - A * tc[0][0] - C * tc[0][1];
    const F = sp[0][1] - B * tc[0][0] - D * tc[0][1];
    // Clip to the face, grown a hair so neighbouring faces don't leave seams.
    const cx = (sp[0][0] + sp[1][0] + sp[2][0] + sp[3][0]) / 4, cy = (sp[0][1] + sp[1][1] + sp[2][1] + sp[3][1]) / 4;
    ctx.save();
    ctx.beginPath();
    sp.forEach(([x, y], i) => {
      const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
      const grow = 0.4 * PX / 64;
      const gx = x + dx / l * grow, gy = y + dy / l * grow;
      if (i) ctx.lineTo(gx, gy); else ctx.moveTo(gx, gy);
    });
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(A, B, C, D, E, F);
    ctx.drawImage(shadedTexture(q.tex, q.shade), 0, 0);
    ctx.restore();
  }
  const out = makeCanvas(ICON_PX, ICON_PX);
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = true;
  o.drawImage(big, 0, 0, PX, PX, 0, 0, ICON_PX, ICON_PX);
  return out;
}

/* ---------------- the builder ---------------- */

const TIER_KEYS = ['ulv', 'lv', 'mv', 'hv', 'ev', 'iv', 'luv', 'zpm', 'uv', 'uhv', 'uev', 'uiv', 'uxv', 'opv', 'max'];
const VANILLA_MACHINE_ITEMS = {
  crafting: 'minecraft:crafting_table', smelting: 'minecraft:furnace', blasting: 'minecraft:blast_furnace',
  smoking: 'minecraft:smoker', campfire_cooking: 'minecraft:campfire', stonecutting: 'minecraft:stonecutter',
  smithing: 'minecraft:smithing_table',
};

class IconBuilder {
  constructor(fs, game) {
    this.fs = fs;
    this.gt = (game && game.icons && game.icons.gtIcons) || {};
    this.materials = (game && game.icons && game.icons.gtMaterials) || {};
    this.iconSets = (game && game.icons && game.icons.iconSets) || {};
    this.modelCache = new Map();
    this.imgCache = new Map();
  }

  async img(ref) {
    const path = texturePath(ref);
    if (this.imgCache.has(path)) return this.imgCache.get(path);
    const p = (async () => {
      const b = await this.fs.bytes(path);
      if (!b) return null;
      try {
        let bmp = await createImageBitmap(new Blob([b], { type: 'image/png' }));
        if (bmp.height > bmp.width) bmp = await createImageBitmap(bmp, 0, 0, bmp.width, bmp.width); // animated: first frame
        return bmp;
      } catch (e) { return null; }
    })();
    this.imgCache.set(path, p);
    return p;
  }

  async model(refOrObj, depth = 0) {
    const key = typeof refOrObj === 'string' ? refOrObj : null;
    if (key && this.modelCache.has(key)) return this.modelCache.get(key);
    const p = (async () => {
      const m = typeof refOrObj === 'string' ? await this.fs.json(modelPath(refOrObj)) : refOrObj;
      if (!m || depth > 24) return null;
      // GregTech machine models: one inline model per state; use the first.
      if (m.variants && typeof m.variants === 'object' && !Array.isArray(m.variants)) {
        const first = Object.values(m.variants)[0];
        const inner = first && (first.model || first);
        if (inner && typeof inner === 'object') {
          const r = await this.model(inner, depth + 1);
          if (r) return { textures: Object.assign({}, m.texture_overrides || {}, r.textures), chain: r.chain, layered: r.layered, elements: r.elements, display: r.display };
        }
      }
      let base = { textures: {}, chain: [] };
      if (m.parent) base = (await this.model(String(m.parent), depth + 1)) || base;
      const parent = String(m.parent || '');
      return {
        textures: Object.assign({}, base.textures, m.texture_overrides || {}, m.textures || {}),
        chain: base.chain.concat(parent ? [parent] : []),
        layered: base.layered || /item\/(generated|handheld)/.test(parent),
        elements: Array.isArray(m.elements) ? m.elements : base.elements || null,
        display: Object.assign({}, base.display || {}, m.display || {}),
      };
    })();
    if (key) this.modelCache.set(key, p);
    return p;
  }

  tex(T, k) {
    let v = T[k];
    for (let i = 0; i < 10 && typeof v === 'string' && v.startsWith('#'); i++) v = T[v.slice(1)];
    return typeof v === 'string' && !v.startsWith('#') ? v : null;
  }

  async layer(ref, color) {
    if (!ref) return null;
    const b = await this.img(ref);
    return b ? (color ? tinted(b, color) : b) : null;
  }

  /** Try a GregTech material-set texture, falling back to parent icon sets (e.g. shiny -> metallic -> dull). */
  async gtTexture(ref, color) {
    if (!ref) return null;
    let r = ref;
    for (let i = 0; i < 8; i++) {
      const l = await this.layer(r, color);
      if (l) return l;
      const m = r.match(/material_sets\/([^/]+)\//);
      if (!m) return null;
      const parent = this.iconSets[m[1]] || (m[1] !== 'dull' ? 'dull' : '');
      if (!parent) return null;
      r = r.replace(`material_sets/${m[1]}/`, `material_sets/${parent}/`);
    }
    return null;
  }

  async gtIcon(data) {
    const parts = data.split('|');
    if (parts[0] === 'pipe') return this.gtPipeIcon(parts);
    if (parts[0] === 'tool') return this.gtToolIcon(parts);
    const [kind, base, sec, , rgb, srgb, , oreBase] = parts;
    // Items: use GregTech's own model for this material style, e.g. material_sets/metallic/ingot_hot
    // = ingot + secondary + overlay + the glowing hot overlay. Layer 0 takes the material colour,
    // layer 1 the secondary colour, the rest (highlights, hot glow) are drawn as they are.
    if (kind === 'item') {
      const fromModel = await this.gtModelLayers(base, '#' + rgb, '#' + srgb);
      if (fromModel) return flatIcon(fromModel);
    }
    const layers = [];
    const b = await this.gtTexture(base, '#' + rgb);
    if (!b) return null;
    layers.push(b);
    const s = await this.gtTexture(sec, '#' + srgb);
    if (s) layers.push(s);
    // (The export's "overlay" field repeats the secondary texture, so derive the overlay name instead.)
    const o = await this.gtTexture(String(base).replace(/(_secondary)?$/, '') + '_overlay', null);
    if (o) layers.push(o);
    if (kind === 'block' && oreBase) {
      // Ore: the stone block underneath, ore texture on top.
      const m = await this.model(oreBase);
      const T = m ? m.textures : {};
      const stoneRef = this.tex(T, 'all') || this.tex(T, 'side') || this.tex(T, 'texture') || this.tex(T, 'particle') || this.tex(T, 'end');
      const stone = await this.layer(stoneRef);
      if (stone) { const l = [stone].concat(layers); return cubeIcon(l, l, l); }
    }
    return kind === 'block' ? cubeIcon(layers, layers, layers) : flatIcon(layers);
  }

  /** Layers from a GregTech material-set item model, following the icon set's parents if needed. */
  async gtModelLayers(textureRef, primary, secondary) {
    let ref = String(textureRef || '');
    if (!ref.includes('material_sets/')) return null;
    for (let i = 0; i < 8 && ref; i++) {
      const m = await this.model(ref);
      if (m && m.textures && m.textures.layer0) {
        const layers = [];
        for (let k = 0; k < 6; k++) {
          const t = this.tex(m.textures, 'layer' + k);
          if (!t) continue;
          const l = await this.gtTexture(t, k === 0 ? primary : k === 1 ? secondary : null);
          if (l) layers.push(l);
        }
        if (layers.length) return layers;
      }
      const mm = ref.match(/material_sets\/([^/]+)\//);
      const parent = mm && (this.iconSets[mm[1]] || (mm[1] !== 'dull' ? 'dull' : ''));
      ref = parent ? ref.replace(`material_sets/${mm[1]}/`, `material_sets/${parent}/`) : '';
    }
    return null;
  }

  async gtPipeIcon(parts) {
    const [, kind, typeName, thick, rgb, , set] = parts;
    const t = Math.min(1, Math.max(0.1875, Number(thick) || 0.5));
    const h = t * 8;
    let side, end;
    if (kind === 'wire' || kind === 'cable') {
      const wireSide = await this.gtTexture(`gtceu:block/material_sets/${set || 'dull'}/wire_side`, '#' + rgb);
      const wireEnd = await this.gtTexture(`gtceu:block/material_sets/${set || 'dull'}/wire_end`, '#' + rgb) || wireSide;
      if (kind === 'wire') { side = wireSide; end = wireEnd; }
      else {
        // Cable: insulation outside, the wire core showing at the ends.
        const sizes = ['single', 'double', 'quadruple', 'octal', 'hex'];
        const idx = Math.max(0, sizes.findIndex(z => String(typeName).includes(z)));
        const ins = (await this.layer(`gtceu:block/cable/insulation_${idx}`, '#404040')) || (await this.layer('gtceu:block/cable/insulation_0', '#404040'));
        side = ins || wireSide;
        if (ins && wireEnd) {
          const n = 16, c = makeCanvas(n, n), x = c.getContext('2d');
          x.imageSmoothingEnabled = false;
          x.drawImage(ins, 0, 0, n, n);
          const core = Math.max(2, Math.round(h * 2 * 0.6));
          x.drawImage(wireEnd, (n - core) / 2, (n - core) / 2, core, core);
          end = c;
        } else end = wireEnd;
      }
    } else {
      side = await this.layer('gtceu:block/pipe/pipe_side', '#' + rgb);
      const size = ['tiny', 'small', 'normal', 'large', 'huge', 'quadruple', 'nonuple'].find(z => String(typeName).includes(z)) || 'normal';
      end = (await this.layer(`gtceu:block/pipe/pipe_${size}_in`, '#' + rgb)) || (await this.layer('gtceu:block/pipe/pipe_normal_in', '#' + rgb)) || side;
    }
    if (!side) return null;
    const faces = { north: { texture: '#end' }, south: { texture: '#end' }, up: { texture: '#side' }, down: { texture: '#side' }, east: { texture: '#side' }, west: { texture: '#side' } };
    const elements = [{ from: [8 - h, 8 - h, 0], to: [8 + h, 8 + h, 16], faces }];
    return renderModel3D(elements, ref => (ref === '#end' ? end : side), { rotation: [30, 225, 0], translation: [0, 0, 0], scale: [0.8, 0.8, 0.8] });
  }

  async gtToolIcon(parts) {
    const [, modelRef, rgb] = parts;
    const m = await this.model(modelRef);
    if (!m) return null;
    const layers = [];
    for (let i = 0; i < 5; i++) {
      const ref = this.tex(m.textures, 'layer' + i);
      if (!ref) continue;
      // GregTech tints the tool head (layer 1) with the material colour.
      const l = await this.layer(ref, i === 1 ? '#' + rgb : null);
      if (l) layers.push(l);
    }
    return layers.length ? flatIcon(layers) : null;
  }

  async fluidIcon(key) {
    const [ns, path] = splitRL(key);
    if (key === 'minecraft:water' || key === 'minecraft:flowing_water') {
      const l = await this.layer('minecraft:block/water_still', '#3f76e4');
      return l ? flatIcon([l], true) : null;
    }
    const tries = [];
    if (ns === 'gtceu') {
      const matName = path.replace(/^(molten|liquid)_/, '').replace(/_(plasma|gas)$/, '');
      const mat = this.materials[matName] || this.materials[path];
      // GregTech fluid textures are pale and get tinted in game with the material colour.
      tries.push([`gtceu:block/fluids/fluid.${path}`, mat ? '#' + mat.split('|')[0] : null]);
      if (mat) {
        const [rgb, , set] = mat.split('|');
        const state = /^molten_/.test(path) ? 'molten' : /_plasma$/.test(path) ? 'plasma' : /_gas$/.test(path) ? 'gas' : 'liquid';
        tries.push([`gtceu:block/fluids/fluid.${matName}`, '#' + rgb]);
        tries.push([`gtceu:block/material_sets/${set}/${state}`, '#' + rgb]);
        tries.push([`gtceu:block/material_sets/dull/${state}`, '#' + rgb]);
      }
    }
    for (const p of [`${ns}:block/${path}_still`, `${ns}:block/fluid/${path}_still`, `${ns}:fluid/${path}_still`, `${ns}:block/fluids/${path}_still`, `${ns}:block/${path}`, `${ns}:fluid/${path}`]) tries.push([p, null]);
    for (const [ref, color] of tries) {
      const l = ref.includes('material_sets') ? await this.gtTexture(ref, color) : await this.layer(ref, color);
      if (l) return flatIcon([l], true);
    }
    return null;
  }

  async itemIcon(key) {
    if (this.gt[key]) {
      const g = await this.gtIcon(this.gt[key]);
      if (g) return g;
    }
    const [ns, path] = splitRL(key);
    let m = await this.model(`${ns}:item/${path}`);
    if (!m || !Object.keys(m.textures).length) m = await this.model(`${ns}:block/${path}`);
    if (!m || !Object.keys(m.textures).length) {
      // Block items without an item model: follow the blockstate to its model.
      const bs = await this.fs.json(`assets/${ns}/blockstates/${path}.json`);
      let ref = null;
      if (bs && bs.variants) { const v = Object.values(bs.variants)[0]; ref = Array.isArray(v) ? v[0] && v[0].model : v && v.model; }
      if (!ref && bs && Array.isArray(bs.multipart)) { const a = bs.multipart[0] && bs.multipart[0].apply; ref = Array.isArray(a) ? a[0] && a[0].model : a && a.model; }
      if (ref) m = await this.model(String(ref));
    }
    if (!m || !Object.keys(m.textures).length) {
      // Last resort: a texture named after the item (common for KubeJS and code-rendered items).
      for (const ref of [`${ns}:item/${path}`, `${ns}:block/${path}`, `${ns}:items/${path}`, `${ns}:blocks/${path}`]) {
        const l = await this.layer(ref);
        if (l) return flatIcon([l]);
      }
      const found = this.fs.findTexture(ns, path);
      if (found) {
        const l = await this.layer(found.replace(/^assets\/([^/]+)\/textures\//, '$1:').replace(/\.png$/, ''));
        if (l) return flatIcon([l]);
      }
      return null;
    }
    const T = m.textures;
    if (T.layer0 && (m.layered || !(T.all || T.side || T.top))) {
      const layers = [];
      for (let i = 0; i < 5; i++) { const l = await this.layer(this.tex(T, 'layer' + i)); if (l) layers.push(l); }
      return layers.length ? flatIcon(layers) : null;
    }
    if (Array.isArray(m.elements) && m.elements.length) {
      const icon = await this.elementsIcon(m);
      if (icon) return icon;
    }
    const pick = (...keys) => { for (const k of keys) { const v = this.tex(T, k); if (v) return v; } return null; };
    const topRef = pick('top', 'up', 'end', 'all', 'side', 'texture', 'particle');
    const frontRef = pick('front', 'north', 'side', 'all', 'texture', 'particle');
    const sideRef = pick('side', 'east', 'west', 'all', 'texture', 'particle', 'front');
    const cubeish = T.all || T.side || T.top || T.front || T.north || T.end || T.texture ||
      m.chain.some(c => /block\/(cube|block|orientable|template)/.test(c));
    if (cubeish && (topRef || frontRef)) {
      const top = [await this.layer(topRef || frontRef)].filter(Boolean);
      const front = [await this.layer(frontRef || topRef)].filter(Boolean);
      const side = [await this.layer(sideRef || frontRef || topRef)].filter(Boolean);
      const ovTop = await this.layer(this.tex(T, 'overlay_top'));
      const ovFront = await this.layer(this.tex(T, 'overlay_front'));
      if (ovTop) top.push(ovTop);
      if (ovFront) front.push(ovFront);
      if (top.length && front.length && side.length) return cubeIcon(top, front, side);
    }
    const any = pick('particle') || Object.keys(T).map(k => this.tex(T, k)).find(Boolean);
    const l = await this.layer(any);
    return l ? flatIcon([l]) : null;
  }

  /** Load every texture a model's faces use, then render it in 3D. */
  async elementsIcon(m) {
    const T = m.textures;
    const refs = new Map();
    for (const el of m.elements) {
      if (!el || !el.faces) continue;
      for (const f of Object.values(el.faces)) {
        if (!f || !f.texture || refs.has(f.texture)) continue;
        const ref = String(f.texture).startsWith('#') ? this.tex(T, f.texture.slice(1)) : f.texture;
        let l = ref ? await this.layer(ref) : null;
        // Grass, leaves and vines are grey in the jar and tinted in game.
        if (l && f.tintindex != null && /grass|leaves|vine|lily|fern/.test(ref)) l = tinted(l, '#7ab55c');
        refs.set(f.texture, l);
      }
    }
    return renderModel3D(m.elements, r => refs.get(r) || null, m.display && m.display.gui);
  }

  /** Item ids that could represent the machine for a recipe type, keyed by tier name ('' = untiered). */
  machineCandidates(type, itemIds) {
    const [ns, path] = splitRL(type);
    const out = {};
    if (ns === 'minecraft') {
      const base = path.replace(/_(shaped|shapeless).*$/, '').replace(/^smithing_.*/, 'smithing');
      const v = VANILLA_MACHINE_ITEMS[base] || VANILLA_MACHINE_ITEMS[path] || (/crafting|shaped|shapeless/.test(path) ? VANILLA_MACHINE_ITEMS.crafting : null);
      if (v) out[''] = v;
      return out;
    }
    if (/^((crafting|impostor)_)?(shaped|shapeless)/.test(path)) { out[''] = VANILLA_MACHINE_ITEMS.crafting; return out; }
    for (const t of TIER_KEYS) { const id = `${ns}:${t}_${path}`; if (itemIds.has(id)) out[t] = id; }
    for (const id of [`${ns}:${path}`, `${ns}:large_${path}`, `${ns}:machine_${path}`, `${ns}:${path}_machine`, `${ns}:mechanical_${path}`, `${ns}:${path}er`, `${ns}:${path}_table`]) {
      if (itemIds.has(id)) { out[''] = id; break; }
    }
    if (!out[''] && Object.keys(out).length) out[''] = out[Object.keys(out)[0]];
    return out;
  }

  /**
   * Build the atlas. items: [{ key, fluid }]; types: recipe type ids; itemIds: every item id in the game.
   */
  async build(items, types, itemIds, onProgress) {
    const machines = {};
    const extra = new Set();
    for (const t of types) {
      const c = this.machineCandidates(t, itemIds);
      if (Object.keys(c).length) { machines[t] = c; for (const id of Object.values(c)) extra.add(id); }
    }
    const seen = new Set(items.map(i => i.key));
    const todo = items.concat([...extra].filter(k => !seen.has(k)).map(key => ({ key, fluid: false })));
    // Pages of up to PAGE_ICONS icons keep each image within browser canvas limits.
    const pages = [];
    let page = null, pageCtx = null;
    const index = {};
    let slot = 0, done = 0;
    const BATCH = 48;
    const finishPage = async () => {
      if (!page) return;
      const used = slot - pages.length * PAGE_ICONS;
      const rows = Math.max(1, Math.ceil(used / ATLAS_COLS));
      const trimmed = makeCanvas(ATLAS_COLS * ICON_PX, rows * ICON_PX);
      trimmed.getContext('2d').drawImage(page, 0, 0);
      const blob = trimmed.convertToBlob ? await trimmed.convertToBlob({ type: 'image/png' }) : await new Promise(r => trimmed.toBlob(r, 'image/png'));
      pages.push({ blob, width: trimmed.width, height: trimmed.height });
      page = null; pageCtx = null;
    };
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async it => {
        try { return it.fluid ? await this.fluidIcon(it.key) : await this.itemIcon(it.key); } catch (e) { return null; }
      }));
      for (let j = 0; j < results.length; j++) {
        const c = results[j];
        if (!c) continue;
        if (!page) {
          page = makeCanvas(ATLAS_COLS * ICON_PX, (PAGE_ICONS / ATLAS_COLS) * ICON_PX);
          pageCtx = page.getContext('2d');
        }
        const s2 = slot - pages.length * PAGE_ICONS;
        pageCtx.drawImage(c, (s2 % ATLAS_COLS) * ICON_PX, Math.floor(s2 / ATLAS_COLS) * ICON_PX, ICON_PX, ICON_PX);
        index[batch[j].key] = slot++;
        if (slot % PAGE_ICONS === 0) await finishPage();
      }
      done += batch.length;
      onProgress && onProgress(done, todo.length, slot);
    }
    await finishPage();
    for (const t of Object.keys(machines)) for (const k of Object.keys(machines[t])) if (index[machines[t][k]] == null) delete machines[t][k];
    return { pages, index, machines, cols: ATLAS_COLS, perPage: PAGE_ICONS, px: ICON_PX, count: slot, total: todo.length, built: new Date().toISOString() };
  }
}

/** Collect jars and loose asset files from an instance folder (directory handle or file list). */
async function collectInstanceSources(source, vanillaJar, onStatus) {
  const loose = [];   // [path, File]
  const jars = [];    // File
  if (source && source.kind === 'directory') {
    const sub = async (dir, name) => { try { return await dir.getDirectoryHandle(name); } catch (e) { return null; } };
    let root = source;
    // Accept the instance folder itself or its "minecraft" / ".minecraft" folder.
    const mc = (await sub(root, 'minecraft')) || (await sub(root, '.minecraft'));
    if (!(await sub(root, 'mods')) && mc) root = mc;
    const mods = await sub(root, 'mods');
    if (mods) for await (const [n, h] of mods.entries()) if (h.kind === 'file' && /\.jar$/i.test(n)) jars.push(await h.getFile());
    const kjs = await sub(root, 'kubejs');
    const assets = kjs && await sub(kjs, 'assets');
    const walk = async (dir, prefix) => {
      for await (const [n, h] of dir.entries()) {
        if (h.kind === 'directory') await walk(h, `${prefix}${n}/`);
        else if (/\.(png|json)$/i.test(n)) loose.push([`${prefix}${n}`, await h.getFile()]);
      }
    };
    if (assets) await walk(assets, 'assets/');
  } else if (source && source.length) {
    for (const f of source) {
      const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
      const mods = rel.match(/(^|\/)mods\/([^/]+\.jar)$/i);
      if (mods) { jars.push(f); continue; }
      const a = rel.match(/(^|\/)kubejs\/(assets\/.+\.(png|json))$/i);
      if (a) loose.push([a[2], f]);
    }
  }
  onStatus && onStatus(`Found ${jars.length} mod jars and ${loose.length} KubeJS asset files`);
  const fs = new AssetFS();
  for (const [p, f] of loose) fs.addFile(p, f);
  let i = 0;
  let nestedCount = 0;
  const addJar = async (blob, name, depth) => {
    let z;
    try { z = await new ZipReader(blob, name).open(); } catch (e) { return; }
    fs.addZip(z);
    // Forge "jar-in-jar": mods bundled inside other mods (e.g. AE2 inside Monilabs).
    if (depth < 2) {
      for (const n of z.nested) {
        const bytes = await z.read(n);
        if (bytes) { nestedCount++; await addJar(new Blob([bytes]), n.split('/').pop(), depth + 1); }
      }
    }
  };
  for (const j of jars) {
    await addJar(j, j.name, 0);
    if (++i % 20 === 0) onStatus && onStatus(`Reading mod jars… ${i}/${jars.length}`);
  }
  onStatus && onStatus(`Read ${jars.length} mod jars (+${nestedCount} bundled inside them)`);
  if (vanillaJar) { try { fs.addZip(await new ZipReader(vanillaJar, vanillaJar.name).open()); } catch (e) { onStatus && onStatus('Could not read the Minecraft jar'); } }
  return { fs, jars: jars.length, loose: loose.length, vanilla: !!vanillaJar };
}

/* ---------------- displaying icons ---------------- */

const lineColorCache = new Map();

function hexToRgb(h) { const v = parseInt(String(h).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

/**
 * The colour a line should have for an item: its GregTech material colour, else the average colour of
 * its icon, else a stable generated colour. Then toned for the dark background: lightness kept in a
 * readable band and saturation capped so lines never go neon or fight the tier colours on nodes;
 * grey materials stay neutral.
 */
function itemLineColor(item, fluid) {
  if (lineColorCache.has(item)) return lineColorCache.get(item);
  let rgb = null;
  const gi = typeof gameData !== 'undefined' && gameData && gameData.icons && gameData.icons.gtIcons;
  const entry = gi && gi[item];
  if (entry) {
    const p = entry.split('|');
    const hex = p[0] === 'tool' ? p[2] : p[4];
    if (/^[0-9a-f]{6}$/i.test(hex || '')) rgb = hexToRgb(hex);
  }
  if (!rgb && fluid) {
    const c = fluidColor(item);
    if (c && c.startsWith('#')) rgb = hexToRgb(c);
  }
  if (!rgb) rgb = IconStore.iconColor(item);
  let color;
  if (!rgb) color = itemColor(item, fluid);
  else {
    let [h, s, l] = rgbToHsl(rgb);
    if (s < 0.12) { s = 0; l = Math.min(0.8, Math.max(0.58, l)); }      // greys and whites
    else { s = Math.min(0.72, Math.max(0.35, s)); l = Math.min(0.72, Math.max(0.56, l)); }
    color = `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
  }
  // Only cache once icon colours are available (or not needed), so lines update after loading.
  if (!IconStore.data || IconStore.images) lineColorCache.set(item, color);
  return color;
}

/**
 * Colour of a fluid for backgrounds: its GregTech material colour when the export has it,
 * otherwise a stable colour from its name. Gas textures are nearly transparent until tinted.
 */
function fluidColor(item) {
  const mats = (typeof gameData !== 'undefined' && gameData && gameData.icons && gameData.icons.gtMaterials) || {};
  const path = String(item).split(':').pop();
  const name = path.replace(/^(molten|liquid)_/, '').replace(/_(plasma|gas)$/, '');
  const m = mats[name] || mats[path];
  // Many fluids have no real material colour (white, icon set "fluid"): their colour is painted into
  // the texture itself. Use the icon's colour for those.
  if (m && !/^ffffff\|/i.test(m)) return '#' + m.split('|')[0];
  const ic = IconStore.iconColor(item);
  if (ic) return '#' + ic.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  return m ? '#ffffff' : itemColor(item, true);
}

const IconStore = {
  data: null, urls: [],

  async load() {
    try { const d = await GameDB.getKey('icons'); if (d && (d.pages || d.blob)) this.set(d); } catch (e) { /* none yet */ }
  },
  async save(d) { await GameDB.setKey('icons', d); this.set(d); },
  async clear() { await GameDB.setKey('icons', null); this.set(null); },

  set(d) {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls = [];
    if (d && !d.pages && d.blob) d = Object.assign({}, d, { pages: [{ blob: d.blob, width: d.width, height: d.height }], perPage: Infinity, px: d.px || 32 });
    this.data = d;
    if (d) this.urls = d.pages.map(pg => URL.createObjectURL(pg.blob));
    this.images = null;
    this.colorCache = new Map();
    lineColorCache.clear();
    if (d) {
      // Decode the pages for colour sampling, then redraw the graph so lines pick up icon colours.
      Promise.all(this.urls.map(u => { const img = new Image(); img.src = u; return img.decode().then(() => img, () => null); }))
        .then(imgs => {
          if (this.data !== d) return;
          this.images = imgs;
          lineColorCache.clear();
          if (typeof renderFlow === 'function' && typeof activeTab !== 'undefined' && activeTab === 'flow') renderFlow();
        });
    }
  },

  /** Average colour [r, g, b] of an item's icon (opaque pixels only), or null. */
  iconColor(key) {
    if (!this.colorCache) this.colorCache = new Map();
    if (this.colorCache.has(key)) return this.colorCache.get(key);
    const d = this.data, s = d && d.index[key];
    if (s == null || !this.images) return null;
    const pi = Math.floor(s / d.perPage), local = s - pi * (isFinite(d.perPage) ? d.perPage : 0);
    const img = this.images[pi];
    if (!img) return null;
    const px = d.px || ICON_PX;
    if (!this.sampler) { this.sampler = document.createElement('canvas'); this.sampler.width = this.sampler.height = 16; }
    const x = this.sampler.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, 16, 16);
    x.drawImage(img, (local % d.cols) * px, Math.floor(local / d.cols) * px, px, px, 0, 0, 16, 16);
    const data = x.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 120) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    const out = n ? [r / n, g / n, b / n] : null;
    this.colorCache.set(key, out);
    return out;
  },

  /** { url, x, y, w, h, px } for an item's icon, or null. */
  locate(key) {
    const d = this.data;
    if (!d) return null;
    const s = d.index[key];
    if (s == null) return null;
    const pi = Math.floor(s / d.perPage), local = s - pi * (isFinite(d.perPage) ? d.perPage : 0);
    const pg = d.pages[pi];
    if (!pg) return null;
    const px = d.px || ICON_PX;
    return { url: this.urls[pi], x: (local % d.cols) * px, y: Math.floor(local / d.cols) * px, w: pg.width, h: pg.height, px };
  },

  slot(key) { return this.data ? this.data.index[key] : undefined; },

  html(key, px = 16, cls = '') {
    const L = this.locate(key);
    if (!L) return null;
    const sc = px / L.px;
    return `<span class="ico ${cls}" style="width:${px}px;height:${px}px;background-image:url('${L.url}');background-position:-${L.x * sc}px -${L.y * sc}px;background-size:${L.w * sc}px ${L.h * sc}px"></span>`;
  },

  /** Nested <svg> that crops the atlas page to one icon. */
  svg(parent, key, x, y, px) {
    const L = this.locate(key);
    if (!L) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('x', x); svg.setAttribute('y', y);
    svg.setAttribute('width', px); svg.setAttribute('height', px);
    svg.setAttribute('viewBox', `${L.x} ${L.y} ${L.px} ${L.px}`);
    svg.setAttribute('class', 'g-ico');
    const img = document.createElementNS(ns, 'image');
    img.setAttribute('href', L.url);
    img.setAttribute('width', L.w); img.setAttribute('height', L.h);
    svg.appendChild(img);
    parent.appendChild(svg);
    return svg;
  },

  /** Item key whose icon represents a recipe's machine (tier-specific when the game has one). */
  machineKey(recipe, tier) {
    if (!this.data || !recipe) return null;
    const m = this.data.machines[recipe.type];
    if (!m) return null;
    const t = tier != null && TIERS[tier] ? TIERS[tier].name.toLowerCase() : null;
    return (t && m[t]) || m[''] || Object.values(m)[0] || null;
  },
};
