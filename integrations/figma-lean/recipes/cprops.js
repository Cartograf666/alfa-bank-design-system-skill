// args: comp, map
// desc: component properties from every matching layer in every variant. map = {prop: 'layer' | {layer, type: 'TEXT'|'BOOLEAN'|'INSTANCE_SWAP'|'EXPOSE', value}}; validates before changing, preserves existing defaults unless value is supplied, safe to run again
const c = await fx.comp(comp);
const owner = c.type === 'COMPONENT' && c.parent && c.parent.type === 'COMPONENT_SET' ? c.parent : c;
if (owner.type !== 'COMPONENT' && owner.type !== 'COMPONENT_SET') throw new Error('fx.r.cprops: ' + owner.name + ' is not a component (use fx.wrap first)');
fx.track(owner, true);
const variants = owner.type === 'COMPONENT_SET' ? owner.children.filter((v) => v.type === 'COMPONENT') : [owner];
const FIELD = { TEXT: 'characters', BOOLEAN: 'visible', INSTANCE_SWAP: 'mainComponent' };
const plans = [];
for (const name of Object.keys(map)) {
  const spec = typeof map[name] === 'string' ? { layer: map[name] } : map[name];
  let hits;
  const skip = figma.skipInvisibleInstanceChildren;
  try {
    if (typeof skip === 'boolean') figma.skipInvisibleInstanceChildren = false;
    hits = variants.map((v) => v.findAll((n) => n.name === spec.layer));
  } finally {
    if (typeof skip === 'boolean') figma.skipInvisibleInstanceChildren = skip;
  }
  const layers = hits.flat(), first = layers[0];
  if (!first) throw new Error('fx.r.cprops: no layer ' + JSON.stringify(spec.layer) + ' in ' + owner.name);
  const type = spec.type || (first.type === 'TEXT' ? 'TEXT' : 'BOOLEAN');
  if (type !== 'EXPOSE' && !FIELD[type]) throw new Error('fx.r.cprops: unknown type ' + type);
  for (const h of layers) {
    fx.track(h, true);
    if ((type === 'TEXT' && h.type !== 'TEXT') || ((type === 'INSTANCE_SWAP' || type === 'EXPOSE') && h.type !== 'INSTANCE')) throw new Error('fx.r.cprops: ' + spec.layer + ' has incompatible layer type ' + h.type + ' for ' + type);
  }
  const key = Object.keys(owner.componentPropertyDefinitions).find((k) => k.split('#')[0] === name);
  if (type !== 'EXPOSE' && key && owner.componentPropertyDefinitions[key].type !== type) throw new Error('fx.r.cprops: existing property ' + name + ' has type ' + owner.componentPropertyDefinitions[key].type + ', requested ' + type);
  let value = spec.value;
  if (type !== 'EXPOSE') {
    if (value === undefined && !key) value = type === 'TEXT' ? first.characters : type === 'BOOLEAN' ? first.visible : (await first.getMainComponentAsync())?.id;
    if (value !== undefined && ((type === 'BOOLEAN' && typeof value !== 'boolean') || (type !== 'BOOLEAN' && typeof value !== 'string'))) throw new Error('fx.r.cprops: invalid default for ' + name);
    if (!key && value === undefined) throw new Error('fx.r.cprops: no default for ' + name);
  }
  plans.push({ name, spec, type, key, value, layers, missing: variants.filter((v, i) => !hits[i].length).map((v) => v.name) });
}
const out = [];
for (const p of plans) {
  if (p.type === 'EXPOSE') {
    for (const h of p.layers) h.isExposedInstance = true;
  } else {
    let key = p.key;
    if (!key) key = owner.addComponentProperty(p.name, p.type, p.value);
    else if (p.value !== undefined && owner.componentPropertyDefinitions[key].defaultValue !== p.value) owner.editComponentProperty(key, { defaultValue: p.value });
    for (const h of p.layers) h.componentPropertyReferences = Object.assign({}, h.componentPropertyReferences, { [FIELD[p.type]]: key });
  }
  out.push(p.name + ':' + (p.type === 'EXPOSE' ? 'exposed' : p.type[0]) + ' ← ' + p.spec.layer + (p.missing.length ? ' (not in: ' + p.missing.join(', ') + ')' : ''));
}
return owner.id + ' ' + owner.name + ' — ' + out.join('; ');
