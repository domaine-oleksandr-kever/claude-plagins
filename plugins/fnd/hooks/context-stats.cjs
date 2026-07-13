#!/usr/bin/env node
// UserPromptSubmit hook: one-line context notice in the Claude Code UI (hook
// `systemMessage`, rendered above the input box — never appended to the assistant's
// reply, never touching the status line). Mirrors /context: tokens used / window (%),
// active model, effort. Effort comes straight from the hook input; model and token
// counts are read verbatim from the transcript's last assistant `usage` entry —
// Claude Code does not expose /context's own numbers to hooks. Above the warn
// threshold the notice adds a /compact-or-/clear call-to-action and flags the
// session for skills via additionalContext. Tunables:
//   FND_CTX_MONITOR on by default; set to 0 to disable (gated in plugin.json's
//                   UserPromptSubmit command, so a disabled monitor never even
//                   spawns node)
//   FND_CTX_WINDOW  context window in tokens (default: resolved from the session model,
//                   200000 when the model is unknown)
//   FND_CTX_WARN    warn-from percentage (default 40)
'use strict';

const fs = require('fs');

const TAIL_BYTES = 512 * 1024;
const ENV_WINDOW = parseInt(process.env.FND_CTX_WINDOW || '', 10) || 0;
const WARN_AT = parseInt(process.env.FND_CTX_WARN || '', 10) || 40;

// 1M-window families: Fable/Mythos, Opus ≥4.6, Sonnet ≥4.6. Haiku and anything
// unrecognized keep the conservative 200k default.
function windowFor(model) {
  return /fable|mythos|opus-4-[6-9]|opus-[5-9]|sonnet-4-[6-9]|sonnet-[5-9]/.test(model)
    ? 1000000
    : 200000;
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const effort = (input.effort && input.effort.level) || '';
    const transcript = input.transcript_path;
    if (!transcript || !fs.existsSync(transcript)) return;

    // Read only the tail — transcripts grow to tens of MB.
    const size = fs.statSync(transcript).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    const fd = fs.openSync(transcript, 'r');
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    let lines = buf.toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // drop the partial first line

    let usage = null;
    let model = '';
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const entry = JSON.parse(lines[i]);
        const u = entry.message && entry.message.usage;
        if (u && u.input_tokens != null && !entry.isSidechain) {
          if (!usage) usage = u;
          const m = entry.message.model;
          // Skip placeholders like "<synthetic>" — keep scanning for a real model ID.
          if (m && m[0] !== '<') {
            model = m;
            break;
          }
        }
      } catch (_) {}
    }
    if (!usage) return;

    const WINDOW = ENV_WINDOW || windowFor(model);

    const used =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.output_tokens || 0);
    const pct = Math.round((used / WINDOW) * 100);

    const windowLabel =
      WINDOW >= 1000000 ? `${WINDOW / 1000000}M` : `${Math.round(WINDOW / 1000)}k`;
    const usedLabel = `${(used / 1000).toFixed(1)}k`;
    const icon = pct >= 90 ? '🔴' : pct >= 75 ? '🟠' : pct >= WARN_AT ? '🟡' : '🟢';

    let msg = [
      `${icon} Context ${usedLabel}/${windowLabel} (${pct}%)`,
      model,
      effort && `effort ${effort}`,
    ]
      .filter(Boolean)
      .join(' · ');

    // systemMessage is user-facing only; additionalContext (warn-level and up) lets
    // skills condition on "the context monitor flagged this session" without the
    // model echoing a banner into its reply.
    const out = { suppressOutput: true, systemMessage: msg };
    if (pct >= WARN_AT) {
      out.systemMessage +=
        pct >= 75
          ? ' — /compact now (or /clear when the workspace is saved), auto-compact is close'
          : ' — /compact, or /clear when the workspace is saved, at the next step boundary';
      out.hookSpecificOutput = {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          `fnd context monitor: ~${pct}% of the ~${windowLabel} context window used. ` +
          `The developer already sees this notice in the UI — do NOT append any context banner to your reply.`,
      };
    }
    console.log(JSON.stringify(out));
  } catch (_) {}
});
