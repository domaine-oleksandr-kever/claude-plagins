#!/usr/bin/env node
// Fixture suite for plugins/fnd/scripts/json-slim.cjs — the shape-driven JSON compressor.
// Three groups:
//   parity:*   — the array-crush port vs Headroom's vendored SmartCrusher fixtures (byte-parity,
//                or value-parity where JS number semantics prevent byte-parity);
//   unit tests — each pipeline stage, the crush gates, markers, safety rails, the spill-TTL
//                sweep (M5: TTL parsing, prefix/exclude filtering, throttle), CLI;
//   reduction:* — the M1 exit gate: ≥70% byte reduction on the real Jira + Figma fixtures.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, rmSync, mkdtempSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLIM = path.join(ROOT, 'plugins/fnd/scripts/json-slim.cjs');
const PARITY = path.join(ROOT, 'tests/parity/fixtures/smart_crusher');
const FIX = path.join(ROOT, 'tests/fixtures');
const require = createRequire(import.meta.url);
const J = require(SLIM);

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; } else { fail++; failures.push(`[${name}] ${detail || ''}`); }
}
const eq = (name, actual, expected) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
const normJSON = (s) => { try { return JSON.stringify(JSON.parse(s)); } catch { return s; } };

// ---------------------------------------------------------------- parity vs Headroom --
// Every fixture: gate (was_modified) + strategy string must match exactly; the compressed body
// must be byte-identical, OR (where JS 0.0→0 float re-serialization prevents it) value-identical.
let byteExact = 0, valueOnly = 0;
for (const f of readdirSync(PARITY).filter((x) => x.endsWith('.json')).sort()) {
  const fx = JSON.parse(readFileSync(path.join(PARITY, f), 'utf8'));
  const c = fx.config || {};
  const cfg = { markerMode: 'ccr' };
  if (c.max_items_after_crush != null) cfg.maxItemsAfterCrush = c.max_items_after_crush;
  if (c.min_items_to_analyze != null) cfg.minItemsToAnalyze = c.min_items_to_analyze;
  const got = J.crush(fx.input.content, cfg);
  const exp = fx.output;
  const okMod = got.wasModified === exp.was_modified;
  const okStrat = got.strategy === exp.strategy;
  const okByte = got.compressed === exp.compressed;
  const okVal = normJSON(got.compressed) === normJSON(exp.compressed);
  if (okByte) byteExact++; else if (okMod && okStrat && okVal) valueOnly++;
  check(`parity:${f.replace(/_[0-9a-f]{12}\.json$/, '')}`, okMod && okStrat && (okByte || okVal),
    `\n  was_modified got=${got.wasModified} exp=${exp.was_modified}` +
    `\n  strategy got=${JSON.stringify(got.strategy)} exp=${JSON.stringify(exp.strategy)}` +
    `\n  body ${okByte ? 'byte-ok' : okVal ? 'value-ok' : 'MISMATCH'}`);
}
check('parity:byte-exact-count', byteExact === 16, `byte-exact ${byteExact}/17 (expected 16)`);
check('parity:value-parity-count', valueOnly === 1, `value-only ${valueOnly}/17 (expected 1: time_series float)`);

// ---------------------------------------------------------------- classifyArray --
eq('classify-dict', J.classifyArray([{ a: 1 }, { a: 2 }]), 'DictArray');
eq('classify-number', J.classifyArray([1, 2, 3]), 'NumberArray');
eq('classify-string', J.classifyArray(['a', 'b']), 'StringArray');
eq('classify-bool', J.classifyArray([true, false]), 'BoolArray');
eq('classify-nested', J.classifyArray([[], [1]]), 'NestedArray');
eq('classify-empty', J.classifyArray([]), 'Empty');
eq('classify-mixed-scalar', J.classifyArray([1, 'a']), 'MixedArray');
eq('classify-mixed-null', J.classifyArray([{ a: 1 }, null]), 'MixedArray'); // one null → Mixed

// ---------------------------------------------------------------- computeOptimalK --
eq('optk-small', J.computeOptimalK(['a', 'b', 'c'], 1, 3, 15), 3); // n<=8 → n
eq('optk-diverse', J.computeOptimalK(Array.from({ length: 40 }, (_, i) => `x${i}`), 1, 3, 15), 15);
eq('optk-identical', J.computeOptimalK(Array.from({ length: 40 }, () => 'same'), 1, 3, 15), 3); // uniq=1 → clamp 3

// ---------------------------------------------------------------- crush gates --
check('crush-nonjson-passthrough', (() => { const r = J.crush('not json at all'); return !r.wasModified && r.strategy === 'passthrough' && r.compressed === 'not json at all'; })(), 'non-JSON must pass verbatim');
check('crush-compact-nochange', (() => { const r = J.crush('[1,2,3]'); return !r.wasModified && r.strategy === 'passthrough'; })(), 'already-compact short array → unmodified');
check('crush-reflow-modified', (() => { const r = J.crush('[1, 2, 3]'); return r.wasModified && r.strategy === 'passthrough'; })(), 'spaced short array → reflow flips wasModified');
check('crush-small-array-passthrough', (() => { const r = J.crush(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])); return normJSON(r.compressed) === normJSON(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }])); })(), 'array < minItemsToAnalyze not crushed');

// a 20-item same-shape dict array with an error signal → smart_sample + sentinel marker
const errArray = Array.from({ length: 20 }, (_, i) => ({ id: i, status: i % 7 === 0 ? 'error' : 'ok', msg: `row ${i}` }));
const crushed = J.crush(JSON.stringify(errArray), { markerMode: 'spill', spillDir: mkdtempSync(path.join(tmpdir(), 'jslim-')) });
check('crush-smart-sample', crushed.strategy.startsWith('smart_sample('), `strategy=${crushed.strategy}`);
const crushedOut = JSON.parse(crushed.compressed);
check('crush-kept-under-budget', crushedOut.filter((x) => !x._ccr_dropped).length <= 15, 'kept ≤ maxItemsAfterCrush');
check('crush-marker-present', crushedOut.some((x) => x._ccr_dropped && /^<<full=.+ \d+_rows_offloaded>>$/.test(x._ccr_dropped)), 'spill marker shape');
check('crush-error-rows-kept', [0, 7, 14].every((i) => crushedOut.some((x) => x.id === i && x.status === 'error')), 'error rows preserved');

// ---------------------------------------------------------------- spill round-trip --
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-spill-'));
  const r = J.crush(JSON.stringify(errArray), { markerMode: 'spill', spillDir: dir });
  const marker = JSON.parse(r.compressed).find((x) => x._ccr_dropped)._ccr_dropped;
  const m = marker.match(/^<<full=(.+) (\d+)_rows_offloaded>>$/);
  check('spill-marker-parses', !!m, marker);
  if (m) {
    const droppedCount = Number(m[2]);
    const spilled = JSON.parse(readFileSync(m[1], 'utf8'));
    check('spill-file-roundtrips', Array.isArray(spilled) && spilled.length === droppedCount, `file has ${spilled?.length}, marker says ${droppedCount}`);
    const keptCount = JSON.parse(r.compressed).filter((x) => !x._ccr_dropped).length;
    check('spill-count-consistent', keptCount + droppedCount === 20, `${keptCount}+${droppedCount} ≠ 20`);
  }
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- ccr hash reproducible --
{
  const items = Array.from({ length: 30 }, (_, i) => ({ id: i, status: i % 5 === 0 ? 'error' : 'ok', msg: `line ${i}` }));
  const a = J.crush(JSON.stringify(items), { markerMode: 'ccr' });
  const b = J.crush(JSON.stringify(items), { markerMode: 'ccr' });
  check('ccr-hash-deterministic', a.compressed === b.compressed, 'ccr marker must be stable across runs');
  check('ccr-hash-shape', /<<ccr:[0-9a-f]{12} \d+_rows_offloaded>>/.test(a.compressed), 'ccr marker shape');
}

// ---------------------------------------------------------------- pipeline stages --
const adfDoc = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world', marks: [{ type: 'strong' }] }] }] };
eq('stage-adf', J.adfStage({ description: adfDoc }, J.DEFAULTS), { description: 'hello **world**' });
eq('stage-noise-null', J.noiseStage({ a: 1, b: null }, J.DEFAULTS), { a: 1 });
eq('stage-noise-empty', J.noiseStage({ a: 1, b: {}, c: [] }, J.DEFAULTS), { a: 1 });
eq('stage-noise-avatar', J.noiseStage({ name: 'x', avatarUrls: { '48x48': 'http://a' }, iconUrl: 'http://i' }, J.DEFAULTS), { name: 'x' });

// dropRestLinks (M3): a `self` REST-navigation URL is noise; a `self` holding real content is not.
eq('stage-noise-self-rest', J.noiseStage({ id: '1', self: 'https://x.atlassian.net/rest/api/2/status/3' }, J.DEFAULTS), { id: '1' });
eq('stage-noise-self-confluence', J.noiseStage({ _links: { self: 'https://x.atlassian.net/wiki/rest/api/content/9', webui: '/pages/9' } }, J.DEFAULTS), { _links: { webui: '/pages/9' } });
eq('stage-noise-self-content', J.noiseStage({ self: 'my note about myself' }, J.DEFAULTS), { self: 'my note about myself' }); // non-REST string survives
eq('stage-noise-self-nonatlassian', J.noiseStage({ name: 'hook', self: 'https://host/api/v2/webhooks/5' }, J.DEFAULTS), { name: 'hook', self: 'https://host/api/v2/webhooks/5' }); // bare /api/ (non-Atlassian actionable URL) survives
eq('stage-noise-self-object', J.noiseStage({ self: { title: 'me' } }, J.DEFAULTS), { self: { title: 'me' } }); // non-string survives
eq('stage-noise-self-off', J.noiseStage({ self: 'https://x.atlassian.net/rest/api/2/status/3' }, { ...J.DEFAULTS, dropRestLinks: false }), { self: 'https://x.atlassian.net/rest/api/2/status/3' });
check('stage-truncate-datauri', (() => { const big = 'data:image/png;base64,' + 'A'.repeat(500); const r = J.truncateStage({ img: big }, J.DEFAULTS); return r.img.includes('…(len=') && r.img.length < 100; })(), 'data-uri clipped');
eq('stage-truncate-short', J.truncateStage({ s: 'short string' }, J.DEFAULTS), { s: 'short string' });

// ---------------------------------------------------------------- safety rails --
check('safe-error-shape', (() => { const env = JSON.stringify({ errors: [{ message: 'boom' }], data: null }); const r = J.slim(env); return !r.wasModified && r.error === true && r.output === env; })(), 'GraphQL error envelope untouched');
check('safe-usererrors', (() => { const env = JSON.stringify({ data: {}, userErrors: [{ field: 'x', message: 'bad' }] }); const r = J.slim(env); return r.error === true; })(), 'userErrors envelope untouched');
check('safe-nonjson', (() => { const r = J.slim('plain text log line'); return !r.wasModified && r.output === 'plain text log line'; })(), 'non-JSON slim passthrough');

// ---------------------------------------------------------------- preserveFields --
{
  // both arrays are crushable (a rare "error" status is the signal); preserving one exempts it
  const mk = (tag) => Array.from({ length: 30 }, (_, i) => ({ id: i, status: i % 6 === 0 ? 'error' : 'ok', v: `${tag}${i}` }));
  const out = J.crushValue({ keepme: mk('x'), other: mk('y') }, { preserveFields: { keepme: true }, markerMode: 'ccr' });
  check('preserve-untouched', out.keepme.length === 30 && !out.keepme.some((x) => x._ccr_dropped), 'preserved key not crushed');
  check('preserve-other-crushed', out.other.length < 30, 'non-preserved key still crushed');
}

// ---------------------------------------------------------------- TOON flag --
{
  const uniform = Array.from({ length: 5 }, (_, i) => ({ a: i, b: `v${i}` }));
  const on = J.toonStage(uniform);
  check('toon-tabularizes', on && on._toon === 'a,b' && Array.isArray(on.rows) && on.rows.length === 5, 'uniform flat array → tabular');
  const off = J.slim(JSON.stringify({ rows: uniform }));
  check('toon-off-by-default', !off.output.includes('_toon'), 'toon must be off unless flagged');
}

// ---------------------------------------------------------------- review regressions --
// finding 1: long prose / ADF-derived markdown is NEVER truncated (only opaque blobs are)
check('trunc-prose-survives', (() => { const prose = 'Acceptance criteria: ' + 'word '.repeat(400); return J.truncateStage({ desc: prose }, J.DEFAULTS).desc === prose; })(), 'long prose must survive');
check('trunc-datauri-clipped', (() => J.truncateStage({ img: 'data:image/png;base64,' + 'A'.repeat(400) }, J.DEFAULTS).img.includes('…(len='))(), 'data-uri still clipped');
check('trunc-data-prose-survives', (() => { const s = 'data: ' + 'the following steps are required. '.repeat(12); return J.truncateStage({ note: s }, J.DEFAULTS).note === s; })(), 'prose starting "data:" is not a data-URI → survives');
check('slim-adf-desc-survives', (() => { const prose = 'Acceptance criteria for this ticket. '.repeat(60); const big = { fields: { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: prose }] }] } } }; return J.slim(JSON.stringify(big)).output.includes(prose.trim()); })(), 'ADF-derived prose survives slim (not clipped)');

// finding 2: spill-write failure keeps the array uncrushed (no dangling handle to a missing file)
{
  const badFile = path.join(mkdtempSync(path.join(tmpdir(), 'jslim-ro-')), 'not-a-dir');
  require('node:fs').writeFileSync(badFile, 'x'); // a FILE — using it as a spill parent dir fails
  const r = J.crush(JSON.stringify(errArray), { markerMode: 'spill', spillDir: path.join(badFile, 'sub') });
  const out = JSON.parse(r.compressed);
  check('spill-fail-keeps-rows', out.length === 20 && !out.some((x) => x._ccr_dropped), 'spill failure → rows kept, no dangling marker');
}

// finding 3: MCP isError envelope guarded; empty errors:[] is a success (still compressed)
check('err-mcp-iserror', J.isErrorShape({ isError: true, content: [{ type: 'text', text: 'boom' }] }) === true, 'MCP isError envelope guarded');
check('err-empty-errors-ok', J.isErrorShape({ data: { x: 1 }, errors: [] }) === false, 'empty errors:[] is not an envelope');
check('err-empty-errors-compresses', (() => { const big = { errors: [], rows: Array.from({ length: 30 }, (_, i) => ({ id: i, status: i % 5 ? 'ok' : 'error', v: `r${i}` })) }; const r = J.slim(JSON.stringify(big)); return !r.error && r.ratio > 0; })(), 'success payload with errors:[] still compressed');

// finding 4: large arrays must not RangeError from Math.min/max spread
check('big-number-array-nocrash', (() => { try { return typeof J.crush(JSON.stringify(Array.from({ length: 200000 }, (_, i) => i * 2))).compressed === 'string'; } catch { return false; } })(), '200k number array');
check('big-dict-array-nocrash', (() => { try { return typeof J.crush(JSON.stringify(Array.from({ length: 120000 }, (_, i) => ({ id: i * 3, status: i % 100 ? 'ok' : 'error' })))).compressed === 'string'; } catch { return false; } })(), '120k dict array');

// ---------------------------------------------------------------- reduction (M1 exit gate) --
// Fixtures are committed alongside this suite — assert directly so a missing one fails loudly.
const ratio = (file) => J.slim(readFileSync(path.join(FIX, file), 'utf8')).ratio;
check('reduction:jira≥0.70', ratio('jira-issue-ELC-104.json') >= 0.70, `jira ratio ${ratio('jira-issue-ELC-104.json').toFixed(3)}`);
check('reduction:figma≥0.70', ratio('figma-node-rest.json') >= 0.70, `figma ratio ${ratio('figma-node-rest.json').toFixed(3)}`);
{
  const out = JSON.parse(J.slim(readFileSync(path.join(FIX, 'jql-search-ELC.json'), 'utf8')).output);
  check('jql-issues-crushed', out.issues.filter((x) => !x._ccr_dropped).length <= 15 && out.issues.some((x) => x._ccr_dropped), 'issues array crushed + marker');
}
// dropRestLinks materially reduces a JQL page (a `self` on every issue + nested resource).
{
  const raw = readFileSync(path.join(FIX, 'jql-search-ELC.json'), 'utf8');
  const on = J.slim(raw).bytesOut;
  const off = J.slim(raw, { dropRestLinks: false }).bytesOut;
  check('jql-self-drop-helps', off - on > 5000, `self-drop saved ${off - on} B (expected >5000)`);
  check('jql-no-self-links', !JSON.parse(J.slim(raw).output).issues.some((x) => x && x.self), 'no REST self survives on kept issues');
}

// ---------------------------------------------------------------- CLI dual entry --
{
  const inp = readFileSync(path.join(FIX, 'figma-node-rest.json'), 'utf8');
  const out = execFileSync('node', [SLIM], { input: inp, encoding: 'utf8' });
  check('cli-stdin', out.length < inp.length && JSON.parse(out), 'CLI over stdin compresses to valid JSON');
  const outFile = execFileSync('node', [SLIM, path.join(FIX, 'figma-node-rest.json')], { encoding: 'utf8' });
  check('cli-file', outFile.length < inp.length, 'CLI over a file compresses');
  const jqOut = execFileSync('node', [SLIM, '--jq', 'nodes', path.join(FIX, 'figma-node-rest.json')], { encoding: 'utf8' });
  check('cli-jq', JSON.parse(jqOut)['3326:39542'] !== undefined, '--jq narrows to a sub-path');
  const jqMiss = execFileSync('node', [SLIM, '--jq', 'no.such.path', path.join(FIX, 'figma-node-rest.json')], { encoding: 'utf8' });
  check('cli-jq-missing', jqMiss.trim() === 'null', '--jq missing path → null, no crash');

  // Non-JSON FILE → hand the path back instead of re-dumping the (whale-sized) content to stdout.
  const xmlPath = path.join(FIX, 'figma-metadata-3326-39542.xml');
  const xmlIn = readFileSync(xmlPath, 'utf8');
  const xmlOut = execFileSync('node', [SLIM, xmlPath], { encoding: 'utf8' });
  check('cli-nonjson-file-handback', xmlOut.includes(xmlPath) && !xmlOut.includes('<frame') && xmlOut.length < 200,
    'non-JSON file → path handback, not a content dump');
  // Non-JSON via STDIN → still passes through verbatim (there is no path to hand back).
  const stdinEcho = execFileSync('node', [SLIM], { input: 'plain text, not json', encoding: 'utf8' });
  check('cli-nonjson-stdin-echo', stdinEcho.trim() === 'plain text, not json',
    'non-JSON stdin → verbatim passthrough (no file to point at)');
}

// ---------------------------------------------------------------- spill-TTL sweep (M5) --
// spillTtlHours contract: default 24, exactly 0 disables, ANY invalid/negative → 24 (never a
// past cutoff that would mass-delete fresh spills).
eq('ttl-default', J.spillTtlHours(undefined), 24);
eq('ttl-empty', J.spillTtlHours(''), 24);
eq('ttl-valid', J.spillTtlHours('12'), 12);
eq('ttl-fractional', J.spillTtlHours('0.5'), 0.5);
eq('ttl-zero-disables', J.spillTtlHours('0'), 0);
eq('ttl-nonnumeric', J.spillTtlHours('abc'), 24);
eq('ttl-negative', J.spillTtlHours('-5'), 24); // a negative TTL must not become "everything is old"

// sweepSpills: seed a stale spill (mtime 1970) + a fresh one + a foreign-named + the debug log,
// then sweep with the default 24 h TTL. Only our-prefixed stale files go; the summary reports 1.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-sweep-'));
  const seed = (name, old) => { const p = path.join(dir, name); writeFileSync(p, '[]'); if (old) utimesSync(p, 1000, 1000); return p; };
  const stale = seed('fnd-crush-STALE.json', true);
  const fresh = seed('fnd-mcp-slim-FRESH.json', false);
  const foreign = seed('other-tool-STALE.json', true);
  const dbg = seed('fnd-mcp-slim-debug.log', true);
  const r = J.sweepSpills(dir);
  check('sweep-stale-deleted', !existsSync(stale), 'our-prefixed stale spill must be deleted');
  check('sweep-fresh-kept', existsSync(fresh), 'a fresh spill must survive (mtime, not a blanket rm)');
  check('sweep-foreign-kept', existsSync(foreign), 'a non-prefixed file must never be touched');
  check('sweep-debug-kept', existsSync(dbg), 'the M6 debug log is excluded by exact name');
  check('sweep-summary', r.swept === 1 && !r.disabled && !r.throttled, `summary ${JSON.stringify(r)}`);
  check('sweep-marker-made', existsSync(path.join(dir, '.fnd-mcp-slim-sweep')), 'throttle marker must be written');
  // throttle: a second sweep sees the fresh marker and skips — a stale file seeded after survives
  const stale2 = seed('fnd-crush-STALE2.json', true);
  const r2 = J.sweepSpills(dir);
  check('sweep-throttled', r2.throttled && existsSync(stale2), `throttle failed ${JSON.stringify(r2)}`);
  rmSync(dir, { recursive: true, force: true });
}
// FND_MCP_SLIM_TTL=0 disables the sweep entirely (env save/restore — don't leak into later cases)
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-sweep0-'));
  const p = path.join(dir, 'fnd-crush-S.json'); writeFileSync(p, '[]'); utimesSync(p, 1000, 1000);
  const prev = process.env.FND_MCP_SLIM_TTL;
  process.env.FND_MCP_SLIM_TTL = '0';
  const r = J.sweepSpills(dir);
  if (prev === undefined) delete process.env.FND_MCP_SLIM_TTL; else process.env.FND_MCP_SLIM_TTL = prev;
  check('sweep-ttl0-disabled', r.disabled && existsSync(p), `TTL=0 must keep the stale spill ${JSON.stringify(r)}`);
  rmSync(dir, { recursive: true, force: true });
}
// CLI entry sweeps at exit: a pre-seeded stale spill in FND_MCP_SLIM_DIR is gone after the run,
// while stdout stays valid + compressed (the sweep never touches output/exit code).
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-cli-sweep-'));
  const stale = path.join(dir, 'fnd-crush-STALE.json'); writeFileSync(stale, '[]'); utimesSync(stale, 1000, 1000);
  const inp = readFileSync(path.join(FIX, 'figma-node-rest.json'), 'utf8');
  const out = execFileSync('node', [SLIM], { input: inp, encoding: 'utf8', env: { ...process.env, FND_MCP_SLIM_DIR: dir } });
  check('cli-sweeps-stale', !existsSync(stale), 'the CLI exit sweep must prune a stale spill');
  check('cli-sweep-output-intact', out.length < inp.length && JSON.parse(out), 'CLI output stays valid + compressed despite the sweep');
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- slim() instrumentation (M6) --
// slim() reports the pipeline stages that actually changed bytes + a `reason` on non-compressing
// outcomes — the FND_MCP_SLIM_DEBUG feed. Assert on a real fixture and the passthrough branches.
{
  // `stages` is opt-in (cfg.trace) — the debug feed sets it; a plain slim() call leaves it empty.
  const r = J.slim(readFileSync(path.join(FIX, 'jira-issue-ELC-104.json'), 'utf8'), { trace: true });
  check('slim-stages-array', Array.isArray(r.stages) && r.stages.includes('adf') && r.stages.includes('crush'), `stages ${JSON.stringify(r.stages)}`);
  check('slim-stages-subset', r.stages.every((s) => ['adf', 'noise', 'truncate', 'crush', 'toon'].includes(s)), `unexpected stage in ${JSON.stringify(r.stages)}`);
  eq('slim-stages-off-empty', J.slim(readFileSync(path.join(FIX, 'jira-issue-ELC-104.json'), 'utf8')).stages, []); // trace off ⇒ no bookkeeping
  eq('slim-nonjson-reason', J.slim('plain text, not json').reason, 'non-json');
  eq('slim-nonjson-stages', J.slim('plain text, not json').stages, []);
  eq('slim-error-reason', J.slim(JSON.stringify({ errors: [{ message: 'boom' }] })).reason, 'error-shape');
  check('slim-ok-no-reason', J.slim(JSON.stringify({ a: 1 })).reason === undefined, 'a compressible-shape result carries no reason');
}

// ---------------------------------------------------------------- debug log (M6) --
// debugEnabled(): only 1/true/yes/on turns it on; unset / 0 / false → off (zero side effects).
{
  const prev = process.env.FND_MCP_SLIM_DEBUG;
  const set = (v) => { if (v === undefined) delete process.env.FND_MCP_SLIM_DEBUG; else process.env.FND_MCP_SLIM_DEBUG = v; };
  set(undefined); check('dbg-enabled-unset', J.debugEnabled() === false, 'unset → off');
  set('1');       check('dbg-enabled-1', J.debugEnabled() === true, '1 → on');
  set('true');    check('dbg-enabled-true', J.debugEnabled() === true, 'true → on');
  set('0');       check('dbg-enabled-0', J.debugEnabled() === false, '0 → off');
  set('false');   check('dbg-enabled-false', J.debugEnabled() === false, 'false → off');
  set(prev);
}

// debugLog: disabled → creates nothing; enabled → appends one parseable JSONL line with `ts`.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-dbg-'));
  const prev = process.env.FND_MCP_SLIM_DEBUG;
  const logp = path.join(dir, 'fnd-mcp-slim-debug.log');
  delete process.env.FND_MCP_SLIM_DEBUG;
  J.debugLog({ entry: 'cli', decision: 'passthrough' }, dir);
  check('dbg-off-no-file', !existsSync(logp), 'disabled debugLog must not create a file');
  process.env.FND_MCP_SLIM_DEBUG = '1';
  J.debugLog({ entry: 'cli', decision: 'compressed', bytes_in: 100, bytes_out: 40 }, dir);
  J.debugLog({ entry: 'cli', decision: 'passthrough', reason: 'size-gate' }, dir);
  if (prev === undefined) delete process.env.FND_MCP_SLIM_DEBUG; else process.env.FND_MCP_SLIM_DEBUG = prev;
  const lines = readFileSync(logp, 'utf8').trim().split('\n');
  check('dbg-two-lines', lines.length === 2, `got ${lines.length} lines`);
  const first = JSON.parse(lines[0]);
  check('dbg-line-shape', first.entry === 'cli' && first.decision === 'compressed' && typeof first.ts === 'string', `line ${lines[0]}`);
  rmSync(dir, { recursive: true, force: true });
}

// rotation: a log past ~5 MB is renamed to .log.1 before the next line lands in a fresh .log.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-dbgrot-'));
  const prev = process.env.FND_MCP_SLIM_DEBUG;
  const logp = path.join(dir, 'fnd-mcp-slim-debug.log');
  writeFileSync(logp, 'x'.repeat(5 * 1024 * 1024 + 1)); // just over the 5 MB cap
  process.env.FND_MCP_SLIM_DEBUG = '1';
  J.debugLog({ entry: 'cli', decision: 'compressed' }, dir);
  if (prev === undefined) delete process.env.FND_MCP_SLIM_DEBUG; else process.env.FND_MCP_SLIM_DEBUG = prev;
  check('dbg-rotated', existsSync(`${logp}.1`), 'oversize log rotated to .log.1');
  check('dbg-fresh-line', readFileSync(logp, 'utf8').trim().split('\n').length === 1, 'fresh log holds exactly the new line');
  rmSync(dir, { recursive: true, force: true });
}

// CLI entry logs `entry:"cli"` at exit with a compressed decision + stages (opt-in, no stdout impact).
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-dbgcli-'));
  const out = execFileSync('node', [SLIM, path.join(FIX, 'figma-node-rest.json')],
    { encoding: 'utf8', env: { ...process.env, FND_MCP_SLIM_DIR: dir, FND_MCP_SLIM_DEBUG: '1' } });
  check('cli-dbg-output-intact', JSON.parse(out) && out.length > 0, 'CLI stdout still valid despite debug logging');
  const line = JSON.parse(readFileSync(path.join(dir, 'fnd-mcp-slim-debug.log'), 'utf8').trim());
  check('cli-dbg-entry', line.entry === 'cli', `entry ${line.entry}`);
  check('cli-dbg-decision', line.decision === 'compressed', `decision ${line.decision}`);
  check('cli-dbg-tool', typeof line.tool === 'string' && line.tool.endsWith('figma-node-rest.json'), `tool ${line.tool}`);
  check('cli-dbg-stages', Array.isArray(line.stages) && line.stages.length > 0, `stages ${JSON.stringify(line.stages)}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- non-json format sniff (M8) --
// slim()'s `format` tag classifies a NON-JSON payload for the FND_MCP_SLIM_DEBUG log — set ONLY on
// the non-json branch (undefined on every compressing / error / success path). Fixed vocabulary:
// html / xml / broken-json / text.
eq('m8-format-xml', J.slim(readFileSync(path.join(FIX, 'figma-metadata-3326-39542.xml'), 'utf8')).format, 'xml');
eq('m8-format-html', J.slim('<!DOCTYPE html><html><body>hi</body></html>').format, 'html');
{
  // A truncated ELC-104 prefix: starts with `{` yet is unparseable → the `broken-json` diagnostic.
  const brokenPrefix = readFileSync(path.join(FIX, 'jira-issue-ELC-104.json'), 'utf8').slice(0, 200);
  eq('m8-format-broken-json', J.slim(brokenPrefix).format, 'broken-json');
}
eq('m8-format-text', J.slim('plain prose, not markup at all').format, 'text');
check('m8-format-absent-on-json', J.slim(JSON.stringify({ a: 1 })).format === undefined, 'a compressible JSON result must carry no format tag');
check('m8-format-absent-on-error', J.slim(JSON.stringify({ errors: [{ message: 'boom' }] })).format === undefined, 'an error-shape result must carry no format tag');

// `project` on EVERY debug line (M8): basename(cwd), added centrally in debugLog(); `format` rides
// through from the caller's record and lands verbatim in the JSONL line.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-m8proj-'));
  const prev = process.env.FND_MCP_SLIM_DEBUG;
  process.env.FND_MCP_SLIM_DEBUG = '1';
  J.debugLog({ entry: 'cli', decision: 'compressed' }, dir);
  J.debugLog({ entry: 'cli', decision: 'passthrough', reason: 'non-json', format: 'xml' }, dir);
  if (prev === undefined) delete process.env.FND_MCP_SLIM_DEBUG; else process.env.FND_MCP_SLIM_DEBUG = prev;
  const lines = readFileSync(path.join(dir, 'fnd-mcp-slim-debug.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const proj = path.basename(process.cwd());
  check('m8-project-every-line', lines.length === 2 && lines.every((l) => l.project === proj), `project missing/wrong: ${JSON.stringify(lines.map((l) => l.project))}`);
  check('m8-format-in-line', lines[1].format === 'xml', `format not carried into the JSONL line: ${JSON.stringify(lines[1])}`);
  check('m8-format-absent-when-omitted', lines[0].format === undefined, `compressed line must carry no format: ${JSON.stringify(lines[0])}`);
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- JSONL detection (M9) --
// A bulk-operation line stream (one JSON value per line) is a same-shape array — parseJsonl routes
// it into the normal pipeline instead of slim()'s non-json handback. Strict gate: every non-blank
// line an object/array, ≥2 rows; one failing line rejects the whole payload (a truncated bulk file
// falls back to the path handback — no partial salvage).
check('m9-jsonl-all-objects', (() => { const r = J.parseJsonl('{"id":1,"h":"a"}\n{"id":2,"h":"b"}\n{"id":3,"h":"c"}'); return Array.isArray(r) && r.length === 3 && r[0].id === 1; })(), 'all-object lines → rows');
check('m9-jsonl-array-rows', (() => { const r = J.parseJsonl('[1,2]\n[3,4]'); return Array.isArray(r) && r.length === 2; })(), 'object-or-array lines → rows (arrays count)');
check('m9-jsonl-prose-line-null', J.parseJsonl('{"id":1}\nnot json here\n{"id":2}') === null, 'one prose line among JSON → null');
check('m9-jsonl-bare-scalar-null', J.parseJsonl('42\ntrue\n7') === null, 'bare-scalar lines (42/true) → null, never swallowed as data');
check('m9-jsonl-bare-null-null', J.parseJsonl('{"id":1}\nnull\n{"id":2}') === null, 'a bare null line is not a data row → null');
check('m9-jsonl-single-line-null', J.parseJsonl('{"only":1}') === null, 'a single line → null (≥2 rows required)');
check('m9-jsonl-blank-only-null', J.parseJsonl('\n  \n\t\n') === null, 'no non-blank lines → null');
check('m9-jsonl-bom-trailing-blanks', (() => { const r = J.parseJsonl('\uFEFF{"id":1}\n{"id":2}\n\n   \n'); return Array.isArray(r) && r.length === 2; })(), 'BOM + trailing blank/whitespace lines → ok');

// slim() on a JSONL string → the array flows through noise+crush; output is ONE JSON array, not
// JSONL. Synthetic 500-row bulk-shape product dump (M1 pattern; no committed fixture) — repetitive
// non-id content so the crush spills the tail behind a <<full=…>> marker.
{
  const jsonl = Array.from({ length: 500 }, (_, i) =>
    JSON.stringify({ id: `gid://shopify/Product/${1000 + i}`, status: 'ACTIVE', vendor: 'MAC', productType: 'Lipstick', publishedAt: '2024-01-01' })).join('\n');
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-m9-'));
  const r = J.slim(jsonl, { spillDir: dir });
  check('m9-slim-modified', r.wasModified && r.bytesOut < r.bytesIn, `wasModified=${r.wasModified} ${r.bytesIn}->${r.bytesOut}`);
  check('m9-slim-is-array', (() => { try { return Array.isArray(JSON.parse(r.output)); } catch { return false; } })(), 'compressed JSONL re-serializes as ONE JSON array');
  check('m9-slim-crush-ran', r.output.includes('_ccr_dropped'), 'crush ran (dropped rows behind a <<full=…>> marker)');
  check('m9-slim-reduction', r.ratio >= 0.70, `≥70% reduction, got ${(r.ratio * 100).toFixed(1)}%`);
  check('m9-slim-no-reason', r.reason === undefined && r.format === undefined, 'a compressed JSONL result carries no non-json reason/format');
  // trace on → the pipeline records `jsonl` alongside the byte-changing stages; off ⇒ empty.
  const rt = J.slim(jsonl, { trace: true, spillDir: dir });
  check('m9-slim-trace-stage', rt.stages.includes('jsonl') && rt.stages.includes('crush'), `stages ${JSON.stringify(rt.stages)}`);
  eq('m9-slim-trace-off-empty', J.slim(jsonl, { spillDir: dir }).stages, []);
  // {jsonl:false} → today's non-json behavior, byte-identical (format still sniffed → broken-json).
  const off = J.slim(jsonl, { jsonl: false });
  check('m9-jsonl-off-nonjson', !off.wasModified && off.reason === 'non-json' && off.output === jsonl, 'jsonl:false → non-json passthrough, verbatim');
  check('m9-jsonl-off-format', off.format === 'broken-json', 'jsonl:false → format still sniffed (leading { → broken-json)');
  rmSync(dir, { recursive: true, force: true });
}

// A MIXED-type JSONL stream (object rows + array rows — parseJsonl blesses both) crushes via the
// mixed path. Rows the dict subgroup drops must NOT vanish silently: sampleMixedArray appends ONE
// {_ccr_dropped:…} sentinel over the whole array with a working spill handle (the M9 CLI never
// spills the whole original the way the M2 hook does). Guards the medium-severity silent-drop bug.
{
  const objRows = Array.from({ length: 20 }, (_, i) => JSON.stringify({ id: i, status: 'ACTIVE', vendor: 'MAC', productType: 'Lipstick' }));
  const arrRows = Array.from({ length: 20 }, (_, i) => JSON.stringify([i, `x${i}`, true]));
  const jsonl = objRows.concat(arrRows).join('\n');
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-m9mix-'));
  const r = J.slim(jsonl, { spillDir: dir });
  const out = JSON.parse(r.output);
  const markers = out.filter((x) => x && typeof x === 'object' && !Array.isArray(x) && x._ccr_dropped);
  check('m9-mixed-drop-marked', markers.length === 1 && /^<<full=.+ \d+_rows_offloaded>>$/.test(markers[0]._ccr_dropped),
    `mixed drop must carry exactly one full= sentinel; got ${JSON.stringify(markers.map((m) => m._ccr_dropped))}`);
  // No row is lost silently: kept real rows + offloaded count reconcile to the 40 inputs, and the
  // spill file actually holds the dropped rows (recoverable, not a dangling handle).
  const m = markers[0]._ccr_dropped.match(/full=(\S+) (\d+)_rows_offloaded/);
  const spillPath = m[1], offloaded = Number(m[2]);
  const keptReal = out.filter((x) => !(x && typeof x === 'object' && !Array.isArray(x) && x._ccr_dropped)).length;
  check('m9-mixed-no-silent-loss', keptReal + offloaded === 40, `kept ${keptReal} + offloaded ${offloaded} != 40 inputs`);
  check('m9-mixed-spill-roundtrips', existsSync(spillPath) && JSON.parse(readFileSync(spillPath, 'utf8')).length === offloaded,
    `spill file must hold the ${offloaded} dropped rows`);
  rmSync(dir, { recursive: true, force: true });
}

// non-JSONL text → unchanged non-json/format behavior; a truly truncated payload stays broken-json.
check('m9-nonjsonl-prose-text', (() => { const r = J.slim('a plain prose line\nanother prose line'); return r.reason === 'non-json' && r.format === 'text'; })(), 'multi-line prose stays non-json/text');
check('m9-broken-json-preserved', (() => { const r = J.slim('{"id":1,\n"unterminated'); return r.reason === 'non-json' && r.format === 'broken-json'; })(), 'a truncated JSON payload still tags broken-json (no false JSONL salvage)');

// ------------------------------------------------- M9b Gate A: CLI output cap — huge JSON document --
// One huge JSON document over the inline cap (a wide-signal crush, or a null-heavy dump that
// noise-drops but does not sample) is spilled + summarized, never dumped to context. capOutput is the
// CLI seam for that ONE case; the cap is overridden via cfg (NOT env) so the test needs no real whale.
// (A JSONL file never reaches capOutput — it profiles upstream in the CLI.)
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-capA-'));
  const arr = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `entity-${i}`, blob: 'x'.repeat(40) }));
  const output = JSON.stringify(arr);
  const res = { output, bytesIn: 500000, bytesOut: Buffer.byteLength(output), ratio: 1 - Buffer.byteLength(output) / 500000 };
  const cap = J.capOutput(res, '/some/bulk.jsonl', { cliOutCap: 100, spillDir: dir });
  check('m9b-capA-fires', !!cap && typeof cap.handback === 'string' && typeof cap.spillOut === 'string', `capOutput must fire over cap: ${JSON.stringify(cap)}`);
  check('m9b-capA-stats-line', /→ .*bytes/.test(cap.handback) && cap.handback.includes('30 rows kept'), `stats line / rows-kept missing:\n${cap.handback}`);
  check('m9b-capA-first-row', cap.handback.includes('first row') && cap.handback.includes('"id":0'), 'first-row shape sample missing');
  check('m9b-capA-both-paths', cap.handback.includes(cap.spillOut) && cap.handback.includes('/some/bulk.jsonl'), 'slimmed-spill + original path must both appear');
  check('m9b-capA-jq-hint', cap.handback.includes('--jq'), '--jq narrow hint missing');
  check('m9b-capA-spill-roundtrips', existsSync(cap.spillOut) && readFileSync(cap.spillOut, 'utf8') === output, 'spill must hold the exact slimmed output');
  check('m9b-capA-undercap-null', J.capOutput(res, '/some/bulk.jsonl', { cliOutCap: 10_000_000, spillDir: dir }) === null, '≤ cap → null (caller prints the body unchanged)');
  check('m9b-capA-stdin-null', J.capOutput(res, null, { cliOutCap: 100, spillDir: dir }) === null, 'no fileArg (stdin) → null even over cap (no path to point at)');
  rmSync(dir, { recursive: true, force: true });
}
// spill-failure → null so the CLI falls back to printing (never lose the result)
{
  const badParent = path.join(mkdtempSync(path.join(tmpdir(), 'jslim-capAro-')), 'not-a-dir');
  writeFileSync(badParent, 'x'); // a FILE — using it as a spill parent dir fails
  const output = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: i })));
  const res = { output, bytesIn: 999999, bytesOut: Buffer.byteLength(output), ratio: 0.9 };
  check('m9b-capA-spill-fail-null', J.capOutput(res, '/some/bulk.jsonl', { cliOutCap: 10, spillDir: path.join(badParent, 'sub') }) === null, 'a spill-write failure returns null → CLI prints the body (never lose the result)');
}

// NB a JSONL FILE via the CLI never reaches capOutput at all — it profiles upstream (the CLI
// scripts-sim J-cases cover that end-to-end). capOutput is the non-JSONL huge-document seam only.

// ---------------------------------------------------------------- M9b Gate B: streaming profile --
// profileLines feeds raw line strings through the SAME accumulator streamProfile runs over a file
// stream — a small synthetic exercises counts / nulls / distinct-cap / samples / parse-failure
// tolerance without a real whale (the >8 MB gate is a CLI concern, tested in scripts-sim).
{
  const good = Array.from({ length: 50 }, (_, i) => JSON.stringify({ id: i, status: i % 2 ? 'ACTIVE' : 'DRAFT', note: i % 5 === 0 ? null : `n${i}` }));
  const lines = good.concat(['', '   ', 'not json at all', '42', JSON.stringify({ id: 999, extra: 'x' })]);
  const p = J.profileLines(lines, { file: '/x/bulk.jsonl', bytes: 12345 });
  check('m9b-prof-meta', p.profile === true && p.file === '/x/bulk.jsonl' && p.bytes === 12345, `profile meta wrong: ${JSON.stringify({ profile: p.profile, file: p.file, bytes: p.bytes })}`);
  check('m9b-prof-rows', p.rows === 51, `object rows: got ${p.rows} (50 good + 1 extra; blanks skipped)`);
  check('m9b-prof-parsefail-tolerated', p.parseFailures === 2, `parse failures tolerated + counted: got ${p.parseFailures} (prose line + bare scalar 42)`);
  check('m9b-prof-presence', p.keys.id.present === 51 && p.keys.status.present === 50, `presence: ${JSON.stringify({ id: p.keys.id.present, status: p.keys.status.present })}`);
  check('m9b-prof-nulls', p.keys.note.null === 10, `note nulls: got ${p.keys.note.null} (i%5===0 over 50 rows)`);
  check('m9b-prof-type', p.keys.status.type === 'str', `status type: ${p.keys.status.type}`);
  check('m9b-prof-samples', p.samples.head.length === 5 && p.samples.tail.length === 5 && p.samples.reservoir.length === 10, `sample sizes: ${JSON.stringify({ h: p.samples.head.length, t: p.samples.tail.length, r: p.samples.reservoir.length })}`);
  check('m9b-prof-sample-content', p.samples.head[0].id === 0 && p.samples.tail[p.samples.tail.length - 1].id === 999, 'head=first rows, tail=last rows');
}
// distinct cap at 1000: 1500 unique values → distinct reported as 1000 with the capped flag
{
  const p = J.profileLines(Array.from({ length: 1500 }, (_, i) => JSON.stringify({ v: `unique-${i}` })), {});
  check('m9b-prof-distinct-cap', p.keys.v.distinct === 1000 && p.keys.v.distinctCapped === true, `distinct cap: ${JSON.stringify(p.keys.v)}`);
}
// ARRAY-row JSONL (tuple rows, `[1,2,3]` per line) is legitimate bulk data — parseJsonl accepts object
// OR array rows, so profileFeed must too. Regression: arrays were counted as parseFailures → a valid
// array-row file profiled as rows:0/empty-keys. Now they profile by index-key ("0","1",…).
{
  const p = J.profileLines(['[1,2,3]', '[4,5,6]', '[7,8,9]'], { file: '/x/arr.jsonl' });
  check('m9b-prof-array-rows', p.rows === 3 && p.parseFailures === 0, `array rows counted, not failed: ${JSON.stringify({ rows: p.rows, pf: p.parseFailures })}`);
  check('m9b-prof-array-index-keys', !!p.keys['0'] && p.keys['0'].present === 3 && p.keys['2'].type === 'number', `index-key stats: ${JSON.stringify(p.keys)}`);
  check('m9b-prof-array-samples', Array.isArray(p.samples.head[0]) && p.samples.head[0][0] === 1, `array rows appear verbatim in samples: ${JSON.stringify(p.samples.head[0])}`);
}
// A WIDE row (200 keys of long names) must NOT blow the profile past PROFILE_BYTE_CAP (8000). A count
// cap alone doesn't bound bytes — keys are trimmed by BYTES via a binary search and the drop recorded
// in keysTruncated. Regression: the size ladder only trimmed samples, so keys emitted 22 KB.
{
  const wide = {}; for (let i = 0; i < 200; i++) wide[`key_${i}_${'x'.repeat(50)}`] = `v${i}`;
  const line = JSON.stringify(wide);
  const p = J.profileLines([line, line, line], { file: '/x/wide.jsonl' });
  const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
  check('m9b-prof-wide-cap', bytes <= 8000, `wide profile must fit the byte cap: got ${bytes} B`);
  check('m9b-prof-wide-truncated', p.keysTruncated > 0 && Object.keys(p.keys).length < 200, `keysTruncated=${p.keysTruncated}, shown=${Object.keys(p.keys).length}`);
  check('m9b-prof-wide-rows', p.rows === 3, `rows still counted under the cap: ${p.rows}`);
}
// A single monster key name (bigger than the whole cap) collapses to keys:{} with keysTruncated set —
// the binary search converges at 0 rather than looping (the base profile without keys is tiny).
{
  const mega = { ['m'.repeat(20000)]: 1, b: 2 };
  const line = JSON.stringify(mega);
  const p = J.profileLines([line, line], { file: '/x/mega.jsonl' });
  const bytes = Buffer.byteLength(JSON.stringify(p), 'utf8');
  check('m9b-prof-mega-key-cap', bytes <= 8000 && Object.keys(p.keys).length === 0 && p.keysTruncated === 2, `mega key collapses under cap: ${bytes} B, shown ${Object.keys(p.keys).length}, trunc ${p.keysTruncated}`);
}
// streamProfile over a real (small) file — the async path the CLI Gate B uses; O(samples) memory.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-prof-'));
  const f = path.join(dir, 'rows.jsonl');
  writeFileSync(f, Array.from({ length: 12 }, (_, i) => JSON.stringify({ id: i, k: `v${i}` })).join('\n') + '\n');
  const p = await J.streamProfile(f);
  check('m9b-streamprofile', p.profile === true && p.rows === 12 && p.file === f && p.bytes > 0, `streamProfile: ${JSON.stringify({ rows: p.rows, file: p.file, bytes: p.bytes })}`);
  rmSync(dir, { recursive: true, force: true });
}
// Gate-A output spill (fnd-slim-out-*) is swept by the same mtime TTL — stale gone, fresh kept.
{
  const dir = mkdtempSync(path.join(tmpdir(), 'jslim-sweepout-'));
  const seed = (name, old) => { const p = path.join(dir, name); writeFileSync(p, '[]'); if (old) utimesSync(p, 1000, 1000); return p; };
  const stale = seed('fnd-slim-out-STALE.json', true);
  const fresh = seed('fnd-slim-out-FRESH.json', false);
  const r = J.sweepSpills(dir);
  check('m9b-sweep-out-stale', !existsSync(stale), 'stale fnd-slim-out-* must be swept');
  check('m9b-sweep-out-fresh', existsSync(fresh), 'fresh fnd-slim-out-* must survive');
  check('m9b-sweep-out-summary', r.swept === 1, `summary ${JSON.stringify(r)}`);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`json-slim fixtures: ${pass} passed, ${fail} failed  (parity ${byteExact} byte-exact + ${valueOnly} value-parity of 17)`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
