// args: root, opts
// desc: visible text with full content, style names, paints/token bindings and mixed-style runs. opts = {max: row limit, text: explicit preview character limit, part: large export page}; preview omissions are marked. No content is shortened by default.
const o = opts || {};
const n = await fx.node(root), b0 = n.absoluteBoundingBox;
if (!b0) throw new Error('fx.r.texts: root has no bounds');
for (const k of ['max', 'text']) if (o[k] !== undefined && (!Number.isInteger(o[k]) || o[k] < 1)) throw new Error('fx.r.texts: ' + k + ' must be a positive integer');
const styles = {}, vars = {};
const styleName = async (id) => {
  if (!id || typeof id !== 'string') return '';
  if (!(id in styles)) { const st = await figma.getStyleByIdAsync(id); styles[id] = st ? st.name : ''; }
  return styles[id];
};
const bindings = async (value) => {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return await Promise.all(value.map(bindings));
  const out = {};
  for (const k of Object.keys(value)) out[k] = await bindings(value[k]);
  if (value.type === 'VARIABLE_ALIAS' && value.id) {
    if (!(value.id in vars)) { const v = await figma.variables.getVariableByIdAsync(value.id); vars[value.id] = v ? v.name : ''; }
    out.name = vars[value.id];
  }
  return out;
};
const details = async (t) => {
  const out = {};
  for (const k of ['start', 'end', 'characters', 'fontSize', 'fontName', 'fontWeight', 'textStyleId', 'fillStyleId', 'fills', 'boundVariables', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'hyperlink']) {
    if (t[k] !== undefined && typeof t[k] !== 'symbol') out[k] = await bindings(t[k]);
  }
  if (typeof t.textStyleId === 'string') out.textStyleName = await styleName(t.textStyleId);
  if (typeof t.fillStyleId === 'string') out.fillStyleName = await styleName(t.fillStyleId);
  return out;
};
const rows = [];
const texts = n.type === 'TEXT' ? [n] : n.findAllWithCriteria({ types: ['TEXT'] });
for (const t of texts) {
  let visible = true;
  for (let a = t; a; a = a.parent) { if (a.visible === false) { visible = false; break; } if (a === n) break; }
  const b = t.absoluteBoundingBox;
  if (!visible || !b || !t.characters.trim()) continue;
  const data = await details(t);
  if (typeof t.getStyledTextSegments === 'function') {
    const segments = t.getStyledTextSegments(['fontSize', 'fontName', 'fontWeight', 'textStyleId', 'fillStyleId', 'fills', 'lineHeight', 'letterSpacing', 'textDecoration', 'textCase', 'hyperlink']);
    if (segments.length > 1 || ['fontSize', 'fontName', 'textStyleId', 'fillStyleId', 'fills'].some((k) => typeof t[k] === 'symbol')) data.runs = await Promise.all(segments.map(details));
  } else if (['fontSize', 'fontName', 'textStyleId', 'fillStyleId', 'fills'].some((k) => typeof t[k] === 'symbol')) data.runsUnavailable = true;
  let content = t.characters;
  if (o.text && content.length > o.text) {
    content = content.slice(0, o.text) + '… [preview: omitted ' + (content.length - o.text) + ' characters]';
    data.preview = true;
    delete data.characters;
    // Preview limits apply to the display, while runs retain their original offsets/content.
  }
  const size = typeof t.fontSize === 'number' ? t.fontSize : '?';
  const weight = t.fontName && t.fontName.style ? t.fontName.style : 'mixed';
  rows.push({ y: Math.round(b.y - b0.y), x: Math.round(b.x - b0.x), width: Math.round(b.width), size, weight, style: await styleName(t.textStyleId), content, data });
}
rows.sort((a, b) => a.y - b.y || a.x - b.x);
const selected = o.max ? rows.slice(0, o.max) : rows;
const out = selected.map((r) => r.y + ' ' + r.x + ' ' + r.width + ' | ' + r.size + ' ' + r.weight + ' | ' + r.style + ' | «' + r.content.replace(/\n/g, '⏎') + '» | ' + JSON.stringify(r.data));
if (rows.length > selected.length) out.push('… [preview: omitted ' + (rows.length - selected.length) + ' rows; remove max to retrieve all]');
const title = n.id + ' ' + n.name + ' ' + Math.round(b0.width) + 'x' + Math.round(b0.height) + ' — ' + rows.length + ' texts';
const result = title + '\n' + out.join('\n');
let bytes = 0;
for (const ch of result) { const cp = ch.codePointAt(0); bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }
if (bytes > 16000 || o.part !== undefined) {
  if (typeof fx.pages !== 'function') throw new Error('fx.r.texts: large exports require the updated kit with fx.pages');
  return fx.pages(n.id, title, out, Object.assign({}, o, { recipe: 'texts' }));
}
return result;
