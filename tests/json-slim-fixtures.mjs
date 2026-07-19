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

console.log(`json-slim fixtures: ${pass} passed, ${fail} failed  (parity ${byteExact} byte-exact + ${valueOnly} value-parity of 17)`);
if (fail) { console.log(failures.join('\n')); process.exit(1); }
