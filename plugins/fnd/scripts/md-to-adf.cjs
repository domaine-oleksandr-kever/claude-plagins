#!/usr/bin/env node
/*
 * md-to-adf.cjs — convert Markdown to Atlassian Document Format (ADF) JSON.
 *
 * Jira rich-text custom fields (Technical Approach, Steps to test, Acceptance Criteria,
 * Assumptions, Documentation Links) and comments store ADF, not Markdown. The fnd
 * write-back skills run the APPROVED markdown through this script and pass the resulting
 * ADF object to editJiraIssue — so content renders correctly instead of showing literal
 * `#`/`*`/`|`. Dependency-free (Node only); deterministic, so the model never hand-builds
 * ADF JSON.
 *
 * Usage:
 *   node md-to-adf.cjs <file.md>         # read from a file
 *   node md-to-adf.cjs                   # read Markdown from stdin
 *   ... | node md-to-adf.cjs
 *   node md-to-adf.cjs --no-tables f.md  # render GFM tables as compact bullet lists
 *   node md-to-adf.cjs --pretty f.md     # 2-space indented JSON (debugging only)
 * Prints the ADF document JSON to stdout (MINIFIED by default).
 *
 * KEEP IT COMPACT. The output goes straight into an editJiraIssue tool call; a huge ADF blob
 * is fragile to inline (one typo breaks the structure) — which tempts deviating to a raw
 * markdown string, which Jira custom fields REJECT ("Operation value must be an Atlassian
 * Document"). Two levers keep it small: (1) output is minified, not pretty-printed (≈half the
 * bytes); (2) `--no-tables` renders GFM tables as bullet lists — ADF `table` nodes are by far
 * the heaviest construct (every cell wraps a paragraph). The script also prints a size warning
 * to stderr when the ADF is large, so you trim/restructure instead of shipping a fragile blob.
 *
 * Supported: headings (#..######), paragraphs, **bold**, *italic*, ***bold-italic***, `inline code`,
 * [links](url), ~~strike~~, bullet/ordered lists, ``` fenced code blocks ```,
 * --- horizontal rules, > blockquotes, and GFM pipe tables. Underscore emphasis
 * (_x_/__x__) is intentionally NOT treated as italics/bold so snake_case identifiers
 * survive; use * / ** for emphasis.
 */
'use strict';
const fs = require('fs');

const ARGV = process.argv.slice(2);
const OPT = {
  noTables: ARGV.includes('--no-tables'),
  pretty: ARGV.includes('--pretty'),
};
const FILE_ARG = ARGV.find((a) => !a.startsWith('--'));
// Warn above this serialized size — large field values are fragile to write back via one tool call.
const SIZE_WARN_BYTES = 30000;

function readInput() {
  try {
    return FILE_ARG ? fs.readFileSync(FILE_ARG, 'utf8') : fs.readFileSync(0, 'utf8');
  } catch (e) {
    process.stderr.write('md-to-adf: cannot read input: ' + e.message + '\n');
    process.exit(1);
  }
}

function textNode(text, marks) {
  if (text === '') return null;
  const n = { type: 'text', text };
  if (marks && marks.length) n.marks = marks;
  return n;
}

// Inline parser → array of ADF inline nodes. Earliest-match wins; code spans first.
function inlineNodes(input) {
  const out = [];
  const push = (s) => { const n = textNode(s); if (n) out.push(n); };
  const patterns = [
    { kind: 'code',     re: /`([^`]+)`/ },
    { kind: 'link',     re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
    { kind: 'strongem', re: /\*\*\*([^*]+)\*\*\*/ },
    { kind: 'strong',   re: /\*\*([^*]+)\*\*/ },
    { kind: 'em',       re: /\*([^*]+)\*/ },
    { kind: 'strike',   re: /~~([^~]+)~~/ },
  ];
  let rest = input;
  while (rest.length) {
    let best = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { p, m };
    }
    if (!best) { push(rest); break; }
    if (best.m.index > 0) push(rest.slice(0, best.m.index));
    const { p, m } = best;
    if (p.kind === 'code') out.push(textNode(m[1], [{ type: 'code' }]));
    else if (p.kind === 'link') out.push(textNode(m[1], [{ type: 'link', attrs: { href: m[2] } }]));
    else if (p.kind === 'strongem') out.push(textNode(m[1], [{ type: 'strong' }, { type: 'em' }]));
    else if (p.kind === 'strong') out.push(textNode(m[1], [{ type: 'strong' }]));
    else if (p.kind === 'em') out.push(textNode(m[1], [{ type: 'em' }]));
    else if (p.kind === 'strike') out.push(textNode(m[1], [{ type: 'strike' }]));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function para(nodes) { return nodes.length ? { type: 'paragraph', content: nodes } : { type: 'paragraph' }; }
function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}
function isBlockStart(line) {
  return /^\s*$/.test(line)
    || /^(#{1,6})\s+/.test(line)
    || /^```/.test(line)
    || /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
    || /^\s*([-*+])\s+/.test(line)
    || /^\s*\d+\.\s+/.test(line)
    || /^\s*>\s?/.test(line)
    || /\|/.test(line);
}

function toADF(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const content = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    // fenced code block
    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // closing fence
      const node = { type: 'codeBlock', content: buf.length ? [{ type: 'text', text: buf.join('\n') }] : [] };
      if (lang) node.attrs = { language: lang };
      content.push(node);
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { content.push({ type: 'heading', attrs: { level: h[1].length }, content: inlineNodes(h[2].trim()) }); i++; continue; }

    // horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { content.push({ type: 'rule' }); i++; continue; }

    // GFM table: this row has a pipe and the next row is a separator (---|---).
    // The separator must itself contain a pipe — a bare `---` under prose is a rule, not a table.
    if (/\|/.test(line) && i + 1 < lines.length && /\|/.test(lines[i + 1]) && /^\s*\|?[\s:]*-{1,}[-\s:|]*$/.test(lines[i + 1])) {
      const header = cellsOf(line);
      i += 2; // header + separator
      const dataRows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        dataRows.push(cellsOf(lines[i]));
        i++;
      }
      // ADF tables must be rectangular — pad ragged rows (and a short header) with empty cells
      const width = Math.max(header.length, ...dataRows.map((r) => r.length));
      while (header.length < width) header.push('');
      for (const r of dataRows) while (r.length < width) r.push('');
      if (OPT.noTables) {
        // Compact form: one bullet per data row, "Header: cell · Header: cell".
        // ADF table nodes are the heaviest construct; this keeps the field small and robust.
        // Labels are PLAIN text (not bold) so each cell stays a single text node — bold marks
        // would double the node count per cell and can make a wide table LARGER than the table form.
        const items = dataRows.map((cells) => {
          const parts = cells
            .map((c, j) => {
              const key = (header[j] || '').trim();
              if (c === '' && !key) return '';
              return key ? `${key}: ${c}` : c;
            })
            .filter((s) => s !== '');
          return { type: 'listItem', content: [para(inlineNodes(parts.join(' · ')))] };
        }).filter((it) => it.content[0].content && it.content[0].content.length);
        content.push({ type: 'bulletList', content: items.length ? items : [{ type: 'listItem', content: [para([])] }] });
      } else {
        const rows = [{
          type: 'tableRow',
          content: header.map((c) => ({ type: 'tableHeader', content: [para(inlineNodes(c))] })),
        }];
        for (const cells of dataRows) {
          rows.push({
            type: 'tableRow',
            content: cells.map((c) => ({ type: 'tableCell', content: [para(inlineNodes(c))] })),
          });
        }
        content.push({ type: 'table', content: rows });
      }
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      content.push({ type: 'blockquote', content: [para(inlineNodes(buf.join(' ')))] });
      continue;
    }

    // lists (single level)
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (ordered || /^\s*([-*+])\s+/.test(line)) {
      const itemRe = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      const start = ordered ? parseInt(/^\s*(\d+)\./.exec(line)[1], 10) : 1;
      const items = [];
      while (i < lines.length && itemRe.test(lines[i])) {
        const m = itemRe.exec(lines[i]);
        items.push({ type: 'listItem', content: [para(inlineNodes(m[1].trim()))] });
        i++;
      }
      const list = { type: ordered ? 'orderedList' : 'bulletList', content: items };
      if (ordered && start !== 1) list.attrs = { order: start }; // preserve lists starting at e.g. "3."
      content.push(list);
      continue;
    }

    // paragraph (gather wrapped lines)
    const buf = [line];
    i++;
    while (i < lines.length && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    content.push(para(inlineNodes(buf.join(' '))));
  }
  return { type: 'doc', version: 1, content };
}

const adf = toADF(readInput());
const min = JSON.stringify(adf);

// Size guardrail: a large field value is fragile to inline into one editJiraIssue call. Warn so
// the caller trims/restructures (shorter content, --no-tables) instead of falling back to raw
// markdown (which Jira custom fields reject). Warning goes to stderr; stdout stays pure JSON.
const hasTables = min.includes('"type":"table"');
if (min.length > SIZE_WARN_BYTES || (hasTables && min.length > SIZE_WARN_BYTES / 2)) {
  process.stderr.write(
    'md-to-adf: warning: ADF is ' + min.length + ' bytes' + (hasTables ? ' and contains table node(s)' : '') +
    '. Large/table-heavy field values are fragile to write back in one tool call — ' +
    'consider --no-tables and trimming the content (headings + bullet lists stay compact).\n'
  );
}

process.stdout.write((OPT.pretty ? JSON.stringify(adf, null, 2) : min) + '\n');
