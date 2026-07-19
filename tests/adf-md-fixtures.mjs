#!/usr/bin/env node
// Fixture suite for the two ADF converters (plugins/fnd/scripts/{adf-to-md,md-to-adf}.cjs).
// Encodes the DESIRED behavior: run it after any converter change. Cases named `bug-*` are
// the 2026-07 audit findings; the rest pin behavior that was already correct.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A2M = path.join(ROOT, 'plugins/fnd/scripts/adf-to-md.cjs');
const M2A = path.join(ROOT, 'plugins/fnd/scripts/md-to-adf.cjs');

const run = (script, input, args = []) =>
  execFileSync('node', [script, ...args], { input, encoding: 'utf8' });

const doc = (content) => ({ type: 'doc', version: 1, content });
const p = (content) => ({ type: 'paragraph', content });
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const li = (content) => ({ type: 'listItem', content });
const ul = (content) => ({ type: 'bulletList', content });
const ol = (content, attrs) => (attrs ? { type: 'orderedList', attrs, content } : { type: 'orderedList', content });

let pass = 0, fail = 0;
const failures = [];
// key-order-independent object comparison
const canon = (v) => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v);
function check(name, actual, expected) {
  const a = typeof actual === 'string' ? actual.trimEnd() : JSON.stringify(canon(actual));
  const e = typeof expected === 'string' ? expected.trimEnd() : JSON.stringify(canon(expected));
  if (a === e) { pass++; } else {
    fail++;
    failures.push(`[${name}]\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`);
  }
}
const a2m = (adf, args) => run(A2M, JSON.stringify(adf), args);
const m2a = (md, args) => JSON.parse(run(M2A, md, args));

// ---------------------------------------------------------------- adf-to-md --

// bug-1: nested bullet list — children on their own indented lines, not space-joined
const nestedUl = doc([
  ul([
    li([p([t('Parent')]), ul([li([p([t('Child 1')])]), li([p([t('Child 2')])])])]),
    li([p([t('Sibling')])]),
  ]),
]);
check('bug-a2m-nested-bullets', a2m(nestedUl), '- Parent\n  - Child 1\n  - Child 2\n- Sibling');

// bug-1b: ordered list with nested bullets (the AC shape Jira tickets actually use)
const nestedOl = doc([
  ol([
    li([p([t('AC 1')]), ul([li([p([t('sub a')])]), li([p([t('sub b')])])])]),
    li([p([t('AC 2')])]),
  ]),
]);
check('bug-a2m-nested-ol-ul', a2m(nestedOl), '1. AC 1\n  - sub a\n  - sub b\n2. AC 2');

// bug-1c: double nesting keeps increasing indentation
const deepUl = doc([
  ul([li([p([t('L1')]), ul([li([p([t('L2')]), ul([li([p([t('L3')])])])])])])]),
]);
check('bug-a2m-double-nested', a2m(deepUl), '- L1\n  - L2\n    - L3');

// bug-2: inline status (lozenge) and date nodes must not vanish
const statusDate = doc([
  p([
    t('State: '),
    { type: 'status', attrs: { text: 'IN PROGRESS', color: 'blue' } },
    t(' due '),
    { type: 'date', attrs: { timestamp: '1767139200000' } },
  ]),
]);
check('bug-a2m-status-date', a2m(statusDate), 'State: [IN PROGRESS] due 2025-12-31');

// bug-3: code+link marks — the link must survive around the code span
const codeLink = doc([
  p([t('see '), t('config.js', [{ type: 'code' }, { type: 'link', attrs: { href: 'https://x.test/f' } }])]),
]);
check('bug-a2m-code-link', a2m(codeLink), 'see [`config.js`](https://x.test/f)');

// bug-4: pipes inside table cells must be escaped (2 columns stay 2 columns)
const pipeTable = doc([{
  type: 'table',
  content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', content: [p([t('Key')])] },
      { type: 'tableHeader', content: [p([t('Value')])] },
    ] },
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [p([t('mode')])] },
      { type: 'tableCell', content: [p([t('a|b')])] },
    ] },
  ],
}]);
check('bug-a2m-table-pipe', a2m(pipeTable), '| Key | Value |\n| --- | --- |\n| mode | a\\|b |');

// regressions: marks, cards, heading clamp, code block, quote, rule, media, flat list
const marks = doc([
  p([
    t('bold', [{ type: 'strong' }]), t(' '), t('em', [{ type: 'em' }]), t(' '),
    t('gone', [{ type: 'strike' }]), t(' '), t('x', [{ type: 'link', attrs: { href: 'https://l.test' } }]),
  ]),
]);
check('a2m-marks', a2m(marks), '**bold** *em* ~~gone~~ [x](https://l.test)');
check('a2m-heading-clamp', a2m(doc([{ type: 'heading', attrs: { level: 8 }, content: [t('H')] }])), '###### H');
check('a2m-inline-card', a2m(doc([p([t('doc: '), { type: 'inlineCard', attrs: { url: 'https://n.test/p' } }])])), 'doc: <https://n.test/p>');
check('a2m-codeblock', a2m(doc([{ type: 'codeBlock', attrs: { language: 'js' }, content: [t('a();\nb();')] }])), '```js\na();\nb();\n```');
check('a2m-quote-rule', a2m(doc([{ type: 'blockquote', content: [p([t('q')])] }, { type: 'rule' }])), '> q\n\n---');
check('a2m-media', a2m(doc([{ type: 'mediaSingle', content: [] }])), '_(media omitted)_');
check('a2m-flat-list', a2m(doc([ul([li([p([t('one')])]), li([p([t('two')])])])])), '- one\n- two');

// regression: a list inside a table cell flattens onto the cell's single line
const listCell = doc([{
  type: 'table',
  content: [
    { type: 'tableRow', content: [{ type: 'tableHeader', content: [p([t('H')])] }] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [ul([li([p([t('x')])]), li([p([t('y')])])])] }] },
  ],
}]);
check('a2m-table-list-cell', a2m(listCell), '| H |\n| --- |\n| - x - y |');

// ---------------------------------------------------------------- md-to-adf --

// bug-5: info strings like ```c++ must open a fence (language = first word)
check('bug-m2a-fence-infostring', m2a('```c++\nint x;\n```\nafter'), doc([
  { type: 'codeBlock', content: [{ type: 'text', text: 'int x;' }], attrs: { language: 'c++' } },
  p([t('after')]),
]));
check('m2a-fence-plain', m2a('```\nx\n```'), doc([
  { type: 'codeBlock', content: [{ type: 'text', text: 'x' }] },
]));

// bug-6: * emphasis needs non-space flanks — formulas survive
check('bug-m2a-em-flanking', m2a('Compute a * b * c'), doc([p([t('Compute a * b * c')])]));
check('m2a-em-real', m2a('a *real* one'), doc([p([t('a '), t('real', [{ type: 'em' }]), t(' one')])]));
check('bug-m2a-strong-flanking', m2a('2 ** 3 ** 4'), doc([p([t('2 ** 3 ** 4')])]));

// bug-7: nested lists must nest inside the previous listItem, not flatten
check('bug-m2a-nested-lists', m2a('1. Parent\n   - sub a\n   - sub b\n2. Second'), doc([
  ol([
    li([p([t('Parent')]), ul([li([p([t('sub a')])]), li([p([t('sub b')])])])]),
    li([p([t('Second')])]),
  ]),
]));
check('bug-m2a-double-nested', m2a('- L1\n  - L2\n    - L3\n- L1b'), doc([
  ul([
    li([p([t('L1')]), ul([li([p([t('L2')]), ul([li([p([t('L3')])])])])])]),
    li([p([t('L1b')])]),
  ]),
]));
check('m2a-flat-ol-start', m2a('3. three\n4. four'), doc([
  ol([li([p([t('three')])]), li([p([t('four')])])], { order: 3 }),
]));
check('m2a-flat-ul', m2a('- a\n- b'), doc([ul([li([p([t('a')])]), li([p([t('b')])])])]));

// regression: snake_case survives, links/code/strike/bold work
check('m2a-inline', m2a('see `customfield_10038` and [d](https://d.test) ~~old~~ **b**'), doc([
  p([
    t('see '), t('customfield_10038', [{ type: 'code' }]), t(' and '),
    t('d', [{ type: 'link', attrs: { href: 'https://d.test' } }]),
    t(' '), t('old', [{ type: 'strike' }]), t(' '), t('b', [{ type: 'strong' }]),
  ]),
]));

// regression: tables in both modes
check('m2a-table', m2a('| A | B |\n| --- | --- |\n| 1 | 2 |'), doc([{
  type: 'table',
  content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', content: [p([t('A')])] },
      { type: 'tableHeader', content: [p([t('B')])] },
    ] },
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [p([t('1')])] },
      { type: 'tableCell', content: [p([t('2')])] },
    ] },
  ],
}]));
check('m2a-table-notables', m2a('| A | B |\n| --- | --- |\n| 1 | 2 |', ['--no-tables']), doc([
  ul([li([p([t('A: 1 · B: 2')])])]),
]));

// regression: heading, blockquote, rule
check('m2a-blocks', m2a('# H1\n\n> quoted\n\n---'), doc([
  { type: 'heading', attrs: { level: 1 }, content: [t('H1')] },
  { type: 'blockquote', content: [p([t('quoted')])] },
  { type: 'rule' },
]));

// mentions and emoji render as their display text, never vanish
check('a2m-mention-emoji', a2m(doc([p([
  t('ping '),
  { type: 'mention', attrs: { id: '5b10a', text: '@Oleksandr' } },
  t(' '),
  { type: 'emoji', attrs: { shortName: ':tada:' } },
])])), 'ping @Oleksandr :tada:');

// unknown block node (panel) degrades to its children — text survives, chrome is lost
check('a2m-unknown-panel', a2m(doc([
  { type: 'panel', attrs: { panelType: 'info' }, content: [p([t('heads-up text')])] },
])), 'heads-up text');

// blockCard at block level with a JSON-LD payload — URL comes from attrs.data['@id']
check('a2m-blockcard-jsonld', a2m(doc([
  { type: 'blockCard', attrs: { data: { '@id': 'https://c.test/page' } } },
])), '<https://c.test/page>');

// --field extracts one field's ADF from a full getJiraIssue envelope (stdin)
check('a2m-field-extract', run(A2M, JSON.stringify({
  key: 'ELC-61',
  fields: { summary: 'S', customfield_10038: doc([p([t('the approach')])]) },
}), ['--field', 'customfield_10038']), 'the approach');

// --field on a plain-string field passes the string through untouched
check('a2m-field-string', run(A2M, JSON.stringify({
  fields: { customfield_10040: 'already markdown' },
}), ['--field', 'customfield_10040']), 'already markdown');

// ***bold-italic*** → strong + em on one text node
check('m2a-strongem', m2a('a ***hot*** path'), doc([
  p([t('a '), t('hot', [{ type: 'strong' }, { type: 'em' }]), t(' path')]),
]));

// round-trip: a nested-list AC survives md → adf → md
check('roundtrip-nested', run(A2M, JSON.stringify(m2a('1. AC 1\n  - sub a\n  - sub b\n2. AC 2'))),
  '1. AC 1\n  - sub a\n  - sub b\n2. AC 2');

console.log(`adf-md fixtures: ${pass} passed, ${fail} failed`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
