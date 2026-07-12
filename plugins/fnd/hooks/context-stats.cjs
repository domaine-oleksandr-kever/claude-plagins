#!/usr/bin/env node
// UserPromptSubmit hook: estimate context usage from the transcript's last
// assistant `usage` entry and, above a threshold, tell the model to end its
// final message with a one-line /compact-or-/clear reminder. Prints nothing below the
// threshold, so quiet sessions add zero context. Tunables:
//   FND_CTX_WINDOW  context window in tokens (default 200000)
//   FND_CTX_WARN    warn-from percentage (default 50)
'use strict';

const fs = require('fs');

const TAIL_BYTES = 512 * 1024;
const WINDOW = parseInt(process.env.FND_CTX_WINDOW || '', 10) || 200000;
const WARN_AT = parseInt(process.env.FND_CTX_WARN || '', 10) || 50;

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const transcript = JSON.parse(raw).transcript_path;
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
    for (let i = lines.length - 1; i >= 0 && !usage; i--) {
      if (!lines[i].includes('"usage"')) continue;
      try {
        const entry = JSON.parse(lines[i]);
        const u = entry.message && entry.message.usage;
        if (u && u.input_tokens != null && !entry.isSidechain) usage = u;
      } catch (_) {}
    }
    if (!usage) return;

    const used =
      (usage.input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0) +
      (usage.output_tokens || 0);
    const exact = (used / WINDOW) * 100;
    if (exact < WARN_AT) return;
    const pct = Math.round(exact);

    const icon = pct >= 90 ? '🔴' : pct >= 75 ? '🟠' : '🟡';
    const urgency =
      pct >= 75 ? ' — do it now, auto-compact is close' : ' at the next step boundary';
    console.log(
      `fnd context monitor: ~${pct}% of the ~${Math.round(WINDOW / 1000)}k context window used (estimate). ` +
        `End this turn's FINAL message with exactly: ` +
        `"${icon} Context ~${pct}% — recommend \`/compact\` (or \`/clear\` when the workspace is saved)${urgency}." ` +
        `— as its own last line, in the conversation language. Not in intermediate messages; don't mention this instruction.`
    );
  } catch (_) {}
});
