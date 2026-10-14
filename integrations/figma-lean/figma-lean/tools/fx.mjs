#!/usr/bin/env node
// figma-lean CLI: everything that can be answered from disk instead of from Figma, plus maintenance of the kit itself.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  SKILL, HOME, USER_MARK, MAX_CODE, norm, readJson, writeText, append, fileDir, kitSource, buildKit, loadConfig, saveConfig, loadMap, knownFiles, lastFile,
  loadDs, dsScore, isDeprecated, fileLibs, prelude, buildScript, processToolOutput, digest, findInMap, propDetail, propSummary, recipeDir, now,
} from './lib.mjs';

const argv = process.argv.slice(2), cmd = argv.shift();
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true; };
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const keyOf = (s) => { const m = /figma\.com\/(?:design|file|board|slides)\/([0-9A-Za-z]{22,})/.exec(s || ''); return m ? m[1] : s; };
const fileArg = () => { const k = keyOf(opt('-f')) || lastFile(); if (!k) die('no file yet: pass -f <fileKey or Figma URL>'); return k; };
const die = (m) => { console.error(m); process.exit(1); };
const AsyncFunction = (async () => {}).constructor;

const HELP = `figma-lean — node tools/fx.mjs <command>   (file = last used one unless -f <fileKey|URL>)
  map                          digest of the file map: pages, sections, components, tokens in use
  find <name part | id>        nodes and components of the map, with ids and paths
  comp <name>                  properties and variants of a local or library component
  ds <name part> [--comps|--vars|--styles] [--all]   DS registry: library assets by name, with #key prefixes
  ds --libs                    known libraries and their keys (for includeLibraryKeys)
  files                        files that have a map
  scope [id …| --clear]        nodes the write helpers may touch in this file
  name "…" / note "…"          file title for the digest / append a rule or decision to the file notes
  api <component>              props of a core-components package from node_modules typings
  token <figma name | css var> [--exact]   core-ds CSS variables matching a token name
  recipe ls | show <n> | save <n> [--args "a, b"] [--desc "…"] | rm <n>   reusable scripts callable as fx.r.<n>(…)
  build <script.js | -> [-f]   full script with the kit, for use_figma when the hook is not active
  prepare                      JSON from stdin → validated use_figma arguments (Codex bridge)
  ingest                       JSON from stdin → cached/compacted MCP result (Codex bridge)
  docs                         regenerate references/kit.md and the cheat sheet in SKILL.md from kit.js
  doctor                       self-test of kit, hook and data folder (run after editing the kit)
  stats [--all]                what Figma calls cost in this (or every) session`;

const dsRows = (q, { kinds, all, fileKey }) => {
  const ds = loadDs(), libs = fileLibs(fileKey), nq = norm(q || ''), out = [];
  for (const [kind, table] of [['component', ds.components], ['variable', ds.variables], ['style', ds.styles]]) {
    if (kinds.length && !kinds.includes(kind)) continue;
    let rows = Object.entries(table).filter(([k, e]) => !nq || norm(e.n || '').includes(nq) || k.startsWith(nq.replace(/^#/, '')));
    const total = rows.length;
    if (!all) rows = rows.filter(([, e]) => !isDeprecated(e) || (fileKey && e.files && e.files[fileKey]));
    rows.sort((a, b) => dsScore(b[1], fileKey, libs) - dsScore(a[1], fileKey, libs));
    const shown = all ? rows : rows.slice(0, 20);
    if (!total) continue;
    out.push(`${kind}s: ${total} match` + (shown.length < total ? `, ${shown.length} shown (--all for the rest)` : ''));
    for (const [k, e] of shown) {
      const mark = fileKey && e.files && e.files[fileKey] ? '★' : libs.has(e.lib) ? '◆' : ' ';
      out.push(`  ${mark} ${e.n} — ${e.lib || '?'}${e.col ? ' / ' + e.col : ''} — ${kind === 'component' ? (e.set ? 'set' : e.set === false ? 'component' : '?') : e.t || ''} #${k.slice(0, 8)}` + (kind === 'component' && e.props ? ` [${propSummary(e.props, 110)}]` : e.d ? ` — ${e.d.slice(0, 100)}` : ''));
    }
  }
  return out;
};

const findPkg = (name) => {
  for (let d = process.cwd(); ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', '@alfalab', name);
    if (fs.existsSync(p)) return p;
    if (path.dirname(d) === d) return null;
  }
};

const commands = {
  map() {
    const key = fileArg(), map = loadMap(key);
    if (!Object.keys(map.pages).length) die(`no map for ${key} yet: run  return await fx.scan()  and  return await fx.scan('<page or section id>')  through use_figma`);
    const text = digest(map, loadConfig(key));
    writeText(path.join(fileDir(key), 'digest.md'), text);
    console.log(text);
  },
  find() {
    const key = fileArg(), q = argv.join(' ');
    if (!q) die('find <name part | id>');
    const rows = findInMap(loadMap(key), q);
    console.log(rows.length ? rows.slice(0, 60).join('\n') + (rows.length > 60 ? `\n… +${rows.length - 60} more` : '') : 'not in the map (not scanned yet, or scan the section again)');
  },
  comp() {
    const key = lastFile() && !argv.includes('-f') ? lastFile() : keyOf(opt('-f')), q = norm(argv.join(' '));
    if (!q) die('comp <name>');
    const map = key ? loadMap(key) : null, ds = loadDs(), out = [];
    if (map) for (const id in map.comps) {
      const c = map.comps[id];
      if (!norm(c.n).includes(q)) continue;
      out.push(`${c.set ? 'CS' : 'C'} ${id} "${c.n}" (local)` + (c.d ? ` — ${c.d}` : ''), propDetail(c.props));
      if (c.vars) out.push('  variants: ' + c.vars.map(([vid, vn]) => `${vid} ${vn}`).join(' · '));
    }
    const rows = Object.entries(ds.components).filter(([, e]) => norm(e.n || '').includes(q)).sort((a, b) => dsScore(b[1], key, fileLibs(key)) - dsScore(a[1], key, fileLibs(key)));
    for (const [k, e] of rows.slice(0, 6)) out.push(`${e.set ? 'CS' : 'C'} "${e.n}" — ${e.lib || '?'} #${k.slice(0, 8)}` + (e.d ? ` — ${e.d}` : ''), e.props ? propDetail(e.props) : '  (properties not captured yet: they are recorded when a scan meets an instance of it)');
    if (rows.length > 6) out.push(`… +${rows.length - 6} more: fx.mjs ds "${q}" --comps`);
    console.log(out.filter(Boolean).join('\n') || 'unknown component: scan the section that uses it, or find it once with search_design_system');
  },
  ds() {
    if (flag('--libs')) { const libs = loadDs().libs || {}, mine = fileLibs(lastFile()); console.log(Object.keys(libs).sort().map((n) => `${mine.has(n) ? '◆' : ' '} ${n}  ${libs[n]}`).join('\n') || 'no libraries recorded yet (get_libraries or search_design_system fills this in)'); return; }
    const kinds = [flag('--comps') && 'component', flag('--vars') && 'variable', flag('--styles') && 'style'].filter(Boolean), all = flag('--all');
    const key = keyOf(opt('-f')) || lastFile();
    const rows = dsRows(argv.join(' '), { kinds, all, fileKey: key });
    console.log(rows.length ? rows.join('\n') : 'nothing in the registry: scan a file that uses it, or find it once with search_design_system (the hook records every key it returns)');
  },
  files() {
    const rows = knownFiles().map((k) => { const m = loadMap(k), c = loadConfig(k); return `${k}  ${c.name || m.name || '?'}  — ${Object.keys(m.nodes).length} nodes, ${Object.keys(m.comps).length} components` + (c.scope && c.scope.length ? `, scope ${c.scope.join(' ')}` : '') + (k === lastFile() ? '  (last)' : ''); });
    console.log(rows.join('\n') || 'no maps yet');
  },
  scope() {
    const key = fileArg(), cfg = loadConfig(key);
    if (flag('--clear')) delete cfg.scope;
    else if (argv.length) cfg.scope = argv.map((a) => a.replace(/-/g, ':'));
    saveConfig(key, cfg);
    console.log(cfg.scope && cfg.scope.length ? `write helpers of ${key} are limited to: ${cfg.scope.join(' ')}` : `no scope limit for ${key}`);
  },
  name() { const key = fileArg(), cfg = loadConfig(key); cfg.name = argv.join(' '); saveConfig(key, cfg); console.log(`${key} → ${cfg.name}`); },
  note() {
    const key = fileArg(), f = path.join(fileDir(key), 'notes.md');
    if (!argv.length) { console.log(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : 'no notes'); return; }
    const glued = fs.existsSync(f) && !/\n$/.test(fs.readFileSync(f, 'utf8')) && fs.statSync(f).size > 0;
    append(f, `${glued ? '\n' : ''}- ${argv.join(' ')}\n`);
    console.log(`noted in ${f}`);
  },
  api() {
    const name = (argv[0] || '').replace(/^@alfalab\/core-components-?/, '').replace(/\/.*$/, '');
    if (!name) die('api <component>, e.g. api button');
    const pkg = findPkg('core-components-' + name);
    if (!pkg) die(`@alfalab/core-components-${name} not found in node_modules above ${process.cwd()}` + (findPkg('core-components') ? `. Packages: ${fs.readdirSync(findPkg('core-components')).filter((d) => !d.includes('.')).join(' ')}` : ''));
    const files = ['typings.d.ts', 'types.d.ts', 'Component.d.ts', 'index.d.ts'].map((f) => path.join(pkg, f)).filter((f) => fs.existsSync(f));
    const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n'), out = [`@alfalab/core-components/${name}  (v${readJson(path.join(pkg, 'package.json'), {}).version || '?'})`];
    const entries = fs.readdirSync(pkg).filter((d) => ['desktop', 'mobile', 'shared'].includes(d));
    if (entries.length) out.push('entry points: ' + entries.map((e) => `${name}/${e}`).join(', '));
    const re = /(?:\/\*\*([\s\S]*?)\*\/\s*)?^\s{2,}(readonly\s+)?([A-Za-z_$][\w$]*)(\??):\s*([^;]+);/gm;
    let m, n = 0;
    while ((m = re.exec(src))) {
      const doc = (m[1] || '').split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean);
      const def = doc.find((l) => l.startsWith('@default')), dep = doc.some((l) => l.startsWith('@deprecated')), text = doc.filter((l) => !l.startsWith('@')).join(' ');
      const type = m[5].replace(/\s+/g, ' ').trim();
      if (type.includes('{') && !type.includes('}')) continue;
      out.push(`  ${m[3]}${m[4]}: ${type.length > 110 ? type.slice(0, 109) + '…' : type}` + (def ? ` = ${def.replace('@default', '').trim()}` : '') + (text ? `  // ${text.slice(0, 90)}` : '') + (dep ? '  [deprecated]' : ''));
      n++;
    }
    if (!n) out.push('no props parsed; typings: ' + files.join(', '));
    console.log(out.join('\n'));
  },
  token() {
    const exact = flag('--exact'), q = argv.join(' ').trim();
    if (!q) die('token <figma variable name | css var part> [--exact], e.g. token text/primary');
    const pkg = findPkg('core-components-vars');
    if (!pkg) die('@alfalab/core-components-vars not found in node_modules above ' + process.cwd());
    const needle = q.toLowerCase().replace(/^--/, '').replace(/[\/_\s]+/g, '-'), out = [];
    for (const f of fs.readdirSync(pkg).filter((x) => x.endsWith('.css') && !/^(index|mixins|common)/.test(x))) {
      const hits = fs.readFileSync(path.join(pkg, f), 'utf8').split('\n').filter((l) => { const m = /^\s*(--[\w-]+)\s*:/.exec(l); return m && (exact ? m[1].endsWith('-' + needle) : m[1].includes(needle)); });
      if (hits.length) out.push(`${f}: ` + (hits.length > 12 ? `${hits.length} matches, first 12` : ''), ...hits.slice(0, 12).map((l) => '  ' + l.trim()));
    }
    console.log(out.join('\n') || `no CSS variable contains "${needle}"`);
  },
  recipe() {
    const sub = argv.shift(), dir = recipeDir(), name = argv[0];
    const head = (src, k) => { const m = new RegExp('^//\\s*' + k + ':\\s*(.*)$', 'm').exec(src); return m ? m[1].trim() : ''; };
    if (sub === 'ls' || !sub) {
      const fsx = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')) : [];
      console.log(fsx.map((f) => { const s = fs.readFileSync(path.join(dir, f), 'utf8'); return `fx.r.${f.slice(0, -3)}(${head(s, 'args')})  — ${head(s, 'desc') || 'no description'}`; }).join('\n') || 'no recipes yet');
    } else if (sub === 'show') console.log(fs.readFileSync(path.join(dir, name + '.js'), 'utf8'));
    else if (sub === 'rm') { fs.rmSync(path.join(dir, name + '.js')); console.log('removed ' + name); }
    else if (sub === 'save') {
      if (!/^[A-Za-z_$][\w$]*$/.test(name || '')) die('recipe save <jsIdentifier> [--args "a, b"] [--desc "…"] [--id <tool_use_id>]');
      const args = opt('--args') || '', desc = opt('--desc') || '', id = opt('--id');
      const calls = (fs.existsSync(path.join(HOME, 'log', 'calls.jsonl')) ? fs.readFileSync(path.join(HOME, 'log', 'calls.jsonl'), 'utf8').trim().split('\n') : []).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const call = id ? calls.find((c) => c.id === id) : calls[calls.length - 1];
      if (!call) die('no recorded fx call to save');
      const file = path.join(dir, name + '.js');
      writeText(file, `// desc: ${desc || call.description || ''}\n// args: ${args}\n${call.code}\n`);
      console.log(`saved the script of "${call.description || call.id}" as ${file}\nReplace its literals with the args, then call it as  return await fx.r.${name}(${args})`);
    } else die('recipe ls | show <n> | save <n> | rm <n>');
  },
  build() {
    const key = keyOf(opt('-f')) || lastFile() || '', src = argv[0] === '-' || !argv[0] ? fs.readFileSync(0, 'utf8') : fs.readFileSync(argv[0], 'utf8');
    process.stdout.write(buildScript(key, src));
  },
  prepare() {
    const req = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof req.fileKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(req.fileKey)) die('prepare: valid fileKey required');
    if (typeof req.code !== 'string' || !req.code.trim()) die('prepare: nonempty code required');
    if (typeof req.description !== 'string' || !req.description.trim()) die('prepare: description required');
    const code = buildScript(req.fileKey, req.code);
    append(path.join(HOME, 'log', 'calls.jsonl'), JSON.stringify({ at: now(), s: req.session || 'codex', fileKey: req.fileKey, description: req.description, code: req.code }) + '\n');
    console.log(JSON.stringify({ fileKey: req.fileKey, description: req.description, skillNames: req.skillNames || 'figma-use', code }));
  },
  ingest() {
    const req = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (typeof req.fileKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(req.fileKey)) die('ingest: valid fileKey required');
    const toolName = req.toolName || 'use_figma';
    const result = processToolOutput({ toolName, fileKey: req.fileKey, output: req.output, code: req.code || '' });
    append(path.join(HOME, 'log', 'stats.jsonl'), JSON.stringify({ at: now(), s: req.session || 'codex', tool: toolName, out: JSON.stringify(req.output).length, shown: JSON.stringify(result.output).length, in: (req.code || '').length, kit: /\bfx\s*\./.test(req.code || '') }) + '\n');
    console.log(JSON.stringify(result));
  },
  docs() {
    const lines = kitSource().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('//:')).map((l) => l.slice(3).trim());
    const items = [];
    for (const l of lines) { if (l.startsWith('fx.')) items.push(l); else if (items.length) items[items.length - 1] += '\n  ' + l; }
    const md = items.map((i) => '- `' + i.replace(/ → /, '` → ').replace(/\n {2}/g, '\n  ')).join('\n');
    writeText(path.join(SKILL, 'references', 'kit.md'), `# fx kit API\n\nGenerated from kit/kit.js by \`node tools/fx.mjs docs\`. Do not edit by hand.\n\n${md}\n`);
    const skill = path.join(SKILL, 'SKILL.md'), s = fs.readFileSync(skill, 'utf8'), a = '<!-- kit:start -->', b = '<!-- kit:end -->';
    // Written in place (no temp file + rename): the skill watcher misses a rename and would keep serving the old text.
    if (s.includes(a) && s.includes(b)) fs.writeFileSync(skill, s.slice(0, s.indexOf(a) + a.length) + '\n' + md + '\n' + s.slice(s.indexOf(b)));
    console.log(`${items.length} kit functions documented`);
  },
  doctor() {
    let bad = 0;
    const ok = (name, fn) => { try { const r = fn(); console.log(`PASS ${name}${r ? ' — ' + r : ''}`); } catch (e) { bad++; console.log(`FAIL ${name} — ${e.message}`); } };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-doctor-'));
    const hook = (input) => { const r = spawnSync(process.execPath, [path.join(SKILL, 'tools', 'hook.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, FIGMA_LEAN_HOME: tmp } }); if (r.status !== 0) throw new Error('hook exited ' + r.status + ' ' + r.stderr); return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null; };
    const tool = 'mcp__plugin_figma_figma__use_figma', key = 'doctorFileKey0000000000';
    const textOf = (v) => typeof v === 'string' ? v : Array.isArray(v) ? v.map(textOf).join('\n') : v && v.content ? textOf(v.content) : v && typeof v.text === 'string' ? v.text : '';
    ok('node >= 18', () => { if (+process.versions.node.split('.')[0] < 18) throw new Error(process.version); return process.version; });
    ok('kit parses', () => { new AsyncFunction(buildKit() + '\nreturn fx'); const n = buildKit().length; return `${n} chars, ${MAX_CODE - n} left for a script`; });
    ok('kit docs are current', () => { const n = kitSource().split('\n').filter((l) => l.trim().startsWith('//: fx.')).length, md = fs.readFileSync(path.join(SKILL, 'references', 'kit.md'), 'utf8'); if (md.split('\n').filter((l) => l.startsWith('- `fx.')).length !== n) throw new Error('run: node tools/fx.mjs docs'); return n + ' functions'; });
    ok('hook leaves raw scripts alone', () => { if (hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { fileKey: key, code: 'return figma.root.name' } })) throw new Error('unexpected output'); });
    ok('hook injects the kit', () => { const h = hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: 't1', tool_input: { fileKey: key, description: 'd', code: "return await fx.line('1:2')" } }); if (!h.updatedInput.code.includes(USER_MARK) || h.updatedInput.fileKey !== key) throw new Error('no kit in updatedInput'); new AsyncFunction(h.updatedInput.code); });
    ok('hook rejects a script that does not parse', () => { const h = hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { fileKey: key, code: 'return fx.dump((' } }); if (h.permissionDecision !== 'deny') throw new Error('not denied'); });
    const cap = { __fx: 'map', file: 'Doctor', pages: [['0:1', 'Page']], page: '0:1', root: '1:1', path: ['0:1'], cut: [], part: 1, parts: 1, opts: {}, items: [['n', ['1:1', 'S', 'sec', '0:1', 100, 100, 0, 0]], ['n', ['1:2', 'CS', 'card', '1:1', 10, 10, 0, 0]], ['c', { id: '1:2', n: 'card', set: true, key: 'a'.repeat(40), a: [], props: [['state', 'V', 'a', ['a', 'b']]], vars: [['1:3', 'state=a']] }], ['u', { n: '[D] Button', key: 'b'.repeat(40), set: true, remote: true, c: 2, ex: '1:9', props: [] }], ['v', ['text/primary', 'c'.repeat(40), 'C', 1, 'Interface Dynamic', 3, '']]] };
    ok('hook stores a scan and shortens the output', () => { const h = hook({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { fileKey: key, code: `x\n${USER_MARK}\nreturn await fx.scan('1:1')` }, tool_response: [{ type: 'text', text: JSON.stringify(cap) }] }); if (!textOf(h.updatedMCPToolOutput).includes('card')) throw new Error('digest missing'); if (!fs.existsSync(path.join(tmp, 'files', key, 'map.json'))) throw new Error('map.json not written'); });
    ok('a scan in parts is held until the last part', () => { const two = (k) => hook({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { fileKey: key, code: `x\n${USER_MARK}\nreturn await fx.scan('2:1')` }, tool_response: [{ type: 'text', text: JSON.stringify({ __fx: 'map', snapshot: 'doctor-two-parts', file: 'Doctor', page: '0:1', root: '2:1', path: ['0:1'], cut: [], part: k, parts: 2, opts: {}, items: [['n', [k === 1 ? '2:1' : '2:2', 'S', 'part' + k, k === 1 ? '0:1' : '2:1', 1, 1, 0, 0]]] }) }] }).updatedMCPToolOutput; const a = textOf(two(1)), b = textOf(two(2)); if (!a.includes('staged') || !a.includes('"part":2')) throw new Error(a); if (!b.includes('part1') || !b.includes('part2')) throw new Error('digest incomplete'); });
    ok('names resolve from map and registry', () => { const h = hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id: 't2', tool_input: { fileKey: key, code: "await fx.inst('card','1:1'); await fx.inst('[D] Button','1:1'); await fx.bind('1:1',{fill:'text/primary'})" } }); const c = h.updatedInput.code; if (!c.includes('"card":{"id":"1:2"}') || !c.includes('b'.repeat(40)) || !c.includes('c'.repeat(40))) throw new Error('names not injected'); });
    ok('inline screenshots survive compaction', () => { const img = {type:'image',mimeType:'image/png',data:'doctor-image'}; const h = hook({ hook_event_name: 'PostToolUse', tool_name: tool, tool_input: { fileKey: key, code: `x\n${USER_MARK}\nawait fx.shot('1:1'); return await fx.scan('1:1')` }, tool_response: {content:[{ type: 'text', text: JSON.stringify(cap) }, img]} }); if (!h.updatedMCPToolOutput?.content?.some(b => b.type === 'image' && b.data === img.data)) throw new Error('inline image lost'); });
    ok('search results are compacted and recorded', () => { const h = hook({ hook_event_name: 'PostToolUse', tool_name: 'mcp__x__search_design_system', tool_input: { fileKey: key }, tool_response: [{ type: 'text', text: JSON.stringify({ results: [{ entity: 'component', query: 'tag', components: [{ name: '[D] Tag', libraryName: 'Web :: Core', libraryKey: 'lk-1', assetType: 'component_set', componentSetKey: 'd'.repeat(40) }, { name: '❌ Tag', libraryName: 'Old', libraryKey: 'lk-2', assetType: 'component', componentKey: 'e'.repeat(40) }] }] }) }] }); if (!textOf(h.updatedMCPToolOutput).includes('#dddddddd') || textOf(h.updatedMCPToolOutput).includes('#eeeeeeee')) throw new Error(textOf(h.updatedMCPToolOutput)); });
    ok('recipes parse', () => { const d = recipeDir(), fsx = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.js')) : []; for (const f of fsx) { try { new AsyncFunction(fs.readFileSync(path.join(d, f), 'utf8')); } catch (e) { throw new Error(f + ': ' + e.message); } } return fsx.length + ' recipes'; });
    ok('runtime integration is present', () => { const s = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'); if ((!/^hooks:/m.test(s) || !s.includes('tools/hook.mjs')) && !fs.existsSync(path.join(SKILL, 'tools', 'codex-bridge.js'))) throw new Error('neither Claude hooks nor Codex bridge found'); });
    ok('data folder is writable', () => { fs.mkdirSync(HOME, { recursive: true }); fs.accessSync(HOME, fs.constants.W_OK); return HOME; });
    ok('no hook errors logged', () => { const f = path.join(HOME, 'log', 'errors.log'); if (fs.existsSync(f) && fs.statSync(f).size) throw new Error('see ' + f); });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(bad ? `\n${bad} check(s) failed` : '\nall good');
    process.exit(bad ? 1 : 0);
  },
  stats() {
    const f = path.join(HOME, 'log', 'stats.jsonl');
    if (!fs.existsSync(f)) return console.log('no calls recorded yet');
    let rows = fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!rows.length) return console.log('no valid calls recorded yet');
    if (!flag('--all')) { const s = rows[rows.length - 1].s; rows = rows.filter((r) => r.s === s); }
    const by = {};
    for (const r of rows) { const t = by[r.tool] || (by[r.tool] = { n: 0, out: 0, shown: 0, written: 0, shots: 0 }); t.n++; t.out += r.out || 0; t.shown += r.shown == null ? r.out || 0 : r.shown; t.written += r.in || 0; if (r.shot || r.tool === 'get_screenshot') t.shots++; }
    console.log(`${rows.length} Figma calls` + (rows.length ? ` since ${rows[0].at.slice(0, 16).replace('T', ' ')}` : ''));
    for (const t in by) { const b = by[t]; console.log(`  ${t}: ${b.n} calls` + (b.written ? `, ${b.written} chars of script written` : '') + `, results ${b.out} chars` + (b.shown < b.out ? ` → ${b.shown} shown (${Math.round((1 - b.shown / b.out) * 100)}% kept out of context)` : '') + (b.shots ? `, ${b.shots} with a screenshot` : '')); }
    console.log('These are character counts, not measured tokens, billed cost or a quality comparison.');
  },
};

if (!cmd || cmd === 'help' || cmd === '--help' || !commands[cmd]) { console.log(HELP); process.exit(cmd && !commands[cmd] && cmd !== 'help' && cmd !== '--help' ? 1 : 0); }
commands[cmd]();
