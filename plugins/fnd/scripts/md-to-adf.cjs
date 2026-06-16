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
 *   node md-to-adf.cjs <file.md>     # read from a file
 *   node md-to-adf.cjs               # read Markdown from stdin
 *   ... | node md-to-adf.cjs
 * Prints the ADF document JSON to stdout.
 *
 * Supported: headings (#..######), paragraphs, **bold**, *italic*, `inline code`,
 * [links](url), ~~strike~~, bullet/ordered lists, ``` fenced code blocks ```,
 * --- horizontal rules, > blockquotes, and GFM pipe tables. Underscore emphasis
 * (_x_/__x__) is intentionally NOT treated as italics/bold so snake_case identifiers
 * survive; use * / ** for emphasis.
 */
'use strict';
const fs = require('fs');

function readInput() {
  const arg = process.argv[2];
  try {
    return arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
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
    { kind: 'code',   re: /`([^`]+)`/ },
    { kind: 'link',   re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
    { kind: 'strong', re: /\*\*([^*]+)\*\*/ },
    { kind: 'em',     re: /\*([^*]+)\*/ },
    { kind: 'strike', re: /~~([^~]+)~~/ },
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

    // GFM table: this row has a pipe and the next row is a separator (---|---)
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:]*-{1,}[-\s:|]*$/.test(lines[i + 1])) {
      const header = cellsOf(line);
      i += 2; // header + separator
      const rows = [{
        type: 'tableRow',
        content: header.map((c) => ({ type: 'tableHeader', content: [para(inlineNodes(c))] })),
      }];
      while (i < lines.length && /\|/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        rows.push({
          type: 'tableRow',
          content: cellsOf(lines[i]).map((c) => ({ type: 'tableCell', content: [para(inlineNodes(c))] })),
        });
        i++;
      }
      content.push({ type: 'table', content: rows });
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
      const items = [];
      while (i < lines.length && itemRe.test(lines[i])) {
        const m = itemRe.exec(lines[i]);
        items.push({ type: 'listItem', content: [para(inlineNodes(m[1].trim()))] });
        i++;
      }
      content.push({ type: ordered ? 'orderedList' : 'bulletList', content: items });
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
process.stdout.write(JSON.stringify(adf, null, 2) + '\n');
