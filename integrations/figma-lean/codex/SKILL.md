---
name: figma-lean
description: Reuse a compact Figma Plugin API library, file maps and design-system asset keys for repeated Figma inspection and editing through the official Figma tool. Use when working in an existing Figma file; keep the project's design system authoritative.
---

# Figma Lean for Codex

Use the existing Figma plugin with deterministic helpers and a local cache. This skill does not grant permission to edit a file or replace the project's design system. The Alfa core-ds reference applies only to projects that actually use it.

Before every `use_figma` call, load the installed **figma:figma-use** skill and follow its current API restrictions. This helper supplements that skill. No Claude hooks are installed: Codex does not support Claude's `updatedMCPToolOutput` behavior.

## Run without copying the library into the model context

Use `functions.exec` to load the reviewed bridge and call the official tool. The bridge returns an ordinary MCP result. Only print its text and emit its media; never print the compiled library or media base64.

```js
const source = await tools.exec_command({cmd: "cat '__SKILL_ROOT__/tools/codex-bridge.js'", max_output_tokens: 8000});
if (source.exit_code !== 0) throw new Error(source.output);
const lean = new Function('tools', source.output + '\nreturn figmaLean;')(tools);
const result = await lean({fileKey: 'FILE_KEY', description: 'Inspect the requested section', code: "return await fx.dump('NODE_ID')", skillNames: 'figma-use', cli: '__SKILL_ROOT__/tools/fx.mjs', dataHome: '__DATA_HOME__'});
for (const block of result.content || []) {
  if (block.type === 'image') image(block);
  else if (block.type === 'audio') audio(block);
  else if (block.type === 'text') text(block.text);
}
```

The placeholders in this example are task inputs, not real files or nodes. The bridge performs one remote call, caches/compacts its result and preserves inline media. A postprocessing error preserves the original result with a warning; it never retries a write automatically.

## File workflow

- Use `FIGMA_LEAN_HOME='__DATA_HOME__' node '__SKILL_ROOT__/tools/fx.mjs' map -f FILE_KEY` to check the saved map first. It is a cache, not live Figma state. After concurrent edits, missing IDs or changed structure, scan the relevant section again.
- No map: run `return await fx.scan()` and `return await fx.scan('PAGE_OR_SECTION')` through the bridge. Follow each `Next:` call until complete. The last complete map stays usable while a new scan is pending; mismatched snapshots must be restarted.
- Resolve assets from `ds QUERY` / `comp QUERY` before searching again. For a search or library listing, use the same bridge with `operation: 'search_design_system'` or `'get_libraries'`, `fileKey` and `args` matching that tool's current schema. Inspect its schema before constructing `args`.
- Before authorized writes, set the allowed root with `scope ROOT_ID -f FILE_KEY`. The scope guards helper operations; raw Plugin API code remains the caller's responsibility. Include an explicit parent when creating an instance. Do not claim scope is a security sandbox.
- Finish writes with the structured return below: official `figma-use` requires **all** created/changed IDs. `fx.done` is only the compact QA field; it cannot replace this ID contract. The processor saves the complete object locally and returns counts plus its path. Keep a logical write batch small enough for the tool's output limit. Register raw Plugin API changes through `fx.track` and return their IDs too.
- After structural edits, rescan the affected section. Cache notes can record task decisions; distinguish proposals from accepted decisions. No automatic copying of rules between projects.

For helper signatures read [references/kit.md](references/kit.md). For recipes, inspect `recipe ls` / `recipe show NAME`; installed recipes are in `__DATA_HOME__/recipes/`. Long text exports use paging; follow their printed recipe calls to complete the export. For actual limitations read [references/known-issues.md](references/known-issues.md). Read [references/core-ds.md](references/core-ds.md) only for Alfa core-ds files.

```js
return {
  createdIds: [...new Set(fx.__made.map(n => n.id))],
  changedIds: [...new Set(fx.__changed.map(n => n.id))],
  qa: await fx.done('CONTAINER_ID')
};
```

Default QA also checks affected parent containers. It remains heuristic: inspect a screenshot for changed composition, wrapping, readability, colors or uncertain results. A text report is not visual acceptance.

## Checks

`FIGMA_LEAN_HOME='__DATA_HOME__' node '__SKILL_ROOT__/tools/fx.mjs' doctor` checks the local library and integration fixtures. It does not prove Figma access or a live runtime round trip. `stats` reports characters, not measured tokens, billed savings or visual quality. A new chat may be needed for discovery after installation.
