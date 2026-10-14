#!/usr/bin/env node
// figma-lean hook (registered by the skill's frontmatter, active once the skill is invoked).
// PreToolUse  use_figma: prepends the kit, the file's scope and the resolved component / token keys to scripts that mention `fx`.
// PostToolUse use_figma: stores scan / library / full-dump captures on disk and shows the model only a short summary.
// PostToolUse search_design_system / get_libraries: records keys and library names in the DS registry and compacts the result.
// Preflight errors deny unsafe scripts; postprocessing errors are logged and shown with the raw result preserved.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, USER_MARK, MAX_CODE, append, now, buildScript, processToolOutput } from './lib.mjs';

const AsyncFunction = (async () => {}).constructor;
const out = (o) => process.stdout.write(JSON.stringify(o));
const stat = (o) => append(path.join(HOME, 'log', 'stats.jsonl'), JSON.stringify({ at: now(), ...o }) + '\n');

function pre(input) {
  const ti = input.tool_input || {}, code = ti.code || '';
  if (!/\bfx\s*\./.test(code) || code.includes(USER_MARK)) return;
  try { new AsyncFunction(code); } catch (e) {
    return out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'fx: the script does not parse, nothing was sent to Figma: ' + e.message } });
  }
  let full;
  try { full = buildScript(ti.fileKey, code); } catch (e) { return out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: e.message } }); }
  if (full.length > MAX_CODE) {
    return out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `fx: script is ${code.length} chars; with the kit it exceeds the ${MAX_CODE} limit of use_figma. Split it into smaller calls.` } });
  }
  append(path.join(HOME, 'log', 'calls.jsonl'), JSON.stringify({ at: now(), id: input.tool_use_id, s: input.session_id, fileKey: ti.fileKey, description: ti.description, code }) + '\n');
  out({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...ti, code: full } } });
}

function post(input) {
  const ti = input.tool_input || {}, short = (input.tool_name || '').split('__').pop();
  if (!['use_figma', 'search_design_system', 'get_libraries'].includes(short)) return;
  const original = input.tool_output ?? input.tool_response;
  const result = processToolOutput({ toolName: short, fileKey: ti.fileKey, output: original });
  stat({ s: input.session_id, tool: short, out: JSON.stringify(original)?.length || 0, shown: JSON.stringify(result.output)?.length || 0, tok: input.tool_output_tokens });
  if (result.changed) out({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedMCPToolOutput: result.output } });
}

let raw = '', eventName;
for await (const chunk of process.stdin) raw += chunk;
try {
  const input = JSON.parse(raw);
  eventName = input.hook_event_name;
  if (fs.existsSync(path.join(HOME, 'debug'))) append(path.join(HOME, 'log', 'debug.jsonl'), JSON.stringify(input, (k, v) => (typeof v === 'string' && v.length > 3000 ? v.slice(0, 3000) + `…[${v.length}]` : v)) + '\n');
  if (input.hook_event_name === 'PreToolUse' && (input.tool_name || '').endsWith('__use_figma')) pre(input);
  else if (input.hook_event_name === 'PostToolUse') post(input);
} catch (e) {
  try { append(path.join(HOME, 'log', 'errors.log'), `${now()} ${e && e.stack ? e.stack : e}\n`); } catch {}
  if (eventName === 'PreToolUse') out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `fx: script preparation failed; nothing was sent to Figma: ${e.message}` } });
  else out({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `fx: output was not ingested: ${e.message}. Previous complete state was preserved; inspect the raw result and retry the scan.` } });
}
