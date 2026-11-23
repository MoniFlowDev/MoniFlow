/* MoniFlow — game recipe import (GregTech CEu JSON from the KubeJS exporter) and storage */
'use strict';

/* ---------------- item naming ---------------- */

// Display names for game ids, filled from the imported dump.
const ITEM_NAMES = new Map();

function prettifyId(id) {
  let s = String(id);
  let tag = false;
  if (s.startsWith('#')) { tag = true; s = s.slice(1); }
  const [ns, path = ns] = s.includes(':') ? s.split(':') : ['', s];
  let words;
  if (tag && path.includes('/')) {
    // forge:dusts/sulfur -> "Sulfur Dust"
    const [prefix, ...rest] = path.split('/');
    const single = prefix.replace(/ies$/, 'y').replace(/(ches|shes|xes|sses)$/, m => m.slice(0, -2)).replace(/s$/, '');
    words = `${rest.join(' ')} ${single}`;
  } else {
    words = path.replace(/\//g, ' ');
  }
  const TIER_WORDS = { ulv: 'ULV', lv: 'LV', mv: 'MV', hv: 'HV', ev: 'EV', iv: 'IV', luv: 'LuV', zpm: 'ZPM', uv: 'UV', uhv: 'UHV', uev: 'UEV', uiv: 'UIV', uxv: 'UXV', opv: 'OpV', max: 'MAX' };
  const out = words.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
    .map(w => TIER_WORDS[w.toLowerCase()] || w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return tag ? `${out} (any)` : out;
}

/* ---- Minecraft text formatting (§ codes) ---- */

// Colours tuned for a dark background (black and dark blue are lifted so they stay readable).
const MC_COLORS = {
  '0': '#8a8a8a', '1': '#5b6cff', '2': '#00c000', '3': '#00c0c0', '4': '#d23a3a', '5': '#c040c0',
  '6': '#ffaa00', '7': '#bdbdbd', '8': '#7a7a7a', '9': '#6f7cff', a: '#55ff55', b: '#55ffff',
  c: '#ff5555', d: '#ff55ff', e: '#ffff55', f: null,
};
const MC_CODE_RE = /\u00a7([0-9a-fk-or])/gi;

function mcStrip(text) { return String(text == null ? '' : text).replace(/\u00a7[0-9a-fk-orx]/gi, ''); }

/** Split "§5Advanced §lAlloy§r" into styled segments. */
function mcSegments(text) {
  const str = String(text == null ? '' : text);
  const segs = [];
  let style = { color: null, bold: false, italic: false, underline: false, strike: false, obf: false };
  let last = 0, m;
  MC_CODE_RE.lastIndex = 0;
  const push = end => { if (end > last) segs.push(Object.assign({ text: str.slice(last, end) }, style)); };
  while ((m = MC_CODE_RE.exec(str)) !== null) {
    push(m.index);
    const c = m[1].toLowerCase();
    if (c in MC_COLORS) style = { color: MC_COLORS[c], bold: false, italic: false, underline: false, strike: false, obf: false };
    else if (c === 'l') style = Object.assign({}, style, { bold: true });
    else if (c === 'o') style = Object.assign({}, style, { italic: true });
    else if (c === 'n') style = Object.assign({}, style, { underline: true });
    else if (c === 'm') style = Object.assign({}, style, { strike: true });
    else if (c === 'k') style = Object.assign({}, style, { obf: true });
    else if (c === 'r') style = { color: null, bold: false, italic: false, underline: false, strike: false, obf: false };
    last = m.index + 2;
  }
  push(str.length);
  return segs;
}

const htmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escaped HTML with coloured spans for § codes. */
function mcHtml(text) {
  const segs = mcSegments(text);
  if (segs.length === 1 && !segs[0].color && !segs[0].bold && !segs[0].italic && !segs[0].underline && !segs[0].strike) return htmlEsc(segs[0].text);
  return segs.map(sg => {
    const css = [];
    if (sg.color) css.push(`color:${sg.color}`);
    if (sg.bold) css.push('font-weight:700');
    if (sg.italic) css.push('font-style:italic');
    const deco = [sg.underline && 'underline', sg.strike && 'line-through'].filter(Boolean).join(' ');
    if (deco) css.push(`text-decoration:${deco}`);
    return css.length ? `<span style="${css.join(';')}">${htmlEsc(sg.text)}</span>` : htmlEsc(sg.text);
  }).join('');
}

/** Raw display name (may contain § codes). */
function inameRaw(key) {
  if (key == null) return '';
  const n = ITEM_NAMES.get(key);
  if (n) return n;
  if (/^#?[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(key)) return prettifyId(key);
  return key;
}

/** Plain display name for an item key (formatting removed). Custom recipes use names; game recipes use ids. */
function iname(key) { return mcStrip(inameRaw(key)); }

/** Display name as escaped, coloured HTML. */
function inameHtml(key) { return mcHtml(inameRaw(key)); }

/* ---------------- GregTech JSON parsing ---------------- */

function avgProvider(p) {
  if (p == null) return null;
  if (typeof p === 'number') return p;
  if (p.type && /uniform/.test(p.type)) {
    const v = p.value || p;
    const lo = +(v.min_inclusive ?? v.min ?? 0), hi = +(v.max_inclusive ?? v.max ?? lo);
    return (lo + hi) / 2;
  }
  if (p.type && /constant/.test(p.type)) return +(p.value ?? 0);
  if (p.type && /binomial/.test(p.type)) return +(p.n ?? 0) * +(p.p ?? 0);
  if (p.value != null && typeof p.value === 'number') return p.value;
  return null;
}

/** First concrete id from a (possibly nested) vanilla/forge ingredient. */
function ingredientKey(ing) {
  if (ing == null) return null;
  if (Array.isArray(ing)) { for (const x of ing) { const k = ingredientKey(x); if (k) return k; } return null; }
  if (typeof ing === 'string') return ing.startsWith('#') ? ing : ing;
  if (ing.type === 'gtceu:circuit') return null;
  if (ing.item) return String(ing.item);
  if (ing.tag) return '#' + ing.tag;
  if (ing.fluid) return String(ing.fluid);
  if (ing.ingredient) return ingredientKey(ing.ingredient);
  if (ing.inner) return ingredientKey(ing.inner);
  if (ing.children) return ingredientKey(ing.children);
  if (ing.values) return ingredientKey(ing.values);
  if (ing.value) return ingredientKey(ing.value);
  if (ing.items) return ingredientKey(ing.items);
  if (ing.base) return ingredientKey(ing.base);
  if (ing.id) return String(ing.id);
  return null;
}

/** Parse one GregTech item content -> { key, count } or null (circuits / unknown). */
function parseItemContent(c) {
  if (c == null) return null;
  let count = 1;
  let ing = c;
  if (c.type === 'gtceu:circuit' || (c.ingredient && c.ingredient.type === 'gtceu:circuit')) return null;
  if (c.count_provider || c.countProvider) {
    const a = avgProvider(c.count_provider || c.countProvider);
    if (a != null) count = a;
  } else if (c.count != null) count = +c.count;
  else if (c.amount != null) count = +c.amount;
  if (c.ingredient) ing = c.ingredient;
  else if (c.inner) ing = c.inner;
  // Int-provider wrapper inside.
  if (ing && (ing.count_provider || ing.countProvider) && (ing.inner || ing.ingredient)) {
    const a = avgProvider(ing.count_provider || ing.countProvider);
    if (a != null) count = a;
    ing = ing.inner || ing.ingredient;
  }
  if (ing && ing.count != null && ing !== c && count === 1) count = +ing.count;
  const key = ingredientKey(ing);
  if (!key) return null;
  return { key, count: count || 0 };
}

/** Parse one GregTech fluid content -> { key, amount } or null. */
function parseFluidContent(c) {
  if (c == null) return null;
  let amount = c.amount ?? c.Amount ?? c.count;
  if (c.count_provider) { const a = avgProvider(c.count_provider); if (a != null) amount = a; }
  let key = null;
  if (Array.isArray(c.value)) key = ingredientKey(c.value);
  else if (c.value) key = ingredientKey(c.value);
  if (!key && c.fluid) key = String(c.fluid);
  if (!key && c.FluidName) key = String(c.FluidName);
  if (!key && c.ingredient) { const inner = parseFluidContent(c.ingredient); if (inner) { key = inner.key; if (amount == null) amount = inner.amount; } }
  if (!key && c.tag) key = '#' + c.tag;
  if (!key) return null;
  return { key, amount: +(amount ?? 1000) };
}

function contentList(group, cap) {
  if (!group) return [];
  const list = group[cap];
  return Array.isArray(list) ? list : [];
}

function chanceOf(entry) {
  const max = +(entry.maxChance ?? 10000) || 10000;
  const ch = entry.chance == null ? max : +entry.chance;
  return ch / max;
}

function parseEu(tickInputs) {
  let eu = 0;
  for (const e of contentList(tickInputs, 'eu')) {
    const c = e.content;
    if (typeof c === 'number') eu += c;
    else if (c && typeof c === 'object') eu += (+(c.voltage ?? c.eu ?? 0)) * (+(c.amperage ?? 1));
    else if (typeof c === 'string') eu += +c || 0;
  }
  return eu;
}

const VANILLA_MACHINES = {
  'minecraft:crafting': 'Crafting Table',
  'minecraft:smelting': 'Furnace',
  'minecraft:blasting': 'Blast Furnace (vanilla)',
  'minecraft:smoking': 'Smoker',
  'minecraft:campfire_cooking': 'Campfire',
  'minecraft:stonecutting': 'Stonecutter',
  'minecraft:smithing': 'Smithing Table',
};
const MOD_NAMES = {
  enderio: 'EnderIO', ae2: 'AE2', extendedcrafting: 'Extended Crafting', thermal: 'Thermal', create: 'Create',
  mekanism: 'Mekanism', botania: 'Botania', ad_astra: 'Ad Astra', sophisticatedbackpacks: 'Sophisticated Backpacks',
  kubejs: 'KubeJS', systeams: 'Systeams', laserio: 'LaserIO', functionalstorage: 'Functional Storage',
};
const titleCase = s => String(s).replace(/[_/]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());

function machineFromType(type) {
  type = String(type || 'unknown');
  if (VANILLA_MACHINES[type]) return VANILLA_MACHINES[type];
  const [ns, path] = type.includes(':') ? type.split(':') : ['', type];
  // crafting_shaped, crafting_shapeless, crafting_shaped_strict, impostor_shaped, shaped (KubeJS)...
  if (/^((crafting|impostor)_)?(shaped|shapeless)(_strict)?$/.test(path)) return 'Crafting Table';
  const base = titleCase(path);
  if (!ns || ns === 'gtceu' || ns === 'minecraft') return base;
  return `${base} (${MOD_NAMES[ns] || titleCase(ns)})`;
}

/**
 * Convert an exporter dump into MoniFlow recipes.
 * Returns { recipes, names, stats }.
 */
function parseGameDump(dump) {
  if (!dump || !Array.isArray(dump.recipes)) throw new Error('This file does not look like a MoniFlow export (no "recipes" list).');
  const tags = dump.tags || {};
  const itemInfo = dump.itemInfo || {};
  /**
   * Crafting ingredients that come back: tools lose one use per craft (cost = 1/durability),
   * containers return something (a water bucket gives back the empty bucket), some are kept.
   */
  const applyLeftovers = (inputs, outputs) => {
    for (const i of inputs) {
      const v = itemInfo[i.item];
      if (!v) continue;
      if (v.startsWith('d:')) {
        const uses = +v.slice(2);
        if (uses > 0) { i.uses = uses; i.amount = i.amount / uses; stats.tools = (stats.tools || 0) + 1; }
      } else if (v === 'k') {
        i.kept = true; i.amount = 0;
      } else if (v.startsWith('r:')) {
        const back = v.slice(2);
        if (back && back !== i.item) {
          const o = outputs.find(x => x.item === back);
          if (o) o.amount += i.amount; else outputs.push({ item: back, amount: i.amount, returned: true });
        }
      }
    }
  };
  const items = dump.items || {};
  const fluidsById = dump.fluids || {};
  const fluidIdsByPath = new Map();
  for (const id of Object.keys(fluidsById)) {
    const path = id.split(':').pop();
    if (!fluidIdsByPath.has(path) || id.startsWith('gtceu:')) fluidIdsByPath.set(path, id);
  }

  const stats = { total: dump.recipes.length, parsed: 0, skipped: 0, generators: 0, errors: 0, types: new Map() };
  // Item ids by path, for resolving tags the exporter couldn't (gtceu first).
  const itemsByPath = new Map();
  for (const id of Object.keys(items)) {
    const path = id.split(':').pop();
    if (!itemsByPath.has(path) || id.startsWith('gtceu:')) itemsByPath.set(path, id);
  }
  const singular = w => w.replace(/ies$/, 'y').replace(/(ches|shes|xes|sses)$/, m => m.slice(0, -2)).replace(/s$/, '');
  const guessTag = tag => {
    // forge:plates/tungsten_carbide -> gtceu:tungsten_carbide_plate ; forge:storage_blocks/x -> x_block
    const path = tag.split(':').pop();
    const parts = path.split('/');
    if (parts.length < 2) return itemsByPath.get(path) || null;
    const prefix = parts[0], material = parts.slice(1).join('_');
    const single = singular(prefix);
    const cands = [`${material}_${single}`, `${single}_${material}`, `${material}`];
    // fine_wires/copper -> fine_copper_wire, double_wires/x -> double_x_wire
    if (single.includes('_')) { const i = single.indexOf('_'); cands.push(`${single.slice(0, i)}_${material}_${single.slice(i + 1)}`); }
    if (prefix === 'storage_blocks') cands.unshift(`${material}_block`);
    if (prefix === 'raw_materials') cands.unshift(`raw_${material}`);
    if (prefix === 'gems') cands.unshift(`${material}_gem`, material);
    for (const c of cands) if (itemsByPath.has(c)) return itemsByPath.get(c);
    return null;
  };
  stats.tagGuesses = 0;
  stats.tagUnresolved = 0;
  const tagCache = new Map();
  const resolveItem = key => {
    if (!key.startsWith('#')) return key;
    if (tagCache.has(key)) return tagCache.get(key);
    let list = tags[key.slice(1)];
    if (typeof list === 'string') list = list.split('|'); // exporter stores "id1|id2"
    let out;
    if (list && list.length) out = list.find(id => id.startsWith('gtceu:')) || list[0];
    else {
      const g = guessTag(key.slice(1));
      if (g) { out = g; stats.tagGuesses++; } else { out = key; stats.tagUnresolved++; }
    }
    tagCache.set(key, out);
    return out;
  };
  const resolveFluid = key => {
    if (!key.startsWith('#')) return key;
    const path = key.slice(1).split(':').pop().split('/').pop();
    return fluidIdsByPath.get(path) || key;
  };

  // Names first, so recipes can be titled with the in-game product name.
  const names = {};
  for (const k of Object.keys(items)) if (items[k]) names[k] = items[k];
  for (const k of Object.keys(fluidsById)) if (fluidsById[k] && !names[k]) names[k] = fluidsById[k];
  ITEM_NAMES.clear();
  for (const k in names) ITEM_NAMES.set(k, names[k]);

  const recipes = [];
  const seenIds = new Set();

  const fromCompact = (c, resolve) => {
    const list = Array.isArray(c) ? c : [];
    return list.filter(x => x && x.id && +x.n > 0).map(x => {
      const o = { item: x.f ? resolveFluid(String(x.id)) : resolveItem(String(x.id)), amount: +x.n };
      if (x.f) o.fluid = true;
      if (x.c != null && +x.c < 1) o.chance = +(+x.c * 100).toFixed(2);
      return o;
    });
  };

  for (const entry of dump.recipes) {
    let id = null, type = null, parsed = null;
    try {
      if (entry && typeof entry === 'object' && (entry.gt || entry.generic)) {
        // Compact form written by the exporter: GregTech fallback or another mod's recipe.
        const c = entry.gt || entry.generic;
        id = entry.id;
        type = String(entry.type || (entry.gt ? 'gtceu:unknown' : 'unknown'));
        if (+c.gen > 0) { stats.generators++; continue; }
        parsed = {
          duration: Math.max(0, +c.duration || 0),
          eut: Math.max(0, +c.eut || 0),
          inputs: fromCompact(c.in),
          outputs: fromCompact(c.out),
          temp: +c.temp || 0,
          cond: c.clean ? (/sterile/i.test(String(c.clean)) ? 'Sterile cleanroom' : 'Cleanroom') : null,
          kind: entry.gt ? 'gt' : 'generic',
        };
        if (!entry.gt) applyLeftovers(parsed.inputs, parsed.outputs);
      } else {
        let j;
        if (typeof entry === 'string') { j = JSON.parse(entry); id = j.id; }
        else if (entry && typeof entry.json === 'string') { j = JSON.parse(entry.json); id = entry.id; }
        else if (entry && entry.json) { j = entry.json; id = entry.id; }
        else { j = entry; id = entry && entry.id; }
        if (!j || typeof j !== 'object') { stats.skipped++; continue; }
        type = String(j.type || (entry && entry.type) || 'gtceu:unknown');
        // Generator fuels produce EU instead of using it.
        if (contentList(j.tickOutputs, 'eu').length) { stats.generators++; continue; }
        const inputs = [], outputs = [];
        for (const e of contentList(j.inputs, 'item')) {
          if (chanceOf(e) === 0) continue; // not consumed
          const p = parseItemContent(e.content);
          if (p && p.count > 0) inputs.push({ item: resolveItem(p.key), amount: p.count });
        }
        for (const e of contentList(j.inputs, 'fluid')) {
          if (chanceOf(e) === 0) continue;
          const p = parseFluidContent(e.content);
          if (p && p.amount > 0) inputs.push({ item: resolveFluid(p.key), amount: p.amount, fluid: true });
        }
        for (const e of contentList(j.outputs, 'item')) {
          const p = parseItemContent(e.content);
          if (!p || !(p.count > 0)) continue;
          const o = { item: resolveItem(p.key), amount: p.count };
          const ch = chanceOf(e);
          if (ch < 1) o.chance = +(ch * 100).toFixed(2);
          outputs.push(o);
        }
        for (const e of contentList(j.outputs, 'fluid')) {
          const p = parseFluidContent(e.content);
          if (!p || !(p.amount > 0)) continue;
          const o = { item: resolveFluid(p.key), amount: p.amount, fluid: true };
          const ch = chanceOf(e);
          if (ch < 1) o.chance = +(ch * 100).toFixed(2);
          outputs.push(o);
        }
        const dur = Math.max(1, +j.duration || 1);
        // Per-tick fluids (rare): count them per craft.
        for (const e of contentList(j.tickInputs, 'fluid')) {
          const p = parseFluidContent(e.content);
          if (p && p.amount > 0) inputs.push({ item: resolveFluid(p.key), amount: p.amount * dur, fluid: true });
        }
        const conds = Array.isArray(j.recipeConditions) ? j.recipeConditions : [];
        const clean = conds.find(c => c && /cleanroom/.test(String(c.type || '')));
        parsed = {
          duration: dur, eut: parseEu(j.tickInputs), inputs, outputs,
          temp: +(j.data && (j.data.ebf_temp ?? j.data.temperature)) || 0,
          cond: clean ? (clean.cleanroom && /sterile/.test(String(clean.cleanroom)) ? 'Sterile cleanroom' : 'Cleanroom') : null,
          recycling: /recycling/.test(String(j.category || '')),
          kind: 'gt',
        };
      }
    } catch (e) { stats.errors++; continue; }

    try {
      if (!parsed.outputs.length) { stats.skipped++; continue; }
      let rid = 'g:' + String(id || type + ':' + recipes.length);
      if (seenIds.has(rid)) rid += '#' + recipes.length;
      seenIds.add(rid);
      const r = {
        id: rid,
        name: iname(parsed.outputs[0].item) || machineFromType(type),
        machine: machineFromType(type),
        type,
        duration: parsed.kind === 'gt' ? Math.max(1, parsed.duration) : parsed.duration,
        eut: parsed.eut,
        inputs: parsed.inputs, outputs: parsed.outputs,
        src: 'game',
      };
      if (parsed.temp) r.temp = parsed.temp;
      if (parsed.cond) r.cond = parsed.cond;
      if (parsed.recycling) r.recycling = true;
      if (parsed.kind === 'generic') r.mod = type.split(':')[0];
      recipes.push(r);
      stats.parsed++;
      if (parsed.kind === 'generic') stats.other = (stats.other || 0) + 1; else stats.gregtech = (stats.gregtech || 0) + 1;
      stats.types.set(r.machine, (stats.types.get(r.machine) || 0) + 1);
    } catch (e) {
      stats.errors++;
    }
  }

  const icons = { gtIcons: dump.gtIcons || {}, gtMaterials: dump.gtMaterials || {}, iconSets: dump.iconSets || {} };
  stats.toolsNormalized = normalizeTools(recipes, { gtIcons: icons.gtIcons, itemInfo, names });
  return { recipes, names, stats, icons, itemInfo, meta: { exported: dump.exported || null, gtceu: dump.gtceu || null, exportErrors: Array.isArray(dump.errors) ? dump.errors.slice(0, 10) : (dump.errors && typeof dump.errors === 'object' ? Object.values(dump.errors).map(String).slice(0, 11) : []) } };
}

/* ---------------- tools in crafting recipes ---------------- */

const TOOL_TIER_PREFIX = /^(ulv|lv|mv|hv|ev|iv|luv|zpm|uv|uhv|uev|uiv|uxv|opv)_/;
const TOOL_TYPE_ALIASES = { wirecutter: 'wire_cutter', chainsaw: 'saw', buzzsaw: 'saw' };
const BASIC_TOOL_MATERIALS = ['iron', 'steel', 'wrought_iron', 'bronze', 'rubber', 'wood'];
const ESTIMATED_TOOL_USES = 256;

/**
 * Crafting recipes accept "any wrench/hammer/file…" (a tag), and the export picks an arbitrary member,
 * often an electric or exotic one. Swap GregTech tools for a basic version (iron, steel, bronze…) and
 * charge one use per craft. Durability comes from the export (itemInfo) when known, else an estimate.
 * Safe to run more than once.
 */
function normalizeTools(recipes, ctx) {
  const gt = (ctx && ctx.gtIcons) || {};
  const info = (ctx && ctx.itemInfo) || {};
  const names = (ctx && ctx.names) || {};
  const toolType = id => {
    const v = gt[id];
    if (!v || !v.startsWith('tool|')) return null;
    let t = v.split('|')[1].split('/').pop().replace(TOOL_TIER_PREFIX, '');
    return TOOL_TYPE_ALIASES[t] || t;
  };
  const basicCache = new Map();
  const basicFor = type => {
    if (basicCache.has(type)) return basicCache.get(type);
    let id = null;
    for (const m of BASIC_TOOL_MATERIALS) { const c = `gtceu:${m}_${type}`; if (names[c] || gt[c]) { id = c; break; } }
    basicCache.set(type, id);
    return id;
  };
  const usesOf = id => { const v = info[id]; return v && v.startsWith('d:') ? +v.slice(2) : 0; };
  let changed = 0;
  for (const r of recipes) {
    if (r.mod == null) continue; // only crafting-style recipes use tools this way
    for (const i of r.inputs) {
      if (i.toolNormalized) continue;
      const type = toolType(i.item);
      if (!type) continue;
      const count = i.uses ? i.amount * i.uses : i.amount; // tools used per craft (normally 1)
      const basic = basicFor(type) || i.item;
      const known = usesOf(basic);
      i.item = basic;
      i.uses = known || ESTIMATED_TOOL_USES;
      if (!known) i.usesEstimated = true;
      i.amount = count / i.uses;
      i.toolNormalized = true;
      changed++;
    }
  }
  return changed;
}

/* ---------------- IndexedDB storage for the (large) game recipe set ---------------- */

const GameDB = {
  name: 'moniflow',
  store: 'gamedata',
  open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(this.store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async getKey(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(this.store, 'readonly').objectStore(this.store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async setKey(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, 'readwrite');
      if (value == null) tx.objectStore(this.store).delete(key); else tx.objectStore(this.store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async get() {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(this.store, 'readonly');
        const req = tx.objectStore(this.store).get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return null; }
  },
  async set(value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.store, 'readwrite');
      if (value == null) tx.objectStore(this.store).delete('current');
      else tx.objectStore(this.store).put(value, 'current');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};
