// Loaded inside functions.exec with new Function('tools', source + '; return figmaLean;')(tools).
// Build and ingest stay inside the tool script; the model sees only the compact result.
async function figmaLean(request) {
  const quote = (s) => "'" + String(s).replace(/'/g, "'\"'\"'") + "'";
  const command = request.cli ? quote(request.cli) : '"${CODEX_HOME:-$HOME/.codex}/skills/figma-lean/tools/fx.mjs"';
  const env = request.dataHome ? 'FIGMA_LEAN_HOME=' + quote(request.dataHome) : 'FIGMA_LEAN_HOME="${FIGMA_LEAN_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/figma-lean}"';
  const cli = async (action, payload) => {
    const runCommand = async (cmd, budget = 40000) => {
      let run = await tools.exec_command({cmd, max_output_tokens: budget, yield_time_ms: 1000}), output = run.output;
      while (run.session_id && run.exit_code === undefined) {
        run = await tools.write_stdin({session_id: run.session_id, chars: '', yield_time_ms: 1000, max_output_tokens: budget});
        output += run.output;
      }
      if (run.exit_code !== 0) throw new Error('figma-lean ' + action + ' failed: ' + output);
      return output;
    };
    const input = JSON.stringify(payload); let temp = null;
    try {
      let pipe;
      if (input.length <= 40000) pipe = "printf '%s' " + quote(input) + ' | ';
      else {
        // Bound shell arguments even for large DS searches; no media or raw output is echoed.
        const candidate = (await runCommand("node -e 'console.log(require(\"node:fs\").mkdtempSync(require(\"node:path\").join(require(\"node:os\").tmpdir(),\"figma-lean-bridge-\")))'", 1000)).trim();
        if (!/^\/[^\n]+\/figma-lean-bridge-[A-Za-z0-9_-]+$/.test(candidate)) throw new Error('figma-lean: invalid temporary path');
        temp = candidate;
        for (let i = 0; i < input.length;) {
          let end = Math.min(i+12000,input.length);
          if (end < input.length && /[\uD800-\uDBFF]/.test(input[end-1])) end--;
          await runCommand("printf '%s' " + quote(input.slice(i,end)) + (i ? ' >> ' : ' > ') + quote(temp+'/input.json'), 1000);
          i = end;
        }
        pipe = '';
      }
      const output = await runCommand(pipe + env + ' node ' + command + ' ' + action + (temp ? ' < '+quote(temp+'/input.json') : ''));
      try { return JSON.parse(output); } catch { throw new Error('figma-lean ' + action + ': invalid or truncated JSON output'); }
    } finally {
      if (temp) await runCommand('node -e '+quote("require('node:fs').rmSync(process.argv[1],{recursive:true,force:true})")+' '+quote(temp), 1000);
    }
  };
  const operation = request.operation || 'use_figma';
  const names = { use_figma: 'mcp__codex_apps__figma_use_figma', search_design_system: 'mcp__codex_apps__figma_search_design_system', get_libraries: 'mcp__codex_apps__figma_get_libraries' };
  if (!names[operation]) throw new Error('figma-lean: unsupported operation ' + operation);
  if (typeof request.fileKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(request.fileKey)) throw new Error('figma-lean: fileKey required');
  const input = operation === 'use_figma' ? await cli('prepare', request) : { ...(request.args || {}), fileKey: request.fileKey };
  const raw = await tools[names[operation]](input);
  if (raw.isError) return raw;
  // Inline media must not travel through a shell argument or be printed as base64.
  const output = raw.content ? { ...raw, content: raw.content.map((b, i) => b.type === 'image' || b.type === 'audio' ? { type: b.type, __figmaLeanMediaIndex: i } : b) } : raw;
  try {
    const result = await cli('ingest', { toolName: operation, fileKey: request.fileKey, code: request.code || '', session: request.session, output });
    if (result.output && Array.isArray(result.output.content)) result.output.content = result.output.content.map((b) => Number.isInteger(b.__figmaLeanMediaIndex) ? raw.content[b.__figmaLeanMediaIndex] : b);
    return result.output;
  } catch (error) {
    // The remote call already ran: preserve its result, warn, and never retry a write here.
    return { ...raw, content: [...(raw.content || []), { type: 'text', text: 'figma-lean cache processing failed; original Figma result preserved. ' + error.message }] };
  }
}
