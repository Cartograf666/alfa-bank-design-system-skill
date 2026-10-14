import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const recipe = (name, args) => {
  const original = new URL('../../recipes/' + name + '.js', import.meta.url);
  return new AsyncFunction(...args, fs.readFileSync(fs.existsSync(original) ? original : new URL('../recipes/' + name + '.js', import.meta.url), 'utf8'));
};
const cprops = recipe('cprops', ['fx', 'figma', 'comp', 'map']);
const texts = recipe('texts', ['fx', 'figma', 'root', 'opts']);
const layer = (name, type = 'TEXT') => ({ name, type, characters: 'default', visible: true, componentPropertyReferences: { keep: 'existing' } });
function component(groups) {
  const owner = { id: '1:1', name: 'Button', type: 'COMPONENT_SET', componentPropertyDefinitions: {}, children: [] };
  owner.children = groups.map((ls, i) => ({ type: 'COMPONENT', name: 'Variant ' + i, findAll: (pred) => ls.filter(pred) }));
  owner.addComponentProperty = (name, type, defaultValue) => {
    const key = name + '#1'; owner.componentPropertyDefinitions[key] = { type, defaultValue }; return key;
  };
  owner.editComponentProperty = (key, props) => Object.assign(owner.componentPropertyDefinitions[key], props);
  return owner;
}
const fxFor = (owner, rejected) => ({ comp: async () => owner, track: (n, existing) => { assert.equal(existing, true); if (n === rejected) throw new Error('outside scope'); } });
test('cprops binds repeated layers across all variants and preserves defaults on rerun', async () => {
  const ls = [layer('Label'), layer('Label'), layer('Label')], owner = component([ls.slice(0, 2), ls.slice(2)]);
  const figma = { skipInvisibleInstanceChildren: true };
  await cprops(fxFor(owner), figma, 'Button', { label: { layer: 'Label', value: 'Specified' } });
  assert.equal(figma.skipInvisibleInstanceChildren, true);
  for (const l of ls) assert.deepEqual(l.componentPropertyReferences, { keep: 'existing', characters: 'label#1' });
  ls[0].characters = 'Changed'; ls[2].componentPropertyReferences = {};
  await cprops(fxFor(owner), figma, 'Button', { label: 'Label' });
  assert.equal(owner.componentPropertyDefinitions['label#1'].defaultValue, 'Specified');
  assert.equal(ls[2].componentPropertyReferences.characters, 'label#1');
  await cprops(fxFor(owner), figma, 'Button', { label: { layer: 'Label', value: '' } });
  assert.equal(owner.componentPropertyDefinitions['label#1'].defaultValue, '');
});
test('cprops validates scope and existing property type before any writes', async () => {
  const l = layer('Label'), owner = component([[l]]);
  await assert.rejects(cprops(fxFor(owner, l), {}, 'Button', { label: 'Label' }), /outside scope/);
  assert.deepEqual(owner.componentPropertyDefinitions, {});
  owner.componentPropertyDefinitions['label#1'] = { type: 'BOOLEAN', defaultValue: true };
  await assert.rejects(cprops(fxFor(owner), {}, 'Button', { label: 'Label' }), /existing property.*BOOLEAN/);
  assert.deepEqual(l.componentPropertyReferences, { keep: 'existing' });
});
test('cprops restores hidden traversal setting after errors and preflights later entries', async () => {
  const l = layer('Label'), owner = component([[l]]), figma = { skipInvisibleInstanceChildren: true };
  owner.children[0].findAll = (pred) => { assert.equal(figma.skipInvisibleInstanceChildren, false); return [l].filter(pred); };
  await assert.rejects(cprops(fxFor(owner), figma, 'Button', { label: 'Label', missing: 'Other' }), /no layer/);
  assert.deepEqual(owner.componentPropertyDefinitions, {});
  assert.equal(figma.skipInvisibleInstanceChildren, true);
  owner.children[0].findAll = () => { throw new Error('traversal failed'); };
  await assert.rejects(cprops(fxFor(owner), figma, 'Button', { label: 'Label' }), /traversal failed/);
  assert.equal(figma.skipInvisibleInstanceChildren, true);
});
function textFixture() {
  const a = 'a'.repeat(190), content = a + '\nMixed ending';
  const paints = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 }, boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'v1' } } }, { type: 'IMAGE', imageHash: 'image' }];
  const t = { type: 'TEXT', characters: content, fontSize: Symbol('mixed'), fontName: Symbol('mixed'), textStyleId: Symbol('mixed'), fills: Symbol('mixed'), absoluteBoundingBox: { x: 2, y: 3, width: 50, height: 40 }, getStyledTextSegments: () => [{ start: 0, end: 190, characters: a, fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14, textStyleId: 's1', fills: paints }, { start: 190, end: content.length, characters: content.slice(190), fontSize: 16, textStyleId: 's2', fills: [] }] };
  const root = { id: '2:1', name: 'Screen', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 }, findAllWithCriteria: () => [t] }; t.parent = root;
  return { t, root, content, fx: { node: async () => root }, figma: { getStyleByIdAsync: async (id) => ({ name: id === 's1' ? 'Body (bodyM)' : 'Heading (h2)' }), variables: { getVariableByIdAsync: async () => ({ name: 'Text/Primary' }) } } };
}
test('texts retains long mixed content, full style names, all paints and token bindings', async () => {
  const f = textFixture(), out = await texts(f.fx, f.figma, 'Screen');
  assert.ok(out.includes('a'.repeat(190)));
  assert.ok(out.includes('Mixed ending'));
  assert.ok(out.includes('Body (bodyM)'));
  assert.ok(out.includes('Heading (h2)'));
  assert.ok(out.includes('Text/Primary'));
  assert.ok(out.includes('"imageHash":"image"'));
  assert.ok(out.includes('"start":190'));
  assert.ok(!out.includes('preview'));
});
test('texts marks explicit previews and includes root TEXT itself', async () => {
  const f = textFixture();
  assert.match(await texts(f.fx, f.figma, 'Screen', { text: 10 }), /preview: omitted \d+ characters/);
  f.fx.node = async () => f.t; f.t.id = '2:2'; f.t.name = 'Label';
  assert.match(await texts(f.fx, f.figma, 'Label'), /1 texts/);
});
test('large texts export roundtrips every UTF8 character through actual kit pages', async () => {
  const f = textFixture();
  f.t.characters = 'Япония 🗾\n'.repeat(4000) + 'FINAL';
  f.t.getStyledTextSegments = () => [{ start: 0, end: f.t.characters.length, characters: f.t.characters, fontName: { family: 'Inter', style: 'Regular' }, fontSize: 14, textStyleId: 's1', fills: [] }];
  const kit = new Function('figma', fs.readFileSync(new URL('../kit/kit.js', import.meta.url), 'utf8') + '\nreturn fx;')({});
  f.fx.pages = kit.pages;
  let page = await texts(f.fx, f.figma, 'Screen');
  assert.equal(page.__fx, 'fragment');
  assert.equal(page.opts.recipe, 'texts');
  const fragments = [], parts = page.parts;
  for (let part = 1; part <= parts; part++) {
    page = await texts(f.fx, f.figma, 'Screen', { part });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 18000);
    fragments.push(page.fragment.data);
  }
  const capture = JSON.parse(fragments.join(''));
  assert.equal(capture.__fx, 'big');
  assert.ok(capture.items.join('\n').includes('FINAL'));
  const data = JSON.parse(capture.items[0].slice(capture.items[0].lastIndexOf(' | ') + 3));
  assert.equal(data.characters, f.t.characters);
  assert.equal(data.runs[0].characters, f.t.characters);
});
