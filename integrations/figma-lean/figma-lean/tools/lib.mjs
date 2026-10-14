// Shared code of the figma-lean tools: data paths, kit build, file map, DS registry, digest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.FIGMA_LEAN_HOME || path.join(os.homedir(), '.claude', 'figma-lean');
export const USER_MARK = '/*fx:user*/';
export const MAX_CODE = 50000;

export const norm = (s) => String(s).toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
export const now = () => new Date().toISOString();
export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
export const writeText = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, s); fs.renameSync(t, f); };
export const writeJson = (f, v) => writeText(f, JSON.stringify(v, null, 1));
export const append = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, s); };
export const fileDir = (key) => { if (typeof key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('fx: invalid file key'); return path.join(HOME, 'files', key); };
const uniq = (a) => [...new Set(a)];

// ───────────── kit ─────────────
export const kitSource = () => fs.readFileSync(path.join(SKILL, 'kit', 'kit.js'), 'utf8');
/** The kit without comments and indentation: what the hook prepends to a script. */
export const buildKit = () => kitSource().split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('//')).join('\n');

// ───────────── per-file state ─────────────
export const loadConfig = (key) => readJson(path.join(fileDir(key), 'config.json'), {});
export const saveConfig = (key, cfg) => writeJson(path.join(fileDir(key), 'config.json'), cfg);
export const emptyMap = (key) => ({ v: 1, fileKey: key, name: '', pages: {}, nodes: {}, comps: {}, used: {}, vars: {}, styles: {}, scans: {}, local: null });
export const loadMap = (key) => ({ ...emptyMap(key), ...readJson(path.join(fileDir(key), 'map.json'), {}) });
export const knownFiles = () => { try { return fs.readdirSync(path.join(HOME, 'files')).filter((k) => fs.existsSync(path.join(fileDir(k), 'map.json'))); } catch { return []; } };
export const setLast = (key) => writeJson(path.join(HOME, 'last.json'), { fileKey: key, at: now() });
export const lastFile = () => readJson(path.join(HOME, 'last.json'), {}).fileKey;

// ───────────── DS registry (library components, variables and styles seen in any file) ─────────────
const DS = () => path.join(HOME, 'ds', 'registry.json');
export const loadDs = () => ({ v: 1, components: {}, variables: {}, styles: {}, ...readJson(DS(), {}) });
export const saveDs = (ds) => writeJson(DS(), ds);
const seen = (table, key, rec, fileKey, count) => {
  const e = table[key] || (table[key] = { files: {} });
  for (const k in rec) if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') e[k] = rec[k];
  e.files = e.files || {};
  if (fileKey) e.files[fileKey] = Math.max(e.files[fileKey] || 0, count || 1);
  e.at = now();
  return e;
};
export const DEPRECATED = /❌|🔄|🚧|⚠|deprecated|trash|\btest\b|не подключать|\bold\b|legacy/i;
export const isDeprecated = (e) => DEPRECATED.test((e.n || '') + ' ' + (e.lib || ''));
export const fileLibs = (fileKey) => new Set(((fileKey && loadConfig(fileKey).libs) || []).map((l) => l.name));
export const dsScore = (e, fileKey, libs) => (isDeprecated(e) ? 0 : 1e9) - (fileKey && e.failedFiles?.[fileKey] ? 1e10 : 0) + (libs && e.lib && libs.has(e.lib) ? 1e8 : 0) + (fileKey && e.files && e.files[fileKey] ? 1e7 : 0) + Object.values(e.files || {}).reduce((a, b) => a + b, 0);

// ───────────── prelude: kit + scope + resolved names + recipes ─────────────
export function literals(code) {
  const out = new Set(), re = /(['"`])((?:\\.|(?!\1)[^\\\n])*?)\1/g;
  let m;
  while ((m = re.exec(code))) if (m[2].length >= 2 && m[2].length <= 120 && !m[2].includes('${')) out.add(norm(m[2]));
  return out;
}

/** Names used in the script → local component ids (file map) and library keys (DS registry). */
export function resolveNames(fileKey, code) {
  const lits = literals(code), res = { c: {}, v: {}, s: {} };
  if (!lits.size) return res;
  const map = loadMap(fileKey), ds = loadDs(), libs = fileLibs(fileKey);
  for (const id in map.comps) { const n = norm(map.comps[id].n); if (lits.has(n) && !res.c[n]) res.c[n] = { id }; }
  const pick = (table, out, make) => {
    const all = {};
    for (const k in table) { const n = norm(table[k].n || ''); if (lits.has(n)) (all[n] || (all[n] = [])).push(k); }
    for (const n in all) {
      if (out[n]) continue;
      const ks = all[n].sort((a, b) => dsScore(table[b], fileKey, libs) - dsScore(table[a], fileKey, libs));
      out[n] = make(ks[0], table[ks[0]], ks.slice(1, 4));
    }
  };
  pick(ds.components, res.c, (k, e, alt) => ({ k, set: e.set === undefined ? undefined : e.set ? 1 : 0, alt: alt.map((k) => ({ k, set: ds.components[k].set === undefined ? undefined : ds.components[k].set ? 1 : 0 })) }));
  pick(ds.variables, res.v, (k) => ({ k }));
  // Styles: libraries publish the same style as "Name" and as "Name (code hint)", so candidates are grouped by the name without the trailing parenthesis.
  // The best one by dsScore wins (a style already used in this file beats an exact name from an unrelated library); the next ones go along as fallbacks for fx.style.
  const base = (n) => n.replace(/\s*\([^)]*\)\s*$/, ''), groups = {};
  for (const k in ds.styles) { const b = base(norm(ds.styles[k].n || '')); (groups[b] || (groups[b] = [])).push(k); }
  for (const l of lits) {
    const g = groups[base(l)];
    if (!g || res.s[l]) continue;
    const score = (k) => dsScore(ds.styles[k], fileKey, libs) + (norm(ds.styles[k].n || '') === l ? 0.5 : 0);
    const ks = g.slice().sort((a, b) => score(b) - score(a));
    res.s[l] = ks.length > 1 ? { k: ks[0], alt: ks.slice(1, 4) } : { k: ks[0] };
  }
  // '#keyprefix' refs
  for (const l of lits) {
    if (!/^#[0-9a-f]{6,40}$/.test(l)) continue;
    const hit = (table) => Object.keys(table).find((k) => k.startsWith(l.slice(1)));
    let k;
    if ((k = hit(ds.components))) res.c[l] = { k, set: ds.components[k].set === undefined ? undefined : ds.components[k].set ? 1 : 0 };
    if ((k = hit(ds.variables))) res.v[l] = { k };
    if ((k = hit(ds.styles))) res.s[l] = { k };
  }
  return res;
}

export const recipeDir = () => path.join(HOME, 'recipes');
function recipes(code) {
  const done = new Set(), queue = [code];
  let out = '';
  while (queue.length) {
    const src = queue.pop(), re = /\bfx\.r\.([A-Za-z_$][\w$]*)/g;
    let m;
    while ((m = re.exec(src))) {
      const n = m[1];
      if (done.has(n)) continue;
      done.add(n);
      const f = path.join(recipeDir(), n + '.js');
      if (!fs.existsSync(f)) { out += `fx.r.${n}=()=>{throw new Error('fx: no recipe "${n}" (node tools/fx.mjs recipe ls)')};\n`; continue; }
      const body = fs.readFileSync(f, 'utf8'), a = /^\/\/\s*args:\s*(.*)$/m.exec(body);
      out += `fx.r.${n}=async(${a ? a[1].trim() : ''})=>{\n${body}\n};\n`;
      queue.push(body);
    }
  }
  return out ? 'fx.r={};\n' + out : '';
}

export function prelude(fileKey, code) {
  const cfg = loadConfig(fileKey), included = recipes(code), res = resolveNames(fileKey, code + '\n' + included);
  let p = buildKit() + '\n';
  if (cfg.scope && cfg.scope.length) p += 'fx.__scope=' + JSON.stringify(cfg.scope) + ';\n';
  if (Object.keys(res.c).length + Object.keys(res.v).length + Object.keys(res.s).length) p += 'fx.__ds=' + JSON.stringify(res) + ';\n';
  return p + included + USER_MARK + '\n';
}

// ───────────── map merge ─────────────
const dropRoot = (map, root) => {
  for (const t of ['used', 'vars', 'styles']) for (const k in map[t]) {
    const e = map[t][k];
    if (e.roots) { delete e.roots[root]; if (!Object.keys(e.roots).length) delete map[t][k]; }
  }
  delete map.scans[root];
};
const count = (e) => Math.max(0, ...Object.values(e.roots || {}));

/** One process at a time may touch the data folder: scans of several sections can finish at the same moment. */
export function withLock(fn, { timeoutMs = 8000 } = {}) {
  const lock = path.join(HOME, '.lock'), until = Date.now() + timeoutMs;
  fs.mkdirSync(HOME, { recursive: true });
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() >= until) throw new Error(`fx: state is locked: ${lock}; no state was changed. If a previous process crashed, verify it is stopped before removing this directory.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(40, Math.max(1, until - Date.now())));
    }
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, at: now() }));
    const result = fn();
    if (result && typeof result.then === 'function') throw new Error('fx: withLock requires synchronous work');
    return result;
  } finally { fs.rmSync(path.join(lock, 'owner.json'), { force: true }); fs.rmdirSync(lock); }
}

const pick = (cap, tag) => (cap.items || []).filter((i) => i[0] === tag).map((i) => i[1]);
const optsText = (cap, part) => JSON.stringify({ ...(cap.opts || {}), part });
const missingParts = (got, parts) => Array.from({ length: parts }, (_, i) => i + 1).filter((k) => !got.includes(k));

/**
 * Merges a fx.scan() capture into the file map and the DS registry; returns the text shown to the model.
 * A capture above the 20 KB reply limit of use_figma arrives in parts: part 1 replaces what was known under the root, the rest add to it.
 */
function commitMap(fileKey, cap) {
  const map = loadMap(fileKey), ds = loadDs(), at = now();
  const part = cap.part || 1, parts = cap.parts || 1, R = cap.root, base = cap.path || [];
  map.name = cap.file || map.name;
  if (cap.pages) {
    const pages = {};
    for (const [id, n] of cap.pages) pages[id] = { n, at: map.pages[id] ? map.pages[id].at : null };
    if (Object.keys(pages).length) map.pages = pages;
  }
  let prog;
  if (!R) {
    if (part === 1 || !map.local) map.local = { at, cols: [], vars: [], styles: [], parts, got: [] };
    prog = map.local;
    prog.cols.push(...pick(cap, 'col'));
    prog.vars.push(...pick(cap, 'lv'));
    prog.styles.push(...pick(cap, 'ls'));
  } else {
    if (part === 1 || !map.scans[R]) {
      const under = (e, id) => id === R || e.r === R || (e.anc || []).includes(R);
      // Components known under this root before the scan: the ones that do not come back were moved out or deleted, and the reply says so.
      const prev = {};
      for (const id in map.comps) if (under(map.comps[id], id)) prev[id] = map.comps[id].n;
      for (const id in map.nodes) if (under(map.nodes[id], id)) delete map.nodes[id];
      for (const id in map.comps) if (under(map.comps[id], id)) delete map.comps[id];
      for (const s in map.scans) if (s === R || (map.scans[s].anc || []).includes(R)) dropRoot(map, s);
      map.scans[R] = { at, anc: base, cut: cap.cut || [], scanned: cap.scanned, other: cap.other, parts, got: [], prev };
    }
    prog = map.scans[R];
    for (const [id, t, n, p, w, h, x, y, m] of pick(cap, 'n')) {
      map.nodes[id] = { t, n, p, w, h, x, y, r: R, anc: [] };
      if (m) map.nodes[id].m = m;
    }
    // Ancestors come from parent links and are recomputed for the whole scan, because parts may arrive in any order.
    for (const id in map.nodes) {
      const n = map.nodes[id];
      if (n.r !== R) continue;
      const chain = [];
      for (let p = n.p, i = 0; p && p !== R && map.nodes[p] && i < 60; p = map.nodes[p].p, i++) chain.unshift(p);
      n.anc = id === R ? base : uniq(base.concat(R, chain));
    }
    for (const c of pick(cap, 'c')) map.comps[c.id] = { n: c.n, set: !!c.set, key: c.key, props: c.props, d: c.d, vars: c.vars, r: R, anc: uniq((c.id === R ? base : base.concat(R)).concat(c.a || [])) };
    const put = (table, key, rec, c) => { const e = table[key] || (table[key] = { roots: {} }); Object.assign(e, rec); e.roots = e.roots || {}; e.roots[R] = c; };
    for (const u of pick(cap, 'u')) {
      put(map.used, u.key, { n: u.n, set: !!u.set, remote: !!u.remote, ex: u.ex, props: u.props, id: u.id }, u.c);
      if (u.remote && u.key) seen(ds.components, u.key, { n: u.n, set: !!u.set, props: u.props }, fileKey, u.c);
    }
    for (const [n, key, t, remote, col, c, id] of pick(cap, 'v')) {
      put(map.vars, key, { n, t, remote: !!remote, col, id: id || undefined }, c);
      if (remote && key) seen(ds.variables, key, { n, t, col }, fileKey, c);
    }
    for (const [n, key, t, remote, c, id] of pick(cap, 's')) {
      put(map.styles, key, { n, t, remote: !!remote, id: id || undefined }, c);
      if (remote && key) seen(ds.styles, key, { n, t }, fileKey, c);
    }
    if (map.pages[cap.page]) map.pages[cap.page].at = at;
  }
  prog.got = uniq([...(prog.got || []), part]);
  const left = missingParts(prog.got, prog.parts || 1);
  let lost = [];
  if (!left.length && prog.prev) {
    lost = Object.keys(prog.prev).filter((id) => !map.comps[id]).map((id) => `${prog.prev[id]} (${id})`);
    delete prog.prev;
  }
  writeJson(path.join(fileDir(fileKey), 'map.json'), map);
  saveDs(ds);
  setLast(fileKey);
  if (left.length) return `scan part ${part}/${parts} saved, ${left.length} to go. Next:  return await fx.scan(${R ? `'${R}'` : 'null'}, ${optsText(cap, left[0])})`;
  let head;
  if (!R) head = `file scan saved: ${Object.keys(map.pages).length} pages, ${prog.vars.length} local variables, ${prog.styles.length} local styles`;
  else {
    const mine = (t) => Object.values(t).filter((e) => e.roots && R in e.roots);
    head = `scan of ${R} saved: ${Object.values(map.nodes).filter((n) => n.r === R).length} top-level nodes, ${Object.values(map.comps).filter((c) => c.r === R).length} local components, ${mine(map.used).filter((u) => u.remote).length} library components, ${mine(map.vars).length} variables, ${mine(map.styles).length} styles in use` + ((prog.cut || []).length ? ` — TRUNCATED (${prog.cut.join(', ')}): scan sections separately` : '');
  }
  if (lost.length) head += `\nNO LONGER UNDER ${R} (moved out or deleted, dropped from the map): ${lost.slice(0, 12).join(', ')}${lost.length > 12 ? `, … +${lost.length - 12}` : ''}. If they were moved, scan the section they are in now; where that is:  return await fx.get('<id>', 'parent,parent.name')`;
  const text = digest(map, loadConfig(fileKey));
  const file = path.join(fileDir(fileKey), 'digest.md');
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  writeText(file, text);
  // The model already has the previous digest (from an earlier scan or `fx.mjs map`): a rescan shows only the lines that changed.
  if (old !== null) {
    // Include usage and local tokens: they are part of the saved snapshot too.
    const body = (t) => t.split('\n');
    const was = body(old), is = body(text), wasSet = new Set(was), isSet = new Set(is);
    const diff = was.filter((l) => l.trim() && !isSet.has(l)).map((l) => '- ' + l).concat(is.filter((l) => l.trim() && !wasSet.has(l)).map((l) => '+ ' + l));
    if (!diff.length) return `${head}\ndigest unchanged: ${file}`;
    if (diff.length <= 40) return `${head}\ndigest: ${file} — ${diff.length} line(s) changed (whole digest: node tools/fx.mjs map)\n${diff.join('\n')}`;
  }
  return `${head}\ndigest: ${file}\n\n${text}`;
}

/** Merges a fx.lib() capture (library variable collections) into the DS registry. */
export function mergeLib(cap, fileKey) {
  const ds = loadDs(), cols = {};
  for (const [lib, col, n, key, t] of cap.items || []) {
    seen(ds.variables, key, { n, t, col, lib }, null);
    cols[`${lib} / ${col}`] = (cols[`${lib} / ${col}`] || 0) + 1;
  }
  saveDs(ds);
  if (fileKey) setLast(fileKey);
  const part = cap.part || 1, parts = cap.parts || 1;
  return `library variables saved to the DS registry (part ${part}/${parts}): ${Object.entries(cols).map(([c, n]) => `${c}: ${n}`).join('; ') || 'none'}` + (part < parts ? `\nNext:  return await fx.lib(${JSON.stringify(cap.filter || '*')}, {part: ${part + 1}})` : '\nlook up: node tools/fx.mjs ds <part of a name> --vars');
}

/** Stores a fx.dump(id, {full:true}) capture; parts are appended in order. */
function commitDump(fileKey, cap) {
  const file = path.join(fileDir(fileKey), 'dumps', String(cap.id).replace(/[^a-zA-Z0-9_-]/g, '-') + '.txt');
  const part = cap.part || 1, parts = cap.parts || 1, text = (cap.items || []).join('\n') + '\n';
  if (part === 1) writeText(file, text); else append(file, text);
  if (part < parts) throw new Error('fx: internal error: dump was committed before all parts arrived');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  return `full dump of ${cap.id} "${cap.title}" saved: ${lines.length} rows → ${file}\nRead it with offset/limit or Grep; first rows:\n${lines.slice(0, 12).map((line) => line.length > 200 ? line.slice(0, 200) + '… [full row is in the saved file]' : line).join('\n')}`;
}

// ───────────── digest ─────────────
export const propSummary = (props, max = 160) => {
  if (!props) return '';
  const s = props.map(([k, t, d, opts]) => { const n = k.split('#')[0]; return t === 'V' ? `${n}=${(opts || []).join('|')}` : `${n}:${{ B: 'bool', T: 'text', I: 'swap' }[t] || t}`; }).join('; ');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

export const loadNotes = (key) => { try { return fs.readFileSync(path.join(fileDir(key), 'notes.md'), 'utf8').trim(); } catch { return ''; } };

export function digest(map, cfg = {}) {
  const L = [`# ${cfg.name || map.name || '?'} — ${map.fileKey}`];
  const notes = loadNotes(map.fileKey);
  if (notes) L.push('', '## Notes (rules and decisions for this file)', ...notes.split('\n').slice(0, 40));
  if (cfg.scope && cfg.scope.length) L.push('', 'writes allowed only inside: ' + cfg.scope.map((id) => id + (map.nodes[id] ? ` "${map.nodes[id].n}"` : '')).join(', '));
  L.push('', '## Pages');
  for (const id in map.pages) L.push(`${id} ${map.pages[id].n}` + (map.pages[id].at ? `  [scanned ${map.pages[id].at.slice(0, 10)}]` : ''));
  const kids = {};
  for (const id in map.nodes) (kids[map.nodes[id].p] = kids[map.nodes[id].p] || []).push(id);
  const row = (id, d) => {
    const n = map.nodes[id], c = map.comps[id];
    let s = `${'  '.repeat(d)}${n.t} ${id} ${n.n} ${n.w}x${n.h}`;
    if (n.t === 'S') s += ` @${n.x},${n.y}`;
    if (n.m) s += ` →${n.m}`;
    if (c && c.props && c.props.length) s += ` [${propSummary(c.props)}]`;
    if (c && c.vars) s += ` (${c.vars.length} variants)`;
    return s;
  };
  const tree = (pid, d) => {
    const ids = kids[pid] || [], secs = ids.filter((i) => map.nodes[i].t === 'S'), rest = ids.filter((i) => map.nodes[i].t !== 'S');
    const keep = rest.filter((i) => map.comps[i]).concat(rest.filter((i) => !map.comps[i]).slice(0, 12));
    for (const i of rest) if (keep.includes(i)) L.push(row(i, d));
    if (rest.length > keep.length) L.push(`${'  '.repeat(d)}… +${rest.length - keep.length} more frames (fx.mjs find)`);
    for (const i of secs) { L.push(row(i, d)); tree(i, d + 1); }
  };
  const roots = uniq(Object.values(map.nodes).map((n) => n.p).filter((p) => !map.nodes[p]));
  for (const p of roots) {
    L.push('', `## ${map.pages[p] ? map.pages[p].n : 'under ' + p} (${p})`);
    tree(p, 0);
  }
  const deep = Object.keys(map.comps).filter((id) => !map.nodes[id]);
  if (deep.length) {
    L.push('', '## Local components nested in frames');
    for (const id of deep.slice(0, 30)) { const c = map.comps[id]; L.push(`${c.set ? 'CS' : 'C'} ${id} ${c.n}` + (c.props && c.props.length ? ` [${propSummary(c.props)}]` : '')); }
    if (deep.length > 30) L.push(`… +${deep.length - 30} more`);
  }
  const top = (table, n) => Object.values(table).sort((a, b) => count(b) - count(a)).slice(0, n);
  const lib = Object.values(map.used).filter((u) => u.remote);
  if (lib.length) {
    L.push('', `## Library components in use (${lib.length}; fx.inst('name', parent, {props}))`);
    for (const u of top(Object.fromEntries(lib.map((u, i) => [i, u])), 15)) L.push(`${u.n} ×${count(u)}` + (u.props && u.props.length ? ` [${propSummary(u.props, 120)}]` : ''));
    if (lib.length > 15) L.push(`… +${lib.length - 15} more (fx.mjs ds <name> --comps)`);
  }
  const names = (table, n) => { const all = Object.values(table); return top(table, n).map((v) => v.n).join(', ') + (all.length > n ? `, … +${all.length - n}` : ''); };
  if (Object.keys(map.vars).length) L.push('', `## Variables in use (${Object.keys(map.vars).length}; fx.mjs ds <name> --vars)`, names(map.vars, 12));
  if (Object.keys(map.styles).length) L.push('', `## Styles in use (${Object.keys(map.styles).length}; fx.mjs ds <name> --styles)`, names(map.styles, 10));
  if (map.local && map.local.vars.length + map.local.styles.length) L.push('', `## Local tokens`, `${map.local.vars.length} variables in ${map.local.cols.length} collections` + (map.local.cols.length ? ` (${map.local.cols.map((c) => `${c[1]}: ${c[3]}`).join(', ')})` : '') + `, ${map.local.styles.length} styles`);
  const cut = Object.entries(map.scans).filter(([, s]) => s.cut && s.cut.length);
  if (cut.length) L.push('', 'truncated scans: ' + cut.map(([id, s]) => `${id} (${s.cut.join(', ')})`).join('; '));
  return L.join('\n') + '\n';
}

// ───────────── lookups for the CLI ─────────────
export function findInMap(map, q) {
  const out = [], nq = norm(q);
  const pathOf = (anc) => (anc || []).map((a) => (map.nodes[a] ? map.nodes[a].n : map.pages[a] ? map.pages[a].n : '')).filter(Boolean).join(' / ');
  for (const id in map.nodes) { const n = map.nodes[id]; if (norm(n.n).includes(nq) || id === q) out.push(`${id} ${n.t} "${n.n}" ${n.w}x${n.h}` + (n.m ? ` →${n.m}` : '') + ` ‹${pathOf(n.anc)}›`); }
  for (const id in map.comps) { const c = map.comps[id]; if (!map.nodes[id] && (norm(c.n).includes(nq) || id === q)) out.push(`${id} ${c.set ? 'CS' : 'C'} "${c.n}" ‹${pathOf(c.anc)}›`); }
  return out;
}

export const propDetail = (props) => (props || []).map(([k, t, d, opts]) => `  ${k.split('#')[0]} : ${{ V: 'variant', B: 'bool', T: 'text', I: 'swap' }[t] || t}` + (opts ? ` = ${opts.map((o) => (o === d ? `*${o}` : o)).join(' | ')}` : d !== '' && d !== undefined ? ` (default ${JSON.stringify(d)})` : '')).join('\n');

// ───────────── search_design_system / get_libraries results ─────────────
const clip = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Records every key a search returned in the DS registry and returns a compact, ranked version of the result. */
export function mergeSearch(text, fileKey) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  if (!data || !Array.isArray(data.results)) return null;
  const ds = loadDs(), libs = fileLibs(fileKey), out = [];
  ds.libs = ds.libs || {};
  for (const res of data.results) {
    const kind = res.entity, items = res.components || res.variables || res.styles || [];
    const table = kind === 'variable' ? ds.variables : kind === 'style' ? ds.styles : ds.components;
    const rows = [];
    for (const it of items) {
      const key = it.componentSetKey || it.componentKey || it.key;
      if (!key || !it.name) continue;
      if (it.libraryName && it.libraryKey) ds.libs[it.libraryName] = it.libraryKey;
      const rec = { n: it.name, lib: it.libraryName, d: it.description ? clip(it.description, 240) : undefined };
      if (kind === 'component') rec.set = !!it.componentSetKey;
      else if (kind === 'variable') { rec.t = (it.variableType || '')[0]; rec.col = it.variableCollectionName; }
      else rec.t = (it.styleType || '')[0];
      const e = seen(table, key, rec, null);
      if (fileKey && e.failedFiles) delete e.failedFiles[fileKey];
      rows.push({ key, e, rank: isDeprecated(e) ? 3 : libs.has(e.lib) ? 0 : fileKey && e.files[fileKey] ? 1 : 2 });
    }
    rows.sort((a, b) => dsScore(b.e, fileKey, libs) - dsScore(a.e, fileKey, libs));
    const shown = rows.filter((r, i) => r.rank < 2 || (r.rank === 2 && i < 8)).slice(0, 14);
    const hidden = rows.length - shown.length, dep = rows.filter((r) => r.rank === 3).length;
    out.push(`${kind} "${res.query}": ${rows.length} found` + (hidden ? `, ${shown.length} shown (${dep} deprecated/test hidden${hidden - dep ? `, ${hidden - dep} more` : ''}; all: node tools/fx.mjs ds "${res.query}" --all)` : ''));
    for (const { key, e, rank } of shown) out.push(`  ${'★◆  '[rank]} ${e.n} — ${e.lib || '?'}${e.col ? ' / ' + e.col : ''} — ${kind === 'component' ? (e.set ? 'set' : 'component') : e.t || ''} #${key.slice(0, 8)}${e.d ? ' — ' + clip(e.d, 100) : ''}`);
  }
  saveDs(ds);
  return out.join('\n') + '\n★ from a connected library  ◆ already used in this file. Nondeprecated connected libraries rank first. Every key is saved: refer to an asset by name or by #prefix in fx.inst / fx.bind / fx.style.';
}

/** get_libraries result → the file's connected libraries (used to rank search results); returns a compact list. */
export function mergeLibraries(text, fileKey) {
  let data; try { data = JSON.parse(text); } catch { return null; }
  const ds = loadDs(), connected = [], available = [];
  ds.libs = ds.libs || {};
  const walk = (v, avail) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, avail));
    if (!v || typeof v !== 'object') return;
    const key = v.libraryKey || v.library_key || v.key, name = v.name || v.libraryName;
    if (typeof key === 'string' && typeof name === 'string' && /^lk-/.test(key)) { ds.libs[name] = key; (avail ? available : connected).push({ name, key }); return; }
    for (const k in v) walk(v[k], avail || /available/i.test(k));
  };
  walk(data, false);
  if (!connected.length && !available.length) return null;
  saveDs(ds);
  if (fileKey) saveConfig(fileKey, { ...loadConfig(fileKey), libs: connected });
  return `connected libraries (${connected.length}): ${connected.map((l) => l.name).join('; ') || '—'}\navailable to add: ${available.length} (names and keys saved: node tools/fx.mjs ds --libs)`;
}

// Multipart data is staged separately. The last complete map/dump remains readable
// until every byte of the new snapshot has arrived and passed validation.
const stateHash = (value) => createHash('sha256').update(String(value)).digest('hex');
function stageParts(fileKey, cap, fragments = false) {
  const part = cap.part || 1, parts = cap.parts || 1;
  if (!Number.isSafeInteger(part) || !Number.isSafeInteger(parts) || part < 1 || part > parts || parts > 10000) throw new Error('fx: invalid capture part numbers');
  if (parts === 1 && !fragments) return { cap };
  if (typeof cap.snapshot !== 'string' || !cap.snapshot) throw new Error('fx: multipart capture needs a snapshot ID; rerun using the current kit. Previous complete state was preserved.');
  const kind = fragments ? cap.kind : cap.__fx;
  const slot = `${kind}:${cap.root || cap.id || 'file'}`;
  const file = path.join(fileDir(fileKey), 'pending', stateHash(slot) + '.json');
  let pending = readJson(file, null);
  if (pending && pending.snapshot !== cap.snapshot) {
    if (part !== 1) throw new Error('fx: snapshot changed between parts; restart at part 1. Previous complete state was preserved.');
    pending = null;
  }
  if (!pending) pending = { snapshot: cap.snapshot, parts, kind, root: cap.root, id: cap.id, got: {}, completed: false };
  if (pending.parts !== parts || pending.kind !== kind || pending.root !== cap.root || pending.id !== cap.id) throw new Error('fx: inconsistent multipart metadata; previous complete state was preserved');
  if (pending.completed) return { summary: `snapshot ${cap.snapshot} already saved; duplicate part ignored` };
  const payload = fragments ? cap.fragment?.data : cap;
  if (fragments && (cap.fragment?.index !== part || cap.fragment?.total !== parts || typeof payload !== 'string')) throw new Error('fx: invalid capture fragment');
  if (pending.got[part] !== undefined && JSON.stringify(pending.got[part]) !== JSON.stringify(payload)) throw new Error('fx: conflicting duplicate capture part; previous complete state was preserved');
  pending.got[part] = payload;
  const left = missingParts(Object.keys(pending.got).map(Number), parts);
  writeJson(file, pending);
  if (left.length) {
    const call = kind === 'map' ? `fx.scan(${JSON.stringify(cap.root || null)}, ${optsText(cap, left[0])})` : kind === 'ds' ? `fx.lib(${JSON.stringify(cap.filter || '*')}, ${optsText(cap, left[0])})` : cap.opts?.recipe && /^[A-Za-z_$][\w$]*$/.test(cap.opts.recipe) ? `fx.r.${cap.opts.recipe}(${JSON.stringify(cap.id)}, ${optsText(cap, left[0])})` : `fx.dump(${JSON.stringify(cap.id)}, ${optsText(cap, left[0])})`;
    return { summary: `snapshot part ${part}/${parts} staged; ${left.length} missing. Previous complete state preserved. Next: return await ${call}` };
  }
  let full;
  if (fragments) {
    try { full = JSON.parse(Array.from({ length: parts }, (_, i) => pending.got[i + 1]).join('')); } catch { throw new Error('fx: invalid reassembled capture; previous complete state was preserved'); }
    if (!full || full.__fx !== kind || full.root !== cap.root || full.id !== cap.id || !Array.isArray(full.items)) throw new Error('fx: fragment payload disagrees with capture metadata');
  } else {
    full = { ...pending.got[1], part: 1, parts: 1, items: Array.from({ length: parts }, (_, i) => pending.got[i + 1].items || []).flat() };
  }
  return { cap: full, complete: () => { pending.completed = true; pending.got = {}; writeJson(file, pending); } };
}

export function mergeMap(fileKey, cap) {
  const staged = stageParts(fileKey, cap);
  if (!staged.cap) return staged.summary;
  const summary = commitMap(fileKey, staged.cap);
  staged.complete?.();
  return summary;
}

export function saveDump(fileKey, cap) {
  const staged = stageParts(fileKey, cap);
  if (!staged.cap) return staged.summary;
  const summary = commitDump(fileKey, staged.cap);
  staged.complete?.();
  return summary;
}

export function mergeFragments(fileKey, cap) {
  const staged = stageParts(fileKey, cap, true);
  if (!staged.cap) return staged.summary;
  const full = staged.cap;
  const summary = full.__fx === 'map' ? commitMap(fileKey, full) : full.__fx === 'ds' ? mergeLib(full, fileKey) : full.__fx === 'big' ? commitDump(fileKey, full) : null;
  if (!summary) throw new Error('fx: unknown fragmented capture kind');
  staged.complete?.();
  return summary;
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
function embeddedCapture(text) {
  const i = text.indexOf('{"__fx"');
  if (i < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; }
    else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const cap = parseJson(text.slice(i, j + 1));
      return cap?.__fx ? { cap, before: text.slice(0, i), after: text.slice(j + 1) } : null;
    }
  }
  return null;
}

/** Shared Claude hook/Codex CLI postprocessor. It accepts actual MCP output,
 * preserves images and unrelated blocks, and never fetches a remote URL. */
export function processToolOutput({ toolName, fileKey, output, trustedPaths = [] }) {
  const tool = String(toolName || '').split('__').pop(), summaries = [], visited = new Set();
  const searching = tool === 'search_design_system' || tool === 'get_libraries';
  const allowed = [HOME, os.tmpdir(), ...trustedPaths].flatMap((p) => { try { return [fs.realpathSync(p)]; } catch { return []; } });
  const safeRead = (pointer) => {
    let candidate = pointer;
    if (/^file:\/\//.test(candidate)) { try { candidate = fileURLToPath(candidate); } catch { return { error: 'invalid local output reference' }; } }
    if (!path.isAbsolute(candidate)) return null;
    let real;
    try { real = fs.realpathSync(candidate); } catch { return { error: 'local output reference is unavailable' }; }
    const trusted = allowed.some((dir) => real.startsWith(dir + path.sep)) || (real.startsWith(path.join(os.homedir(), '.claude', 'projects') + path.sep) && real.split(path.sep).includes('tool-results'));
    if (!trusted || !/\.(json|txt)$/i.test(real)) return { error: 'local output reference is outside trusted JSON/text output directories' };
    if (visited.has(real)) return null;
    const info = fs.statSync(real);
    if (!info.isFile() || info.size > 16 * 1024 * 1024) return { error: 'local output reference is not a regular file under 16 MiB' };
    visited.add(real);
    return { text: fs.readFileSync(real, 'utf8') };
  };
  let changed = false, revision = 0;
  const record = (summary) => {
    // Captures stay lossless on disk; only the derived model-facing preview is bounded.
    if (Buffer.byteLength(summary, 'utf8') > 12000) {
      let end = Math.min(summary.length, 12000);
      while (Buffer.byteLength(summary.slice(0, end), 'utf8') > 11500) end -= Math.max(1, Math.ceil(end / 20));
      if (/[\ud800-\udbff]/.test(summary[end - 1] || '')) end--;
      summary = summary.slice(0, end) + '\n… preview shortened; complete data is saved at the path above.';
    }
    summaries.push(summary); changed = true; revision++; return summary;
  };
  const ingest = (cap) => {
    if (!fileKey && cap.__fx !== 'ds') throw new Error('fx: fileKey is required to save capture');
    if (cap.__fx === 'fragment') return record(mergeFragments(fileKey, cap));
    if (cap.__fx === 'map') return record(mergeMap(fileKey, cap));
    if (cap.__fx === 'ds') return record(mergeLib(cap, fileKey));
    if (cap.__fx === 'big') return record(saveDump(fileKey, cap));
    return null;
  };
  const follow = (pointer) => {
    const read = safeRead(pointer);
    if (!read) return null;
    if (read.error) return record(`fx: ${read.error}; original reference retained. Raw search result was not ingested.`);
    const before = summaries.length;
    walk(read.text, 0);
    return summaries.length > before ? summaries.slice(before).join('\n') : record('fx: local output contained no supported search payload; original reference retained.');
  };
  const walk = (value, depth = 0) => {
    if (depth > 30) return value;
    if (typeof value === 'string') {
      const parsed = parseJson(value);
      if (parsed !== undefined && parsed !== value) {
        const before = revision, next = walk(parsed, depth + 1);
        return revision > before ? (typeof next === 'string' ? next : JSON.stringify(next)) : value;
      }
      if (tool === 'use_figma') {
        const hit = embeddedCapture(value);
        if (hit) { const summary = ingest(hit.cap); if (summary) return hit.before + summary + hit.after; }
      }
      if (searching) {
        const pointer = /(?:full output|output|results?)\s+(?:has been\s+)?(?:saved|written)(?:\s+to)?\s*:?\s*[`"']?((?:file:\/\/|\/)[^\n`"']+)/i.exec(value);
        if (pointer) { const summary = follow(pointer[1].trim()); if (summary) return value + '\n\n' + summary; }
      }
      return value;
    }
    if (!value || typeof value !== 'object' || value.type === 'image' || value.type === 'audio') return value;
    if (tool === 'use_figma' && Array.isArray(value.createdIds) && Array.isArray(value.changedIds) && value.createdIds.every(id => typeof id === 'string') && value.changedIds.every(id => typeof id === 'string')) {
      const file = path.join(fileDir(fileKey), 'writes', randomUUID() + '.json');
      writeJson(file, value);
      const {createdIds,changedIds,...rest} = value;
      record(`write IDs saved: ${createdIds.length} created, ${changedIds.length} changed — ${file}`);
      return {...rest, writes: {created:createdIds.length,changed:changedIds.length,idsFile:file}};
    }
    if (tool === 'use_figma' && Object.hasOwn(value, '__fxResult') && Array.isArray(value.__fxFailures)) {
      const ds = loadDs();
      for (const failure of value.__fxFailures.slice(0, 20)) {
        if (failure?.kind !== 'component' || typeof failure.key !== 'string' || !fileKey) continue;
        const e = ds.components[failure.key];
        if (e) { e.failedFiles ||= {}; e.failedFiles[fileKey] = now(); }
      }
      saveDs(ds);
      changed = true; revision++;
      return walk(value.__fxResult, depth + 1);
    }
    if (tool === 'use_figma' && value.__fx) { const summary = ingest(value); if (summary) return summary; }
    if (searching && ((tool === 'search_design_system' && Array.isArray(value.results)) || (tool === 'get_libraries' && !value.type && !['content','response','result','structuredContent','data'].some((k) => Object.hasOwn(value, k)) && (!Array.isArray(value) || !value.some((v) => v?.type))))) {
      const summary = tool === 'search_design_system' ? mergeSearch(JSON.stringify(value), fileKey) : mergeLibraries(JSON.stringify(value), fileKey);
      if (summary) return record(summary);
    }
    if (searching && value.type === 'resource_link' && typeof value.uri === 'string' && !/^https?:/i.test(value.uri)) {
      const summary = follow(value.uri); if (summary) return [value, { type: 'text', text: summary }];
    }
    if (Array.isArray(value)) return value.flatMap((v) => { const next = walk(v, depth + 1); return Array.isArray(next) && !Array.isArray(v) ? next : [next]; });
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, depth + 1)]));
  };
  return withLock(() => {
    const result = walk(output);
    if (fileKey) setLast(fileKey);
    return { output: result, summary: summaries.join('\n\n') || null, changed };
  });
}

/** Compile the same script for both runtimes; thrown Figma errors remain errors. */
export function buildScript(fileKey, code) {
  const AsyncFunction = (async () => {}).constructor;
  new AsyncFunction(code);
  if (!/\bfx\s*\./.test(code)) { if (code.length > MAX_CODE) throw new Error('fx: script exceeds character limit'); return code; }
  const full = prelude(fileKey, code) + 'const __fxResult=await(async()=>{\n' + code + '\n})();\nreturn fx.__failures?.length ? {__fxResult,__fxFailures:fx.__failures.slice(0,20)} : __fxResult;';
  if (full.length > MAX_CODE) throw new Error(`fx: script with kit exceeds the ${MAX_CODE} character limit; split it into smaller calls`);
  new AsyncFunction(full);
  return full;
}
