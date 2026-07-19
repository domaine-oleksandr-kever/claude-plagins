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
//      FND_MCP_SLIM_DIR (spill directory, shared with json-slim; default os.tmpdir()).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { slim } = require('../scripts/json-slim.cjs');

const GATE_BYTES = 4096; // only results larger than this are worth compressing

// Slim one text payload. Error envelope / non-JSON / no byte gain → original unchanged.
function slimText(text) {
  let res;
  try {
    res = slim(text);
  } catch (_) {
    return { text, modified: false };
  }
  if (res.error) return { text, modified: false }; // error shape: verbatim
  if (!res.wasModified || res.bytesOut >= res.bytesIn) return { text, modified: false };
  return { text: res.output, modified: true };
}

// Slim every text block in an MCP content array, preserving non-text and verbatim blocks
// byte-for-byte. `markIndex` = the last block we actually compressed (-1 if none), so the
// recovery handle never lands on a verbatim-preserved error block.
function slimBlocks(blocks) {
  let modified = false;
  let markIndex = -1;
  const out = blocks.map((b, i) => {
    if (b && typeof b === 'object' && typeof b.text === 'string') {
      const r = slimText(b.text);
      if (r.modified) {
        modified = true;
        markIndex = i;
        return { ...b, text: r.text };
      }
    }
    return b; // non-text or unchanged → untouched
  });
  return { blocks: out, modified, markIndex };
}

// Slim a tool result, mirroring its shape. Returns a descriptor for attachMarker.
function slimResult(result) {
  if (typeof result === 'string') {
    const r = slimText(result);
    return { value: r.text, modified: r.modified, kind: 'string' };
  }
  if (Array.isArray(result)) {
    const r = slimBlocks(result);
    return { value: r.blocks, modified: r.modified, kind: 'array', markIndex: r.markIndex };
  }
  if (result && typeof result === 'object') {
    if (Array.isArray(result.content)) {
      const r = slimBlocks(result.content);
      return { value: { ...result, content: r.blocks }, modified: r.modified, kind: 'content', markIndex: r.markIndex };
    }
    if (typeof result.text === 'string') {
      const r = slimText(result.text);
      return { value: { ...result, text: r.text }, modified: r.modified, kind: 'single' };
    }
  }
  return { value: result, modified: false, kind: 'none' }; // unrecognized shape → no-op
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
    const dir = process.env.FND_MCP_SLIM_DIR || os.tmpdir();
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `fnd-mcp-slim-${crypto.randomUUID()}.json`);
    fs.writeFileSync(p, text);
    return p;
  } catch (_) {
    return null;
  }
}

function run(raw) {
  const input = JSON.parse(raw);
  const result = input.tool_response !== undefined ? input.tool_response : input.tool_output;
  if (result === undefined || result === null) return;

  // MCP error result — never touch (the model must see failures verbatim).
  if (typeof result === 'object' && result.isError === true) return;

  // Size gate on the serialized result.
  let serialized;
  try {
    serialized = typeof result === 'string' ? result : JSON.stringify(result);
  } catch (_) {
    return;
  }
  if (Buffer.byteLength(serialized, 'utf8') <= GATE_BYTES) return;

  const slimmed = slimResult(result);
  if (!slimmed.modified) return; // no byte gain → passthrough

  // Recovery net: spill the original before handing back a lossy result. No spill → passthrough.
  const fullPath = spillOriginal(serialized);
  if (!fullPath) return;

  const value = attachMarker(slimmed, `\n\n<<full=${fullPath} original_result>>`);
  if (value === null) return; // could not attach a handle safely → passthrough (no orphan)

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: value },
    }),
  );
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
});
