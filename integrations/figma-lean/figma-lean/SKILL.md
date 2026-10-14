---
name: figma-lean
description: Reuse Figma Plugin API helpers, persistent file maps and design-system asset keys for repeated Figma inspection and editing in Claude Code. Supplement the official figma-use skill and preserve the project's design system.
hooks:
  PreToolUse:
    - matcher: "mcp__.*__use_figma"
      hooks:
        - type: command
          command: 'node "$HOME/.claude/skills/figma-lean/tools/hook.mjs"'
          timeout: 20
  PostToolUse:
    - matcher: "mcp__.*__(use_figma|search_design_system|get_libraries)"
      hooks:
        - type: command
          command: 'node "$HOME/.claude/skills/figma-lean/tools/hook.mjs"'
          timeout: 20
---

# figma-lean

Библиотека `fx` подставляется хуком перед `use_figma`, карта файла и реестр ассетов сохраняются на диске. Агенту не нужно заново генерировать готовые операции или читать весь файл. Это не гарантирует конкретную экономию токенов/денег и не меняет разрешённую пользователем область работы.

Это инструкция для Claude Code. Для Codex используйте `install-codex.mjs` и отдельную инструкцию из `codex/SKILL.md`; хуки Claude напрямую туда не переносите.

## Порядок работы

1. Перед каждым `use_figma` загрузите установленный официальный `figma-use` и соблюдайте его текущие ограничения. `skillNames: "figma-use"` передавайте по его инструкции. Кит дополняет, а не заменяет официальный навык.
2. Сначала `node ~/.claude/skills/figma-lean/tools/fx.mjs map -f FILE_KEY`. Карта — кэш, а не текущая истина о Figma. При внешних изменениях, ошибке ID или изменении структуры пересканируйте нужную секцию.
3. Карты нет: `return await fx.scan()` и затем `return await fx.scan('PAGE_OR_SECTION')`. Следуйте напечатанным `Next:` до конца. Полная прежняя карта сохраняется до завершения нового скана; смена snapshot требует начать скан заново.
4. Читайте нужный фрагмент: `find` / `comp` с диска → `fx.dump(id)` → `fx.get(id, 'property')`. `into:true` раскрывает внутренности экземпляра; включайте для нужного узла. Для переноса дизайна в код используйте официальный design-to-code workflow.
5. Перед согласованными правками задайте корень: `fx.mjs scope ROOT_ID -f FILE_KEY`. Команда без ROOT_ID показывает текущее ограничение; сама ничего не ограничивает. `--clear` снимает его. Scope проверяет хелперы, но не изолирует произвольный Plugin API-код.
6. Создавайте экземпляры с явным родителем. При ручных операциях соблюдайте область до изменения; `fx.track(node,true)` после мутации не может её отменить.
7. Возвращайте структурированный объект со **всеми** ID: `return {createdIds:[...new Set(fx.__made.map(n=>n.id))], changedIds:[...new Set(fx.__changed.map(n=>n.id))], qa:await fx.done(CONTAINER_ID)}`. Это сохраняет официальный контракт figma-use. Обработчик кладёт полный объект в `files/FILE_KEY/writes/`, в кратком результате остаются счётчики и путь. `fx.done` отдельно не заменяет полный возврат ID. Работайте небольшими логическими партиями, чтобы полный ответ укладывался в лимит инструмента; ручные изменения регистрируйте. QA проверяет затронутые контейнеры и отмечает непроверенные.
8. После структурных изменений пересканируйте затронутую секцию. `fx.mjs note "…"` сохраняет решения; различайте предложения и принятую пользователем договорённость.

## Ассеты и токены

`fx.mjs ds QUERY` / `comp QUERY` ищут на диске. Нет нужного ассета — используйте `search_design_system`, затем повторно используйте сохранённый ключ. Подключённые библиотеки запоминаются через `get_libraries`.

Приоритет имён: ключ без известной ошибки для этого файла → неустаревший ассет → подключённая библиотека → использование в файле → количество использований. Этот порядок заменяет первоначальную эвристику, ставившую любое старое использование выше подключённой библиотеки. Для точного выбора используйте `#префикс` или полный ключ. Не позволяйте эвристике переопределять систему проекта.

Если импорт ключа не удался, кит пробует резервные кандидаты и главный компонент существующего экземпляра. После успешного fallback нерабочие ключи понижаются в реестре этого файла. Если вызов завершился исключением, телеметрия может не вернуться: выберите явный исправный ключ. Новый результат поиска снимает отметку ошибки.

`fx.bind` сохраняет остальные paints. Если подходящих SOLID-слоёв несколько, задайте `{fill: {variable:'token/name', index:0}}`. Неподходящую заливку хелпер не заменяет молча. Пустая заливка допускает создание SOLID-слоя.

Alfa-specific названия и соответствия коду — в [references/core-ds.md](references/core-ds.md). Применяйте только в core-ds проектах. Для остальных систем используйте их реальные библиотеки, стили и токены.

## Проверка результата

`fx.check` — эвристическая структурная проверка с ограничениями обхода; `fx.done` также сообщает, что не было проверено. Отсутствие ошибок не доказывает визуальную корректность.

После изменения композиции, переноса текста, цвета, читаемости или неоднозначного результата используйте `fx.shot(id)` и проверьте изображение. Техническая проверка и визуальная приёмка пользователя различаются. Не объединяйте scan/lib и screenshot в один вызов: инструмент может возвращать изображение вместо capture.

## API

<!-- kit:start -->
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
<!-- kit:end -->

## Рецепты и восстановление

`recipe ls` / `recipe show NAME` показывают установленные рецепты; `recipe save NAME` сохраняет исходный скрипт последнего вызова. Подставляются и вложенные рецепты, имена токенов разрешаются по их исходникам.

`fx.r.cprops(component, specs)` связывает все совпавшие слои вариантов, проверяет типы до изменений и повторно связывает существующие свойства. Без явного `value` сохраняет существующее значение по умолчанию. `fx.r.texts(root, opts)` сохраняет полный текст и смешанные стили. Только явные `max`/`text` включают помеченный preview. Крупный экспорт приходит частями; продолжайте именно напечатанным вызовом рецепта.

`fx is not defined`: хук не активен — вызовите навык или соберите скрипт через `fx.mjs build script.js -f FILE_KEY`. Подготовка проверяет синтаксис и лимит 50 000 символов. Ошибка подготовки запрещает вызов, ошибка обработки ответа сохраняет исходный результат и предупреждает; удалённую правку автоматически не повторяйте.

`fx.mjs doctor` проверяет локальную механику, а `stats` показывает символы, не реальные токены или стоимость. Для известных границ см. [references/known-issues.md](references/known-issues.md), для устройства — [references/internals.md](references/internals.md).
