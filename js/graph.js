/* MoniFlow — layered flow graph rendered to SVG */
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const NODE_W = 224, NODE_H = 70, IO_STRIP = 0, ITEM_W = 172, ITEM_H = 40;
const PORT_STEP = 24, PORT_OUT = 3; // spacing of input/output icons on node edges; how far they sit outside
const COL_GAP = 120, ROW_GAP = 34;

function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Build nodes + edges from a solution. */
function buildGraph(sol, opts = {}) {
  const nodes = new Map();
  const edges = [];
  const addNode = n => { nodes.set(n.id, n); return n; };

  for (const n of sol.nodes) addNode({ id: n.id, kind: 'recipe', data: n, w: NODE_W, h: NODE_H + IO_STRIP,
    inPorts: [...new Set(n.recipe.inputs.filter(io => (Number(io.amount) || 0) > 0).map(io => io.item))],
    outPorts: [...new Set(n.recipe.outputs.map(o => o.item))] });
  for (const r of sol.raw) addNode({ id: 'raw:' + r.item, kind: 'raw', item: r.item, rate: r.rate, fluid: r.fluid, manual: r.manual, expandable: r.expandable, w: ITEM_W, h: ITEM_H });
  for (const t of sol.targets) {
    const fluid = isFluidItem(sol, t.item);
    addNode({ id: 'out:' + t.item, kind: 'out', item: t.item, rate: t.rate, fluid, w: ITEM_W, h: ITEM_H });
  }
  for (const s of sol.surplus) addNode({ id: 'sur:' + s.item, kind: 'sur', item: s.item, rate: s.rate, fluid: s.fluid, w: ITEM_W, h: ITEM_H });

  // Per item: producers and consumers, then allocate proportionally.
  const prod = new Map(), cons = new Map();
  const push = (m, item, e) => { if (!m.has(item)) m.set(item, []); m.get(item).push(e); };
  for (const n of sol.nodes) {
    for (const o of n.recipe.outputs) push(prod, o.item, { id: n.id, amt: expectedAmount(o) * n.rate, fluid: !!o.fluid });
    for (const i of n.recipe.inputs) push(cons, i.item, { id: n.id, amt: (Number(i.amount) || 0) * n.rate, fluid: !!i.fluid });
  }
  for (const r of sol.raw) push(prod, r.item, { id: 'raw:' + r.item, amt: r.rate, fluid: r.fluid });
  for (const t of sol.targets) push(cons, t.item, { id: 'out:' + t.item, amt: t.rate, fluid: isFluidItem(sol, t.item) });
  for (const s of sol.surplus) push(cons, s.item, { id: 'sur:' + s.item, amt: s.rate, fluid: s.fluid });

  for (const [item, ps] of prod) {
    const cs = cons.get(item);
    if (!cs) continue;
    const totalP = ps.reduce((a, p) => a + p.amt, 0);
    if (totalP <= 0) continue;
    for (const p of ps) for (const c of cs) {
      if (p.id === c.id) continue;
      const flow = p.amt * c.amt / totalP;
      if (flow < 1e-9) continue;
      edges.push({ from: p.id, to: c.id, item, rate: flow, fluid: p.fluid || c.fluid });
    }
  }

  // Stubs: raw inputs and byproducts drawn as short lines at the step itself, instead of separate
  // nodes with long lines across the graph. (Kept as nodes when they connect straight to a target.)
  if (opts.stubs) {
    for (const [id, n] of [...nodes]) {
      if (n.kind !== 'raw' && n.kind !== 'sur') continue;
      const mine = edges.filter(e => (n.kind === 'raw' ? e.from : e.to) === id);
      const ok = mine.length && mine.every(e => nodes.get(n.kind === 'raw' ? e.to : e.from).kind === 'recipe');
      if (!ok) continue;
      nodes.delete(id);
      for (const e of mine) { e.stub = n.kind === 'raw' ? 'in' : 'out'; e.manual = n.manual; }
    }
  }
  return { nodes, edges };
}

function isFluidItem(sol, item) {
  for (const n of sol.nodes) {
    for (const io of n.recipe.outputs) if (io.item === item) return !!io.fluid;
    for (const io of n.recipe.inputs) if (io.item === item) return !!io.fluid;
  }
  const r = sol.raw.find(x => x.item === item);
  return r ? r.fluid : false;
}

/** Assign columns (ranks) and rows; returns graph bounds. */
function layoutGraph(g) {
  const { nodes, edges } = g;
  const out = new Map(), inc = new Map();
  for (const id of nodes.keys()) { out.set(id, []); inc.set(id, []); }
  for (const e of edges) { if (e.stub) continue; out.get(e.from).push(e); inc.get(e.to).push(e); }

  // Break cycles with DFS: mark back edges.
  const state = new Map();
  const visit = id => {
    state.set(id, 1);
    for (const e of out.get(id)) {
      const s = state.get(e.to);
      if (s === 1) e.back = true;
      else if (!s) visit(e.to);
    }
    state.set(id, 2);
  };
  const order = [...nodes.keys()].sort((a, b) => inc.get(a).length - inc.get(b).length);
  for (const id of order) if (!state.get(id)) visit(id);

  // Longest path ranks for recipe nodes (column 0 is reserved for raw inputs).
  const rank = new Map();
  const getRank = (id, stack = new Set()) => {
    if (rank.has(id)) return rank.get(id);
    if (stack.has(id)) return 1;
    stack.add(id);
    let r = 1;
    for (const e of inc.get(id)) {
      if (e.back) continue;
      const src = nodes.get(e.from);
      if (src.kind !== 'recipe') continue;
      r = Math.max(r, getRank(e.from, stack) + 1);
    }
    stack.delete(id);
    rank.set(id, r);
    return r;
  };
  let maxRank = 1;
  for (const [id, n] of nodes) if (n.kind === 'recipe') maxRank = Math.max(maxRank, getRank(id));

  // Pull recipe nodes right toward their consumers to shorten edges.
  const recipeIds = [...nodes.keys()].filter(id => nodes.get(id).kind === 'recipe');
  for (let pass = 0; pass < 3; pass++) {
    for (const id of recipeIds.sort((a, b) => rank.get(b) - rank.get(a))) {
      const consumers = out.get(id).filter(e => !e.back && nodes.get(e.to).kind === 'recipe').map(e => rank.get(e.to));
      const hasOther = out.get(id).some(e => nodes.get(e.to).kind === 'out');
      if (consumers.length && !hasOther) {
        const want = Math.min(...consumers) - 1;
        if (want > rank.get(id)) rank.set(id, want);
      }
    }
  }

  for (const [id, n] of nodes) {
    if (n.kind === 'out') rank.set(id, maxRank + 1);
    else if (n.kind === 'raw') {
      const cr = out.get(id).map(e => rank.get(e.to)).filter(x => x != null);
      rank.set(id, cr.length ? Math.max(0, Math.min(...cr) - 1) : 0);
    }
  }
  for (const [id, n] of nodes) {
    if (n.kind === 'sur') {
      const pr = inc.get(id).map(e => rank.get(e.from)).filter(x => x != null);
      rank.set(id, pr.length ? Math.max(...pr) + 1 : maxRank + 1);
    }
  }

  // Long edges get a chain of invisible waypoints, one per column they pass through, so the line
  // travels through the gaps between nodes instead of straight across them.
  const all = new Map(nodes);
  const adjIn = new Map(), adjOut = new Map();
  for (const id of all.keys()) { adjIn.set(id, []); adjOut.set(id, []); }
  const cols = new Map();
  const place = (id, r) => { if (!cols.has(r)) cols.set(r, []); cols.get(r).push(id); };
  for (const [id] of nodes) place(id, rank.get(id));
  const link = (a, b, w) => { adjOut.get(a).push({ id: b, w }); adjIn.get(b).push({ id: a, w }); };
  edges.forEach((e, idx) => {
    e.via = null;
    if (e.stub) return;
    const r0 = rank.get(e.from), r1 = rank.get(e.to);
    if (e.back || r1 <= r0) return; // loops are drawn around the outside
    let prev = e.from;
    if (r1 - r0 > 1) e.via = [];
    for (let r = r0 + 1; r < r1; r++) {
      const id = `~${idx}:${r}`;
      const d = { id, kind: 'dummy', edge: e, w: 0, h: 0 };
      all.set(id, d); adjIn.set(id, []); adjOut.set(id, []);
      place(id, r);
      link(prev, id, e.w || 2);
      e.via.push(d);
      prev = id;
    }
    link(prev, e.to, e.w || 2);
  });
  const colKeys = [...cols.keys()].sort((a, b) => a - b);
  const layers = colKeys.map(k => cols.get(k));

  // Order within columns: barycenter sweeps, keeping whichever order has the fewest crossings,
  // then swapping neighbours while that removes crossings.
  const pos = new Map();
  const renumber = ids => ids.forEach((id, i) => pos.set(id, i));
  layers.forEach(renumber);
  const kindOrder = { raw: 0, recipe: 1, dummy: 1, out: 2, sur: 3 };
  const crossBetween = (upper) => {
    const segs = [];
    for (const id of upper) for (const nb of adjOut.get(id)) segs.push([pos.get(id), pos.get(nb.id)]);
    let c = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [a1, b1] = segs[i], [a2, b2] = segs[j];
      if ((a1 - a2) * (b1 - b2) < 0) c++;
    }
    return c;
  };
  const crossings = () => layers.reduce((s, ids) => s + crossBetween(ids), 0);
  let bestC = crossings(), best = layers.map(ids => ids.slice());
  for (let sweep = 0; sweep < 24 && bestC > 0; sweep++) {
    const down = sweep % 2 === 0;
    for (const ids of (down ? layers : [...layers].reverse())) {
      const bary = new Map(ids.map(id => {
        let nb = down ? adjIn.get(id) : adjOut.get(id);
        if (!nb.length) nb = [...adjIn.get(id), ...adjOut.get(id)];
        if (!nb.length) return [id, pos.get(id)];
        let s = 0, sw = 0;
        for (const x of nb) { s += pos.get(x.id) * x.w; sw += x.w; }
        return [id, s / sw];
      }));
      ids.sort((a, b) => (bary.get(a) - bary.get(b)) || (kindOrder[all.get(a).kind] - kindOrder[all.get(b).kind]));
      renumber(ids);
    }
    const c = crossings();
    if (c < bestC) { bestC = c; best = layers.map(ids => ids.slice()); }
  }
  layers.forEach((ids, i) => { ids.splice(0, ids.length, ...best[i]); renumber(ids); });
  // Crossings caused by u sitting before v (against both neighbouring columns).
  const pairCross = (u, v) => {
    let c = 0;
    for (const adj of [adjIn, adjOut]) {
      for (const a of adj.get(u)) for (const b of adj.get(v)) if (pos.get(a.id) > pos.get(b.id)) c++;
    }
    return c;
  };
  for (let round = 0, improved = true; round < 12 && improved; round++) {
    improved = false;
    for (const ids of layers) {
      for (let i = 0; i + 1 < ids.length; i++) {
        const u = ids[i], v = ids[i + 1];
        if (pairCross(v, u) < pairCross(u, v)) {
          ids[i] = v; ids[i + 1] = u;
          pos.set(v, i); pos.set(u, i + 1);
          improved = true;
        }
      }
    }
  }

  return { cols, colKeys, out, inc, all, adjIn, adjOut, crossings: crossings() };
}

/* ------------------------------------------------------------------ */
/* Directions and coordinate assignment                                */

const DIRS = {
  lr: { horizontal: true, flip: false, rankGap: 96, crossGap: 20 },
  tb: { horizontal: false, flip: false, rankGap: 84, crossGap: 22 },
  bt: { horizontal: false, flip: true, rankGap: 84, crossGap: 22 },
};

/**
 * Place nodes: layers along the flow axis, and within a layer pull each node toward
 * the (flow-weighted) average of its neighbours, keeping order and spacing.
 * Waypoints of long lines are placed too, and become corridors the line runs through.
 */
function assignCoordinates(g, lay, dir) {
  const D = DIRS[dir] || DIRS.lr;
  const all = lay.all;
  const isDummy = n => n.kind === 'dummy';
  const rankSize = n => (isDummy(n) ? 0 : D.horizontal ? n.w : n.h);
  const crossSize = n => (isDummy(n) ? Math.max(4, n.edge.w || 2) : D.horizontal ? n.h : n.w);
  const layers = lay.colKeys.map(k => lay.cols.get(k));

  // Flow axis.
  let a = 0;
  const layerSpan = [];
  for (const ids of layers) {
    const ext = Math.max(0, ...ids.map(id => rankSize(all.get(id))));
    for (const id of ids) { const n = all.get(id); n._a = a + (ext - rankSize(n)) / 2; }
    layerSpan.push([a, a + ext]);
    for (const id of ids) { const n = all.get(id); n._a0 = a; n._a1 = a + ext; }
    a += ext + D.rankGap;
  }
  const flowLength = Math.max(0, a - D.rankGap);

  // Cross axis: start packed and centred.
  const gapBetween = (x, y) => (isDummy(x) && isDummy(y) ? 6 : isDummy(x) || isDummy(y) ? 12 : D.crossGap);
  const center = new Map();
  for (const ids of layers) {
    let c = 0;
    const tmp = ids.map((id, i) => {
      const n = all.get(id);
      if (i) c += gapBetween(all.get(ids[i - 1]), n);
      const mid = c + crossSize(n) / 2;
      c += crossSize(n);
      return mid;
    });
    ids.forEach((id, i) => center.set(id, tmp[i] - c / 2));
  }

  // Refine: alternate sweeps toward predecessors / successors.
  for (let pass = 0; pass < 16; pass++) {
    const forward = pass % 2 === 0;
    for (const ids of (forward ? layers : [...layers].reverse())) {
      if (!ids.length) continue;
      const desired = ids.map(id => {
        let list = forward ? lay.adjIn.get(id) : lay.adjOut.get(id);
        if (!list.length) list = [...lay.adjIn.get(id), ...lay.adjOut.get(id)];
        if (!list.length) return center.get(id);
        let s = 0, sw = 0;
        // Waypoints pull harder so long lines run straight.
        for (const x of list) { const w = (1 + x.w) * (isDummy(all.get(id)) ? 2 : 1); s += center.get(x.id) * w; sw += w; }
        return 0.85 * (s / sw) + 0.15 * center.get(id);
      });
      const sep = i => {
        const x = all.get(ids[i]), y = all.get(ids[i + 1]);
        return (crossSize(x) + crossSize(y)) / 2 + gapBetween(x, y);
      };
      const p = desired.slice(), q = desired.slice();
      for (let i = 1; i < ids.length; i++) p[i] = Math.max(p[i], p[i - 1] + sep(i - 1));
      for (let i = ids.length - 2; i >= 0; i--) q[i] = Math.min(q[i], q[i + 1] - sep(i));
      ids.forEach((id, i) => center.set(id, (p[i] + q[i]) / 2));
    }
  }

  let minC = Infinity;
  for (const [id, n] of all) minC = Math.min(minC, center.get(id) - crossSize(n) / 2);
  const flowPos = v => (D.flip ? flowLength - v : v);
  for (const [id, n] of all) {
    const c = center.get(id) - minC;
    if (isDummy(n)) {
      // Corridor through this column, in travel order.
      const f0 = flowPos(n._a0), f1 = flowPos(n._a1);
      n.seg = D.horizontal ? { x1: f0, y1: c, x2: f1, y2: c } : { x1: c, y1: f0, x2: c, y2: f1 };
      continue;
    }
    const c0 = c - crossSize(n) / 2;
    if (D.horizontal) { n.x = n._a; n.y = c0; } else { n.x = c0; n.y = D.flip ? flowLength - n._a - n.h : n._a; }
  }
}

function computeBounds(g) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const pad = 0;
  for (const n of g.nodes.values()) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, width: 0, height: 0 };
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

/* ------------------------------------------------------------------ */

const GraphView = {
  svg: null, root: null, view: { x: 0, y: 0, k: 1 }, bounds: null,
  lastKey: '', selected: null, showLabels: false, stubs: true, onSelect: null, onMove: null, dir: 'lr', hover: null,

  init(svg, onSelect, onAction, onMove) {
    this.svg = svg;
    this.onSelect = onSelect;
    this.onAction = onAction;
    this.onMove = onMove;
    let drag = null;
    let raf = 0;
    svg.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const btn = e.target.closest && e.target.closest('.g-btn');
      const nodeEl = !btn && e.target.closest && e.target.closest('.g-node');
      const n = nodeEl && this.graph && this.graph.nodes.get(nodeEl.dataset.id);
      if (n) drag = { mode: 'node', el: nodeEl, n, x: e.clientX, y: e.clientY, nx: n.x, ny: n.y, moved: false };
      else drag = { mode: 'pan', x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y, moved: false };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        svg.classList.add(drag.mode === 'node' ? 'dragging' : 'panning');
      }
      if (!drag.moved) return;
      if (drag.mode === 'node') {
        drag.n.x = Math.round((drag.nx + dx / this.view.k) / 4) * 4;
        drag.n.y = Math.round((drag.ny + dy / this.view.k) / 4) * 4;
        drag.el.setAttribute('transform', `translate(${drag.n.x},${drag.n.y})`);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.drawEdges(); this.highlight(this.selected); });
      } else {
        this.view.x = drag.vx + dx; this.view.y = drag.vy + dy;
        this.apply();
      }
    });
    const end = e => {
      if (!drag) return;
      const d = drag;
      drag = null;
      svg.classList.remove('panning', 'dragging');
      if (d.moved) {
        if (d.mode === 'node') {
          this.drawEdges();
          this.highlight(this.selected);
          this.bounds = computeBounds(this.graph);
          this.onMove && this.onMove(d.n.id, { x: d.n.x, y: d.n.y }, this.dir);
        }
        return;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const btn = target && target.closest && target.closest('.g-btn');
      if (btn) { this.onAction && this.onAction(btn.dataset.act, btn.dataset.arg); return; }
      const node = target && target.closest && target.closest('.g-node');
      const port = target && target.closest && target.closest('.g-port[data-item]');
      this.onSelect && this.onSelect(port ? port.dataset.item : node ? node.dataset.id : null);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('panning', 'dragging'); });
    const tip = document.getElementById('graphTip');
    const hideTip = () => { if (tip) tip.hidden = true; };
    svg.addEventListener('pointermove', e => {
      if (drag && drag.moved) { hideTip(); return; }
      const t = e.target;
      const portEl = t.closest && t.closest('.g-port[data-item]');
      const nodeEl = !portEl && t.closest && t.closest('.g-node');
      const edgeEl = !nodeEl && !portEl && t.closest && t.closest('.g-edge');
      let h = null, html = '';
      if (portEl && this.graph) {
        const idx = +portEl.dataset.e;
        const ed = this.graph.edges[idx];
        if (ed) { h = { kind: 'edge', id: idx }; html = edgeTipHtml(ed, this.graph); }
      } else if (nodeEl && this.graph) {
        const n = this.graph.nodes.get(nodeEl.dataset.id);
        if (n) { h = { kind: 'node', id: n.id }; if (!t.closest('.g-btn')) html = nodeTipHtml(n); }
      } else if (edgeEl && this.graph) {
        const idx = +edgeEl.dataset.e;
        const ed = this.graph.edges[idx];
        if (ed) { h = { kind: 'edge', id: idx }; html = edgeTipHtml(ed, this.graph); }
      }
      this.setHover(h);
      if (!tip) return;
      if (!html) { hideTip(); return; }
      if (tip.dataset.key !== (h.kind + ':' + h.id)) { tip.innerHTML = html; tip.dataset.key = h.kind + ':' + h.id; }
      tip.hidden = false;
      const wrap = svg.parentElement.getBoundingClientRect();
      let x = e.clientX - wrap.left + 16, y = e.clientY - wrap.top + 16;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      if (x + tw > wrap.width - 8) x = e.clientX - wrap.left - tw - 16;
      if (y + th > wrap.height - 8) y = Math.max(8, wrap.height - th - 8);
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = y + 'px';
    });
    svg.addEventListener('pointerleave', () => { this.setHover(null); hideTip(); });
    svg.addEventListener('pointerdown', hideTip);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    new ResizeObserver(() => { if (this.bounds && this.needsFit) this.fit(); }).observe(svg);
  },

  zoomAt(px, py, f) {
    const k = Math.min(3, Math.max(0.1, this.view.k * f));
    f = k / this.view.k;
    this.view.x = px - (px - this.view.x) * f;
    this.view.y = py - (py - this.view.y) * f;
    this.view.k = k;
    this.apply();
  },
  /** Pan so a node is fully visible (used when selecting from tables). */
  ensureVisible(id) {
    const n = this.graph && this.graph.nodes.get(id);
    if (!n) return;
    const r = this.svg.getBoundingClientRect();
    if (r.width < 10) return;
    const k = this.view.k;
    const x0 = n.x * k + this.view.x, y0 = n.y * k + this.view.y;
    const x1 = x0 + n.w * k, y1 = y0 + n.h * k;
    if (x0 >= 0 && y0 >= 0 && x1 <= r.width && y1 <= r.height) return;
    this.view.x = r.width / 2 - (n.x + n.w / 2) * k;
    this.view.y = r.height / 2 - (n.y + n.h / 2) * k;
    this.apply();
  },
  zoomBy(f) {
    const r = this.svg.getBoundingClientRect();
    this.zoomAt(r.width / 2, r.height / 2, f);
  },

  apply() {
    if (this.root) this.root.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
  },

  fit() {
    if (!this.bounds) return;
    const r = this.svg.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) { this.needsFit = true; return; }
    this.needsFit = false;
    const pad = 50, b = this.bounds;
    const k = Math.min(1.1, (r.width - pad * 2) / Math.max(1, b.width), (r.height - pad * 2 - 30) / Math.max(1, b.height));
    this.view.k = Math.max(0.1, k);
    this.view.x = (r.width - b.width * this.view.k) / 2 - b.minX * this.view.k;
    this.view.y = (r.height - 30 - b.height * this.view.k) / 2 - b.minY * this.view.k;
    this.apply();
  },

  render(sol, project) {
    const svg = this.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = el('defs', null, svg);
    const glow = el('filter', { id: 'shadow', x: '-20%', y: '-20%', width: '140%', height: '160%' }, defs);
    el('feDropShadow', { dx: 0, dy: 3, stdDeviation: 5, 'flood-color': '#000', 'flood-opacity': 0.45 }, glow);

    this.root = el('g', null, svg);
    const g = buildGraph(sol, { stubs: this.stubs });
    if (!g.nodes.size) { this.bounds = null; this.graph = null; return false; }
    this.dir = DIRS[project.graphDir] ? project.graphDir : 'lr';
    // Room for one icon per ingredient/product along the side where lines attach.
    const Dsz = DIRS[this.dir];
    for (const n of g.nodes.values()) {
      if (n.kind !== 'recipe') continue;
      const k = Math.max(n.inPorts.length, n.outPorts.length);
      if (Dsz.horizontal) n.h = Math.max(NODE_H, k * PORT_STEP + 14);
      else n.w = Math.max(NODE_W, k * PORT_STEP + 28);
    }

    // Edge widths, normalized separately for fluids (mB) and items (also used as layout weights).
    const maxItem = Math.max(1e-9, ...g.edges.filter(e => !e.fluid).map(e => e.rate));
    const maxFluid = Math.max(1e-9, ...g.edges.filter(e => e.fluid).map(e => e.rate));
    for (const e of g.edges) e.w = 2 + 12 * Math.sqrt(e.rate / (e.fluid ? maxFluid : maxItem));

    const lay = layoutGraph(g);
    assignCoordinates(g, lay, this.dir);
    // Positions you dragged by hand win over the automatic layout.
    const pinned = (project.graphPos && project.graphPos[this.dir]) || {};
    for (const [id, n] of g.nodes) if (pinned[id]) { n.x = pinned[id].x; n.y = pinned[id].y; n.pinned = true; }
    if (Object.keys(pinned).length) resolveOverlaps(g, DIRS[this.dir]);
    this.lay = lay;
    this.graph = g;
    this.bounds = computeBounds(g);

    // Lines under nodes; rate labels and line badges on top (their placement avoids nodes).
    this.edgeLayer = el('g', null, this.root);
    const nodeLayer = el('g', null, this.root);
    this.labelLayer = el('g', null, this.root);
    for (const [, n] of g.nodes) drawNode(nodeLayer, n, project);
    this.drawEdges();

    const key = this.dir + '#' + [...g.nodes.keys()].sort().join('|');
    if (key !== this.lastKey) { this.lastKey = key; this.fit(); } else this.apply();
    this.highlight(this.selected);
    return true;
  },

  /** (Re)draw edges and rate labels from the current node positions. */
  drawEdges() {
    const g = this.graph, lay = this.lay;
    if (!g) return;
    const D = DIRS[this.dir];
    while (this.edgeLayer.firstChild) this.edgeLayer.removeChild(this.edgeLayer.firstChild);
    while (this.labelLayer.firstChild) this.labelLayer.removeChild(this.labelLayer.firstChild);

    // Order each recipe's port icons by where their lines go, so lines don't cross; then move the badges.
    sortPorts(g, lay, D);
    for (const n of g.nodes.values()) if (n.portEls) placePorts(n, D);

    // Ports: stack edges along the node side, sorted by where the line heads (its first waypoint, or the other node).
    for (const [id, n] of g.nodes) {
      if (n.kind === 'recipe') {
        for (const e of lay.out.get(id)) e.sp = portCoord(n, e.item, true, D);
        for (const e of lay.inc.get(id)) e.tp = portCoord(n, e.item, false, D);
        continue;
      }
      spreadPorts(lay.out.get(id).slice().sort((a, b) => edgeHeading(g, a, true, D) - edgeHeading(g, b, true, D)), n, 'sp', D);
      spreadPorts(lay.inc.get(id).slice().sort((a, b) => edgeHeading(g, a, false, D) - edgeHeading(g, b, false, D)), n, 'tp', D);
    }
    for (const e of g.edges) {
      if (e.stub === 'in') e.tp = portCoord(g.nodes.get(e.to), e.item, false, D);
      else if (e.stub === 'out') e.sp = portCoord(g.nodes.get(e.from), e.item, true, D);
    }

    g.edges.forEach((e, idx) => {
      const color = itemLineColor(e.item, e.fluid);
      if (e.stub) { markPort(g, e, idx, D); return; }
      const d = edgePath(g.nodes.get(e.from), g.nodes.get(e.to), e, D);
      const ge = el('g', { class: 'g-edge', 'data-from': e.from, 'data-to': e.to, 'data-e': idx }, this.edgeLayer);
      // Wide invisible stroke makes thin lines easy to hover.
      el('path', { d, class: 'hit', 'stroke-width': Math.max(10, e.w + 6) }, ge);
      const p = el('path', { d, class: 'flow', stroke: color, 'stroke-width': e.w }, ge);
      el('path', { d, class: 'anim', 'stroke-width': Math.max(1.5, e.w * 0.35), stroke: color }, ge);
      e.pathEl = p;
    });
    this.drawLabels();
    this.applyHover();
  },

  /** Rate labels: try several spots along each edge and take the least crowded one. */
  drawLabels() {
    const g = this.graph;
    const placed = [];
    for (const n of g.nodes.values()) placed.push({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: n.h + 8 });
    const overlaps = r => placed.reduce((c, p) => c + (r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y ? 1 : 0), 0);
    const edges = g.edges.slice().sort((a, b) => b.w - a.w);
    for (const e of edges) {
      if (e.stub && !e.stubEnd) continue;
      const len = e.stub ? 0 : e.pathEl && e.pathEl.getTotalLength ? e.pathEl.getTotalLength() : 0;
      if (!len && !e.stub) continue;
      const text = `${truncate(iname(e.item), 20)}  ${fmtRate(e.rate, e.fluid)}`;
      const w = text.length * 6.1 + 30, h = 20;
      let best = null;
      if (e.stub) {
        // Just outside the port icon, pointing away from the node.
        const { cap, dir } = e.stubEnd;
        const r = { x: dir.x < 0 ? cap.x - 6 - w : dir.x > 0 ? cap.x + 6 : cap.x - w / 2, y: dir.y < 0 ? cap.y - 6 - h : dir.y > 0 ? cap.y + 6 : cap.y - h / 2, w, h };
        best = { r, pt: { x: r.x + w / 2, y: r.y + h / 2 }, c: overlaps(r) };
      }
      for (const t of (e.stub ? [] : [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78])) {
        const pt = e.pathEl.getPointAtLength(len * t);
        const r = { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
        const c = overlaps(r);
        if (!best || c < best.c) best = { r, pt, c };
        if (c === 0) break;
      }
      placed.push(best.r);
      const lg = el('g', { class: 'g-label' + (best.c ? ' crowded' : ''), 'data-from': e.from, 'data-to': e.to, 'data-e': g.edges.indexOf(e) }, this.labelLayer);
      // Full label (icon + name + rate) shows on hover/selection or with "All rates";
      // otherwise just the icon badge stays on the line so you can see what it carries.
      const full = el('g', { class: 'lbl-full' }, lg);
      el('rect', { x: best.r.x, y: best.r.y, width: w, height: h, rx: 9 }, full);
      el('text', { x: best.r.x + 25, y: best.pt.y + 3.5 }, full).textContent = text;
      if (e.stub) { drawItemIcon(full, e.item, e.fluid, best.r.x + 3, best.pt.y - 8, 16); continue; } // the port already shows the icon
      const badge = el('g', { class: 'lbl-icon' }, lg);
      el('circle', { cx: best.r.x + 11, cy: best.pt.y, r: 11 }, badge);
      drawItemIcon(badge, e.item, e.fluid, best.r.x + 3, best.pt.y - 8, 16);
    }
  },

  highlight(id) {
    this.selected = id;
    if (!this.root) return;
    const linked = new Set();
    if (id) {
      linked.add(id);
      this.root.querySelectorAll('.g-edge').forEach(e => {
        if (e.dataset.from === id) linked.add(e.dataset.to);
        if (e.dataset.to === id) linked.add(e.dataset.from);
      });
    }
    this.root.querySelectorAll('.g-node').forEach(n => {
      n.classList.toggle('selected', n.dataset.id === id);
      n.classList.toggle('dim', !!id && !linked.has(n.dataset.id));
    });
    this.root.querySelectorAll('.g-edge, .g-label').forEach(e => {
      const on = !!id && (e.dataset.from === id || e.dataset.to === id);
      e.classList.toggle('dim', !!id && !on && e.classList.contains('g-edge'));
      e.classList.toggle('sel', on);
    });
  },

  /** Show every rate label, or only on hover/selection. */
  setLabels(always) {
    this.showLabels = !!always;
    const wrap = this.svg && this.svg.parentElement;
    if (wrap) wrap.classList.toggle('labels-always', this.showLabels);
  },

  /** Hover focus: a node (and its lines/neighbours) or a single line. */
  setHover(h) {
    const same = (a, b) => (a === b) || (a && b && a.kind === b.kind && a.id === b.id);
    if (same(h, this.hover)) return;
    this.hover = h;
    this.applyHover();
  },
  applyHover() {
    if (!this.root) return;
    this.root.querySelectorAll('.hot').forEach(x => x.classList.remove('hot'));
    const h = this.hover;
    this.svg.classList.toggle('hovering', !!h);
    if (!h) return;
    const mark = sel => this.root.querySelectorAll(sel).forEach(x => x.classList.add('hot'));
    const q = v => (window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"'));
    if (h.kind === 'node') {
      mark(`.g-node[data-id="${q(h.id)}"]`);
      this.root.querySelectorAll('.g-edge, .g-label').forEach(e => {
        if (e.dataset.from === h.id || e.dataset.to === h.id) {
          e.classList.add('hot');
          mark(`.g-node[data-id="${q(e.dataset.from === h.id ? e.dataset.to : e.dataset.from)}"]`);
        }
      });
    } else {
      mark(`[data-e="${h.id}"]`);
      const e = this.graph && this.graph.edges[h.id];
      if (e) { mark(`.g-node[data-id="${q(e.from)}"]`); mark(`.g-node[data-id="${q(e.to)}"]`); }
    }
  },

  exportSvg() {
    if (!this.bounds) return null;
    const clone = this.svg.cloneNode(true);
    const pad = 40, b = this.bounds;
    clone.setAttribute('viewBox', `${b.minX - pad} ${b.minY - pad} ${b.width + pad * 2} ${b.height + pad * 2 + 80}`);
    clone.setAttribute('width', b.width + pad * 2);
    clone.setAttribute('height', b.height + pad * 2 + 80);
    clone.querySelector('g').removeAttribute('transform');
    clone.querySelectorAll('.anim, .hit, .g-btn, .g-ico').forEach(n => n.remove());
    clone.classList.remove('hovering');
    clone.querySelectorAll('.hot').forEach(n => n.classList.remove('hot'));
    clone.querySelectorAll('.dim').forEach(n => n.classList.remove('dim'));
    const style = document.createElementNS(SVGNS, 'style');
    style.textContent = `
      svg{background:#0b1117;font-family:system-ui,'Segoe UI',sans-serif}
      .card{fill:#18222d;stroke:#354a5f}.flow{fill:none;opacity:.6;stroke-linecap:round}
      .g-label rect{fill:#0e141bdd;stroke:#2a3a4b}.g-label text{font:11px Consolas,monospace;fill:#9fb0c2}
      .g-text{fill:#e3ebf3}`;
    clone.insertBefore(style, clone.firstChild);
    return new XMLSerializer().serializeToString(clone);
  },
};

/**
 * Nodes you dragged stay where you put them; automatically placed nodes that now overlap anything
 * get pushed along the cross axis (down for left-to-right, right for vertical layouts) until clear.
 */
function resolveOverlaps(g, D) {
  const GAP = 12;
  const nodes = [...g.nodes.values()];
  const hit = (a, b) => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;
  const movable = nodes.filter(n => !n.pinned).sort((a, b) => (D.horizontal ? a.y - b.y : a.x - b.x));
  for (const n of movable) {
    for (let guard = 0; guard < 60; guard++) {
      const other = nodes.find(o => o !== n && hit(n, o));
      if (!other) break;
      if (D.horizontal) n.y = other.y + other.h + GAP; else n.x = other.x + other.w + GAP;
    }
  }
}

/** Cross-axis coordinate of an item's port on a recipe node (inputs on one side, outputs on the other). */
function portCoord(n, item, isOut, D) {
  const list = isOut ? n.outPorts : n.inPorts;
  const k = Math.max(1, list.length);
  const i = Math.max(0, list.indexOf(item));
  const span = D.horizontal ? n.h : n.w;
  const start = D.horizontal ? n.y : n.x;
  const step = Math.min(PORT_STEP, (span - 8) / k);
  return start + span / 2 + (i - (k - 1) / 2) * step;
}

/** Where an item's port badge sits, relative to the node. */
function portPoint(n, item, isOut, D) {
  const c = portCoord(n, item, isOut, D) - (D.horizontal ? n.y : n.x);
  if (D.horizontal) return { x: isOut ? n.w + PORT_OUT : -PORT_OUT, y: c };
  const bottom = D.flip ? !isOut : isOut; // top-to-bottom: outputs at the bottom; bottom-to-top: inputs at the bottom
  return { x: c, y: bottom ? n.h + PORT_OUT : -PORT_OUT };
}

/** Spread edge endpoints along a node side (right/left for left-to-right, bottom/top for vertical). */
function spreadPorts(list, n, key, D) {
  if (!list.length) return;
  const span = D.horizontal ? n.h : n.w;
  const start = D.horizontal ? n.y : n.x;
  const total = list.reduce((a, e) => a + e.w, 0);
  const avail = span - 16;
  const gap = list.length > 1 ? Math.max(0, Math.min(6, (avail - total) / (list.length - 1))) : 0;
  const used = total + gap * (list.length - 1);
  const scale = used > avail ? avail / used : 1;
  let p = start + span / 2 - Math.min(used, avail) / 2;
  for (const e of list) {
    const w = e.w * scale;
    e[key] = p + w / 2;
    p += w + gap * scale;
  }
}

/** Cross-axis position a line heads toward from one end: its nearest waypoint, else the other node's centre. */
function edgeHeading(g, e, fromStart, D) {
  if (e.via && e.via.length) {
    const s = e.via[fromStart ? 0 : e.via.length - 1].seg;
    if (s) return D.horizontal ? s.y1 : s.x1;
  }
  const o = g.nodes.get(fromStart ? e.to : e.from);
  if (!o) return 0;
  return D.horizontal ? o.y + o.h / 2 : o.x + o.w / 2;
}

/**
 * Raw inputs and unused byproducts (compact mode): no line, the step's own port icon is marked instead
 * (dashed border = raw input, purple = byproduct) and becomes hoverable and clickable.
 */
function markPort(g, e, idx, D) {
  const isIn = e.stub === 'in';
  const n = g.nodes.get(isIn ? e.to : e.from);
  const bg = n && n.portEls && (isIn ? n.portEls.in : n.portEls.out).get(e.item);
  if (!bg) return;
  bg.classList.add(isIn ? 'raw' : 'spare');
  bg.classList.toggle('manual', !!e.manual);
  bg.dataset.e = idx;
  bg.dataset.item = (isIn ? 'raw:' : 'sur:') + e.item;
  // Where its rate label goes: just outside the icon, away from the node.
  const p = portPoint(n, e.item, !isIn, D);
  const dir = D.horizontal ? { x: isIn ? -1 : 1, y: 0 } : { x: 0, y: p.y > n.h / 2 ? 1 : -1 };
  e.stubEnd = { cap: { x: n.x + p.x + dir.x * 10, y: n.y + p.y + dir.y * 10 }, dir };
}

/** Smooth path through a list of points, flowing along the main axis (tangents along the flow). */
function flowPath(pts, D) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const straight = D.horizontal ? Math.abs(a.y - b.y) < 0.5 : Math.abs(a.x - b.x) < 0.5;
    if (straight) { d += ` L${b.x},${b.y}`; continue; }
    if (D.horizontal) { const m = (b.x - a.x) / 2; d += ` C${a.x + m},${a.y} ${b.x - m},${b.y} ${b.x},${b.y}`; }
    else { const m = (b.y - a.y) / 2; d += ` C${a.x},${a.y + m} ${b.x},${b.y - m} ${b.x},${b.y}`; }
  }
  return d;
}

function edgePath(a, b, e, D) {
  // Long lines: through their waypoint corridors, if those still lie between the two ends
  // (after dragging nodes they may not, and then the line goes direct).
  if (e.via && e.via.length && e.via.every(v => v.seg)) {
    const s = D.flip ? -1 : 1;
    const start = D.horizontal ? { x: a.x + a.w, y: e.sp } : { x: e.sp, y: D.flip ? a.y : a.y + a.h };
    const end = D.horizontal ? { x: b.x, y: e.tp } : { x: e.tp, y: D.flip ? b.y + b.h : b.y };
    const pts = [start];
    for (const v of e.via) pts.push({ x: v.seg.x1, y: v.seg.y1 }, { x: v.seg.x2, y: v.seg.y2 });
    pts.push(end);
    const along = p => (D.horizontal ? p.x : p.y) * (D.horizontal ? 1 : s);
    let ok = true;
    for (let i = 1; i < pts.length; i++) if (along(pts[i]) < along(pts[i - 1]) - 0.5) { ok = false; break; }
    if (ok && along(pts[1]) - along(start) > 20 && along(end) - along(pts[pts.length - 2]) > 20) return flowPath(pts, D);
  }
  if (D.horizontal) {
    const sx = a.x + a.w, sy = e.sp, tx = b.x, ty = e.tp;
    if (tx > sx - 80) {
      const m = Math.max(50, Math.abs(tx - sx) * 0.5);
      return `M${sx},${sy} C${sx + m},${sy} ${tx - m},${ty} ${tx},${ty}`;
    }
    // Loop back: route underneath both nodes.
    const low = Math.max(a.y + a.h, b.y + b.h) + 60;
    return `M${sx},${sy} C${sx + 120},${sy} ${sx + 120},${low} ${(sx + tx) / 2},${low} S${tx - 120},${ty} ${tx},${ty}`;
  }
  const s = D.flip ? -1 : 1;
  const sx = e.sp, sy = D.flip ? a.y : a.y + a.h;
  const tx = e.tp, ty = D.flip ? b.y + b.h : b.y;
  if ((ty - sy) * s > -80) {
    const m = Math.max(50, Math.abs(ty - sy) * 0.5);
    return `M${sx},${sy} C${sx},${sy + s * m} ${tx},${ty - s * m} ${tx},${ty}`;
  }
  // Loop back: route to the right of both nodes.
  const side = Math.max(a.x + a.w, b.x + b.w) + 60;
  return `M${sx},${sy} C${sx},${sy + s * 100} ${side},${sy + s * 100} ${side},${(sy + ty) / 2} S${tx},${ty - s * 100} ${tx},${ty}`;
}

function drawNode(layer, n, project) {
  const g = el('g', { class: 'g-node g-node-' + n.kind, 'data-id': n.id, transform: `translate(${n.x},${n.y})` }, layer);
  const W = n.w, H = n.h;
  const clipId = 'clip-' + n.id.replace(/[^a-z0-9_-]/gi, '_');
  const cp = el('clipPath', { id: clipId }, g);
  el('rect', { width: W, height: H, rx: 8 }, cp);
  const clip = `url(#${clipId})`;

  if (n.kind === 'recipe') {
    const d = n.data;
    const unpowered = !d.instant && !(d.recipe.eut > 0);
    const tier = d.instant ? { name: 'CRAFT', color: '#8fa8c0' } : unpowered ? { name: 'NO EU', color: '#8fa8c0' } : TIERS[d.settings.tier];
    const bad = d.oc.errors.length > 0;
    el('rect', { class: 'card', width: W, height: H, rx: 8, filter: 'url(#shadow)', stroke: bad ? '#ff6b6b' : null }, g);
    el('rect', { width: W, height: 22, fill: tier.color, opacity: 0.16, 'clip-path': clip }, g);
    el('rect', { width: 3, height: H, fill: tier.color, 'clip-path': clip }, g);
    // Header: machine icon, tier, machine name.
    const D = DIRS[GraphView.dir] || DIRS.lr;
    const PL = D.horizontal ? 16 : 10, PR = D.horizontal ? 16 : 10; // room for the edge icons
    const mKey = IconStore.machineKey(d.recipe, d.instant ? null : d.settings.tier);
    let x = PL;
    if (mKey && IconStore.svg(g, mKey, x, 3, 16)) x += 20;
    txt(g, x, 15, tier.name, { 'font-size': 10.5, 'font-weight': 700, fill: tier.color, 'font-family': 'Consolas, monospace' });
    x += tier.name.length * 7 + 6;
    const room = Math.max(6, Math.floor((W - x - (bad ? 44 : 28) - (PR - 10)) / 6.2));
    txt(g, x, 15, truncate(d.recipe.machine, room), { 'font-size': 11, fill: '#c9d6e3' });
    if (bad) txt(g, W - 30 - (PR - 10), 16, '⚠', { 'font-size': 12, fill: '#ff6b6b', 'text-anchor': 'end' });
    gButton(g, W - 22 - (PR - 10), 2, '−', 'hide', n.id, 'Hide this chain: supply its product as a raw input', 18);
    // Product.
    // Named after what the plan uses it for; spare outputs get a small "+N" pill (the hover card lists them).
    const spare = (d.spareOutputs || []).length;
    let titleRoom = W - PL - PR;
    if (spare) {
      const label = '+' + spare, pw = label.length * 6 + 8;
      const pill = el('g', { class: 'g-spare' }, g);
      el('rect', { x: W - PR - pw, y: 30, width: pw, height: 15, rx: 7.5, fill: '#b48cff', 'fill-opacity': 0.16, stroke: '#b48cff', 'stroke-opacity': 0.5 }, pill);
      txt(pill, W - PR - pw / 2, 41, label, { 'font-size': 9.5, 'font-weight': 700, fill: '#c9b0ff', 'text-anchor': 'middle' });
      titleRoom -= pw + 5;
    }
    const fit = fitTitle(stepTitleOptions(d, true), titleRoom);
    txtMc(g, PL, 41, fit.text, fit.chars, { 'font-size': fit.size, 'font-weight': 600 });
    // Numbers.
    if (d.instant) {
      txt(g, PL, 60, `${fmtRate(d.rate)} crafts`, { 'font-size': 12, 'font-weight': 700, fill: '#8fa8c0', 'font-family': 'Consolas, monospace' });
      txt(g, W - PR, 60, 'instant', { 'font-size': 10.5, fill: '#6d8197', 'text-anchor': 'end' });
    } else {
      const count = `×${fmtNum(d.machines, 2)}`;
      txt(g, PL, 60, count, { 'font-size': 13, 'font-weight': 700, fill: '#ffb347', 'font-family': 'Consolas, monospace' });
      txt(g, PL + count.length * 8 + 5, 60, `build ${d.built}`, { 'font-size': 10.5, fill: '#9fb0c2' });
      txt(g, W - PR, 60, unpowered ? 'no power' : fmtEut(d.avgEut), { 'font-size': 10.5, fill: unpowered ? '#6d8197' : '#e3ebf3', 'text-anchor': 'end', 'font-family': 'Consolas, monospace' });
      // Utilization along the bottom edge.
      el('rect', { x: 0, y: H - 3, width: W, height: 3, fill: '#0e141b', 'clip-path': clip }, g);
      el('rect', { x: 0, y: H - 3, width: W * Math.min(1, d.utilization), height: 3, fill: d.utilization > 0.85 ? '#5fd38d' : d.utilization > 0.5 ? '#ffcf5c' : '#ff8c3a', 'clip-path': clip }, g);
    }
    drawPorts(g, n, d, D);
  } else {
    const color = n.kind === 'raw' ? (n.manual ? '#b48cff' : '#8fa8c0') : n.kind === 'out' ? '#5fd38d' : '#b48cff';
    el('rect', { class: 'card', width: W, height: H, rx: 8, filter: 'url(#shadow)', stroke: color, 'stroke-opacity': n.manual ? 0.9 : 0.45, 'stroke-dasharray': n.manual ? '4 3' : null }, g);
    el('rect', { width: 4, height: H, fill: color, 'clip-path': clip }, g);
    drawItemIcon(g, n.item, n.fluid, 11, (H - 22) / 2, 22);
    const hasBtn = n.manual || (n.kind === 'raw' && n.expandable);
    txtMc(g, 40, 17, inameRaw(n.item), hasBtn ? 16 : 19, { 'font-size': 12, 'font-weight': 600 });
    txt(g, 40, 31, fmtRate(n.rate, n.fluid), { 'font-size': 10, fill: '#9fb0c2', 'font-family': 'Consolas, monospace' });
    if (n.manual) gButton(g, W - 26, (H - 18) / 2, '+', 'expand', n.item, 'Show the chain that makes this again', 18, 'faint');
    else if (n.kind === 'raw' && n.expandable) gButton(g, W - 26, (H - 18) / 2, '+', 'pick', n.item, 'Pick a recipe to make this', 18, 'faint');
  }
}

/** Item icon (fluids on a disc of their colour), or a coloured shape when there's no icon. */
function drawItemIcon(g, item, fluid, x, y, px) {
  if (fluid && IconStore.slot(item) != null) el('circle', { cx: x + px / 2, cy: y + px / 2, r: px / 2, fill: fluidColor(item) }, g);
  if (IconStore.svg(g, item, x, y, px)) return true;
  el(fluid ? 'circle' : 'rect', fluid
    ? { cx: x + px / 2, cy: y + px / 2, r: px * 0.38, fill: itemColor(item, true) }
    : { x: x + px * 0.12, y: y + px * 0.12, width: px * 0.76, height: px * 0.76, rx: px * 0.18, fill: itemColor(item, false) }, g);
  return true;
}

/** Item icons on the node edges, where each item's line attaches (inputs one side, outputs the other). */
function drawPorts(g, n, d, D) {
  const fluidOf = new Map();
  for (const io of [...d.recipe.inputs, ...d.recipe.outputs]) if (io.fluid) fluidOf.set(io.item, true);
  n.portEls = { in: new Map(), out: new Map() };
  const badge = (item, isOut) => {
    const bg = el('g', { class: 'g-port' + (isOut ? ' out' : ' in') }, g);
    el('rect', { x: -10, y: -10, width: 20, height: 20, rx: 6 }, bg);
    drawItemIcon(bg, item, !!fluidOf.get(item), -8, -8, 16);
    (isOut ? n.portEls.out : n.portEls.in).set(item, bg);
  };
  n.inPorts.forEach(item => badge(item, false));
  n.outPorts.forEach(item => badge(item, true));
  placePorts(n, D);
}

/** Move a recipe node's port badges to their current slots. */
function placePorts(n, D) {
  for (const [isOut, map] of [[false, n.portEls.in], [true, n.portEls.out]]) {
    for (const [item, bg] of map) {
      const p = portPoint(n, item, isOut, D);
      bg.setAttribute('transform', `translate(${p.x},${p.y})`);
    }
  }
}

/**
 * Order port icons along each recipe node's sides by the position of whatever their lines connect to,
 * so lines arrive in order instead of crossing. Two passes: first by the other node's centre,
 * then by the other end's actual port.
 */
function sortPorts(g, lay, D) {
  const center = n => (D.horizontal ? n.y + n.h / 2 : n.x + n.w / 2);
  for (let pass = 0; pass < 2; pass++) {
    for (const [id, n] of g.nodes) {
      if (n.kind !== 'recipe') continue;
      const order = (list, edges, isOut) => {
        const pos = new Map();
        for (const e of edges) {
          if (e.stub) continue;
          const o = g.nodes.get(isOut ? e.to : e.from);
          if (!o) continue;
          const v = e.via && e.via.length ? edgeHeading(g, e, isOut, D)
            : pass === 0 || o.kind !== 'recipe' ? center(o) : portCoord(o, e.item, !isOut, D);
          if (!pos.has(e.item)) pos.set(e.item, []);
          pos.get(e.item).push(v);
        }
        const avg = it => { const a = pos.get(it); return a ? a.reduce((x, y) => x + y, 0) / a.length : null; };
        const orig = new Map(list.map((it, i) => [it, i]));
        return list.slice().sort((a, b) => {
          const va = avg(a), vb = avg(b);
          if (va == null && vb == null) return orig.get(a) - orig.get(b);
          if (va == null) return 1;
          if (vb == null) return -1;
          return va - vb || orig.get(a) - orig.get(b);
        });
      };
      n.inPorts = order(n.inPorts, lay.inc.get(id) || [], false);
      n.outPorts = order(n.outPorts, lay.out.get(id) || [], true);
    }
  }
}

/* ---------------- hover card ---------------- */

function tipIcon(item, fluid, px = 16) {
  const h = IconStore.html(item, px);
  if (h && fluid) return `<span class="fl-wrap" style="width:${px}px;height:${px}px;background:${fluidColor(item)}">${h}</span>`;
  if (h) return h;
  return `<span class="tip-dot${fluid ? ' fluid' : ''}" style="background:${itemColor(item, fluid)}"></span>`;
}

function tipRows(list, rate, isOut) {
  return list.map(io => {
    const amt = isOut ? expectedAmount(io) : (Number(io.amount) || 0);
    const note = io.uses ? `<span class="tip-note">tool · ${io.uses.toLocaleString()} uses</span>` : io.kept ? '<span class="tip-note">kept</span>'
      : io.chance != null && +io.chance !== 100 ? `<span class="tip-note">${io.chance}%</span>` : '';
    return `<div class="tip-row">${tipIcon(io.item, io.fluid)}<span class="tip-name">${inameHtml(io.item)}${note}</span><span class="tip-rate">${io.kept ? '—' : fmtRate(amt * rate, io.fluid)}</span></div>`;
  }).join('') || '<div class="tip-row muted">nothing</div>';
}

function nodeTipHtml(n) {
  if (n.kind === 'recipe') {
    const d = n.data, r = d.recipe;
    const unpowered = !d.instant && !(r.eut > 0);
    const tier = d.instant ? null : TIERS[d.settings.tier];
    const mKey = IconStore.machineKey(r, d.instant ? null : d.settings.tier);
    const mIcon = mKey ? IconStore.html(mKey, 18) || '' : '';
    const used = d.usedOutputs || [];
    const title = r.src !== 'game' && used.length <= 1 ? htmlEsc(r.name)
      : (used.length ? used : r.outputs.slice(0, 1).map(o => o.item)).map(inameHtml).join(' + ');
    const spareList = (d.spareOutputs || []).map(inameHtml).join(', ');
    const rows = d.instant
      ? `<span>Crafts</span><b>${fmtRate(d.rate)}</b><span>Machine</span><b>none (instant)</b>`
      : `<span>Machines</span><b>${fmtNum(d.machines, 2)} → build ${d.built} <em>(${Math.round(d.utilization * 100)}% busy)</em></b>
         <span>Power</span><b>${unpowered ? 'none' : `${fmtEut(d.avgEut)} avg · ${fmtEut(d.peakEut)} peak`}</b>
         <span>Each machine</span><b>${unpowered ? '' : `${fmtEut(d.oc.eut)} · `}${fmtDuration(d.oc.dur)} per craft</b>
         <span>Crafts</span><b>${fmtRate(d.rate)}</b>`;
    const warn = d.oc.errors.length ? `<div class="tip-warn">⚠ ${htmlEsc(d.oc.errors.join(' '))}</div>` : '';
    return `<div class="tip-head">${tier ? `<span class="tier" style="color:${tier.color}">${tier.name}</span>` : ''}${mIcon}<span>${htmlEsc(r.machine)}</span></div>
      <div class="tip-title">${title}</div>
      <div class="tip-grid">${rows}${spareList ? `<span>Byproducts</span><b class="tip-spare">${spareList}</b>` : ''}</div>${warn}
      <div class="tip-io"><div><div class="tip-sub">Uses</div>${tipRows(r.inputs.filter(io => (Number(io.amount) || 0) > 0 || io.kept), d.rate, false)}</div>
      <div><div class="tip-sub">Makes</div>${tipRows(r.outputs, d.rate, true)}</div></div>
      <div class="tip-hint">Click for details · drag to move</div>`;
  }
  const label = { raw: n.manual ? 'Supplied by you · chain hidden' : 'Raw input', out: 'Target', sur: 'Byproduct (left over)' }[n.kind];
  const hint = n.manual ? 'Click + to show the chain that makes it again'
    : n.kind === 'raw' && n.expandable ? 'Click + to pick a recipe for it' : 'Click for details · drag to move';
  return `<div class="tip-head"><span>${label}</span></div>
    <div class="tip-title">${tipIcon(n.item, n.fluid, 20)} ${inameHtml(n.item)}</div>
    <div class="tip-grid"><span>Rate</span><b>${fmtRate(n.rate, n.fluid)}</b></div>
    <div class="tip-hint">${hint}</div>`;
}

function edgeTipHtml(e, g) {
  const name = id => {
    const n = g.nodes.get(id);
    if (!n) return '';
    return n.kind === 'recipe' ? `${htmlEsc(n.data.recipe.machine)}` : { raw: 'raw input', out: 'target', sur: 'byproduct' }[n.kind];
  };
  if (e.stub) {
    const step = g.nodes.get(e.stub === 'in' ? e.to : e.from);
    return `<div class="tip-title">${tipIcon(e.item, e.fluid, 20)} ${inameHtml(e.item)}</div>
      <div class="tip-grid"><span>Flow</span><b>${fmtRate(e.rate, e.fluid)}</b><span>${e.stub === 'in' ? 'Into' : 'From'}</span><b>${step ? htmlEsc(step.data.recipe.machine) : ''}</b></div>
      <div class="tip-foot">${e.stub === 'in' ? (e.manual ? 'Raw input you supply (chain hidden)' : 'Raw input') : 'Byproduct, not used in this plan'} · click for details</div>`;
  }
  return `<div class="tip-title">${tipIcon(e.item, e.fluid, 20)} ${inameHtml(e.item)}</div>
    <div class="tip-grid"><span>Flow</span><b>${fmtRate(e.rate, e.fluid)}</b><span>From</span><b>${name(e.from)}</b><span>To</span><b>${name(e.to)}</b></div>`;
}

function gButton(parent, x, y, glyph, act, arg, title, size = 20, cls = '') {
  const b = el('g', { class: 'g-btn' + (cls ? ' ' + cls : ''), 'data-act': act, 'data-arg': arg, transform: `translate(${x},${y})` }, parent);
  el('rect', { width: size, height: size, rx: 5 }, b);
  const t = el('text', { x: size / 2, y: size / 2 + 4.5, 'text-anchor': 'middle' }, b);
  t.textContent = glyph;
  el('title', null, b).textContent = title;
  return b;
}

/** Text with Minecraft § formatting as coloured tspans, truncated to `max` visible characters. */
/** Width in px of plain text in the graph font. */
const measureCtx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
function textWidth(s, size, weight) {
  if (!measureCtx) return s.length * size * 0.56;
  measureCtx.font = `${weight || 400} ${size}px system-ui, 'Segoe UI', sans-serif`;
  return measureCtx.measureText(s).width;
}

/**
 * Pick the longest name option that fits the width, first at full size and then slightly smaller;
 * if none fit, cut the shortest option to the width. Returns { text, size, chars }.
 */
function fitTitle(options, room) {
  for (const size of [12.5, 11.5]) {
    for (const o of options) {
      const plain = mcStrip(o);
      if (textWidth(plain, size, 600) <= room) return { text: o, size, chars: plain.length };
    }
  }
  // Shorten the (first) name but keep a "+ N more" suffix readable.
  const last = mcStrip(options[options.length - 1]), size = 11.5;
  const m = last.match(/^(.*?)( \+ \d+ more)$/);
  const head = m ? m[1] : last, tail = m ? m[2] : '';
  let n = head.length;
  while (n > 1 && textWidth(head.slice(0, n) + '…' + tail, size, 600) > room) n--;
  if (!tail) return { text: options[options.length - 1], size, chars: n };
  return { text: head.slice(0, n).trimEnd() + '…' + tail, size, chars: Infinity };
}

function txtMc(parent, x, y, raw, max, attrs) {
  const t = el('text', Object.assign({ x, y, class: 'g-text' }, attrs || {}), parent);
  let left = max;
  const segs = mcSegments(raw);
  const total = segs.reduce((a, sg) => a + sg.text.length, 0);
  if (total > max) left = max - 1;
  for (const sg of segs) {
    if (left <= 0) break;
    const text = sg.text.slice(0, left);
    left -= text.length;
    const span = el('tspan', null, t);
    if (sg.color) span.setAttribute('fill', sg.color);
    if (sg.bold) span.setAttribute('font-weight', 700);
    if (sg.italic) span.setAttribute('font-style', 'italic');
    if (sg.underline || sg.strike) span.setAttribute('text-decoration', sg.underline ? 'underline' : 'line-through');
    span.textContent = text;
  }
  if (total > max) el('tspan', null, t).textContent = '…';
  return t;
}

function txt(parent, x, y, s, attrs) {
  const t = el('text', Object.assign({ x, y, class: 'g-text' }, attrs || {}), parent);
  t.textContent = s;
  return t;
}
