#!/usr/bin/env node
// PostToolUse hook: compress large MCP tool results before they enter the model's
// context. A thin wrapper over scripts/json-slim.cjs — the shape-driven compressor
// (ADF→md, noise-drop, long-string truncate, same-shape-array crush) validated in M1.
//
// Contract (Claude Code ≥ 2.1.191, verified against live docs 2026-07-19):
//   in  — PostToolUse event JSON on stdin; the tool result is `tool_response`
//         (older builds/docs: `tool_output`). For MCP tools it is the CallToolResult:
//         a string, a `{type:'text',text}` block, an array of such blocks, or
//         `{content:[…],isError?}`. We MIRROR whatever shape arrives.
//   out — `hookSpecificOutput.updatedToolOutput` (hookEventName `PostToolUse`) REPLACES
//         the result. Print nothing → the original passes through untouched.
//
// Safety rails (any doubt → emit nothing, original survives):
//   - MCP error results (`isError:true`) and per-block error envelopes are never touched
//     — write-gating elsewhere reads them verbatim (json-slim guards the envelope too);
//   - the recovery handle is attached only to a block we actually COMPRESSED, never to a
//     verbatim-preserved error block;
//   - size gate: results ≤ 4 KB pass through;
//   - the ORIGINAL whole result is spilled to a file and referenced as `full=<path>` —
//     the recovery net for json-slim's lossy noise/truncate stages, which don't
//     self-spill (its array crush spills each array on its own). If that spill can't be
//     written, the result passes through UNCOMPRESSED (never a lossy result with no
//     recovery path);
//   - any parse/transform failure → passthrough.
//
// Env: FND_MCP_SLIM (gated in plugin.json — node never spawns when 0);
//      FND_MCP_SLIM_DIR (spill directory, shared with json-slim; default os.tmpdir());
//      FND_MCP_SLIM_TTL (hours a spill survives before the exit-time sweep prunes it; default 24);
//      FND_MCP_SLIM_DEBUG (opt-in: one JSONL trace line per invocation to fnd-mcp-slim-debug.log).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slim, sweepSpills, spillRoot, debugLog, debugEnabled } = require('../scripts/json-slim.cjs');

const GATE_BYTES = 4096; // only results larger than this are worth compressing

// Slim one text payload. Error envelope / non-JSON / no byte gain → original unchanged. `reason`
// (null when modified) names the passthrough branch for the debug log; `stages` = the slim stages
// that changed bytes (only populated when `trace`, i.e. FND_MCP_SLIM_DEBUG is on).
function slimText(text, trace) {
  let res;
  try {
    res = slim(text, { trace });
  } catch (_) {
    return { text, modified: false, reason: 'transform-error', stages: [] };
  }
  if (res.error) return { text, modified: false, reason: 'error-shape', stages: [] }; // error shape: verbatim
  if (!res.wasModified || res.bytesOut >= res.bytesIn) {
    return { text, modified: false, reason: res.reason || 'no-gain', stages: res.stages || [] };
  }
  return { text: res.output, modified: true, reason: null, stages: res.stages || [] };
}

// Slim every text block in an MCP content array, preserving non-text and verbatim blocks
// byte-for-byte. `markIndex` = the last block we actually compressed (-1 if none), so the
// recovery handle never lands on a verbatim-preserved error block. `reason` (unmodified case) is
// the first non-modifying block reason; `stages` is the union across compressed blocks.
function slimBlocks(blocks, trace) {
  let modified = false;
  let markIndex = -1;
  let reason = null;
  const stages = [];
  const out = blocks.map((b, i) => {
    if (b && typeof b === 'object' && typeof b.text === 'string') {
      const r = slimText(b.text, trace);
      if (r.modified) {
        modified = true;
        markIndex = i;
        for (const s of r.stages) if (!stages.includes(s)) stages.push(s);
        return { ...b, text: r.text };
      }
      if (reason === null) reason = r.reason;
    }
    return b; // non-text or unchanged → untouched
  });
  return { blocks: out, modified, markIndex, reason: modified ? null : (reason || 'no-gain'), stages };
}

// Slim a tool result, mirroring its shape. Returns a descriptor for attachMarker (+ reason/stages
// for the debug log). `trace` (= debug on) gates the per-stage `stages` bookkeeping in slim().
function slimResult(result, trace) {
  if (typeof result === 'string') {
    const r = slimText(result, trace);
    return { value: r.text, modified: r.modified, kind: 'string', reason: r.reason, stages: r.stages };
  }
  if (Array.isArray(result)) {
    const r = slimBlocks(result, trace);
    return { value: r.blocks, modified: r.modified, kind: 'array', markIndex: r.markIndex, reason: r.reason, stages: r.stages };
  }
  if (result && typeof result === 'object') {
    if (Array.isArray(result.content)) {
      const r = slimBlocks(result.content, trace);
      return { value: { ...result, content: r.blocks }, modified: r.modified, kind: 'content', markIndex: r.markIndex, reason: r.reason, stages: r.stages };
    }
    if (typeof result.text === 'string') {
      const r = slimText(result.text, trace);
      return { value: { ...result, text: r.text }, modified: r.modified, kind: 'single', reason: r.reason, stages: r.stages };
    }
  }
  return { value: result, modified: false, kind: 'none', reason: 'unrecognized-shape', stages: [] }; // unrecognized shape → no-op
}

// Append the recovery handle to the COMPRESSED text (never a verbatim/error block).
function attachMarker(res, suffix) {
  const v = res.value;
  if (res.kind === 'string') return v + suffix;
  if (res.kind === 'single') return { ...v, text: v.text + suffix };
  if (res.kind === 'array' || res.kind === 'content') {
    const blocks = res.kind === 'content' ? v.content : v;
    const i = res.markIndex;
    if (i < 0 || !blocks[i] || typeof blocks[i].text !== 'string') return null; // nowhere safe
    const clone = blocks.slice();
    clone[i] = { ...blocks[i], text: blocks[i].text + suffix };
    return res.kind === 'content' ? { ...v, content: clone } : clone;
  }
  return null;
}

// Spill the whole original result to a file; return its path, or null on failure.
function spillOriginal(text) {
  try {
    const dir = spillRoot(); // same home the sweep scans — never drift
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `fnd-mcp-slim-${crypto.randomUUID()}.json`);
    fs.writeFileSync(p, text);
    return p;
  } catch (_) {
    return null;
  }
}

// Byte length of a result value (best-effort; a non-serializable object → 0).
function bytesOf(v) {
  try { return Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v), 'utf8'); } catch (_) { return 0; }
}
const pctOf = (inB, outB) => (inB ? Math.round((1 - outB / inB) * 1000) / 10 : 0);

function run(raw) {
  const t0 = Date.now();
  const dbg = debugEnabled(); // cache: disabled → every trace() is a no-op and the metrics below are skipped
  const input = JSON.parse(raw);
  const tool = typeof input.tool_name === 'string' ? input.tool_name : null;
  const result = input.tool_response !== undefined ? input.tool_response : input.tool_output;

  // One debug line per invocation (opt-in). Never touches stdout; the compressed path calls it
  // AFTER writing the result. `decision:"compressed"` iff we emitted updatedToolOutput.
  const trace = (decision, reason, bytesIn, bytesOut, stages, spill) => {
    if (!dbg) return;
    debugLog({
      entry: 'hook', tool, decision, reason: reason || null,
      bytes_in: bytesIn, bytes_out: bytesOut, pct: pctOf(bytesIn, bytesOut),
      stages: stages || [], spill: spill || null, ms: Date.now() - t0,
    });
  };

  if (result === undefined || result === null) return; // nothing arrived — not a compressor invocation

  // MCP error result — never touch (the model must see failures verbatim).
  if (typeof result === 'object' && result.isError === true) {
    if (dbg) { const b = bytesOf(result); trace('passthrough', 'error-shape', b, b, [], null); }
    return;
  }

  // Size gate on the serialized result.
  let serialized;
  try {
    serialized = typeof result === 'string' ? result : JSON.stringify(result);
  } catch (_) {
    trace('passthrough', 'transform-error', 0, 0, [], null);
    return;
  }
  const bytesIn = Buffer.byteLength(serialized, 'utf8');
  if (bytesIn <= GATE_BYTES) { trace('passthrough', 'size-gate', bytesIn, bytesIn, [], null); return; }

  const slimmed = slimResult(result, dbg); // dbg gates slim()'s per-stage `stages` bookkeeping
  if (!slimmed.modified) { trace('passthrough', slimmed.reason || 'no-gain', bytesIn, bytesIn, [], null); return; } // no byte gain → passthrough

  // Recovery net: spill the original before handing back a lossy result. No spill → passthrough.
  const fullPath = spillOriginal(serialized);
  if (!fullPath) { trace('passthrough', 'spill-write-failure', bytesIn, bytesIn, [], null); return; }

  const value = attachMarker(slimmed, `\n\n<<full=${fullPath} original_result>>`);
  if (value === null) { trace('passthrough', 'transform-error', bytesIn, bytesIn, [], null); return; } // could not attach a handle safely → passthrough (no orphan)

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: value },
    }),
  );
  if (dbg) trace('compressed', null, bytesIn, bytesOf(value), slimmed.stages, fullPath);
}

// Collect the whole stdin as bytes, then decode once — decoding per Buffer chunk would
// mangle any multibyte character split across a read boundary (U+FFFD corruption on the
// large non-ASCII payloads this hook targets).
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('end', () => {
  try {
    run(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    // Any failure → emit nothing, original result passes through untouched.
  }
  // Spill hygiene runs AFTER the result is emitted (or passed through) so it never delays what
  // the model sees; throttled and self-guarding, so it costs one stat on the hot path.
  try { sweepSpills(); } catch (_) {}
});
