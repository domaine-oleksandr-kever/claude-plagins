#!/usr/bin/env node
/*
 * adf-to-md.cjs — convert Atlassian Document Format (ADF) JSON to Markdown.
 *
 * The inverse of md-to-adf.cjs. Jira rich-text CUSTOM fields (Technical Approach, Steps to
 * test, Acceptance Criteria, Assumptions, Documentation Links) come back as raw ADF even when
 * getJiraIssue is called with responseContentFormat:"markdown" (that only converts standard
 * description/comment fields). The fnd reading path (jira-reader) runs those ADF values through
 * this so it gets clean markdown deterministically instead of hand-walking nested JSON — and
 * keeps the bulky raw ADF out of context.
 *
 * Usage:
 *   node adf-to-md.cjs <file.json>                      # an ADF doc, OR a full getJiraIssue response
 *   node adf-to-md.cjs <issue.json> --field customfield_10038   # extract that field's ADF first
 *   cat adf.json | node adf-to-md.cjs                   # stdin
 * Prints Markdown to stdout. Unknown node types degrade gracefully (render their children/text).
 */
'use strict';
const fs = require('fs');

function readJSON() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--field');
  const fieldId = fi !== -1 && args[fi + 1] && !args[fi + 1].startsWith('--') ? args[fi + 1] : null;
  if (fi !== -1 && !fieldId) {
    process.stderr.write('adf-to-md: --field needs a value (e.g. --field customfield_10038)\n');
    process.exit(1);
  }
  // skip the --field VALUE when looking for the input file arg
  const fileArg = args.find((a, i) => !a.startsWith('--') && (fi === -1 || i !== fi + 1));
  let raw;
  try {
    raw = fileArg ? fs.readFileSync(fileArg, 'utf8') : fs.readFileSync(0, 'utf8');
  } catch (e) {
    process.stderr.write('adf-to-md: cannot read input: ' + e.message + '\n');
    process.exit(1);
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) {
    process.stderr.write('adf-to-md: input is not valid JSON: ' + e.message + '\n');
    process.exit(1);
  }
  if (fieldId) {
    const has = (o, k) => o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
    if (!has(data.fields, fieldId) && !has(data, fieldId)) {
      process.stderr.write('adf-to-md: field ' + fieldId + ' not present in input\n');
      process.exit(1);
    }
    const val = has(data.fields, fieldId) ? data.fields[fieldId] : data[fieldId];
    if (val == null) {
      // genuinely empty field → empty output, never a fallback to another field or the whole doc
      process.stderr.write('adf-to-md: field ' + fieldId + ' is empty\n');
      process.exit(0);
    }
    if (typeof val === 'string') { process.stdout.write(val + '\n'); process.exit(0); }
    data = val;
  }
  return data;
}

// Find the ADF doc node if a wrapper object was passed.
function findDoc(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'doc' && Array.isArray(node.content)) return node;
  for (const k of Object.keys(node)) {
    const found = findDoc(node[k]);
    if (found) return found;
  }
  return null;
}

function renderText(node) {
  let t = node.text != null ? node.text : '';
  const marks = node.marks || [];
  const has = (m) => marks.some((x) => x.type === m);
  if (has('code')) {
    // em/strong/strike can't render inside a code span, but a link can still wrap it
    let c = '`' + t + '`';
    const clink = marks.find((m) => m.type === 'link');
    if (clink && clink.attrs && clink.attrs.href) c = '[' + c + '](' + clink.attrs.href + ')';
    return c;
  }
  if (has('strike')) t = '~~' + t + '~~';
  if (has('em')) t = '*' + t + '*';
  if (has('strong')) t = '**' + t + '**';
  const link = marks.find((m) => m.type === 'link');
  if (link && link.attrs && link.attrs.href) t = '[' + t + '](' + link.attrs.href + ')';
  return t;
}

// Pull a URL off a smart-link / card node (inlineCard, blockCard, embedCard).
// Most carry attrs.url; some carry attrs.data.url (JSON-LD) instead. Never drop it.
function cardUrl(node) {
  const a = node.attrs || {};
  return a.url || (a.data && (a.data.url || (a.data['@id']))) || '';
}

function inline(nodes) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map((n) => {
    if (!n || typeof n !== 'object') return '';
    if (n.type === 'text') return renderText(n);
    if (n.type === 'hardBreak') return '\n';
    if (n.type === 'emoji') return (n.attrs && (n.attrs.shortName || n.attrs.text)) || '';
    if (n.type === 'mention') return (n.attrs && n.attrs.text) || '';
    if (n.type === 'inlineCard' || n.type === 'blockCard' || n.type === 'embedCard') {
      const u = cardUrl(n);
      return u ? '<' + u + '>' : '';
    }
    if (n.type === 'status') return '[' + ((n.attrs && n.attrs.text) || '') + ']';
    if (n.type === 'date') {
      const ts = n.attrs && Number(n.attrs.timestamp);
      return ts ? new Date(ts).toISOString().slice(0, 10) : '';
    }
    if (n.content) return inline(n.content); // unknown inline wrapper
    return (n.attrs && (n.attrs.text || n.attrs.shortName)) || '';
  }).join('');
}

// a listItem usually holds one paragraph, but Jira nests child lists as sibling blocks —
// those must come out as their own indented lines, never space-joined into the parent item
function renderListItem(item, depth, marker) {
  const pad = '  '.repeat(depth);
  const inlineParts = [];
  const childLines = [];
  for (const b of item.content || []) {
    if (b && (b.type === 'bulletList' || b.type === 'orderedList')) childLines.push(renderBlock(b, depth + 1));
    else inlineParts.push(renderBlock(b, depth));
  }
  return [pad + marker + inlineParts.join(' ').trim(), ...childLines].join('\n');
}

function renderBlock(node, depth) {
  depth = depth || 0;
  if (!node || typeof node !== 'object') return '';
  switch (node.type) {
    case 'heading': {
      // markdown has no level > 6; clamp instead of emitting `#########`
      const lvl = Math.min(Math.max((node.attrs && node.attrs.level) || 1, 1), 6);
      return '#'.repeat(lvl) + ' ' + inline(node.content);
    }
    case 'paragraph':
      return inline(node.content);
    case 'bulletList':
      return (node.content || []).map((li) => renderListItem(li, depth, '- ')).join('\n');
    case 'orderedList': {
      let i = (node.attrs && node.attrs.order) || 1;
      return (node.content || []).map((li) => renderListItem(li, depth, (i++) + '. ')).join('\n');
    }
    case 'codeBlock': {
      const lang = (node.attrs && node.attrs.language) || '';
      const text = (node.content || []).map((c) => c.text || '').join('');
      return '```' + lang + '\n' + text + '\n```';
    }
    case 'blockquote':
      return (node.content || []).map((b) => '> ' + renderBlock(b, depth + 1)).join('\n');
    case 'rule':
      return '---';
    case 'table': {
      const rows = node.content || [];
      if (!rows.length) return '';
      // render EVERY block of a cell (a Jira cell can hold several paragraphs / a list);
      // depth 0 — cells flatten to one line anyway, indentation would only add noise.
      // Escape | so a cell's own pipes can't shift the column layout.
      const cellsOf = (row) => (row.content || []).map((c) =>
        (c.content || []).map((b) => renderBlock(b, 0)).join(' ')
          .replace(/\n/g, ' ').replace(/\|/g, '\\|').trim());
      const out = [];
      const head = cellsOf(rows[0]);
      out.push('| ' + head.join(' | ') + ' |');
      out.push('| ' + head.map(() => '---').join(' | ') + ' |');
      for (let r = 1; r < rows.length; r++) out.push('| ' + cellsOf(rows[r]).join(' | ') + ' |');
      return out.join('\n');
    }
    case 'blockCard':
    case 'embedCard': {
      // A Jira "smart link" pasted on its own line (e.g. a Notion / Figma / Confluence URL).
      // It carries only attrs.url — render it as an autolink so the URL is never lost.
      const u = cardUrl(node);
      return u ? '<' + u + '>' : '';
    }
    case 'mediaSingle':
    case 'mediaGroup':
      return '_(media omitted)_';
    default:
      // unknown block: try children, else inline text
      if (node.content) return (node.content || []).map((b) => renderBlock(b, depth)).join('\n\n');
      return node.text || '';
  }
}

// Convert an ADF doc — or any wrapper object that contains one — to Markdown.
// Returns null when no ADF doc node is present. This is the single home of the
// converter: json-slim.cjs require()s it for the ADF-detection compression stage,
// and the CLI below is the same call over stdin/a file.
function adfToMarkdown(input) {
  const doc = findDoc(input);
  if (!doc) return null;
  return (doc.content || []).map((b) => renderBlock(b)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { adfToMarkdown, findDoc, renderBlock, inline, renderText, cardUrl };

if (require.main === module) {
  const md = adfToMarkdown(readJSON());
  if (md == null) { process.stderr.write('adf-to-md: no ADF doc node found in input\n'); process.exit(1); }
  process.stdout.write(md + '\n');
}
