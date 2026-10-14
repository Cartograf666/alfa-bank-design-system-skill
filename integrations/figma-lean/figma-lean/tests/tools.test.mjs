import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fx-tools-test-'));
process.env.FIGMA_LEAN_HOME = home;
const L = await import('../tools/lib.mjs');
test.after(() => fs.rmSync(home, { recursive: true, force: true }));
const node = (id, name) => ['n', [id, 'F', name, 'page', 100, 100, 0, 0]];
const cap = (items, extra = {}) => ({ __fx: 'map', file: 'Example', root: 'root', page: 'page', pages: [['page', 'Page']], path: [], items, ...extra });
const search = (key = 'compA') => ({ results: [{ entity: 'component', query: 'Button', components: [{ name: 'Button', componentKey: key, libraryName: 'Connected' }] }] });

 test('incomplete map snapshot preserves map, registry, and digest; commit ordered complete snapshot', () => {
  L.mergeMap('atomic', cap([node('old', 'Old'), ['c', { id: 'old', n: 'Old' }]]));
  const before = fs.readFileSync(path.join(L.fileDir('atomic'), 'map.json'), 'utf8');
  const digest = fs.readFileSync(path.join(L.fileDir('atomic'), 'digest.md'), 'utf8');
  L.mergeMap('atomic', cap([node('two', 'Second')], { snapshot: 'new', part: 2, parts: 2 }));
  assert.equal(fs.readFileSync(path.join(L.fileDir('atomic'), 'map.json'), 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(L.fileDir('atomic'), 'digest.md'), 'utf8'), digest);
  const summary = L.mergeMap('atomic', cap([node('one', 'First')], { snapshot: 'new', part: 1, parts: 2 }));
  assert.deepEqual(Object.keys(L.loadMap('atomic').nodes), ['one', 'two']);
  assert.match(summary, /NO LONGER UNDER root/);
  assert.match(summary, /Old/);
  assert.match(summary, /line\(s\) changed/);
  assert.match(L.mergeMap('atomic', cap([node('one', 'First')], { snapshot: 'new', part: 1, parts: 2 })), /duplicate/);
});

test('conflicting parts and missing snapshot fail without destroying complete state', () => {
  L.mergeMap('conflict', cap([node('old', 'Protected')]));
  assert.throws(() => L.mergeMap('conflict', cap([], { part: 1, parts: 2 })), /snapshot ID/);
  L.mergeMap('conflict', cap([node('new', 'New')], { snapshot: 'a', part: 1, parts: 2 }));
  assert.throws(() => L.mergeMap('conflict', cap([node('new', 'Different')], { snapshot: 'a', part: 1, parts: 2 })), /conflicting duplicate/);
  assert.throws(() => L.mergeMap('conflict', cap([], { snapshot: 'b', part: 2, parts: 2 })), /snapshot changed/);
  assert.equal(L.loadMap('conflict').nodes.old.n, 'Protected');
});

test('usage-only changes appear in digest diff', () => {
  L.mergeMap('usage', cap([['v', ['Color/old', 'vold', 'C', true, 'colors', 1]]]));
  const result = L.mergeMap('usage', cap([['v', ['Color/new', 'vnew', 'C', true, 'colors', 1]]]));
  assert.match(result, /Color\/old/); assert.match(result, /Color\/new/); assert.doesNotMatch(result, /digest unchanged/);
});

test('recursive recipes resolve token names and connected component preference', () => {
  fs.mkdirSync(L.recipeDir(), { recursive: true });
  fs.writeFileSync(path.join(L.recipeDir(), 'outer.js'), 'return fx.r.inner();');
  fs.writeFileSync(path.join(L.recipeDir(), 'inner.js'), "return fx.bind('1:1','Brand/red');");
  L.saveDs({ components: { used: { n: 'Button', lib: 'Other', files: { recipes: 20 } }, connected: { n: 'Button', lib: 'Connected', files: {} } }, variables: { red: { n: 'Brand/red', files: {} } }, styles: {} });
  L.saveConfig('recipes', { libs: [{ name: 'Connected' }] });
  const built = L.prelude('recipes', "return fx.r.outer();");
  assert.match(built, /"brand\/red":\{"k":"red"\}/);
  assert.equal(L.resolveNames('recipes', "fx.inst('Button')").c.button.k, 'connected');
  assert.equal(L.resolveNames('recipes', "fx.inst('Button')").c.button.alt[0].k, 'used');
});

test('wrapped large search result ingests and preserves image/hints', () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'BASE64' };
  const payload = search('large'); payload.results[0].components[0].description = 'description '.repeat(5000);
  const output = { content: [{ type: 'text', text: JSON.stringify({ response: JSON.stringify(payload), hint: 'Keep me' }) }, image, { type: 'text', text: 'Also keep me' }] };
  const result = L.processToolOutput({ toolName: 'search_design_system', fileKey: 'search', output });
  assert.equal(result.changed, true); assert.equal(L.loadDs().components.large.n, 'Button');
  assert.deepEqual(result.output.content[1], image);
  assert.equal(result.output.content[2].text, 'Also keep me');
  assert.match(result.output.content[0].text, /Keep me/);
  assert.ok(JSON.stringify(result.output).length < 2000);
});

test('trusted search file indirection preserves pointer; forbidden file is never ingested', () => {
  const file = path.join(home, 'large-search.json'); fs.writeFileSync(file, JSON.stringify(search('indirect')));
  const output = { content: [{ type: 'resource_link', uri: `file://${file}`, name: 'full result' }] };
  const result = L.processToolOutput({ toolName: 'search_design_system', fileKey: 'indirect', output });
  assert.equal(L.loadDs().components.indirect.n, 'Button');
  assert.deepEqual(result.output.content[0], output.content[0]);
  assert.match(result.output.content[1].text, /found/);
  const secret = path.join(home, '.env'); fs.writeFileSync(secret, 'PRIVATE-SECRET');
  const denied = L.processToolOutput({ toolName: 'search_design_system', output: `Full output saved to: ${secret}` });
  assert.match(denied.output, /outside trusted/); assert.doesNotMatch(denied.output, /PRIVATE-SECRET/);
});

test('text capture with siblings and image stays lossless', () => {
  const output = { content: [{ type: 'text', text: JSON.stringify({ capture: cap([node('new', 'New')]), result: { value: 'retained' } }) }, { type: 'image', data: 'pixels', mimeType: 'image/png' }] };
  const result = L.processToolOutput({ toolName: 'use_figma', fileKey: 'siblings', output });
  assert.match(result.output.content[0].text, /retained/);
  assert.deepEqual(result.output.content[1], output.content[1]);
  assert.equal(L.loadMap('siblings').nodes.new.n, 'New');
});

test('fragments reassemble an oversized single item, preserving Unicode exactly', () => {
  const full = cap([node('large', '日本語🙂'.repeat(12000))]);
  const text = JSON.stringify(full), data = [text.slice(0, 20000), text.slice(20000)];
  const fragment = (i) => ({ __fx: 'fragment', kind: 'map', root: 'root', snapshot: 'unicode', part: i, parts: 2, fragment: { index: i, total: 2, data: data[i - 1] } });
  L.mergeMap('fragments', cap([node('old', 'Old')]));
  L.mergeFragments('fragments', fragment(2));
  assert.equal(L.loadMap('fragments').nodes.old.n, 'Old');
  L.mergeFragments('fragments', fragment(1));
  assert.equal(L.loadMap('fragments').nodes.large.n, full.items[0][1][2]);
});

test('active lock is never stolen even if old', () => {
  const lock = path.join(home, '.lock'); fs.mkdirSync(lock);
  fs.utimesSync(lock, 0, 0);
  let ran = false;
  assert.throws(() => L.withLock(() => { ran = true; }, { timeoutMs: 2 }), /state is locked/);
  assert.equal(ran, false); assert.equal(fs.existsSync(lock), true);
  fs.rmdirSync(lock);
});

test('successful failure envelope demotes stale component candidate and fresh search restores it', () => {
  L.saveDs({ components: { bad: { n: 'Button', lib: 'Connected', files: {} }, good: { n: 'Button', lib: 'Other', files: {} } }, variables: {}, styles: {} });
  L.saveConfig('failures', { libs: [{ name: 'Connected' }] });
  const result = L.processToolOutput({ toolName: 'use_figma', fileKey: 'failures', output: { __fxResult: 'working fallback', __fxFailures: [{ kind: 'component', key: 'bad' }] } });
  assert.equal(result.output, 'working fallback');
  assert.equal(L.resolveNames('failures', "fx.inst('Button')").c.button.k, 'good');
  L.mergeSearch(JSON.stringify(search('bad')), 'failures');
  assert.equal(L.resolveNames('failures', "fx.inst('Button')").c.button.k, 'bad');
});

test('get_libraries wrapped MCP output retains images and other text', () => {
  const image = { type: 'image', data: 'retained', mimeType: 'image/png' };
  const output = { content: [{ type: 'text', text: JSON.stringify({ connected: [{ libraryKey: 'lk-a', name: 'Alpha' }], available: [{ libraryKey: 'lk-b', name: 'Beta' }] }) }, image, { type: 'text', text: 'Retain hint' }] };
  const result = L.processToolOutput({ toolName: 'get_libraries', fileKey: 'libs', output });
  assert.deepEqual(result.output.content[1], image);
  assert.equal(result.output.content[2].text, 'Retain hint');
  assert.deepEqual(L.loadConfig('libs').libs, [{ name: 'Alpha', key: 'lk-a' }]);
});

test('actual kit oversized recipe capture roundtrips through disk and suggests recipe continuation', () => {
  const fx = new Function(L.kitSource() + '\nreturn fx;')();
  const lines = ['日本語🙂'.repeat(9000), 'second line'];
  const first = fx.pages('1:2', 'Texts', lines, { recipe: 'texts' });
  assert.equal(first.__fx, 'fragment');
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 20480);
  const result = L.processToolOutput({ toolName: 'use_figma', fileKey: 'recipe-large', output: first });
  assert.match(result.summary, /fx\.r\.texts\(/);
  for (let part = 2; part <= first.parts; part++) {
    const next = fx.pages('1:2', 'Texts', lines, { recipe: 'texts', part });
    assert.equal(next.snapshot, first.snapshot);
    assert.ok(Buffer.byteLength(JSON.stringify(next)) < 20480);
    L.processToolOutput({ toolName: 'use_figma', fileKey: 'recipe-large', output: next });
  }
  const last = L.processToolOutput({ toolName: 'use_figma', fileKey: 'recipe-large', output: fx.pages('1:2', 'Texts', lines, { recipe: 'texts', part: first.parts }) });
  assert.ok(Buffer.byteLength(JSON.stringify(last.output)) < 20480);
  assert.equal(fs.readFileSync(path.join(L.fileDir('recipe-large'), 'dumps', '1-2.txt'), 'utf8'), lines.join('\n') + '\n');
});

test('buildScript leaves plain Figma scripts small and preserves thrown errors', async () => {
  const raw = 'return figma.currentPage.name;';
  assert.equal(L.buildScript('compile', raw), raw);
  const full = L.buildScript('compile', "throw new Error('boom'); // fx.done()");
  await assert.rejects(new ((async () => {}).constructor)(full)(), /boom/);
  assert.throws(() => L.buildScript('compile', 'return await;'), SyntaxError);
});


test('preparation failures deny PreToolUse instead of silently sending raw fx script', () => {
  const result = spawnSync(process.execPath, [new URL('../tools/hook.mjs', import.meta.url).pathname], { input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'mcp__figma__use_figma', tool_input: { fileKey: '../escape', code: 'return fx.done();' } }), encoding: 'utf8', env: { ...process.env, FIGMA_LEAN_HOME: home } });
  const reply = JSON.parse(result.stdout);
  assert.equal(reply.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(reply.hookSpecificOutput.permissionDecision, 'deny');
});

test('failure telemetry inside a JSON text block unwraps to the original successful result', () => {
  const result = L.processToolOutput({ toolName: 'use_figma', fileKey: 'envelope', output: { content: [{ type: 'text', text: JSON.stringify({ __fxResult: 'success', __fxFailures: [] }) }] } });
  assert.equal(result.output.content[0].text, 'success');
});
