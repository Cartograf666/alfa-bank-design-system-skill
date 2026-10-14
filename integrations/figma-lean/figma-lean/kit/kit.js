// figma-lean kit. Runs inside use_figma (Figma Plugin API sandbox): the PreToolUse hook prepends it
// to every script that mentions `fx`, so none of this code is ever written out by the model.
// Lines starting with "//:" are the public API; `node tools/fx.mjs docs` renders them into references/kit.md.
const fx = (() => {
  const fx = { __ds: { c: {}, v: {}, s: {} }, __scope: null, __made: [], __changed: [], __warnings: [], __failures: [] };
  const ABBR = { FRAME: 'F', TEXT: 'T', INSTANCE: 'I', COMPONENT: 'C', COMPONENT_SET: 'CS', SECTION: 'S', GROUP: 'G', RECTANGLE: 'R', VECTOR: 'V', ELLIPSE: 'E', LINE: 'L', PAGE: 'P', BOOLEAN_OPERATION: 'B', POLYGON: 'PG', STAR: 'ST', SLICE: 'SL' };
  const DEFNAME = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Polygon|Star|Text) \d+$/;
  const norm = (s) => String(s).toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
  const r = (n) => Math.round(n * 10) / 10;
  const trunc = (s, n) => { s = String(s).replace(/\n/g, '⏎'); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const uniq = (a) => a.filter((v, i) => a.indexOf(v) === i);
  const bytes = (s) => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdfff ? 2 : 3; } return n; };
  // use_figma rejects a return value above 20480 bytes: captures are split into parts, plain text is cut.
  const LIMIT = 18000;
  const paged = (head, items, o) => {
    const opts = Object.assign({}, o); delete opts.part;
    const payload = Object.assign({}, head, { part: 1, parts: 1, opts, items });
    const data = JSON.stringify(payload);
    if (bytes(data) <= LIMIT) return payload;
    let hash = 2166136261;
    for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data.charCodeAt(i), 16777619) >>> 0;
    const snapshot = data.length + '-' + hash.toString(16), chunks = [];
    // Size the complete escaped JSON envelope, including possibly long names/options.
    const envelope = (text, index, total) => ({ __fx: 'fragment', kind: head.__fx, root: head.root, id: head.id, opts, snapshot, part: index, parts: total, fragment: { index, total, data: text } });
    for (let at = 0; at < data.length;) {
      let lo = 0, hi = Math.min(data.length - at, LIMIT);
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (bytes(JSON.stringify(envelope(data.slice(at, at + mid), 999999, 999999))) <= LIMIT) lo = mid; else hi = mid - 1; }
      if (!lo) throw new Error('fx: capture options exceed reply limit; narrow the request');
      // Never split a surrogate pair: each fragment must be valid Unicode on transport.
      if (lo > 1 && /[\ud800-\udbff]/.test(data[at + lo - 1]) && /[\udc00-\udfff]/.test(data[at + lo] || '')) lo--;
      chunks.push(data.slice(at, at + lo)); at += lo;
    }
    const part = Math.min(Math.max(Math.floor(Number(o && o.part) || 1), 1), chunks.length);
    return envelope(chunks[part - 1], part, chunks.length);
  };
  //: fx.pages(id, title, lines, {part=1}) → lossless paged text capture saved by the host tools; request every part to complete large exports.
  fx.pages = (id, title, lines, o = {}) => paged({ __fx: 'big', id, title }, lines, o);
  const fit = (text) => {
    if (bytes(text) <= 18000) return text;
    const rows = text.split('\n'), out = []; let size = 0;
    for (const l of rows) { size += bytes(l) + 1; if (size > 17000) break; out.push(l); }
    return out.join('\n') + '\n… cut to fit the 20 KB reply limit (' + (rows.length - out.length) + ' rows dropped): narrow the request';
  };
  const match = (s, q) => (q instanceof RegExp ? q.test(s) : String(s).toLowerCase().includes(String(q).toLowerCase()));
  const pageOf = (n) => { while (n && n.type !== 'PAGE') n = n.parent; return n; };
  const g = (n, k) => (k in n ? n[k] : undefined);
  const tag = (n) => n.id + ' ' + (ABBR[n.type] || n.type) + ' ' + JSON.stringify(trunc(n.name, 40));
  try { figma.skipInvisibleInstanceChildren = true; } catch (e) {}

  //: fx.node(id) → node. Accepts "1:2", "1-2" or a node; switches to the node's page when needed.
  fx.node = async (x) => {
    if (x && typeof x === 'object') return x;
    const id = String(x).trim().replace(/-/g, ':');
    const n = await figma.getNodeByIdAsync(id);
    if (!n) throw new Error('fx: node ' + id + ' not found');
    const p = pageOf(n);
    if (p && p !== figma.currentPage) await figma.setCurrentPageAsync(p);
    return n;
  };

  // ───────────── formatting ─────────────
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  const vcache = {}, scache = {}, ccache = {};
  const variable = async (id) => {
    if (!(id in vcache)) { let v = null; try { v = await figma.variables.getVariableByIdAsync(id); } catch (e) {} vcache[id] = v; }
    return vcache[id];
  };
  const styleOf = async (id) => {
    if (!(id in scache)) { let s = null; try { s = await figma.getStyleByIdAsync(id); } catch (e) {} scache[id] = s; }
    return scache[id];
  };
  const collectionName = async (id) => {
    if (!(id in ccache)) { let c = null; try { c = await figma.variables.getVariableCollectionByIdAsync(id); } catch (e) {} ccache[id] = c ? c.name : ''; }
    return ccache[id];
  };
  const paintStr = async (node, prop, styleProp) => {
    const sid = styleProp in node ? node[styleProp] : '';
    if (typeof sid === 'string' && sid) { const s = await styleOf(sid); if (s) return 'S:' + s.name; }
    const ps = node[prop];
    if (ps === figma.mixed) return 'mixed';
    if (!Array.isArray(ps)) return '';
    const out = [];
    for (const p of ps) {
      if (p.visible === false) continue;
      let s;
      if (p.type === 'SOLID') { const b = p.boundVariables && p.boundVariables.color; const v = b ? await variable(b.id) : null; s = v ? 'V:' + v.name : hex(p.color); }
      else s = p.type === 'IMAGE' ? 'img' : p.type === 'VIDEO' ? 'video' : 'grad';
      if (p.opacity != null && p.opacity < 1) s += '@' + Math.round(p.opacity * 100);
      out.push(s);
    }
    return out.join('+');
  };
  const sz = (n) => {
    const f = (v, m) => Math.round(v) + (m === 'HUG' ? 'h' : m === 'FILL' ? 'f' : '');
    return f(n.width, g(n, 'layoutSizingHorizontal')) + 'x' + f(n.height, g(n, 'layoutSizingVertical'));
  };
  const layout = (n) => {
    if (!('layoutMode' in n) || n.layoutMode === 'NONE') return '';
    let s = 'AL:' + (n.layoutMode === 'HORIZONTAL' ? (n.layoutWrap === 'WRAP' ? 'W' : 'H') : n.layoutMode === 'VERTICAL' ? 'V' : 'G');
    if (n.primaryAxisAlignItems === 'SPACE_BETWEEN') s += ' between'; else if (n.itemSpacing) s += ' gap' + r(n.itemSpacing);
    const t = r(n.paddingTop), rr = r(n.paddingRight), b = r(n.paddingBottom), l = r(n.paddingLeft);
    if (t || rr || b || l) s += ' p' + (t === b && l === rr ? (t === l ? t : t + ',' + l) : [t, rr, b, l].join(','));
    const al = (v) => ({ CENTER: 'c', MAX: 'e', BASELINE: 'b' })[v] || '';
    const a = al(n.primaryAxisAlignItems), c = al(n.counterAxisAlignItems);
    if (a || c) s += ' al:' + (a || 's') + (c || 's');
    return s;
  };
  const propDefs = (c) => {
    let d; try { d = c.componentPropertyDefinitions; } catch (e) { return null; }
    const out = [];
    for (const k in d) {
      const p = d[k], e = [k, p.type[0], p.defaultValue];
      if (p.type === 'INSTANCE_SWAP') e[2] = '';
      if (p.variantOptions) e.push(p.variantOptions.slice(0, 40));
      out.push(e);
      if (out.length >= 80) break;
    }
    return out;
  };
  const line = async (n, o) => {
    const p = [n.id, ABBR[n.type] || n.type, JSON.stringify(trunc(n.name, 60))];
    if ('width' in n) p.push(sz(n));
    const par = n.parent;
    const free = par && 'x' in n && (!('layoutMode' in par) || par.layoutMode === 'NONE' || g(n, 'layoutPositioning') === 'ABSOLUTE');
    if (free) p.push('@' + Math.round(n.x) + ',' + Math.round(n.y));
    if (g(n, 'layoutPositioning') === 'ABSOLUTE') p.push('abs');
    const l = layout(n); if (l) p.push(l);
    if (n.type === 'INSTANCE') {
      let m = null; try { m = await n.getMainComponentAsync(); } catch (e) {}
      if (m) { const set = m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : null; p.push('→' + (m.remote ? '' : 'local:') + (set ? set.name : m.name)); }
      let cp = null; try { cp = n.componentProperties; } catch (e) {}
      const kv = [];
      for (const k in cp || {}) { const d = cp[k]; if (d.type !== 'INSTANCE_SWAP') kv.push(k.split('#')[0] + '=' + (d.type === 'TEXT' ? JSON.stringify(trunc(d.value, 30)) : d.value)); }
      if (kv.length) p.push('{' + kv.join(', ') + '}');
    }
    if (n.type === 'TEXT') {
      const st = typeof n.textStyleId === 'string' && n.textStyleId ? await styleOf(n.textStyleId) : null;
      if (st) p.push('S:' + st.name);
      else if (n.fontSize !== figma.mixed && n.fontName !== figma.mixed) {
        const lh = n.lineHeight;
        p.push(r(n.fontSize) + (lh !== figma.mixed && lh.unit !== 'AUTO' ? '/' + r(lh.value) + (lh.unit === 'PERCENT' ? '%' : '') : '') + ' ' + n.fontName.style);
      } else p.push('mixed-type');
    }
    if (n.type !== 'INSTANCE' || (o && o.into)) {
      if ('fills' in n) { const f = await paintStr(n, 'fills', 'fillStyleId'); if (f) p.push('fill=' + f); }
      if ('strokes' in n && Array.isArray(n.strokes) && n.strokes.length) { const s = await paintStr(n, 'strokes', 'strokeStyleId'); if (s) p.push('st=' + s + '/' + (n.strokeWeight === figma.mixed ? '*' : r(n.strokeWeight))); }
      if ('cornerRadius' in n && n.cornerRadius !== 0) p.push('r' + (n.cornerRadius === figma.mixed ? '*' : r(n.cornerRadius)));
      if ('effects' in n && n.effects.length) { const es = typeof n.effectStyleId === 'string' && n.effectStyleId ? await styleOf(n.effectStyleId) : null; p.push(es ? 'E:' + es.name : 'fx' + n.effects.length); }
    }
    if ('opacity' in n && n.opacity < 1) p.push('op' + Math.round(n.opacity * 100));
    if (n.visible === false) p.push('hidden');
    if (n.type === 'TEXT') p.push('«' + trunc(n.characters, (o && o.text) || 60) + '»');
    return p.join(' ');
  };

  // ───────────── reading ─────────────
  //: fx.line(id) → one-line summary of a node (same format as a dump row).
  fx.line = async (x) => line(await fx.node(x), {});

  //: fx.dump(id, {depth=3, into=false, max=250, kids=40, text=60, full=false}) → compact text tree, one node per row. `into` descends into instances; `full` lifts the row cap and the hook saves the tree to disk, showing only its head (large trees come in parts: follow the "Next:" call in the reply).
  //:   row: id TYPE "name" WxH [@x,y] [AL:…] [→component {props}] [text style] [fill= st= r fx] «text». Size suffix: h = hug, f = fill. S:/V:/E: = style / variable / effect style name.
  fx.dump = async (x, o = {}) => {
    const root = await fx.node(x);
    const depth = o.depth == null ? 3 : o.depth, max = o.full ? 6000 : o.max || 250, kids = o.full ? 500 : o.kids || 40;
    const out = []; let cut = false, size = 0;
    const walk = async (n, d) => {
      if (out.length >= max || (!o.full && size > 16500)) { cut = true; return; }
      const ch = 'children' in n && (n.type !== 'INSTANCE' || o.into || n === root) && n.type !== 'BOOLEAN_OPERATION' ? n.children : [];
      let l = '  '.repeat(d) + (await line(n, o));
      if (ch.length && d >= depth) l += ' (+' + ch.length + ')';
      out.push(l); size += bytes(l) + 1;
      if (d >= depth) return;
      for (let i = 0; i < ch.length; i++) {
        if (i >= kids) { out.push('  '.repeat(d + 1) + '… +' + (ch.length - i) + ' more children'); break; }
        await walk(ch[i], d + 1);
      }
    };
    await walk(root, 0);
    if (cut) out.push('… capped at ' + out.length + ' rows: dump a child id, lower depth, or pass {full:true}');
    return o.full ? paged({ __fx: 'big', id: root.id, title: root.name }, out, o) : out.join('\n');
  };

  //: fx.find(root, 'name part' | /re/ | {name, type, text, q:'CSS-like selector'}, {max=40, into=false}) → matching nodes as "id TYPE name WxH ‹path›" rows. Layers inside instances are skipped unless `into` (or root is itself an instance).
  fx.find = async (x, sel, o = {}) => {
    const root = await fx.node(x);
    const q = typeof sel === 'string' || sel instanceof RegExp ? { name: sel } : sel || {};
    let ns;
    if (q.q) ns = root.query(q.q).toArray();
    else ns = root.findAll((n) => (!q.type || n.type === q.type) && (q.name == null || match(n.name, q.name)) && (q.text == null || (n.type === 'TEXT' && match(n.characters, q.text))));
    if (!o.into && root.type !== 'INSTANCE' && root.id[0] !== 'I') ns = ns.filter((n) => n.id[0] !== 'I');
    const max = o.max || 40, out = [];
    for (const n of ns.slice(0, max)) {
      const path = []; for (let a = n.parent; a && a !== root && a.type !== 'DOCUMENT'; a = a.parent) path.unshift(trunc(a.name, 24));
      out.push(tag(n) + ('width' in n ? ' ' + sz(n) : '') + (n.type === 'TEXT' ? ' «' + trunc(n.characters, 40) + '»' : '') + (path.length ? ' ‹' + path.slice(-3).join(' / ') + '›' : ''));
    }
    if (ns.length > max) out.push('… +' + (ns.length - max) + ' more');
    return out.length ? fit(out.join('\n')) : 'no matches';
  };

  const ser = (v, d) => {
    if (v === figma.mixed) return 'mixed';
    if (v == null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (typeof v.id === 'string' && typeof v.type === 'string' && 'parent' in v) return v.id;
    if (d > 4) return '…';
    if (Array.isArray(v)) return v.map((e) => ser(e, d + 1));
    const out = {}; for (const k in v) { const s = ser(v[k], d + 1); if (s !== undefined) out[k] = s; } return out;
  };
  //: fx.get(id, 'fills,layoutMode,parent.name') → raw property values by dot path (nodes become ids, mixed becomes "mixed"). For the rare property a dump row does not show.
  fx.get = async (x, props) => {
    const n = await fx.node(x), out = {};
    for (const p of Array.isArray(props) ? props : String(props).split(',')) {
      let v = n; for (const k of p.trim().split('.')) v = v == null ? undefined : v[k];
      out[p.trim()] = ser(v, 0);
    }
    return out;
  };

  // ───────────── map ─────────────
  //: fx.scan() → file level: pages + local variables and styles. fx.scan(pageOrSectionId, {maxInst=1500, maxNodes=6000, nested=false}) → structure, components with properties, library components / variables / styles in use. The hook stores the result in the file map and the DS registry; the digest comes back in its place (after a rescan, only its changed lines), and anything else the script returns next to it is kept. Not together with a screenshot in one script. A large result arrives in parts: when the reply says "part 1/N", send the call it prints for each remaining part (they may go in parallel).
  fx.scan = async (x, o = {}) => {
    const out = { __fx: 'map', file: figma.root.name, pages: figma.root.children.map((p) => [p.id, p.name]) };
    if (!x) {
      const cols = await figma.variables.getLocalVariableCollectionsAsync();
      const items = cols.map((c) => ['col', [c.id, c.name, c.modes.map((m) => m.name), c.variableIds.length]]);
      const cn = {}; for (const c of cols) cn[c.id] = c.name;
      for (const v of (await figma.variables.getLocalVariablesAsync()).slice(0, 3000)) items.push(['lv', [v.name, v.key, v.resolvedType[0], cn[v.variableCollectionId] || '', v.id]]);
      for (const s of await figma.getLocalPaintStylesAsync()) items.push(['ls', [s.name, s.key, 'P', s.id]]);
      for (const s of await figma.getLocalTextStylesAsync()) items.push(['ls', [s.name, s.key, 'T', s.id]]);
      for (const s of await figma.getLocalEffectStylesAsync()) items.push(['ls', [s.name, s.key, 'E', s.id]]);
      return paged(out, items, o);
    }
    const root = await fx.node(x), page = pageOf(root);
    const maxInst = o.maxInst || 1500, maxNodes = o.maxNodes || 6000;
    out.page = page.id; out.root = root.id; out.path = []; out.cut = [];
    for (let a = root.parent; a && a.type !== 'DOCUMENT'; a = a.parent) out.path.unshift(a.id);
    const nodes = []; let other = 0;
    const entry = async (c, parentId) => {
      const e = [c.id, ABBR[c.type] || c.type, c.name, parentId, Math.round(c.width), Math.round(c.height), Math.round(c.x), Math.round(c.y)];
      if (c.type === 'INSTANCE') { let m = null; try { m = await c.getMainComponentAsync(); } catch (err) {} e.push(m ? (m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent.name : m.name) : ''); }
      return e;
    };
    const top = async (n) => {
      for (const c of n.children) {
        const t = c.type;
        if (t === 'SECTION') { nodes.push(await entry(c, n.id)); await top(c); }
        else if (t === 'FRAME' || t === 'COMPONENT' || t === 'COMPONENT_SET' || t === 'INSTANCE' || t === 'GROUP') nodes.push(await entry(c, n.id));
        else other++;
      }
    };
    if (root.type !== 'PAGE') nodes.push(await entry(root, root.parent.id));
    if (root.type === 'PAGE' || root.type === 'SECTION') await top(root);
    out.other = other;

    const comps = [];
    const cs = root.type === 'COMPONENT' || root.type === 'COMPONENT_SET' ? [root] : 'findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }) : [];
    for (const c of cs) {
      if (c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET') continue;
      const e = { id: c.id, n: c.name, set: c.type === 'COMPONENT_SET', key: c.key, a: [], props: propDefs(c) };
      for (let a = c.parent; a && a !== root && a.type !== 'PAGE' && a.type !== 'DOCUMENT'; a = a.parent) e.a.unshift(a.id);
      if (c.description) e.d = trunc(c.description, 160);
      if (e.set) e.vars = c.children.filter((v) => v.type === 'COMPONENT').slice(0, 80).map((v) => [v.id, v.name]);
      comps.push(e);
    }

    const used = {}; let ni = 0;
    const insts = root.type === 'INSTANCE' ? [root] : 'findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : [];
    for (const i of insts) {
      if (!o.nested && i.id[0] === 'I') continue;
      if (ni++ >= maxInst) { out.cut.push('instances>' + maxInst); break; }
      let m = null; try { m = await i.getMainComponentAsync(); } catch (e) {}
      if (!m) continue;
      const set = m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : null, owner = set || m;
      let u = used[owner.id];
      if (!u) { u = used[owner.id] = { n: owner.name, key: owner.key, set: !!set, remote: !!m.remote, c: 0, ex: i.id, props: propDefs(owner) }; if (!m.remote) u.id = owner.id; }
      u.c++;
    }
    const usedList = Object.values(used).sort((a, b) => b.c - a.c);

    const vuse = {}, suse = {}; let nn = 0;
    const bump = (m, id) => { if (typeof id === 'string' && id) m[id] = (m[id] || 0) + 1; };
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (nn++ >= maxNodes) { out.cut.push('nodes>' + maxNodes); break; }
      const bv = g(n, 'boundVariables');
      if (bv) for (const k in bv) {
        const a = bv[k];
        if (Array.isArray(a)) a.forEach((z) => z && bump(vuse, z.id));
        else if (a && typeof a.id === 'string') bump(vuse, a.id);
        else if (a && typeof a === 'object') for (const kk in a) if (a[kk] && a[kk].id) bump(vuse, a[kk].id);
      }
      for (const sp of ['fillStyleId', 'strokeStyleId', 'textStyleId', 'effectStyleId']) if (sp in n) bump(suse, n[sp]);
      if ('children' in n && n.type !== 'INSTANCE') for (const c of n.children) stack.push(c);
    }
    out.scanned = nn;
    const vars = [];
    for (const id of Object.keys(vuse).sort((a, b) => vuse[b] - vuse[a]).slice(0, 400)) {
      const v = await variable(id); if (!v) continue;
      vars.push([v.name, v.key, v.resolvedType[0], v.remote ? 1 : 0, await collectionName(v.variableCollectionId), vuse[id], v.remote ? '' : v.id]);
    }
    const styles = [];
    for (const id of Object.keys(suse).sort((a, b) => suse[b] - suse[a]).slice(0, 300)) {
      const s = await styleOf(id); if (!s) continue;
      styles.push([s.name, s.key, s.type[0], s.remote ? 1 : 0, suse[id], s.remote ? '' : s.id]);
    }
    return paged(out, nodes.map((e) => ['n', e]).concat(comps.map((e) => ['c', e]), usedList.map((e) => ['u', e]), vars.map((e) => ['v', e]), styles.map((e) => ['s', e])), o);
  };

  //: fx.lib() → lists the library variable collections Figma exposes for the file. fx.lib('part of a collection or library name' | '*') → captures all their variables (name → key) into the DS registry. Some files expose none; then tokens are learned from scans and search_design_system instead.
  fx.lib = async (filter, o = {}) => {
    const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    if (!filter) return cols.map((c) => c.libraryName + ' / ' + c.name).join('\n') || 'no library variable collections';
    const items = [];
    for (const c of cols) {
      if (filter !== '*' && !match(c.libraryName + ' / ' + c.name, filter)) continue;
      for (const v of await figma.teamLibrary.getVariablesInLibraryCollectionAsync(c.key)) items.push([c.libraryName, c.name, v.name, v.key, v.resolvedType[0]]);
    }
    return paged({ __fx: 'ds', filter }, items, o);
  };

  // ───────────── verification ─────────────
  //: fx.check(id, {into=false, max=40}) → heuristic structural QA; visual inspection is still required: collapsed nodes, children overflowing or clipped by their parent, partial overlaps of free-positioned siblings, missing fonts, fixed text boxes, placeholder shimmer left on, variant conflicts; plus counts of raw colors / raw text styles (not bound to a token) and default layer names.
  fx.check = async (x, o = {}) => {
    const root = await fx.node(x);
    const errs = [], warns = [], st = { nodes: 0, rawFill: [], rawText: [], defNames: 0 };
    const rawPaint = (ps, sid) => Array.isArray(ps) && !(typeof sid === 'string' && sid) && ps.some((p) => p.visible !== false && p.type === 'SOLID' && !(p.boundVariables && p.boundVariables.color));
    const visit = (n) => {
      if (n.visible === false) return;
      st.nodes++;
      const t = n.type, inner = n.id[0] === 'I';
      if ('width' in n && t !== 'LINE' && t !== 'VECTOR' && (n.width < 1 || n.height < 1)) errs.push(tag(n) + ' collapsed to ' + r(n.width) + 'x' + r(n.height));
      if (g(n, 'placeholder') === true) errs.push(tag(n) + ' placeholder shimmer left on');
      if (t === 'TEXT') {
        if (n.hasMissingFont) errs.push(tag(n) + ' missing font');
        if (!inner && n.textAutoResize === 'NONE' && n.characters.length) warns.push(tag(n) + ' fixed text box: content can overflow or clip');
        if (!inner && n.textStyleId === '') st.rawText.push(n.id);
      }
      if (!inner && t !== 'INSTANCE' && t !== 'SECTION' && t !== 'COMPONENT_SET' && (rawPaint(g(n, 'fills'), g(n, 'fillStyleId')) || rawPaint(g(n, 'strokes'), g(n, 'strokeStyleId')))) st.rawFill.push(n.id);
      if (!inner && DEFNAME.test(n.name)) st.defNames++;
      if (t === 'COMPONENT_SET') { try { n.componentPropertyDefinitions; } catch (e) { errs.push(tag(n) + ' variant conflict: ' + e.message); } }
      const ch = 'children' in n && (t !== 'INSTANCE' || o.into || n === root) && t !== 'BOOLEAN_OPERATION' ? n.children.filter((c) => c.visible !== false) : [];
      if (ch.length && 'layoutMode' in n) {
        const pb = n.absoluteBoundingBox;
        if (pb && (g(n, 'overflowDirection') || 'NONE') === 'NONE') {
          let worst = 0, cnt = 0, side = '';
          for (const c of ch) {
            const b = g(c, 'absoluteBoundingBox'); if (!b) continue;
            const d = { left: pb.x - b.x, top: pb.y - b.y, right: b.x + b.width - pb.x - pb.width, bottom: b.y + b.height - pb.y - pb.height };
            let hit = false;
            for (const k in d) if (d[k] > 0.5) { hit = true; if (d[k] > worst) { worst = d[k]; side = k; } }
            if (hit) cnt++;
          }
          if (cnt) warns.push(tag(n) + (g(n, 'clipsContent') ? ' clips ' : ' is overflowed by ') + cnt + ' child(ren), max +' + r(worst) + 'px ' + side);
        }
        const free = (n.layoutMode === 'NONE' ? ch : ch.filter((c) => g(c, 'layoutPositioning') === 'ABSOLUTE')).slice(0, 60);
        let pairs = 0;
        for (let i = 0; i < free.length && pairs < 3; i++) for (let j = i + 1; j < free.length && pairs < 3; j++) {
          const a = g(free[i], 'absoluteBoundingBox'), b = g(free[j], 'absoluteBoundingBox'); if (!a || !b) continue;
          const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          if (w <= 1 || h <= 1) continue;
          const inside = (p, q) => p.x >= q.x - 1 && p.y >= q.y - 1 && p.x + p.width <= q.x + q.width + 1 && p.y + p.height <= q.y + q.height + 1;
          if (inside(a, b) || inside(b, a)) continue;
          pairs++; warns.push(tag(free[i]) + ' overlaps ' + tag(free[j]) + ' by ' + r(w) + 'x' + r(h));
        }
      }
      for (const c of ch) visit(c);
    };
    visit(root);
    const max = o.max || 40, rows = errs.map((e) => '! ' + e).concat(warns.map((w) => '~ ' + w));
    const ids = (a) => a.length + (a.length ? ' (' + a.slice(0, 5).join(' ') + (a.length > 5 ? ' …' : '') + ')' : '');
    const info = []; if (st.rawFill.length) info.push('raw colors ' + ids(st.rawFill)); if (st.rawText.length) info.push('raw text styles ' + ids(st.rawText)); if (st.defNames) info.push('default names ' + st.defNames);
    const head = 'heuristic check ' + tag(root) + ': ' + st.nodes + ' nodes, ' + errs.length + ' errors, ' + warns.length + ' warnings' + (info.length ? '; ' + info.join('; ') : '');
    return fit([head + (o.into ? '; visual appearance unverified' : '; nested instances skipped; visual appearance unverified')].concat(rows.slice(0, max), rows.length > max ? ['… +' + (rows.length - max) + ' more'] : []).join('\n'));
  };

  //: fx.shot(id, {max=1024, scale}) → inline screenshot of one node, scaled so its long side is about 800px (small nodes are enlarged up to 2x, large ones shrunk) and never above `max`.
  fx.shot = async (x, o = {}) => {
    const n = await fx.node(x), long = Math.max(n.width, n.height), max = o.max || 1024;
    let s = o.scale || Math.min(2, Math.max(0.1, 800 / long));
    if (long * s > max) s = max / long;
    s = Math.round(s * 100) / 100;
    await n.screenshot({ scale: s });
    return 'shot ' + tag(n) + ' ' + Math.round(n.width) + 'x' + Math.round(n.height) + ' @' + s + 'x';
  };

  // ───────────── writing ─────────────
  const guard = (n) => {
    if (!fx.__scope || !fx.__scope.length) return n;
    for (let a = n; a; a = a.parent) if (fx.__scope.includes(a.id)) return n;
    throw new Error('fx: ' + tag(n) + ' is outside the allowed scope [' + fx.__scope.join(', ') + '] of this file (see `fx.mjs scope`)');
  };
  const made = (n) => { fx.__made.push(n); return n; };
  const changed = (n) => { fx.__changed.push(n); return n; };
  const loadFonts = async (n) => {
    const ts = n.type === 'TEXT' ? [n] : 'findAllWithCriteria' in n ? n.findAllWithCriteria({ types: ['TEXT'] }) : [];
    const seen = {};
    for (const t of ts) {
      const fs = t.characters.length ? t.getStyledTextSegments(['fontName']).map((s) => s.fontName) : [t.fontName];
      for (const f of fs) { if (!f || f === figma.mixed) continue; const k = f.family + '|' + f.style; if (!seen[k]) { seen[k] = 1; await figma.loadFontAsync(f); } }
    }
  };
  const place = (n, p, o) => {
    if (p) { if (o.index != null) p.insertChild(o.index, n); else p.appendChild(n); }
    if (o.name) n.name = o.name;
    if (o.x != null) n.x = o.x;
    if (o.y != null) n.y = o.y;
    return n;
  };
  const missing = (kind, ref) => new Error('fx: ' + kind + ' ' + JSON.stringify(ref) + ' is not in the map or the DS registry. Look it up with `node tools/fx.mjs ds ' + JSON.stringify(ref) + '`; if it is not there, find it once with search_design_system (the hook records the key).');

  //: fx.comp(ref) → component or component-set node. ref = node id | name from the file map (local; a component created since the last scan is found by name on the current page) or the DS registry (library) | '#keyprefix' as printed by search results and `fx.mjs ds` | 40-char key. The same refs work for variables and styles.
  fx.comp = async (ref) => {
    if (ref && typeof ref === 'object') return ref;
    if (/^\d+[:-]\d+$/.test(ref)) return fx.node(ref);
    const e = fx.__ds.c[norm(ref)] || (/^[0-9a-f]{40}$/.test(ref) ? { k: ref } : null);
    if (!e) {
      // A component made after the last scan is not in the map yet: look for it by name on the current page.
      const l = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT'] }).find((c) => norm(c.name) === norm(ref) && !(c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET'));
      if (l) return l;
      throw missing('component', ref);
    }
    let last;
    const failed = (key) => { if (fx.__failures.length < 40 && !fx.__failures.some((f) => f.kind === 'component' && f.key === key)) fx.__failures.push({ kind: 'component', key }); };
    if (e.id) { try { return await fx.node(e.id); } catch (err) { last = err; } }
    const candidates = [{ k: e.k, set: e.set }].concat((e.alt || []).map((a) => typeof a === 'string' ? { k: a, set: e.set } : a)).filter((a) => a && a.k);
    for (const candidate of candidates) {
      if (candidate.set !== 0) { try { return await figma.importComponentSetByKeyAsync(candidate.k); } catch (err) { last = err;  } }
      try { return await figma.importComponentByKeyAsync(candidate.k); } catch (err) { last = err; failed(candidate.k); }
    }
    const locals = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT_SET', 'COMPONENT', 'INSTANCE'] });
    for (let c of locals) {
      if (c.type === 'INSTANCE') { try { c = await c.getMainComponentAsync(); } catch (err) { continue; } }
      if (!c) continue;
      const owner = c.parent && c.parent.type === 'COMPONENT_SET' ? c.parent : c;
      if (norm(owner.name) === norm(ref) || norm(c.name) === norm(ref) || candidates.some((a) => a.k === owner.key) || owner.id === e.id) return owner;
    }
    throw new Error('fx.comp: all component candidates failed for ' + JSON.stringify(ref) + ' (' + candidates.map((c) => c.k).join(', ') + '); ' + (last ? last.message : 'no usable current-page component'));
  };

  //: fx.props(instance, {size:'48', label:'Text', icon:true, slot:'Icon name'}) → sets component properties by case-insensitive name without the "#id" suffix; variants first, then the rest; fonts are loaded; an INSTANCE_SWAP value is any fx.comp ref.
  fx.props = async (x, props) => {
    const i = guard(await fx.node(x));
    const key = (k) => {
      const cp = i.componentProperties; if (k in cp) return k;
      const f = Object.keys(cp).filter((c) => norm(c.split('#')[0]) === norm(k));
      if (!f.length) throw new Error('fx: ' + tag(i) + ' has no property ' + JSON.stringify(k) + '. Available: ' + Object.keys(cp).map((c) => c.split('#')[0] + ':' + cp[c].type[0]).join(', '));
      return f[0];
    };
    const first = {}, rest = [];
    for (const k in props) { const rk = key(k); if (i.componentProperties[rk].type === 'VARIANT') first[rk] = String(props[k]); else rest.push([k, props[k]]); }
    if (Object.keys(first).length) {
      try { i.setProperties(first); } catch (e) {
        // Not every combination of variant values exists: list the existing ones closest to the request.
        const m = await i.getMainComponentAsync(), set = m && m.parent && m.parent.type === 'COMPONENT_SET' ? m.parent : null;
        if (!set || !/variant/i.test(e.message)) throw e;
        const want = Object.assign({}, m.variantProperties); for (const k in first) want[k] = first[k];
        const near = set.children.filter((c) => c.variantProperties).map((c) => [Object.keys(want).filter((k) => c.variantProperties[k] === want[k]).length, c.name]).sort((a, b) => b[0] - a[0]).slice(0, 6).map((r) => r[1]);
        throw new Error('fx: ' + tag(i) + ' has no variant ' + JSON.stringify(first) + ' from its current state. Closest existing: ' + near.join(' | '));
      }
    }
    if (rest.length) {
      const second = {};
      for (const [k, v] of rest) {
        const rk = key(k), t = i.componentProperties[rk].type;
        if (t === 'INSTANCE_SWAP') { const c = await fx.comp(v); second[rk] = (c.type === 'COMPONENT_SET' ? c.defaultVariant : c).id; }
        else second[rk] = t === 'BOOLEAN' ? !!v : String(v);
      }
      await loadFonts(i);
      i.setProperties(second);
    }
    return changed(i);
  };

  //: fx.inst(ref, parent, {props, name, index, x, y}) → new instance of a local or library component (ref as in fx.comp) appended to parent.
  fx.inst = async (ref, parent, o = {}) => {
    const p = guard(parent ? await fx.node(parent) : figma.currentPage);
    const c = await fx.comp(ref);
    const i = place((c.type === 'COMPONENT_SET' ? c.defaultVariant : c).createInstance(), p, o);
    made(i);
    if (o.props) { await fx.props(i, o.props); fx.__changed.pop(); }
    return i;
  };

  //: fx.clone(src, parent, {name, index, x, y}) → copy of a node placed into parent (the way to reuse an existing instance or frame as is).
  fx.clone = async (src, parent, o = {}) => {
    const s = await fx.node(src), p = parent ? guard(await fx.node(parent)) : guard(s.parent);
    const copy = made(place(s.clone(), p, o));
    // Figma versions may drop variable aliases on cloned instance variant properties.
    const restore = (a, b) => {
      if (a.componentPropertyReferences && Object.keys(a.componentPropertyReferences).length) {
        try { b.componentPropertyReferences = Object.assign({}, a.componentPropertyReferences); }
        catch (err) { fx.__warnings.push('clone ' + b.id + ': layer property references could not be restored: ' + err.message); }
      }
      if (a.type === 'INSTANCE' && typeof b.setProperties === 'function') {
        const aliases = {};
        for (const [key, prop] of Object.entries(a.componentProperties || {})) if (prop.boundVariables && prop.boundVariables.value) aliases[key] = prop.boundVariables.value;
        if (Object.keys(aliases).length) { try { b.setProperties(aliases); } catch (err) { fx.__warnings.push('clone ' + b.id + ': component property bindings could not be restored: ' + err.message); } }
      }
      if (a.children && b.children) for (let i = 0; i < Math.min(a.children.length, b.children.length); i++) restore(a.children[i], b.children[i]);
    };
    const skip = figma.skipInvisibleInstanceChildren;
    try { figma.skipInvisibleInstanceChildren = false; restore(s, copy); } finally { figma.skipInvisibleInstanceChildren = skip; }
    return copy;
  };

  //: fx.text(textNode, 'chars') | fx.text(parent, {'layer name': 'chars', …}) → sets text with fonts loaded; in the map form each key is the name of a text layer inside parent.
  fx.text = async (x, v) => {
    const n = guard(await fx.node(x));
    const set = async (t, s) => { await loadFonts(t); t.characters = String(s); changed(t); };
    if (typeof v !== 'object') { if (n.type !== 'TEXT') throw new Error('fx: ' + tag(n) + ' is not a text node; pass {layerName: text}'); await set(n, v); return n; }
    const ts = n.findAllWithCriteria({ types: ['TEXT'] });
    for (const k in v) {
      const t = ts.find((c) => c.name === k) || ts.find((c) => norm(c.name) === norm(k));
      if (!t) throw new Error('fx: no text layer ' + JSON.stringify(k) + ' in ' + tag(n) + '. Text layers: ' + uniq(ts.map((c) => c.name)).slice(0, 30).join(', '));
      await set(t, v[k]);
    }
    return n;
  };

  let lvars = null;
  //: fx.v(name) → Variable: local by name, else library by name through the DS registry (imported by key).
  fx.v = async (name) => {
    if (name && typeof name === 'object') return name;
    if (!lvars) lvars = await figma.variables.getLocalVariablesAsync();
    const l = lvars.find((v) => v.name === name) || lvars.find((v) => norm(v.name) === norm(name));
    if (l) return l;
    const e = fx.__ds.v[norm(name)] || (/^[0-9a-f]{40}$/.test(name) ? { k: name } : null);
    if (!e) throw missing('variable', name);
    return figma.variables.importVariableByKeyAsync(e.k);
  };

  //: fx.bind(node, {fill, stroke, gap, pad, padX, padY, radius, <any bindable field>: 'variable name'}) → binds tokens. Paints preserve other layers; multiple solid paints require {variable:'name', index:0}. Non-solid paints are never replaced implicitly.
  fx.bind = async (x, map) => {
    const n = guard(await fx.node(x));
    if (n.type === 'TEXT') await loadFonts(n);
    const F = { gap: ['itemSpacing'], pad: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'], padX: ['paddingLeft', 'paddingRight'], padY: ['paddingTop', 'paddingBottom'], radius: ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'] };
    for (const k in map) {
      const spec = map[k], paintSpec = spec && typeof spec === 'object' && 'variable' in spec;
      const v = await fx.v(paintSpec ? spec.variable : spec);
      if (k === 'fill' || k === 'stroke') {
        const prop = k === 'fill' ? 'fills' : 'strokes';
        if (!Array.isArray(n[prop])) throw new Error('fx.bind: ' + prop + ' is mixed or unsupported');
        const paints = n[prop].slice(), solids = paints.map((p, i) => p.type === 'SOLID' ? i : -1).filter((i) => i >= 0);
        let index = paintSpec && spec.index != null ? spec.index : solids.length === 1 ? solids[0] : paints.length === 0 ? 0 : -1;
        if (!Number.isInteger(index) || index < 0 || index > paints.length || (paints[index] && paints[index].type !== 'SOLID') || (index === paints.length && paints.length)) throw new Error('fx.bind: select an existing SOLID ' + prop + ' index explicitly; paints preserved');
        const cur = paints[index] || { type: 'SOLID', color: { r: 0, g: 0, b: 0 } };
        paints[index] = figma.variables.setBoundVariableForPaint(cur, 'color', v);
        n[prop] = paints;
      } else for (const f of F[k] || [k]) n.setBoundVariable(f, v);
    }
    return changed(n);
  };

  const lstyles = {};
  //: fx.style(node, {text, fill, stroke, effect: 'style name'}) → applies local or library styles by name. When several library styles share the name, a text style whose font cannot be loaded is skipped for the next one.
  fx.style = async (x, map) => {
    const n = guard(await fx.node(x));
    const get = async (kind, name) => {
      if (!lstyles[kind]) lstyles[kind] = await (kind === 'text' ? figma.getLocalTextStylesAsync() : kind === 'effect' ? figma.getLocalEffectStylesAsync() : figma.getLocalPaintStylesAsync());
      const l = lstyles[kind].find((s) => s.name === name) || lstyles[kind].find((s) => norm(s.name) === norm(name));
      if (l) return [async () => l];
      const e = fx.__ds.s[norm(name)] || (/^[0-9a-f]{40}$/.test(name) ? { k: name } : null);
      if (!e) throw missing('style', name);
      return [e.k].concat(e.alt || []).map((key) => () => figma.importStyleByKeyAsync(key));
    };
    for (const k in map) {
      // Libraries publish styles under the same name; one whose font is not available is skipped for the next one.
      let s = null, err = null;
      for (const c of await get(k === 'stroke' ? 'fill' : k, map[k])) {
        try { s = await c(); if (k === 'text') await figma.loadFontAsync(s.fontName); break; } catch (e) { err = err || e; s = null; }
      }
      if (!s) throw err;
      if (k === 'text') { await loadFonts(n); await n.setTextStyleIdAsync(s.id); }
      else if (k === 'fill') await n.setFillStyleIdAsync(s.id);
      else if (k === 'stroke') await n.setStrokeStyleIdAsync(s.id);
      else if (k === 'effect') await n.setEffectStyleIdAsync(s.id);
      else throw new Error('fx.style: unknown kind ' + k);
    }
    return changed(n);
  };

  //: fx.wrap(node, {name, desc}) → turns a frame into a component in place. fx.variants([ids], {name, parent}) → combines components into a component set.
  fx.wrap = async (x, o = {}) => {
    const n = guard(await fx.node(x)), c = figma.createComponentFromNode(n);
    if (o.name) c.name = o.name;
    if (o.desc) c.description = o.desc;
    return made(c);
  };
  fx.variants = async (xs, o = {}) => {
    const ns = []; for (const x of xs) ns.push(guard(await fx.node(x)));
    if (!ns.length) throw new Error('fx.variants: no components given');
    const set = figma.combineAsVariants(ns, guard(o.parent ? await fx.node(o.parent) : ns[0].parent));
    if (o.name) set.name = o.name;
    return made(set);
  };

  //: fx.rm(id) → removes a node (scope-checked).
  fx.rm = async (x) => { const n = guard(await fx.node(x)), t = tag(n); n.remove(); return 'removed ' + t; };

  //: fx.track(node, existing=false) → registers a node created (or, with `existing`, changed) with the raw Plugin API so that fx.done() reports and checks it (also scope-checks it).
  fx.track = (n, existing) => (existing ? changed : made)(guard(n));

  //: fx.done(...nodes) → closing report for a writing script: ids created / changed by the helpers plus fx.check of every top-level touched node (or of the nodes given). Return all created/changed IDs in a structured object and include this compact report as its `qa` field.
  fx.done = async (...xs) => {
    const live = (a) => uniq(a).filter((n) => !n.removed);
    const mk = live(fx.__made), ch = live(fx.__changed).filter((n) => !mk.includes(n));
    let targets = [];
    for (const x of xs) targets.push(await fx.node(x));
    if (!xs.length) {
      const all = uniq(mk.concat(ch).map((n) => n.parent && n.parent.type !== 'PAGE' && n.parent.type !== 'DOCUMENT' ? n.parent : n));
      targets = all.filter((n) => { for (let a = n.parent; a; a = a.parent) if (all.includes(a)) return false; return true; });
    }
    if (!mk.length && !ch.length && !targets.length) return 'nothing touched; no QA performed';
    const out = [];
    const summary = (label, ns) => {
      const top = ns.filter((n) => { if (n.id[0] === 'I') return false; for (let a = n.parent; a; a = a.parent) if (ns.includes(a)) return false; return true; });
      if (ns.length) out.push(label + ': ' + ns.length + '; top-level ids (' + top.slice(0, 20).map((n) => n.id).join(' ') + (top.length > 20 ? ' …' : '') + ')');
    };
    summary('created', mk); summary('changed', ch);
    out.push(...fx.__warnings.slice(0, 8).map((w) => '~ ' + w));
    out.push('QA heuristic; ' + Math.min(targets.length, 8) + '/' + targets.length + ' touched containers checked; visual appearance unverified');
    for (const t of targets.slice(0, 8)) out.push(await fx.check(t, { max: Math.max(1, Math.floor(70 / Math.min(targets.length, 8))) }));
    if (targets.length > 8) out.push('NOT CHECKED containers: ' + targets.slice(8, 28).map((n) => n.id).join(' ') + (targets.length > 28 ? ' …' : '') + '; run fx.check on remaining containers');
    return fit(out.join('\n')) || 'nothing touched';
  };

  return fx;
})();
