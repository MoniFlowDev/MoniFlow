/* MoniFlow — application state and UI */
'use strict';

const STORE_KEY = 'moniflow.v1';
const $ = sel => document.querySelector(sel);
const clone = o => JSON.parse(JSON.stringify(o));
const uid = p => p + Math.random().toString(36).slice(2, 9);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let state;
let solution = null;
let selection = null; // { type: 'recipe', id } | { type: 'item', item, kind }
let activeTab = 'flow';
let gameData = null;          // imported game recipes { recipes, names, meta, stats }
let INDEX = buildIndex([]);   // lookup over your recipes + game recipes
let ITEM_SEARCH = [];         // [{ key, name, lname, fluid, makeable }]
const NAME_TO_KEY = new Map();

let libDirty = true, indexedLib = null, indexedLen = -1;

function rebuildIndex() {
  libDirty = false;
  indexedLib = state.library;
  indexedLen = state.library.length;
  INDEX = buildIndex(gameData ? state.library.concat(gameData.recipes) : state.library);
  NAME_TO_KEY.clear();
  ITEM_SEARCH = [];
  for (const key of INDEX.items) {
    const name = iname(key);
    if (!NAME_TO_KEY.has(name.toLowerCase())) NAME_TO_KEY.set(name.toLowerCase(), key);
    ITEM_SEARCH.push({ key, name, lname: name.toLowerCase(), fluid: INDEX.fluids.has(key), makeable: INDEX.producers.has(key) });
  }
}

/** Map typed text (display name or id) to an item key. */
function keyFromText(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  if (INDEX.items.has(t)) return t;
  return NAME_TO_KEY.get(t.toLowerCase()) || t;
}

/* ---------------- persistence ---------------- */

function newProject(base) {
  return Object.assign({
    id: uid('p_'), name: 'New plan', targets: [], choices: {}, nodes: {},
    defaultTier: 1, defaultCoil: 0, gridTier: 2, autoExpand: true,
    gen: { preset: 0, eut: 32 },
  }, clone(base || {}), { id: uid('p_') });
}

function defaultState() {
  const p = newProject(STARTER_PROJECT);
  return { library: clone(STARTER_RECIPES), projects: [p], activeId: p.id, unit: 's' };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.library) || !Array.isArray(s.projects) || !s.projects.length) return null;
    s.projects = s.projects.map(p => Object.assign(newProject(), p));
    return s;
  } catch (e) { return null; }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }, 200);
}

const project = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];

/* ---------------- helpers ---------------- */

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/**
 * In-app replacement for prompt()/confirm(), which some browsers and embedded views block.
 * Resolves to the entered text (input mode), true (confirm mode), or null when cancelled.
 */
function ask({ title, message = '', input = null, okLabel = 'OK', danger = false }) {
  return new Promise(resolve => {
    const dlg = $('#askDialog'), form = $('#askForm'), field = $('#askInput'), ok = $('#askOk');
    $('#askTitle').textContent = title;
    $('#askMessage').textContent = message;
    field.hidden = input == null;
    field.value = input == null ? '' : input;
    ok.textContent = okLabel;
    ok.classList.toggle('danger-fill', danger);
    let done = false;
    const finish = v => {
      if (done) return;
      done = true;
      form.onsubmit = null;
      $('#askCancel').onclick = null;
      dlg.onclose = null;
      if (dlg.open) dlg.close();
      resolve(v);
    };
    form.onsubmit = e => { e.preventDefault(); finish(input == null ? true : field.value); };
    $('#askCancel').onclick = () => finish(null);
    dlg.onclose = () => finish(null);
    dlg.showModal();
    if (input != null) { field.focus(); field.select(); } else ok.focus();
  });
}

function tierBadge(t) {
  const tier = TIERS[t];
  return `<span class="tier" style="color:${tier.color}">${tier.name}</span>`;
}

/** Tier badge for EU recipes; neutral label for unpowered or instant recipes. */
/** Recipe title as HTML: game recipes are named after their product, so show its formatted name. */
/** Step title as HTML: the outputs the plan uses ("Hydrogen + Oxygen"), else the recipe name. */
function stepNameHtml(node) {
  const r = node.recipe, used = node.usedOutputs || [];
  if (r.src !== 'game' && used.length <= 1) return esc(r.name);
  if (!used.length) return recipeNameHtml(r);
  if (used.length <= 2) return used.map(inameHtml).join(' + ');
  return `${inameHtml(used[0])} + ${used.length - 1} more`;
}

/** "Also makes … (not used)" line for steps with spare outputs. */
function spareNoteHtml(node) {
  const spare = node.spareOutputs || [];
  return spare.length ? `<div class="spare-note">Also makes ${spare.map(inameHtml).join(', ')} <span class="muted">(not used in this plan)</span></div>` : '';
}

function recipeNameHtml(r) {
  return r.src === 'game' && r.outputs[0] ? inameHtml(r.outputs[0].item) : esc(r.name);
}

/** Icon of the machine that runs a recipe (tier-specific for GregTech when known). */
function machineIcon(r, tier, px = 16) {
  if (!r) return '';
  const t = tier != null ? tier : (r.eut > 0 ? Math.max(1, tierIndexForEut(r.eut)) : null);
  const key = IconStore.machineKey(r, t);
  return key ? IconStore.html(key, px, 'm-ico') || '' : '';
}

function recipeBadge(r) {
  if (r.eut > 0) return tierBadge(tierIndexForEut(r.eut));
  return `<span class="tier" style="color:#8fa8c0">${r.duration > 0 ? 'NO EU' : 'CRAFT'}</span>`;
}

function recipeTiming(r) {
  if (!(r.duration > 0)) return 'instant';
  return r.eut > 0 ? `${fmtEut(r.eut)} · ${fmtDuration(r.duration)}` : `no power · ${fmtDuration(r.duration)}`;
}

function tierOptions(selected, from = 0) {
  return TIERS.map((t, i) => i < from ? '' : `<option value="${i}" ${i === selected ? 'selected' : ''}>${t.name} (${fmtNum(t.v)} V)</option>`).join('');
}

function dot(item, fluid, cls = 'dot') {
  const px = cls === 'chip-dot' ? 14 : 16;
  const ic = IconStore.html(item, px);
  // Fluids sit on a disc of their colour so pale gas textures stay visible.
  if (ic && fluid) return `<span class="fl-wrap" style="width:${px}px;height:${px}px;background:${fluidColor(item)}">${ic}</span>`;
  if (ic) return ic;
  return `<span class="${cls}${fluid ? ' fluid' : ''}" style="background:${itemColor(item, fluid)}"></span>`;
}

function allItems() {
  return { get: k => INDEX.fluids.has(k), keys: () => INDEX.items.keys() };
}

function producersOf(item) {
  return (INDEX.producers.get(item) || []).map(p => p.recipe);
}

function currentChoice(item) {
  const r = resolveChoice(project(), INDEX, item);
  return r ? r.id : 'raw';
}

function plural(n, word) { return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`; }

/** Compact "made by" control: current recipe + a button that opens the recipe picker. */
function choiceSelect(item) {
  const prods = producersOf(item);
  if (!prods.length) return '';
  const cur = currentChoice(item);
  const r = cur !== 'raw' ? INDEX.byId.get(cur) : null;
  return `<div class="choice-ctl">
    <span class="cc-cur">${r ? `${recipeBadge(r)} ${machineIcon(r, null, 14)}${esc(r.machine)}` : `<span class="muted">${plural(prods.length, 'recipe')} available</span>`}</span>
    <button class="link-btn" data-pick="${esc(item)}">${r ? 'Change…' : 'Pick recipe…'}</button>
  </div>`;
}

function bindChoiceSelects(root) {
  root.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); openPicker(b.dataset.pick); }));
}

/* ---------------- main update ---------------- */

function update() {
  if (libDirty || indexedLib !== state.library || indexedLen !== state.library.length) rebuildIndex();
  const p = project();
  RATE_UNIT = state.unit;
  solution = solve(p, INDEX);
  renderSidebarLists();
  renderSummary();
  renderActiveTab();
  renderDrawer();
  save();
}

function renderActiveTab() {
  if (activeTab === 'flow') renderFlow();
  else if (activeTab === 'machines') renderMachines();
  else if (activeTab === 'power') renderPower();
  else if (activeTab === 'recipes') renderRecipes();
}

/* ---------------- top bar ---------------- */

function renderProjectSelect() {
  $('#projectSelect').innerHTML = state.projects.map(p => `<option value="${p.id}" ${p.id === state.activeId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  document.querySelectorAll('#unitSeg button').forEach(b => b.classList.toggle('active', b.dataset.unit === state.unit));
}

function switchProject(id) {
  state.activeId = id;
  selection = null;
  GraphView.lastKey = '';
  renderAllStatic();
  update();
}

function renderAllStatic() {
  renderProjectSelect();
  renderTargets();
  renderDefaults();
  renderDatalists();
}

function renderDatalists() {
  $('#machineList').innerHTML = [...new Set([...MACHINES.map(m => m.name), ...state.library.map(r => r.machine)])].sort()
    .map(m => `<option value="${esc(m)}">`).join('');
  const names = new Set();
  for (const r of state.library) for (const io of [...r.inputs, ...r.outputs]) names.add(iname(io.item));
  $('#itemList').innerHTML = [...names].sort().map(i => `<option value="${esc(i)}">`).join('');
}

/* ---------------- sidebar ---------------- */

function renderTargets() {
  const p = project();
  const mult = UNITS[state.unit].mult;
  const items = allItems();
  const list = $('#targetList');
  if (!p.targets.length) {
    list.innerHTML = `<div class="io-empty" style="margin-bottom:8px">No targets yet — search for an item below.</div>`;
    return;
  }
  list.innerHTML = p.targets.map((t, i) => `
    <div class="target-row" data-i="${i}">
      <span class="t-name" title="${esc(t.item)}">${dot(t.item, items.get(t.item))}<span>${inameHtml(t.item)}</span></span>
      <input class="t-rate" type="number" min="0" step="any" value="${+(t.rate * mult).toPrecision(6)}">
      <span class="unit">${items.get(t.item) ? 'mB' : 'items'}${UNITS[state.unit].label}</span>
      <button class="icon-btn t-del" title="Remove target">×</button>
    </div>`).join('');
  list.querySelectorAll('.target-row').forEach(row => {
    const i = +row.dataset.i;
    row.querySelector('.t-rate').addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      p.targets[i].rate = isFinite(v) && v > 0 ? v / mult : 0;
      update();
    });
    row.querySelector('.t-del').addEventListener('click', () => { p.targets.splice(i, 1); renderTargets(); update(); });
  });
}

function addTarget(item, rate) {
  const p = project();
  if (!item) return;
  if (p.targets.some(t => t.item === item)) { toast(`${iname(item)} is already a target`); return; }
  p.targets.push({ item, rate: rate != null ? rate : 1 });
  renderTargets();
  update();
  // Start building the tree right away: pick how the new target is made.
  if (producersOf(item).length && currentChoice(item) === 'raw' && p.choices[item] !== 'raw') openPicker(item);
}

function renderDefaults() {
  const p = project();
  $('#defaultTier').innerHTML = tierOptions(p.defaultTier, 1);
  $('#gridTier').innerHTML = tierOptions(p.gridTier, 0);
  $('#defaultCoil').innerHTML = COILS.map((c, i) => `<option value="${i}" ${i === p.defaultCoil ? 'selected' : ''}>${c.name} (${fmtNum(c.temp)}K)</option>`).join('');
  $('#autoExpand').checked = p.autoExpand !== false;
  $('#autoPerfectTier').checked = p.autoPerfectTier !== false;
}

function renderSidebarLists() {
  const sol = solution;
  const raw = $('#rawList');
  const p = project();
  const items = allItems();
  const manual = Object.keys(p.choices).filter(k => p.choices[k] === 'raw');
  const manualSet = new Set(manual);
  const natural = sol.raw.filter(r => !manualSet.has(r.item));
  const supplied = manual.map(item => sol.raw.find(r => r.item === item) || { item, rate: 0, fluid: items.get(item) || false, unused: true })
    .sort((a, b) => b.rate - a.rate);
  const row = (r, isManual) => `
    <div class="io-item${isManual ? ' manual' : ''}">
      ${dot(r.item, r.fluid)}
      <span class="name" title="${esc(r.item)}">${inameHtml(r.item)}</span>
      <span class="rate">${r.unused ? '<span class="muted">not needed</span>' : fmtRate(r.rate, r.fluid)}</span>
      ${isManual
        ? `<div class="act"><span class="tagline">${producersOf(r.item).length ? 'chain hidden' : 'supplied'}</span><button class="link-btn" data-show="${esc(r.item)}" title="Craft this in the plan again">${producersOf(r.item).length ? 'Show chain' : 'Remove'}</button></div>`
        : choiceSelect(r.item)}
    </div>`;
  let html = '';
  if (supplied.length) html += `<div class="io-sub"><span>Supplied by you · chain hidden</span><span>${supplied.length}</span></div>` + supplied.map(r => row(r, true)).join('');
  if (natural.length) html += `${supplied.length ? '<div class="io-sub"><span>Base resources</span></div>' : ''}` + natural.map(r => row(r, false)).join('');
  raw.innerHTML = html || `<div class="io-empty">None</div>`;
  bindChoiceSelects(raw);
  raw.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => showChain(b.dataset.show)));

  const sur = $('#surplusList');
  sur.innerHTML = sol.surplus.length ? sol.surplus.map(r => `
    <div class="io-item">
      ${dot(r.item, r.fluid)}
      <span class="name" title="${esc(r.item)}">${inameHtml(r.item)}</span>
      <span class="rate">${fmtRate(r.rate, r.fluid)}</span>
    </div>`).join('') : `<div class="io-empty">None</div>`;

  $('#warnPanel').hidden = !sol.warnings.length;
  $('#warnList').innerHTML = sol.warnings.map(w => `<li>${esc(w)}</li>`).join('');
}

function renderSummary() {
  const p = project();
  const t = solution.totals;
  const grid = p.gridTier;
  const head = solution.nodes.length ? Math.max(0, t.headroom - 1) : 0;
  $('#summary').innerHTML = `
    <div class="stat" style="--c:var(--accent)">
      <div class="label">Average power</div>
      <div class="value">${fmtEut(t.avgEut)}</div>
      <div class="sub">${ampsLabel(t.avgEut, grid)}</div>
    </div>
    <div class="stat" style="--c:var(--accent-2)">
      <div class="label">Peak power</div>
      <div class="value">${fmtEut(t.peakEut)}</div>
      <div class="sub">${ampsLabel(t.peakEut, grid)} · all machines on</div>
    </div>
    <div class="stat" style="--c:var(--good)">
      <div class="label">Machines to build</div>
      <div class="value">${t.machines}</div>
      <div class="sub">${solution.nodes.length} recipe step${solution.nodes.length === 1 ? '' : 's'}${solution.nodes.length ? ` · up to ${TIERS[t.maxTier].name}` : ''}</div>
    </div>
    <div class="stat" style="--c:var(--raw)">
      <div class="label">Raw inputs</div>
      <div class="value">${solution.raw.length}</div>
      <div class="sub">${solution.surplus.length} byproduct${solution.surplus.length === 1 ? '' : 's'}</div>
    </div>
    <div class="stat" style="--c:var(--sur)">
      <div class="label">Spare capacity</div>
      <div class="value">+${fmtNum(head * 100, 0)}%</div>
      <div class="sub" title="How much you could raise every target before any built machine group runs at 100%">before the first step maxes out</div>
    </div>`;
}

/* ---------------- flow tab ---------------- */

function renderFlow() {
  const p = project();
  const has = GraphView.render(solution, p);
  $('#graphEmpty').hidden = has;
  const dir = p.graphDir || 'lr';
  document.querySelectorAll('#dirSeg button').forEach(b => b.classList.toggle('active', b.dataset.dir === dir));
  const moved = p.graphPos && p.graphPos[dir] && Object.keys(p.graphPos[dir]).length;
  $('#btnResetLayout').disabled = !moved;
  $('#btnResetLayout').textContent = moved ? `Reset layout (${moved} moved)` : 'Reset layout';
}

/** Remember where you dragged a node (per plan and per direction). */
function saveNodePosition(id, pos, dir) {
  const p = project();
  p.graphPos = p.graphPos || {};
  p.graphPos[dir] = p.graphPos[dir] || {};
  p.graphPos[dir][id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
  const moved = Object.keys(p.graphPos[dir]).length;
  $('#btnResetLayout').disabled = false;
  $('#btnResetLayout').textContent = `Reset layout (${moved} moved)`;
  save();
}

function selectNode(id) {
  if (!id) selection = null;
  else if (id.startsWith('raw:') || id.startsWith('out:') || id.startsWith('sur:')) selection = { type: 'item', item: id.slice(4), kind: id.slice(0, 3) };
  else selection = { type: 'recipe', id };
  GraphView.highlight(id);
  renderDrawer();
  if (id && activeTab === 'flow') requestAnimationFrame(() => GraphView.ensureVisible(id));
}

/* ---------------- drawer ---------------- */

function renderDrawer() {
  const drawer = $('#drawer');
  const body = $('#drawerBody');
  if (!selection) { drawer.hidden = true; return; }
  if (selection.type === 'recipe') {
    const node = solution.nodes.find(n => n.id === selection.id);
    if (!node) { selection = null; drawer.hidden = true; GraphView.highlight(null); return; }
    drawer.hidden = false;
    body.innerHTML = recipeDrawerHtml(node);
    bindRecipeDrawer(body, node);
  } else {
    drawer.hidden = false;
    body.innerHTML = itemDrawerHtml(selection.item, selection.kind);
    bindChoiceSelects(body);
    body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => itemAction(b.dataset.act, selection.item)));
  }
}

function instantDrawerHtml(node) {
  const r = node.recipe;
  const row = (io, isIn) => {
    const amt = isIn ? (Number(io.amount) || 0) : expectedAmount(io);
    return `<div class="choice-row">${dot(io.item, io.fluid)}
      <div style="display:flex;justify-content:space-between;gap:8px"><span title="${esc(io.item)}">${inameHtml(io.item)}</span><span class="rate">${fmtRate(amt * node.rate, io.fluid)}</span></div>
      ${isIn ? choiceSelect(io.item) : ''}</div>`;
  };
  return `
    <h2 class="d-title">${stepNameHtml(node)}</h2>
    <div class="d-sub">${esc(r.machine)} · instant recipe${r.src === 'game' ? ' · <span class="muted">game recipe</span>' : ''}</div>${spareNoteHtml(node)}
    <dl class="kv"><dt>Crafts needed</dt><dd>${fmtRate(node.rate)}</dd><dt>Power</dt><dd>none</dd></dl>
    <p class="hint">No processing time, so there is no machine count. Use an autocrafter (or craft by hand) at this rate.</p>
    <div class="d-section"><h3>Inputs</h3>${r.inputs.map(io => row(io, true)).join('') || '<div class="io-empty">None</div>'}</div>
    <div class="d-section"><h3>Outputs</h3>${r.outputs.map(io => row(io, false)).join('')}</div>
    <div class="d-section" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small primary" id="dChange">Change recipe…</button>
      <button class="btn small" id="dEdit">${r.src === 'game' ? 'Copy &amp; edit' : 'Edit recipe'}</button>
      <button class="btn small danger" id="dRemove">Hide this chain (supply as raw)</button>
    </div>`;
}

function recipeDrawerHtml(node) {
  if (node.instant) return instantDrawerHtml(node);
  const r = node.recipe, s = node.settings, oc = node.oc;
  const minTier = Math.max(1, tierIndexForEut(r.eut));
  const cmp = tierComparison(node);
  const ioRow = (io, isIn) => {
    const amt = isIn ? (Number(io.amount) || 0) : expectedAmount(io);
    return `<div class="choice-row">
      ${dot(io.item, io.fluid)}
      <div style="display:flex;justify-content:space-between;gap:8px"><span title="${esc(io.item)}">${inameHtml(io.item)}${io.uses ? ` <span class="muted" title="Tool: one use per craft">(tool, ${io.uses.toLocaleString()} uses)</span>` : ''}${io.kept ? ' <span class="muted">(kept)</span>' : ''}${io.returned ? ' <span class="muted">(returned)</span>' : ''}${!isIn && io.chance != null && io.chance !== '' && +io.chance !== 100 ? ` <span class="muted">(${io.chance}%)</span>` : ''}</span><span class="rate">${fmtRate(amt * node.rate, io.fluid)}</span></div>
      ${isIn ? choiceSelect(io.item) : ''}
    </div>`;
  };
  return `
    <h2 class="d-title">${stepNameHtml(node)}</h2>
    <div class="d-sub">${tierBadge(s.tier)} ${machineIcon(r, s.tier, 16)}${esc(r.machine)} · base ${fmtEut(r.eut)} (${TIERS[tierIndexForEut(r.eut)].name}) · ${fmtDuration(r.duration)}${r.temp ? ` · ${fmtNum(r.temp)}K` : ''}${r.cond ? ` · <span class="cond">${esc(r.cond)}</span>` : ''}${r.src === 'game' ? ' · <span class="muted">game recipe</span>' : ''}</div>${spareNoteHtml(node)}

    <div class="big-machines">
      <div><div class="l">Needed</div><div class="n">${fmtNum(node.machines, 2)}</div></div>
      <div><div class="l">Build</div><div class="n" style="color:var(--accent)">${node.built}</div></div>
      <div><div class="l">Utilization</div><div class="n">${Math.round(node.utilization * 100)}%</div></div>
    </div>

    <div class="d-section">
      <h3>Machine setup</h3>
      <div class="field-grid">
        <label>Tier<select id="dTier">${tierOptions(s.tier, Math.min(minTier, s.tier))}</select></label>
        <label>Overclock<select id="dOc">
          <option value="standard" ${s.ocMode === 'standard' ? 'selected' : ''}>Standard (×4 EU, ÷2 time)</option>
          <option value="perfect" ${s.ocMode === 'perfect' ? 'selected' : ''}>Perfect (×4 EU, ÷4 time)</option>
          <option value="none" ${s.ocMode === 'none' ? 'selected' : ''}>No overclocking</option>
        </select></label>
        ${node.useCoil ? `<label>Coils<select id="dCoil">${COILS.map((c, i) => `<option value="${i}" ${i === s.coil ? 'selected' : ''}>${c.name} (${fmtNum(c.temp)}K)</option>`).join('')}</select></label>` : ''}
        <label>Parallel<input id="dPar" type="number" min="1" step="1" value="${s.parallel}"></label>
      </div>
      <ul class="oc-notes">
        ${s.autoTier ? `<li class="auto-note">Tier picked automatically: perfect overclocking gives the same energy per item at any tier, and ${TIERS[s.tier].name} needs the fewest machines (up to your ${TIERS[project().gridTier].name} grid). Choose a tier to override it.</li>` : ''}
        ${oc.errors.map(e => `<li class="err">${esc(e)}</li>`).join('')}
        ${oc.notes.map(n => `<li>${esc(n)}</li>`).join('')}
        ${node.useCoil && oc.effTemp ? `<li>Effective coil heat ${fmtNum(oc.effTemp)}K (recipe needs ${fmtNum(r.temp)}K)</li>` : ''}
      </ul>
    </div>

    <div class="d-section">
      <h3>Per machine</h3>
      <dl class="kv">
        <dt>Time per craft</dt><dd>${oc.dur} t (${fmtDuration(oc.dur)})</dd>
        <dt>Power draw</dt><dd>${fmtEut(oc.eut)}</dd>
        <dt>Amperage</dt><dd>${fmtNum(node.amps, 2)}A @ ${TIERS[s.tier].name}</dd>
        <dt>Crafts</dt><dd>${fmtRate(oc.craftsPerSec)}</dd>
        <dt>Energy per craft</dt><dd>${fmtNum(oc.euPerCraft)} EU</dd>
      </dl>
    </div>

    <div class="d-section">
      <h3>This step in total</h3>
      <dl class="kv">
        <dt>Crafts needed</dt><dd>${fmtRate(node.rate)}</dd>
        <dt>Average power</dt><dd>${fmtEut(node.avgEut)}</dd>
        <dt>Peak (${node.built} running)</dt><dd>${fmtEut(node.peakEut)}</dd>
      </dl>
    </div>

    <div class="d-section">
      <h3>Inputs</h3>
      ${r.inputs.map(io => ioRow(io, true)).join('') || '<div class="io-empty">None</div>'}
    </div>
    <div class="d-section">
      <h3>Outputs</h3>
      ${r.outputs.map(io => ioRow(io, false)).join('')}
    </div>

    <div class="d-section">
      <h3>Compare tiers</h3>
      <div class="table-wrap"><table class="cmp">
        <thead><tr><th>Tier</th><th class="r">Machines</th><th class="r">Time</th><th class="r">EU/t each</th><th class="r">Avg EU/t</th></tr></thead>
        <tbody>${cmp.map(c => `<tr class="clickable ${c.tier === s.tier ? 'cur' : ''}" data-tier="${c.tier}">
          <td>${tierBadge(c.tier)}</td>
          <td class="r num">${fmtNum(c.machines, 2)} <span class="muted">(${c.built})</span></td>
          <td class="r num">${c.oc.dur}t</td>
          <td class="r num">${fmtNum(c.oc.eut)}</td>
          <td class="r num">${fmtNum(c.avgEut)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="hint">Standard overclocks keep the same EU per item but double the power per machine; perfect overclocks make each item cheaper. Click a row to switch.</p>
    </div>

    <div class="d-section" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small primary" id="dChange">Change recipe…</button>
      <button class="btn small" id="dEdit">${r.src === 'game' ? 'Copy &amp; edit' : 'Edit recipe'}</button>
      <button class="btn small" id="dReset">Reset machine setup</button>
      <button class="btn small danger" id="dRemove" title="Supply this step's product yourself and hide everything that feeds it">Hide this chain (supply as raw)</button>
    </div>`;
}

function bindRecipeDrawer(body, node) {
  const p = project();
  const set = (k, v) => { p.nodes[node.id] = Object.assign({}, p.nodes[node.id], { [k]: v }); update(); };
  if (node.instant) {
    body.querySelector('#dEdit').addEventListener('click', () => editOrCopy(node.recipe));
    body.querySelector('#dChange').addEventListener('click', () => {
      const made = node.recipe.outputs.map(o => o.item).find(item => currentChoice(item) === node.id) || node.recipe.outputs[0].item;
      openPicker(made);
    });
    body.querySelector('#dRemove').addEventListener('click', () => hideChain(node.id));
    bindChoiceSelects(body);
    return;
  }
  body.querySelector('#dTier').addEventListener('change', e => set('tier', +e.target.value));
  body.querySelector('#dOc').addEventListener('change', e => set('ocMode', e.target.value));
  const coil = body.querySelector('#dCoil');
  coil && coil.addEventListener('change', e => set('coil', +e.target.value));
  body.querySelector('#dPar').addEventListener('change', e => set('parallel', Math.max(1, Math.floor(+e.target.value || 1))));
  body.querySelectorAll('tr[data-tier]').forEach(tr => tr.addEventListener('click', () => set('tier', +tr.dataset.tier)));
  body.querySelector('#dEdit').addEventListener('click', () => editOrCopy(node.recipe));
  body.querySelector('#dChange').addEventListener('click', () => {
    const made = node.recipe.outputs.map(o => o.item).find(item => currentChoice(item) === node.id) || node.recipe.outputs[0].item;
    openPicker(made);
  });
  body.querySelector('#dReset').addEventListener('click', () => { delete p.nodes[node.id]; update(); });
  body.querySelector('#dRemove').addEventListener('click', () => hideChain(node.id));
  bindChoiceSelects(body);
}

/** Treat everything this recipe makes in the plan as a raw input, hiding the chain behind it. */
function hideChain(recipeId) {
  const p = project();
  const r = INDEX.byId.get(recipeId);
  if (!r) return;
  const hidden = [];
  for (const o of r.outputs) if (currentChoice(o.item) === recipeId) { p.choices[o.item] = 'raw'; hidden.push(o.item); }
  if (selection && selection.type === 'recipe') selection = null;
  update();
  if (hidden.length) toast(`${hidden.map(iname).join(', ')} is now supplied as a raw input. Use "Show chain" in Raw inputs to bring it back.`);
}

/** Supply an item yourself (by name). */
function supplyAsRaw(item) {
  item = keyFromText(item);
  if (!item) return;
  const p = project();
  if (p.choices[item] === 'raw') { toast(`${iname(item)} is already supplied as raw`); return; }
  p.choices[item] = 'raw';
  update();
  toast(`${iname(item)} is now supplied as a raw input`);
}

/** Undo supplyAsRaw / hideChain: craft the item in the plan again. */
function showChain(item) {
  const p = project();
  delete p.choices[item];
  // If auto-expand wouldn't pick a recipe, choose the first one that makes it.
  if (currentChoice(item) === 'raw') {
    const prods = producersOf(item);
    if (prods.length === 1) p.choices[item] = prods[0].id;
    else if (prods.length > 1) { update(); openPicker(item); return; }
  }
  update();
}

function itemDrawerHtml(item, kind) {
  const sol = solution;
  const fluid = allItems().get(item) || false;
  const raw = sol.raw.find(r => r.item === item);
  const sur = sol.surplus.find(r => r.item === item);
  const tgt = sol.targets.find(r => r.item === item);
  const consumers = sol.nodes.filter(n => n.recipe.inputs.some(i => i.item === item));
  const producers = sol.nodes.filter(n => n.recipe.outputs.some(o => o.item === item));
  const label = { raw: 'Raw input', out: 'Target', sur: 'Byproduct' }[kind];
  const isTarget = !!tgt;
  return `
    <h2 class="d-title">${dot(item, fluid, 'chip-dot')} ${inameHtml(item)}</h2>
    <div class="d-sub">${label}${fluid ? ' · fluid' : ' · item'}${item !== iname(item) ? ` · <span class="muted">${esc(item)}</span>` : ''}</div>
    <dl class="kv">
      ${tgt ? `<dt>Target rate</dt><dd>${fmtRate(tgt.rate, fluid)}</dd>` : ''}
      ${raw ? `<dt>You must supply</dt><dd>${fmtRate(raw.rate, fluid)}</dd>` : ''}
      ${sur ? `<dt>Left over</dt><dd>${fmtRate(sur.rate, fluid)}</dd>` : ''}
      ${fluid && raw ? `<dt>Buckets per hour</dt><dd>${fmtNum(raw.rate * 3600 / 1000)}</dd>` : ''}
      ${!fluid && raw ? `<dt>Stacks per hour</dt><dd>${fmtNum(raw.rate * 3600 / 64)}</dd>` : ''}
    </dl>
    ${producersOf(item).length ? `<div class="d-section"><h3>Made by</h3>${choiceSelect(item)}</div>` : ''}
    ${producers.length ? `<div class="d-section"><h3>Produced in this plan by</h3>${producers.map(n => `<div class="muted">• ${stepNameHtml(n)} <span class="muted">(${esc(n.recipe.machine)})</span></div>`).join('')}</div>` : ''}
    ${consumers.length ? `<div class="d-section"><h3>Used by</h3>${consumers.map(n => {
      const a = n.recipe.inputs.filter(i => i.item === item).reduce((s, i) => s + (+i.amount || 0), 0) * n.rate;
      return `<div style="display:flex;justify-content:space-between"><span>${stepNameHtml(n)}</span><span class="num muted">${fmtRate(a, fluid)}</span></div>`;
    }).join('')}</div>` : ''}
    <div class="d-section" style="display:flex;gap:8px;flex-wrap:wrap">
      ${project().choices[item] === 'raw' && producersOf(item).length ? `<button class="btn small primary" data-act="show">Show its chain again</button>` : ''}
      ${!isTarget ? `<button class="btn small" data-act="target">Make it a target</button>` : ''}
      <button class="btn small" data-act="newrecipe">＋ New recipe for this</button>
    </div>`;
}

function itemAction(act, item) {
  if (act === 'target') addTarget(item, 1);
  else if (act === 'show') { selection = null; showChain(item); }
  else if (act === 'newrecipe') openRecipeEditor(null, { name: iname(item), outputs: [{ item, amount: 1, fluid: allItems().get(item) || false }] });
}

/* ---------------- machines tab ---------------- */

function renderMachines() {
  const sol = solution;
  const view = $('#machinesView');
  if (!sol.nodes.length) { view.innerHTML = `<p class="muted">No machines yet — add a target.</p>`; return; }
  const groups = new Map();
  for (const n of sol.nodes) {
    if (n.instant) continue;
    const k = n.settings.tier + '|' + n.recipe.machine;
    const g = groups.get(k) || { tier: n.settings.tier, machine: n.recipe.machine, recipe: n.recipe, count: 0 };
    g.count += n.built;
    groups.set(k, g);
  }
  const build = [...groups.values()].sort((a, b) => b.tier - a.tier || b.count - a.count);
  view.innerHTML = `
    <div class="section-title"><h3>Build list</h3><span class="hint">Machines rounded up, grouped by tier</span></div>
    <div class="build-list">${build.map(g => `
      <div class="build-card"><div class="count">${g.count}×</div>${machineIcon(g.recipe, g.tier, 28)}<div>${tierBadge(g.tier)} <span>${esc(g.machine)}</span></div></div>`).join('')}
    </div>
    <div class="section-title"><h3>Every step</h3><span class="hint">Click a row for details and tier comparison</span></div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>Tier</th><th>Machine</th><th>Recipe</th>
        <th class="r">Needed</th><th class="r">Build</th><th>Utilization</th>
        <th class="r">Craft time</th><th class="r">EU/t each</th><th class="r">Avg EU/t</th><th class="r">Peak EU/t</th><th>Notes</th>
      </tr></thead>
      <tbody>${sol.nodes.map(n => `
        <tr class="clickable" data-id="${esc(n.id)}">
          <td>${n.instant ? '<span class="muted">—</span>' : tierBadge(n.settings.tier)}</td>
          <td>${machineIcon(n.recipe, n.instant ? null : n.settings.tier, 16)}${esc(n.recipe.machine)}</td>
          <td>${stepNameHtml(n)}${(n.spareOutputs || []).length ? ` <span class="spare-tag" title="Also makes: ${esc(n.spareOutputs.map(iname).join(', '))}">+${n.spareOutputs.length}</span>` : ''}</td>
          <td class="r num">${n.instant ? `<span class="muted">${fmtRate(n.rate)}</span>` : fmtNum(n.machines, 2)}</td>
          <td class="r num"><b>${n.instant ? '—' : n.built}</b></td>
          <td><span class="util"><i style="width:${Math.round(n.utilization * 100)}%;background:${n.utilization > .85 ? 'var(--good)' : n.utilization > .5 ? 'var(--warn)' : 'var(--accent-2)'}"></i></span><span class="num muted">${Math.round(n.utilization * 100)}%</span></td>
          <td class="r num">${n.oc.dur}t</td>
          <td class="r num">${fmtNum(n.oc.eut)}</td>
          <td class="r num">${fmtNum(n.avgEut)}</td>
          <td class="r num">${fmtNum(n.peakEut)}</td>
          <td class="note">${n.oc.errors.length ? `<span class="bad">${esc(n.oc.errors[0])}</span>` : esc(n.oc.notes.join(' · '))}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr>
        <td colspan="4"><b>Total</b></td><td class="r num"><b>${sol.totals.machines}</b></td><td colspan="3"></td>
        <td class="r num"><b>${fmtNum(sol.totals.avgEut)}</b></td><td class="r num"><b>${fmtNum(sol.totals.peakEut)}</b></td><td></td>
      </tr></tfoot>
    </table></div>`;
  view.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => selectNode(tr.dataset.id)));
}

/* ---------------- power tab ---------------- */

function renderPower() {
  const p = project();
  const sol = solution;
  const t = sol.totals;
  const view = $('#powerView');
  if (!sol.nodes.length) { view.innerHTML = `<p class="muted">No power use yet — add a target.</p>`; return; }
  const powered = sol.nodes.filter(n => !n.instant);
  const maxPeak = Math.max(...powered.map(n => n.peakEut), 1);
  const byTier = new Map();
  for (const n of powered) {
    const b = byTier.get(n.settings.tier) || { avg: 0, peak: 0, machines: 0 };
    b.avg += n.avgEut; b.peak += n.peakEut; b.machines += n.built;
    byTier.set(n.settings.tier, b);
  }
  const grid = p.gridTier;
  const gen = p.gen || { preset: 0, eut: 32 };
  const preset = GENERATOR_PRESETS[gen.preset] || GENERATOR_PRESETS[0];
  const genEut = preset.eut || gen.eut || 0;
  const singleTarget = sol.targets.length === 1 ? sol.targets[0] : null;
  const tFluid = singleTarget ? allItems().get(singleTarget.item) : false;
  const highestTier = t.maxTier;

  view.innerHTML = `
    <div class="power-grid">
      <div class="card-box">
        <h3>Power by step</h3>
        <p class="hint" style="margin:-4px 0 10px">Bar = average draw, dashed line = peak with every built machine running.</p>
        ${powered.map(n => `
          <div class="bar-row clickable" data-id="${esc(n.id)}" style="cursor:pointer">
            <div class="bl" title="${esc(stepTitle(n))}">${tierBadge(n.settings.tier)} ${stepNameHtml(n)}</div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${(n.avgEut / maxPeak * 100).toFixed(2)}%;background:${TIERS[n.settings.tier].color};opacity:.85"></div>
              <div class="bar-peak" style="width:${(n.peakEut / maxPeak * 100).toFixed(2)}%"></div>
            </div>
            <div class="bv">${fmtNum(n.avgEut)}</div>
          </div>`).join('')}

        <div class="section-title"><h3>By voltage tier</h3></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Tier</th><th class="r">Machines</th><th class="r">Avg EU/t</th><th class="r">Peak EU/t</th><th class="r">Peak amps @ tier</th></tr></thead>
          <tbody>${[...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([tier, b]) => `
            <tr><td>${tierBadge(tier)}</td><td class="r num">${b.machines}</td><td class="r num">${fmtNum(b.avg)}</td><td class="r num">${fmtNum(b.peak)}</td><td class="r num">${fmtNum(b.peak / TIERS[tier].v, 2)}A</td></tr>`).join('')}
          </tbody>
        </table></div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="card-box">
          <h3>Totals</h3>
          <dl class="kv">
            <dt>Average draw</dt><dd>${fmtEut(t.avgEut)}</dd>
            <dt>Peak draw</dt><dd>${fmtEut(t.peakEut)}</dd>
            <dt>Average @ grid (${TIERS[grid].name})</dt><dd>${ampsLabel(t.avgEut, grid)}</dd>
            <dt>Peak @ grid (${TIERS[grid].name})</dt><dd>${ampsLabel(t.peakEut, grid)}</dd>
            <dt>Highest machine tier</dt><dd>${TIERS[highestTier].name}</dd>
            <dt>Energy per hour</dt><dd>${fmtNum(t.avgEut * 72000)} EU</dd>
            ${singleTarget ? `<dt>Energy per ${tFluid ? 'bucket' : 'item'} of ${inameHtml(singleTarget.item)}</dt><dd>${fmtNum(t.avgEut * 20 / singleTarget.rate * (tFluid ? 1000 : 1))} EU</dd>` : ''}
          </dl>
          ${highestTier > grid ? `<p class="hint bad" style="margin-top:10px">Some machines are above your grid tier (${TIERS[grid].name}); they need a transformer up or a higher-tier line.</p>` : ''}
          <p class="hint" style="margin-top:10px">Wire for peak: at ${TIERS[grid].name} you need cables rated for <b>${Math.ceil(t.peakEut / TIERS[grid].v)}A</b> (before cable loss).</p>
        </div>

        <div class="card-box">
          <h3>Generators needed</h3>
          <div class="gen-row">
            <select id="genPreset">${GENERATOR_PRESETS.map((g, i) => `<option value="${i}" ${i === gen.preset ? 'selected' : ''}>${esc(g.name)}${g.eut ? ` — ${fmtNum(g.eut)} EU/t` : ''}</option>`).join('')}</select>
            <input id="genEut" type="number" min="1" step="any" value="${genEut}" ${preset.eut ? 'disabled' : ''} title="EU/t per generator">
          </div>
          <div class="big-answer">
            <div><div class="hint">For average draw</div><div class="n">${genEut ? Math.ceil(t.avgEut / genEut - 1e-9) : '—'}</div><div class="hint">with a battery buffer</div></div>
            <div><div class="hint">For peak draw</div><div class="n">${genEut ? Math.ceil(t.peakEut / genEut - 1e-9) : '—'}</div><div class="hint">no buffer needed</div></div>
          </div>
          <p class="hint" style="margin-top:10px">To ride out a full minute at peak with only average-rated generation, store about <b>${fmtNum((t.peakEut - t.avgEut) * 1200)} EU</b>. Turbine output depends on rotor and fuel — use Custom for exact numbers.</p>
        </div>
      </div>
    </div>`;
  view.querySelectorAll('.bar-row[data-id]').forEach(r => r.addEventListener('click', () => selectNode(r.dataset.id)));
  view.querySelector('#genPreset').addEventListener('change', e => {
    const i = +e.target.value;
    p.gen = { preset: i, eut: GENERATOR_PRESETS[i].eut || gen.eut || 32 };
    update();
  });
  view.querySelector('#genEut').addEventListener('change', e => {
    p.gen = { preset: gen.preset, eut: Math.max(1, +e.target.value || 1) };
    update();
  });
}

/* ---------------- recipes tab ---------------- */

let recipeSource = 'mine';
const recipeTextCache = new WeakMap();

function recipeText(r) {
  let t = recipeTextCache.get(r);
  if (!t) {
    t = [r.name, r.machine, ...r.inputs.map(i => iname(i.item)), ...r.outputs.map(o => iname(o.item))].join(' ').toLowerCase();
    recipeTextCache.set(r, t);
  }
  return t;
}

function ioChips(arr, highlight) {
  return arr.map(io => {
    let amt = fmtAmount(+io.amount, io.fluid), cls = '', title = io.item;
    if (io.uses) { amt = `1/${fmtNum(io.uses)}`; cls = ' tool'; title = `${io.item} — tool with ${io.usesEstimated ? 'about ' : ''}${io.uses.toLocaleString()} uses; one use per craft${io.usesEstimated ? ' (estimated: re-export with exporter v8 for exact durability)' : ''}`; }
    else if (io.kept) { amt = 'kept'; cls = ' kept'; title = `${io.item} — not used up`; }
    else if (io.returned) { cls = ' returned'; title = `${io.item} — given back after crafting`; }
    return `<span class="chip${io.item === highlight ? ' hl' : ''}${cls}" title="${esc(title)}">${dot(io.item, io.fluid, 'chip-dot')}<span class="amt">${amt}</span> ${inameHtml(io.item)}${io.chance != null && +io.chance !== 100 ? ` <span class="muted">${io.chance}%</span>` : ''}</span>`;
  }).join('');
}

/** Efficiency evaluator for the picker, using the current plan and byproduct setting. */
function pickerEfficiency() {
  const p = project();
  const planUses = new Set();
  if (solution) {
    for (const n of solution.nodes) for (const i of n.recipe.inputs) planUses.add(i.item);
    for (const t of solution.targets) planUses.add(t.item);
  }
  // The cost table covers every recipe in the game, so reuse it while nothing it depends on has changed.
  const mode = state.byproductMode || 'split';
  const key = [INDEX.byId.size, p.id, p.defaultTier, mode, JSON.stringify(p.choices), mode === 'plan' ? [...planUses].sort().join(',') : ''].join('|');
  if (!pickerEfficiency.cache || pickerEfficiency.cache.key !== key || pickerEfficiency.cache.index !== INDEX) {
    pickerEfficiency.cache = { key, index: INDEX, eff: makeEfficiency(INDEX, p.choices, p.defaultTier, { byproducts: mode, planUses }) };
  }
  const eff = pickerEfficiency.cache.eff;
  // Stats are computed once per recipe per picker session and reused while filtering or re-sorting.
  const cache = new Map();
  return Object.assign({}, eff, { stats: (r, item) => { if (!cache.has(r)) cache.set(r, eff.stats(r, item)); return cache.get(r); } });
}

function renderGamePanel() {
  const el = $('#gamePanel');
  if (!gameData) {
    el.innerHTML = `
      <div class="game-card">
        <div>
          <h3>Use the real recipes from your game</h3>
          <p class="hint">MoniFlow reads recipes straight out of your Monifactory install, so every machine, EU/t and duration matches your exact version.</p>
          <ol class="steps">
            <li><a href="kubejs/zzz_moniflow_export.js" download>Download the exporter script</a> and put it in <code>&lt;instance&gt;/minecraft/kubejs/server_scripts/</code>.</li>
            <li>Start Monifactory and load a singleplayer world. It writes <code>kubejs/moniflow_recipes.json</code> once.</li>
            <li>Click <b>Import game recipes</b> and pick that file.</li>
          </ol>
        </div>
        <label class="btn primary">Import game recipes<input type="file" class="game-file" accept=".json,application/json" hidden></label>
      </div>`;
  } else {
    const m = gameData.meta || {};
    el.innerHTML = `
      <div class="game-card compact">
        <div><b>${gameData.recipes.length.toLocaleString()} game recipes</b>
          <span class="hint">${gameData.stats && gameData.stats.gregtech != null ? `GregTech ${(gameData.stats.gregtech || 0).toLocaleString()} · other mods ${(gameData.stats.other || 0).toLocaleString()} · ` : ''}${m.gtceu ? `GTCEu ${esc(m.gtceu)} · ` : ''}${m.exported ? `exported ${esc(String(m.exported).slice(0, 10))}` : ''}</span>
          ${m.exportErrors && m.exportErrors.length ? `<details class="hint"><summary>${m.exportErrors.length} export warning(s)</summary>${m.exportErrors.map(e => `<div>${esc(e)}</div>`).join('')}</details>` : ''}</div>
        <div style="display:flex;gap:6px">
          <label class="btn small">Re-import<input type="file" class="game-file" accept=".json,application/json" hidden></label>
          <button class="btn small danger" id="btnRemoveGame">Remove</button>
        </div>
      </div>
      <div class="icon-status">${IconStore.data
        ? `<span>Icons: <b>${IconStore.data.count.toLocaleString()}</b> of ${IconStore.data.total.toLocaleString()} built ${esc(String(IconStore.data.built || '').slice(0, 10))}</span><button class="btn small" id="btnIcons">Rebuild icons</button><button class="btn small ghost" id="btnClearIcons">Remove icons</button>`
        : `<span>No item icons yet.</span><button class="btn small primary" id="btnIcons">Build icons</button>`}${gameData.icons && Object.keys(gameData.icons.gtIcons || {}).length ? '' : ' <span class="hint">Re-export from the game (exporter v5) for GregTech material icons.</span>'}</div>`;
    el.querySelector('#btnIcons').addEventListener('click', openIconDialog);
    const clr = el.querySelector('#btnClearIcons');
    clr && clr.addEventListener('click', async () => { await IconStore.clear(); renderAllStatic(); update(); });
    el.querySelector('#btnRemoveGame').addEventListener('click', async () => {
      const yes = await ask({ title: 'Remove game recipes?', message: 'Plans that use game recipes will show those items as raw inputs until you import again.', okLabel: 'Remove', danger: true });
      if (!yes) return;
      gameData = null;
      ITEM_NAMES.clear();
      try { await GameDB.set(null); } catch (e) { /* ignore */ }
      libDirty = true;
      recipeSource = 'mine';
      renderAllStatic();
      update();
    });
  }
  el.querySelectorAll('.game-file').forEach(inp => inp.addEventListener('change', () => {
    const f = inp.files[0];
    inp.value = '';
    if (f) importGameFile(f);
  }));
}

function renderRecipes() {
  renderGamePanel();
  const q = $('#recipeSearch').value.trim().toLowerCase();
  document.querySelectorAll('#recipeSrcSeg button').forEach(b => b.classList.toggle('active', b.dataset.src === recipeSource));
  $('#recipeSrcSeg [data-src="game"]').textContent = `Game recipes${gameData ? ` (${gameData.recipes.length.toLocaleString()})` : ''}`;
  $('#recipeSrcSeg [data-src="mine"]').textContent = `My recipes (${state.library.length})`;
  const usedIds = new Set(solution.nodes.map(n => n.id));
  const pool = recipeSource === 'game' ? (gameData ? gameData.recipes : []) : state.library;
  const LIMIT = 120;
  const list = [];
  let total = 0;
  for (const r of pool) {
    if (q && !recipeText(r).includes(q)) continue;
    total++;
    if (list.length < LIMIT) list.push(r);
  }
  const empty = recipeSource === 'game' && !gameData ? '<p class="muted">No game recipes yet — follow the steps above.</p>' : '<p class="muted">No recipes match.</p>';
  $('#recipeList').innerHTML = list.length ? `<div class="recipe-grid">${list.map(r => `
    <div class="recipe-card" data-id="${esc(r.id)}">
      <div class="rc-head">
        <div><div class="rc-name">${recipeNameHtml(r)}</div><div class="rc-machine">${machineIcon(r, null, 14)}${esc(r.machine)}${r.cond ? ` · <span class="cond">${esc(r.cond)}</span>` : ''}</div></div>
        ${recipeBadge(r)}
      </div>
      <div class="rc-io"><div class="chips">${ioChips(r.inputs) || '<span class="muted">—</span>'}</div><div class="arrow">→</div><div class="chips">${ioChips(r.outputs)}</div></div>
      <div class="rc-meta"><span class="num">${recipeTiming(r)}</span>${r.duration > 0 ? `<span class="num">${r.duration}t</span>` : ''}${r.temp ? `<span class="num">${fmtNum(r.temp)}K</span>` : ''}${usedIds.has(r.id) ? '<span style="color:var(--good)">● in plan</span>' : ''}</div>
      <div class="rc-actions">
        <button class="btn small" data-act="make" title="Add its main product as a target, made with this recipe">Make this</button>
        ${r.src === 'game'
          ? `<button class="btn small" data-act="copy" title="Copy into My recipes so you can edit it">Copy &amp; edit</button>`
          : `<button class="btn small" data-act="edit">Edit</button>
             <button class="btn small" data-act="dup">Duplicate</button>
             <button class="btn small danger" data-act="del">Delete</button>`}
      </div>
    </div>`).join('')}</div>${total > LIMIT ? `<p class="hint" style="margin-top:10px">Showing ${LIMIT} of ${total.toLocaleString()} — type more to narrow it down.</p>` : ''}` : empty;
  $('#recipeList').querySelectorAll('.recipe-card').forEach(card => {
    const r = INDEX.byId.get(card.dataset.id);
    card.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
      const act = b.dataset.act;
      if (act === 'edit') openRecipeEditor(r);
      else if (act === 'copy') editOrCopy(r);
      else if (act === 'dup') { const c = clone(r); c.id = uid('r_'); c.name += ' (copy)'; state.library.push(c); renderDatalists(); update(); }
      else if (act === 'del') {
        ask({ title: 'Delete recipe?', message: `"${r.name}" will be removed from your library and from any plan that uses it.`, okLabel: 'Delete', danger: true }).then(yes => {
          if (!yes) return;
          state.library = state.library.filter(x => x.id !== r.id);
          for (const p of state.projects) for (const k in p.choices) if (p.choices[k] === r.id) delete p.choices[k];
          renderDatalists(); update();
        });
      } else if (act === 'make') {
        const o = r.outputs[0];
        if (!o) return;
        project().choices[o.item] = r.id;
        addTarget(o.item, 1);
        setTab('flow');
      }
    }));
  });
}

/** Game recipes are read-only: copy them into My recipes before editing. */
function editOrCopy(r) {
  if (r.src !== 'game') { openRecipeEditor(r); return; }
  const c = clone(r);
  delete c.src;
  c.id = uid('r_');
  c.name = r.name + ' (custom)';
  openRecipeEditor(null, c);
}

/* ---------------- icon builder dialog ---------------- */

let iconSource = null, iconJar = null;

function openIconDialog() {
  if (!gameData) { toast('Import game recipes first'); return; }
  $('#iconProgress').hidden = true;
  $('#iconBuild').disabled = !iconSource;
  $('#iconDialog').showModal();
}

function bindIconDialog() {
  const setDir = (src, label) => { iconSource = src; $('#iconDirStatus').textContent = label; $('#iconBuild').disabled = !src; };
  $('#iconPickDir').addEventListener('click', async () => {
    if (window.showDirectoryPicker) {
      try { const h = await window.showDirectoryPicker({ id: 'moniflow-instance', mode: 'read' }); setDir(h, `Folder: ${h.name}`); return; }
      catch (e) { if (e && e.name === 'AbortError') return; /* fall back to the file input */ }
    }
    $('#iconDirInput').click();
  });
  $('#iconDirInput').addEventListener('change', e => {
    const files = e.target.files;
    if (files && files.length) setDir(files, `${files.length.toLocaleString()} files selected`);
  });
  $('#iconJarInput').addEventListener('change', e => {
    iconJar = e.target.files[0] || null;
    $('#iconJarStatus').textContent = iconJar ? iconJar.name : 'Nothing chosen';
  });
  $('#iconCancel').addEventListener('click', () => $('#iconDialog').close());
  $('#iconForm').addEventListener('submit', e => { e.preventDefault(); runIconBuild(); });
}

async function runIconBuild() {
  if (!gameData || !iconSource) return;
  const text = $('#iconProgressText'), bar = $('#iconBar');
  $('#iconProgress').hidden = false;
  $('#iconBuild').disabled = true;
  bar.style.width = '0%';
  try {
    const src = await collectInstanceSources(iconSource, iconJar, msg => { text.textContent = msg; });
    if (!src.jars) { text.textContent = 'No mod jars found. Pick the instance folder that contains "mods".'; $('#iconBuild').disabled = false; return; }
    const builder = new IconBuilder(src.fs, gameData);
    const items = [...INDEX.items].filter(k => k.includes(':') && !k.startsWith('#')).map(key => ({ key, fluid: INDEX.fluids.has(key) }));
    const types = [...new Set(gameData.recipes.map(r => r.type).filter(Boolean))];
    const itemIds = new Set(Object.keys(gameData.names || {}));
    const res = await builder.build(items, types, itemIds, (done, total, ok) => {
      bar.style.width = `${(done / total * 100).toFixed(1)}%`;
      text.textContent = `Drawing icons… ${done.toLocaleString()} / ${total.toLocaleString()} (${ok.toLocaleString()} found)`;
    });
    text.textContent = 'Saving…';
    await IconStore.save(res);
    $('#iconDialog').close();
    renderAllStatic();
    update();
    toast(`Built ${res.count.toLocaleString()} icons for ${res.total.toLocaleString()} items and machines${src.vanilla ? '' : ' (add the Minecraft jar for vanilla items)'}`, 6000);
  } catch (e) {
    text.textContent = 'Icon build failed: ' + (e && e.message ? e.message : e);
    $('#iconBuild').disabled = false;
  }
}

/* ---------------- recipe picker ---------------- */

let pickerItem = null;
let pickerEff = null;
let pickerReady = false;

function openPicker(item) {
  pickerItem = item;
  const prods = producersOf(item);
  const fluid = INDEX.fluids.has(item);
  $('#pickTitle').innerHTML = `${dot(item, fluid, 'chip-dot')} How should <b>${inameHtml(item)}</b> be made?`;
  $('#pickSub').textContent = `${plural(prods.length, 'recipe')} make this. Pick one to add it to the tree; its ingredients appear as new inputs you can expand next.`;
  const counts = new Map();
  for (const r of prods) counts.set(r.machine, (counts.get(r.machine) || 0) + 1);
  $('#pickMachine').innerHTML = `<option value="">All machines</option>` + [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `<option value="${esc(m)}">${esc(m)} (${n})</option>`).join('');
  $('#pickSearch').value = '';
  // Efficiency is evaluated against the plan as it is now (its existing recipe choices count).
  pickerEff = pickerEfficiency();
  $('#pickByproducts').value = state.byproductMode || 'split';
  pickerReady = false;
  $('#pickSort').innerHTML = Object.entries(PICK_SORTS).map(([k, v]) => `<option value="${k}" ${k === (state.pickSort || 'best') ? 'selected' : ''}>Sort: ${v}</option>`).join('');
  const recycled = prods.filter(r => r.recycling).length;
  $('#pickRecycle').checked = false;
  $('#pickRecycleWrap').hidden = !recycled;
  $('#pickRecycleLabel').textContent = `Show recycling (${recycled})`;
  // Open right away; working out efficiency for many recipes can take a moment.
  $('#pickList').innerHTML = `<p class="hint">Working out the most efficient recipes for ${plural(prods.length, 'recipe')}…</p>`;
  const dlg = $('#pickDialog');
  if (!dlg.open) dlg.showModal();
  $('#pickSearch').focus();
  setTimeout(() => { if (pickerItem === item) { pickerReady = true; renderPickList(); } }, 30);
}

function renderPickList() {
  if (!pickerReady) return;
  const item = pickerItem;
  const q = $('#pickSearch').value.trim().toLowerCase();
  const machine = $('#pickMachine').value;
  const cur = currentChoice(item);
  const isRaw = project().choices[item] === 'raw';
  const showRecycling = $('#pickRecycle').checked;
  const mode = state.pickSort || 'best';
  const filtered = producersOf(item)
    .filter(r => (showRecycling || !r.recycling) && (!machine || r.machine === machine) && (!q || recipeText(r).includes(q)));
  const ranked = rankRecipes(filtered, item, pickerEff || pickerEfficiency(), mode, project().defaultTier || 1);
  const list = ranked.map(x => x.r);
  const statsOf = new Map(ranked.map(x => [x.r, x.s]));
  const fluidItem = INDEX.fluids.has(item);
  const perUnit = fluidItem ? '/B' : '/item';
  const scale = fluidItem ? 1000 : 1;
  const hl = k => (mode === k ? ' hl' : '');
  const LIMIT = 150;
  $('#pickRaw').classList.toggle('active', isRaw);
  $('#pickList').innerHTML = list.slice(0, LIMIT).map((r, idx) => {
    const makes = r.outputs.filter(o => o.item === item).reduce((a, o) => a + expectedAmount(o), 0);
    const st = statsOf.get(r);
    return `<button class="pick-row${r.id === cur ? ' current' : ''}" data-id="${esc(r.id)}">
      <div class="pr-head">
        ${recipeBadge(r)}
        ${machineIcon(r, null, 18)}<b>${esc(r.machine)}</b>
        <span class="muted num">${recipeTiming(r)}</span>
        ${r.temp ? `<span class="muted num">${fmtNum(r.temp)}K</span>` : ''}
        ${r.cond ? `<span class="cond">${esc(r.cond)}</span>` : ''}
        ${r.src !== 'game' ? '<span class="mine-tag">my recipe</span>' : ''}
        <span class="pr-makes">makes ${INDEX.fluids.has(item) ? fmtFluid(makes) : fmtNum(makes)}</span>
        ${idx === 0 && list.length > 1 && !st.loops ? `<span class="best-tag" title="Top of the current sort">★ ${mode === 'best' ? 'Best' : 'Top'}</span>` : ''}
        ${st.loops ? '<span class="loop-tag" title="Its ingredients are made from the item itself (for example nuggets or liquid back into ingots), so it only converts what you already have">↻ made from itself</span>' : ''}
        ${r.id === cur ? '<span class="cur-tag">current</span>' : ''}
      </div>
      <div class="pr-stats">
        <span class="st${hl('chain')}" title="Total energy per item, including making its ingredients (following the cheapest recipes, or the ones already in your plan)${st.approx ? '. Approximate: the ingredient tree loops or goes very deep' : ''}">Σ ${fmtNum(st.chainEU * scale)} EU${perUnit}${st.approx ? '*' : ''}</span>
        <span class="st${hl('step')}" title="Energy for this step only">⚡ ${fmtNum(st.stepEU * scale)} EU${perUnit}</span>
        ${st.machines ? `<span class="st${hl('machines')}" title="Machines needed to make 1${fluidItem ? ' bucket' : ''} per second at ${TIERS[st.runTier].name}, with overclocking">⚙ ${fmtNum(st.machines * scale, 2)} machines @ ${TIERS[st.runTier].name}</span>` : `<span class="st${hl('machines')}">⚙ instant</span>`}
        <span class="st${hl('raw')}" title="Raw materials per item, following the ingredient tree (items count 1, fluids count 1 per bucket)">⛏ ${fmtNum(st.raw * scale)} raw</span>
        <span class="st${hl('tier')}" title="Lowest voltage tier that can run it">${st.tier ? TIERS[st.tier].name : 'no power'}</span>
        ${st.byproductShare > 0.005 ? `<span class="st" title="Share of this recipe's cost carried by its other outputs (split by quantity: items 1 each, fluids 1 per bucket)">♻ ${Math.round(st.byproductShare * 100)}% to byproducts</span>` : ''}
        ${st.tools.map(t => `<span class="tool-tag" title="A tool is used, not consumed: it lasts ${t.est ? 'about ' : ''}${t.uses.toLocaleString()} crafts${t.est ? ' (estimated; exporter v8 records the exact durability)' : ''}">🔨 ${esc(iname(t.item))}: ${t.est ? '~' : ''}${t.uses.toLocaleString()} uses</span>`).join('')}
      </div>
      <div class="pr-io"><div class="chips">${ioChips(r.inputs) || '<span class="muted">nothing</span>'}</div><div class="arrow">→</div><div class="chips">${ioChips(r.outputs, item)}</div></div>
    </button>`;
  }).join('') + (list.length > LIMIT ? `<p class="hint">Showing ${LIMIT} of ${list.length} — filter to narrow it down.</p>` : '') + (list.length ? '' : '<p class="muted">No recipes match that filter.</p>');
}

function choosePick(value) {
  const item = pickerItem;
  if (!item) return;
  project().choices[item] = value;
  $('#pickDialog').close();
  update();
  if (value === 'raw') toast(`${iname(item)} is supplied as a raw input`);
  else {
    const r = INDEX.byId.get(value);
    const open = r ? r.inputs.filter(i => producersOf(i.item).length && currentChoice(i.item) === 'raw' && project().choices[i.item] !== 'raw').length : 0;
    toast(`${iname(item)} → ${r ? r.machine : 'recipe'}${open ? ` · ${plural(open, 'ingredient')} can be expanded (＋ on the graph)` : ''}`, 4000);
  }
}

/* ---------------- item search (autocomplete) ---------------- */

function searchItems(q, limit = 40, preferMakeable = false) {
  const out = [];
  for (const e of ITEM_SEARCH) {
    const i = e.lname.indexOf(q);
    if (i < 0 && !e.key.includes(q)) continue;
    let score = i === 0 ? 0 : i > 0 && /[\s(-]/.test(e.lname[i - 1]) ? 1 : i > 0 ? 2 : 3;
    if (preferMakeable && !e.makeable) score += 4;
    out.push([score, e.name.length, e]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return out.slice(0, limit).map(x => x[2]);
}

function attachItemSearch(input, onPick, opts = {}) {
  const wrap = input.parentElement;
  wrap.classList.add('ac-wrap');
  const box = document.createElement('div');
  box.className = 'ac-list';
  box.hidden = true;
  wrap.appendChild(box);
  let results = [], sel = -1;
  const show = () => {
    box.innerHTML = results.map((e, i) => `<div class="ac-item${i === sel ? ' sel' : ''}" data-i="${i}">
      ${dot(e.key, e.fluid)}<span class="ac-name">${inameHtml(e.key)}</span>
      <span class="ac-meta">${e.key.includes(':') ? '' : 'my item · '}${e.makeable ? plural(INDEX.producers.get(e.key).length, 'recipe') : 'no recipe'}</span></div>`).join('')
      || `<div class="ac-empty">No matching items${gameData ? '' : ' — import game recipes in the Recipes tab to search everything'}</div>`;
    box.hidden = false;
    const s = box.querySelector('.sel');
    s && s.scrollIntoView({ block: 'nearest' });
  };
  const pick = key => { box.hidden = true; input.value = ''; results = []; onPick(key); };
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; results = []; return; }
    results = searchItems(q, 40, opts.preferMakeable);
    sel = results.length ? 0 : -1;
    show();
  });
  input.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); show(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); show(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (sel >= 0) pick(results[sel].key);
      else if (opts.allowFree && input.value.trim()) pick(keyFromText(input.value));
    } else if (e.key === 'Escape') { box.hidden = true; }
  });
  box.addEventListener('mousedown', e => {
    const it = e.target.closest('.ac-item');
    if (it) { e.preventDefault(); pick(results[+it.dataset.i].key); }
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
}

/* ---------------- game recipe import ---------------- */

async function importGameFile(file) {
  toast(`Reading ${file.name}…`, 60000);
  let dump;
  try { dump = JSON.parse(await file.text()); } catch (e) { toast('That file is not valid JSON'); return; }
  await new Promise(r => setTimeout(r, 30));
  let res;
  try { res = parseGameDump(dump); } catch (e) { toast(e.message, 5000); return; }
  if (!res.recipes.length) { toast('No GregTech recipes found in that file', 5000); return; }
  gameData = {
    recipes: res.recipes, names: res.names, meta: res.meta, icons: res.icons, itemInfo: res.itemInfo || {},
    stats: Object.assign({}, res.stats, { types: [...res.stats.types] }),
    imported: new Date().toISOString(),
  };
  ITEM_NAMES.clear();
  for (const k in res.names) ITEM_NAMES.set(k, res.names[k]);
  let saved = true;
  try { await GameDB.set(gameData); } catch (e) { saved = false; }
  libDirty = true;
  recipeSource = 'game';
  renderAllStatic();
  update();
  const st = res.stats;
  toast(`Imported ${st.parsed.toLocaleString()} recipes${st.skipped + st.errors ? ` (${(st.skipped + st.errors).toLocaleString()} skipped)` : ''}${saved ? '' : ' — could not save them in this browser, re-import next time'}`, 6000);
  const starters = state.library.filter(r => STARTER_RECIPES.some(x => x.id === r.id));
  if (starters.length) {
    const yes = await ask({ title: 'Remove the example recipes?', message: `Your library still has ${starters.length} starter example recipes. Remove them so only real game recipes (and your own) are used?`, okLabel: 'Remove examples' });
    if (yes) {
      state.library = state.library.filter(r => !STARTER_RECIPES.some(x => x.id === r.id));
      renderAllStatic();
      update();
    }
  }
}

/* ---------------- recipe editor ---------------- */

let editing = null;

function openRecipeEditor(recipe, prefill) {
  editing = recipe ? recipe.id : null;
  const r = recipe ? clone(recipe) : Object.assign({ name: '', machine: '', duration: 100, eut: 30, inputs: [], outputs: [] }, prefill || {});
  const f = $('#recipeForm');
  $('#recipeDialogTitle').textContent = recipe ? 'Edit recipe' : 'New recipe';
  f.name.value = r.name || (prefill && prefill.outputs && prefill.outputs[0] ? iname(prefill.outputs[0].item) : '');
  f.machine.value = r.machine;
  f.duration.value = r.duration;
  f.durUnit.value = 't';
  f.eut.value = r.eut;
  f.temp.value = r.temp || '';
  $('#ioInputs').innerHTML = '';
  $('#ioOutputs').innerHTML = '';
  r.inputs.forEach(io => addIoRow('inputs', io));
  r.outputs.forEach(io => addIoRow('outputs', io));
  if (!r.outputs.length) addIoRow('outputs', { item: '', amount: 1 });
  refreshEditorMeta();
  $('#recipeDialog').showModal();
}

function addIoRow(kind, io) {
  const isOut = kind === 'outputs';
  const row = document.createElement('div');
  row.className = 'io-row' + (isOut ? '' : ' no-chance');
  row.dataset.fluid = io.fluid ? '1' : '';
  row.innerHTML = `
    <span class="kind${io.fluid ? ' fluid' : ''}" title="${io.fluid ? 'Fluid (mB)' : 'Item'}"></span>
    <input class="io-item-name" list="itemList" placeholder="${io.fluid ? 'Fluid name' : 'Item name'}" value="${esc(io.item ? iname(io.item) : '')}">
    <input class="io-amt" type="number" min="0" step="any" value="${io.amount != null ? io.amount : (io.fluid ? 1000 : 1)}" title="${io.fluid ? 'mB' : 'count'}">
    ${isOut ? `<input class="io-chance" type="number" min="0" max="100" step="any" value="${io.chance != null ? io.chance : 100}" title="Chance %">` : ''}
    <button type="button" class="icon-btn" title="Remove">×</button>`;
  row.querySelector('.kind').addEventListener('click', () => {
    row.dataset.fluid = row.dataset.fluid ? '' : '1';
    row.querySelector('.kind').classList.toggle('fluid', !!row.dataset.fluid);
  });
  row.querySelector('.icon-btn').addEventListener('click', () => row.remove());
  $(isOut ? '#ioOutputs' : '#ioInputs').appendChild(row);
  return row;
}

function refreshEditorMeta() {
  const f = $('#recipeForm');
  const eut = +f.eut.value || 0;
  const t = tierIndexForEut(eut);
  f.minTier.value = TIERS[t].name;
  f.minTier.style.color = TIERS[t].color;
  $('#tempField').style.display = machineUsesCoil(f.machine.value) || f.temp.value ? '' : 'none';
}

function readIoRows(container, isOut) {
  return [...container.querySelectorAll('.io-row')].map(row => {
    const io = { item: keyFromText(row.querySelector('.io-item-name').value), amount: +row.querySelector('.io-amt').value || 0 };
    if (row.dataset.fluid) io.fluid = true;
    if (isOut) {
      const c = +row.querySelector('.io-chance').value;
      if (isFinite(c) && c !== 100) io.chance = c;
    }
    return io;
  }).filter(io => io.item && io.amount > 0);
}

function saveRecipeFromForm() {
  const f = $('#recipeForm');
  const durRaw = +f.duration.value || 1;
  const r = {
    id: editing || uid('r_'),
    name: f.name.value.trim(),
    machine: f.machine.value.trim(),
    duration: Math.max(1, Math.round(f.durUnit.value === 's' ? durRaw * 20 : durRaw)),
    eut: Math.max(0, +f.eut.value || 0),
    inputs: readIoRows($('#ioInputs'), false),
    outputs: readIoRows($('#ioOutputs'), true),
  };
  if (+f.temp.value > 0) r.temp = +f.temp.value;
  if (!r.outputs.length) { toast('A recipe needs at least one output'); return false; }
  const i = state.library.findIndex(x => x.id === r.id);
  if (i >= 0) state.library[i] = r; else state.library.push(r);
  libDirty = true;
  renderDatalists();
  update();
  toast(`Saved "${r.name}"`);
  return true;
}

/* ---------------- import / export / share ---------------- */

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function readFile(input, cb) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { cb(JSON.parse(reader.result)); } catch (e) { toast('That file is not valid JSON'); }
    input.value = '';
  };
  reader.readAsText(file);
}

function sanitizeRecipe(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.outputs)) return null;
  const io = a => (Array.isArray(a) ? a : []).filter(x => x && x.item).map(x => {
    const o = { item: String(x.item), amount: +x.amount || 0 };
    if (x.fluid) o.fluid = true;
    if (x.chance != null && x.chance !== '') o.chance = +x.chance;
    return o;
  });
  const out = {
    id: String(r.id || uid('r_')), name: String(r.name || 'Unnamed'), machine: String(r.machine || 'Unknown'),
    duration: Math.max(1, +r.duration || 1), eut: Math.max(0, +r.eut || 0), inputs: io(r.inputs), outputs: io(r.outputs),
  };
  if (+r.temp > 0) out.temp = +r.temp;
  return out.outputs.length ? out : null;
}

function mergeRecipes(recipes) {
  let added = 0, updated = 0;
  for (const raw of recipes) {
    const r = sanitizeRecipe(raw);
    if (!r) continue;
    const i = state.library.findIndex(x => x.id === r.id);
    if (i >= 0) { state.library[i] = r; updated++; } else { state.library.push(r); added++; }
  }
  libDirty = true;
  return { added, updated };
}

function importProject(p) {
  const np = newProject(p);
  np.name = p.name || 'Imported plan';
  state.projects.push(np);
  return np;
}

function shareLink() {
  const p = project();
  const used = new Set(solution.nodes.map(n => n.id));
  for (const k in p.choices) if (p.choices[k] !== 'raw') used.add(p.choices[k]);
  const recipes = [...used].map(id => INDEX.byId.get(id)).filter(Boolean);
  const names = {};
  for (const r of recipes) for (const io of [...r.inputs, ...r.outputs]) if (ITEM_NAMES.has(io.item)) names[io.item] = ITEM_NAMES.get(io.item);
  const payload = { v: 1, project: Object.assign({}, p, { id: undefined }), recipes, names };
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url = location.href.split('#')[0] + '#plan=' + enc;
  const done = () => toast('Share link copied to clipboard');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => ask({ title: 'Copy this link', input: url, okLabel: 'Done' }));
  else ask({ title: 'Copy this link', input: url, okLabel: 'Done' });
}

function loadFromHash() {
  const m = location.hash.match(/^#plan=(.+)$/);
  if (!m) return;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    if (payload.recipes) {
      // Only add recipes that are missing so a link never overwrites your edits.
      for (const raw of payload.recipes) {
        const r = sanitizeRecipe(raw);
        if (r && !state.library.some(x => x.id === r.id) && !(gameData && gameData.recipes.some(x => x.id === r.id))) state.library.push(r);
      }
    }
    if (payload.names) for (const k in payload.names) if (!ITEM_NAMES.has(k)) ITEM_NAMES.set(k, payload.names[k]);
    if (payload.project) {
      const np = importProject(payload.project);
      state.activeId = np.id;
      toast(`Opened shared plan "${np.name}"`);
    }
  } catch (e) {
    toast('Could not read the shared plan in the link');
  }
  history.replaceState(null, '', location.href.split('#')[0]);
}

/* ---------------- tabs ---------------- */

function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  renderActiveTab();
  if (tab === 'flow') requestAnimationFrame(() => GraphView.needsFit && GraphView.fit());
}

/* ---------------- wiring ---------------- */

function init() {
  state = load() || defaultState();
  loadFromHash();
  RATE_UNIT = state.unit || 's';
  FLUID_UNITS = state.fluidUnits || 'auto';

  GraphView.init($('#graph'), selectNode, (act, id) => {
    if (act === 'hide') hideChain(id);
    else if (act === 'expand') { if (selection && selection.item === id) selection = null; showChain(id); }
    else if (act === 'pick') openPicker(id);
  }, saveNodePosition);
  document.querySelectorAll('#dirSeg button').forEach(b => b.addEventListener('click', () => {
    project().graphDir = b.dataset.dir;
    renderFlow();
    save();
  }));
  $('#btnResetLayout').addEventListener('click', () => {
    const p = project();
    if (p.graphPos) delete p.graphPos[p.graphDir || 'lr'];
    GraphView.lastKey = '';
    renderFlow();
    save();
  });
  attachItemSearch($('#targetSearch'), key => addTarget(key, 1), { preferMakeable: true });
  attachItemSearch($('#rawAddInput'), key => supplyAsRaw(key), { allowFree: true });

  // Recipe picker.
  $('#pickSearch').addEventListener('input', renderPickList);
  $('#pickMachine').addEventListener('change', renderPickList);
  $('#pickRecycle').addEventListener('change', renderPickList);
  $('#pickSort').addEventListener('change', e => { state.pickSort = e.target.value; save(); renderPickList(); });
  $('#pickByproducts').addEventListener('change', e => { state.byproductMode = e.target.value; save(); pickerEff = pickerEfficiency(); renderPickList(); });
  $('#pickClose').addEventListener('click', () => $('#pickDialog').close());
  $('#pickRaw').addEventListener('click', () => choosePick('raw'));
  $('#pickList').addEventListener('click', e => {
    const row = e.target.closest('.pick-row');
    if (row) choosePick(row.dataset.id);
  });
  document.querySelectorAll('#recipeSrcSeg button').forEach(b => b.addEventListener('click', () => { recipeSource = b.dataset.src; renderRecipes(); }));

  IconStore.load().then(() => { if (IconStore.data) { renderAllStatic(); update(); } });
  bindIconDialog();

  // Load previously imported game recipes.
  GameDB.get().then(d => {
    if (!d || !Array.isArray(d.recipes)) return;
    gameData = d;
    // Older imports: apply tool handling now instead of requiring a re-import.
    normalizeTools(d.recipes, { gtIcons: (d.icons && d.icons.gtIcons) || {}, itemInfo: d.itemInfo || {}, names: d.names || {} });
    ITEM_NAMES.clear();
    for (const k in d.names || {}) ITEM_NAMES.set(k, d.names[k]);
    libDirty = true;
    renderAllStatic();
    update();
  });
  $('#rawAddForm').addEventListener('submit', e => {
    e.preventDefault();
    supplyAsRaw($('#rawAddInput').value);
    $('#rawAddInput').value = '';
  });

  $('#projectSelect').addEventListener('change', e => switchProject(e.target.value));
  $('#btnNewProject').addEventListener('click', async () => {
    const name = await ask({ title: 'New plan', message: 'What should this plan be called?', input: 'New plan', okLabel: 'Create' });
    if (name == null) return;
    const p = newProject({ name: name.trim() || 'New plan', defaultTier: project().defaultTier, gridTier: project().gridTier });
    state.projects.push(p);
    switchProject(p.id);
  });
  $('#btnRenameProject').addEventListener('click', async () => {
    const p = project();
    const name = await ask({ title: 'Rename plan', input: p.name, okLabel: 'Rename' });
    if (name == null || !name.trim()) return;
    p.name = name.trim();
    renderProjectSelect();
    save();
  });
  $('#btnDupProject').addEventListener('click', () => {
    const p = newProject(project());
    p.name = project().name + ' (copy)';
    state.projects.push(p);
    switchProject(p.id);
  });
  $('#btnDeleteProject').addEventListener('click', async () => {
    const yes = await ask({ title: 'Delete plan?', message: `"${project().name}" will be deleted. Your recipe library is kept.`, okLabel: 'Delete', danger: true });
    if (!yes) return;
    state.projects = state.projects.filter(p => p.id !== state.activeId);
    if (!state.projects.length) state.projects.push(newProject({ name: 'New plan' }));
    switchProject(state.projects[0].id);
  });

  document.querySelectorAll('#unitSeg button').forEach(b => b.addEventListener('click', () => {
    state.unit = b.dataset.unit;
    RATE_UNIT = state.unit;
    renderProjectSelect();
    renderTargets();
    update();
  }));

  $('#defaultTier').addEventListener('change', e => { project().defaultTier = +e.target.value; update(); });
  $('#defaultCoil').addEventListener('change', e => { project().defaultCoil = +e.target.value; update(); });
  $('#gridTier').addEventListener('change', e => { project().gridTier = +e.target.value; update(); });
  $('#fluidUnits').value = state.fluidUnits || 'auto';
  $('#fluidUnits').addEventListener('change', e => { state.fluidUnits = e.target.value; FLUID_UNITS = state.fluidUnits; update(); });
  $('#autoExpand').addEventListener('change', e => { project().autoExpand = e.target.checked; update(); });
  $('#autoPerfectTier').addEventListener('change', e => { project().autoPerfectTier = e.target.checked; update(); });

  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  $('#btnFit').addEventListener('click', () => GraphView.fit());
  $('#btnZoomIn').addEventListener('click', () => GraphView.zoomBy(1.25));
  $('#btnZoomOut').addEventListener('click', () => GraphView.zoomBy(0.8));
  GraphView.stubs = state.graphStubs !== false;
  $('#graphStubs').checked = GraphView.stubs;
  $('#graphStubs').addEventListener('change', e => { state.graphStubs = e.target.checked; GraphView.stubs = e.target.checked; GraphView.lastKey = ''; renderFlow(); save(); });
  $('#showLabels').checked = !!state.alwaysRates;
  GraphView.setLabels(!!state.alwaysRates);
  $('#showLabels').addEventListener('change', e => { state.alwaysRates = e.target.checked; GraphView.setLabels(e.target.checked); save(); });
  $('#btnSvg').addEventListener('click', () => {
    const s = GraphView.exportSvg();
    if (!s) { toast('Nothing to export yet'); return; }
    download(`${project().name.replace(/[^\w-]+/g, '_')}.svg`, s, 'image/svg+xml');
  });

  $('#drawerClose').addEventListener('click', () => selectNode(null));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#recipeDialog').open && selection) selectNode(null);
  });

  // Recipes tab.
  $('#recipeSearch').addEventListener('input', renderRecipes);
  $('#btnNewRecipe').addEventListener('click', () => openRecipeEditor(null));
  $('#btnExportLib').addEventListener('click', () => download('moniflow-recipes.json', JSON.stringify({ library: state.library }, null, 2)));
  $('#fileImportLib').addEventListener('change', e => readFile(e.target, data => {
    const recipes = Array.isArray(data) ? data : data.library;
    if (!Array.isArray(recipes)) { toast('No recipes found in that file'); return; }
    const { added, updated } = mergeRecipes(recipes);
    renderDatalists(); update();
    toast(`Imported ${added} new, ${updated} updated recipes`);
  }));
  $('#btnResetLib').addEventListener('click', () => {
    let n = 0;
    for (const r of STARTER_RECIPES) if (!state.library.some(x => x.id === r.id)) { state.library.push(clone(r)); n++; }
    renderDatalists(); update();
    toast(n ? `Restored ${n} starter recipes` : 'All starter recipes are already present');
  });

  // Recipe dialog.
  const f = $('#recipeForm');
  f.eut.addEventListener('input', refreshEditorMeta);
  f.machine.addEventListener('input', refreshEditorMeta);
  document.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const row = addIoRow(b.dataset.add, { item: '', fluid: !!b.dataset.fluid });
    row.querySelector('.io-item-name').focus();
  }));
  $('#recipeCancel').addEventListener('click', () => $('#recipeDialog').close());
  f.addEventListener('submit', e => {
    e.preventDefault();
    if (saveRecipeFromForm()) $('#recipeDialog').close();
  });

  // Global import / export.
  $('#btnExport').addEventListener('click', () => download('moniflow-backup.json', JSON.stringify({ app: 'MoniFlow', version: 1, library: state.library, projects: state.projects }, null, 2)));
  $('#fileImport').addEventListener('change', e => readFile(e.target, data => {
    let msg = [];
    if (Array.isArray(data.library)) { const r = mergeRecipes(data.library); msg.push(`${r.added + r.updated} recipes`); }
    let last = null;
    if (Array.isArray(data.projects)) { for (const p of data.projects) last = importProject(p); msg.push(`${data.projects.length} plans`); }
    if (data.project) { last = importProject(data.project); msg.push('1 plan'); }
    if (last) state.activeId = last.id;
    renderAllStatic(); update();
    toast(msg.length ? `Imported ${msg.join(' and ')}` : 'Nothing to import in that file');
  }));
  $('#btnShare').addEventListener('click', shareLink);
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#plan=')) { loadFromHash(); renderAllStatic(); update(); } });

  renderAllStatic();
  update();
}

document.addEventListener('DOMContentLoaded', init);
