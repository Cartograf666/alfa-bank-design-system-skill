# fx kit API

Generated from kit/kit.js by `node tools/fx.mjs docs`. Do not edit by hand.

- `fx.pages(id, title, lines, {part=1})` → lossless paged text capture saved by the host tools; request every part to complete large exports.
- `fx.node(id)` → node. Accepts "1:2", "1-2" or a node; switches to the node's page when needed.
- `fx.line(id)` → one-line summary of a node (same format as a dump row).
- `fx.dump(id, {depth=3, into=false, max=250, kids=40, text=60, full=false})` → compact text tree, one node per row. `into` descends into instances; `full` lifts the row cap and the hook saves the tree to disk, showing only its head (large trees come in parts: follow the "Next:" call in the reply).
  row: id TYPE "name" WxH [@x,y] [AL:…] [→component {props}] [text style] [fill= st= r fx] «text». Size suffix: h = hug, f = fill. S:/V:/E: = style / variable / effect style name.
- `fx.find(root, 'name part' | /re/ | {name, type, text, q:'CSS-like selector'}, {max=40, into=false})` → matching nodes as "id TYPE name WxH ‹path›" rows. Layers inside instances are skipped unless `into` (or root is itself an instance).
- `fx.get(id, 'fills,layoutMode,parent.name')` → raw property values by dot path (nodes become ids, mixed becomes "mixed"). For the rare property a dump row does not show.
- `fx.scan()` → file level: pages + local variables and styles. fx.scan(pageOrSectionId, {maxInst=1500, maxNodes=6000, nested=false}) → structure, components with properties, library components / variables / styles in use. The hook stores the result in the file map and the DS registry; the digest comes back in its place (after a rescan, only its changed lines), and anything else the script returns next to it is kept. Not together with a screenshot in one script. A large result arrives in parts: when the reply says "part 1/N", send the call it prints for each remaining part (they may go in parallel).
- `fx.lib()` → lists the library variable collections Figma exposes for the file. fx.lib('part of a collection or library name' | '*') → captures all their variables (name → key) into the DS registry. Some files expose none; then tokens are learned from scans and search_design_system instead.
- `fx.check(id, {into=false, max=40})` → heuristic structural QA; visual inspection is still required: collapsed nodes, children overflowing or clipped by their parent, partial overlaps of free-positioned siblings, missing fonts, fixed text boxes, placeholder shimmer left on, variant conflicts; plus counts of raw colors / raw text styles (not bound to a token) and default layer names.
- `fx.shot(id, {max=1024, scale})` → inline screenshot of one node, scaled so its long side is about 800px (small nodes are enlarged up to 2x, large ones shrunk) and never above `max`.
- `fx.comp(ref)` → component or component-set node. ref = node id | name from the file map (local; a component created since the last scan is found by name on the current page) or the DS registry (library) | '#keyprefix' as printed by search results and `fx.mjs ds` | 40-char key. The same refs work for variables and styles.
- `fx.props(instance, {size:'48', label:'Text', icon:true, slot:'Icon name'})` → sets component properties by case-insensitive name without the "#id" suffix; variants first, then the rest; fonts are loaded; an INSTANCE_SWAP value is any fx.comp ref.
- `fx.inst(ref, parent, {props, name, index, x, y})` → new instance of a local or library component (ref as in fx.comp) appended to parent.
- `fx.clone(src, parent, {name, index, x, y})` → copy of a node placed into parent (the way to reuse an existing instance or frame as is).
- `fx.text(textNode, 'chars') | fx.text(parent, {'layer name': 'chars', …})` → sets text with fonts loaded; in the map form each key is the name of a text layer inside parent.
- `fx.v(name)` → Variable: local by name, else library by name through the DS registry (imported by key).
- `fx.bind(node, {fill, stroke, gap, pad, padX, padY, radius, <any bindable field>: 'variable name'})` → binds tokens. Paints preserve other layers; multiple solid paints require {variable:'name', index:0}. Non-solid paints are never replaced implicitly.
- `fx.style(node, {text, fill, stroke, effect: 'style name'})` → applies local or library styles by name. When several library styles share the name, a text style whose font cannot be loaded is skipped for the next one.
- `fx.wrap(node, {name, desc})` → turns a frame into a component in place. fx.variants([ids], {name, parent}) → combines components into a component set.
- `fx.rm(id)` → removes a node (scope-checked).
- `fx.track(node, existing=false)` → registers a node created (or, with `existing`, changed) with the raw Plugin API so that fx.done() reports and checks it (also scope-checks it).
- `fx.done(...nodes)` → closing report for a writing script: ids created / changed by the helpers plus fx.check of every top-level touched node (or of the nodes given). Return all created/changed IDs in a structured object and include this compact report as its `qa` field.
