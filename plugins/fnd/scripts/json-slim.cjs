#!/usr/bin/env node
/*
 * json-slim.cjs — shape-driven compressor for large JSON (MCP tool results, saved dumps).
 *
 * Dual entry point (one home for the transform):
 *   - require()d as a module by the mcp-slim PostToolUse hook (M2) — { slim, crush, crushValue };
 *   - a standalone CLI to compress an already-saved dump on demand:
 *       node json-slim.cjs <file.json> [--jq <path>] [--toon] [--no-spill] [--stats]
 *       cat big.json | node json-slim.cjs
 *
 * The pipeline is shape-driven (each stage independent, all generic — no per-tool registry),
 * applied by slim() in this order:
 *   1. ADF/rich-doc → markdown via adf-to-md.cjs (the single converter home);
 *   2. noise drop (nulls / empty containers / avatar-class decoration / self REST links);
 *   3. long-string truncation (base64 / data-URIs / long URLs);
 *   4. repetitive same-shape-array crush (a faithful port of Headroom's SmartCrusher).
 * The array-crush spills dropped rows to a file and leaves a `full=<path>` handle, so nothing
 * is lost — the detail is one `Read`/`jq` away.
 *
 * Pure Node built-ins only (repo policy): fs, os, path, crypto + the local adf converter.
 *
 * -----------------------------------------------------------------------------------------------
 * The array-crush (§ crushValue / analyseDictArray / sampleNumberArray / sampleStringArray) is a
 * port of the deterministic (empty-query) path of Headroom's SmartCrusher.
 *   Headroom — https://github.com/headroomlabs-ai/headroom — Copyright 2025 Headroom Contributors.
 *   Licensed under the Apache License, Version 2.0 (see tests/parity/NOTICE for attribution).
 * This is a modified re-implementation in JavaScript; behaviour is pinned against Headroom's own
 * parity fixtures (tests/json-slim-fixtures.mjs, "parity:*" cases).
 * -----------------------------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { adfToMarkdown } = require('./adf-to-md.cjs');

// ---------------------------------------------------------------------------- config --

// Defaults mirror Headroom's SmartCrusherConfig (the crush knobs) plus fnd pipeline knobs.
// Only the crush knobs affect parity; the pipeline knobs gate the fnd-specific stages.
const DEFAULTS = {
  // --- array crush (SmartCrusher parity) ---
  minItemsToAnalyze: 5, // arrays with < N items are recursed into, never crushed
  maxItemsAfterCrush: 15, // hard cap on kept real rows
  firstFraction: 0.3, // number/string paths: leading slice kept
  lastFraction: 0.15, // number/string paths: trailing slice kept
  varianceThreshold: 2, // the σ-multiplier for outliers / anomalies / change-points
  preserveChangePoints: true,
  dedupIdenticalItems: true,
  enableMarker: true, // append the {_ccr_dropped:…} sentinel when rows are offloaded
  markerMode: 'spill', // 'spill' → write dropped rows to a file, handle = full=<path>;
  //                       'ccr'   → reproduce Headroom's content hash (byte-parity tests only)
  spillDir: null, // override the spill directory (else FND_MCP_SLIM_DIR, else os.tmpdir())
  // --- fnd pipeline stages (slim only, not crush) ---
  adf: true, // stage 1: ADF doc nodes → markdown
  noise: true, // stage 3: drop nulls / empty containers / avatar-class keys
  dropRestLinks: true, // stage 3: drop `self` REST-navigation URLs (Jira/Confluence _links.self)
  truncate: true, // stage 4: clip base64 / data-URI / very long strings
  stringLimit: 200, // stage 4 threshold (chars)
  toon: false, // optional lossless tabular re-serialization of uniform arrays (behind a flag)
  trace: false, // instrument `stages` (which stages changed bytes) for the FND_MCP_SLIM_DEBUG feed;
  //               off ⇒ a single final compact() (pre-M6 cost) — the hot path pays nothing when off
  // preserveFields { keyName: true } leaves the value/subtree under those keys uncrushed. Escape
  // hatch: name an ARRAY's own key to keep it whole — a field inside crushable rows does NOT shield
  // those rows from sampling (row-level preserve is a possible future enhancement).
  preserveFields: {},
};

// Substring-matched (lower-cased compact JSON) → the item is preserved as an "error" row.
const ERROR_KEYWORDS = [
  'error', 'exception', 'failed', 'failure', 'critical', 'fatal',
  'crash', 'panic', 'abort', 'timeout', 'denied', 'rejected',
];

// ---------------------------------------------------------------------------- helpers --

const trunc = Math.trunc;

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'list';
  const t = typeof v;
  if (t === 'boolean') return 'bool';
  if (t === 'number') return 'number';
  if (t === 'string') return 'str';
  if (t === 'object') return 'dict';
  return 'other'; // undefined / function — never appears in parsed JSON
}

// compactSerialize: no spaces, insertion-order keys, non-ASCII kept as UTF-8 — matches Python
// json.dumps(x, separators=(',',':'), ensure_ascii=False) for the payloads we handle.
const compact = (v) => JSON.stringify(v);

// Banker's rounding (round-half-to-even) — the number/string split uses it.
function roundHalfEven(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// Loop-based min/max — `Math.min(...arr)` throws RangeError past ~1e5 elements (stack overflow).
function minMax(nums) {
  let mn = Infinity, mx = -Infinity;
  for (const v of nums) { if (v < mn) mn = v; if (v > mx) mx = v; }
  return { min: mn, max: mx };
}

// Sample standard deviation (n-1 divisor) — the σ that feeds every 2σ gate.
function sampleStd(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  const v = nums.reduce((a, b) => a + (b - m) * (b - m), 0) / (nums.length - 1);
  return Math.sqrt(v);
}

function median(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Linear-interpolation percentile over a sorted array (0..100).
function percentile(sorted, p) {
  const n = sorted.length;
  if (!n) return 0;
  if (n === 1) return sorted[0];
  const rank = (p / 100) * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (rank - lo) * (sorted[hi] - sorted[lo]);
}

function sha256hex12(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 12);
}

// Format a stat for the number-path strategy string: round to 2 decimals, strip trailing zeros.
function fmtStat(x) {
  if (Number.isInteger(x)) return String(x);
  let s = x.toFixed(2);
  s = s.replace(/\.?0+$/, '');
  return s;
}

// ------------------------------------------------------------------- array classification --

function classifyArray(arr) {
  if (arr.length === 0) return 'Empty';
  let bool = true, dict = true, str = true, num = true, list = true;
  for (const x of arr) {
    const t = jsonType(x);
    if (t !== 'bool') bool = false;
    if (t !== 'dict') dict = false;
    if (t !== 'str') str = false;
    if (t !== 'number') num = false;
    if (t !== 'list') list = false;
  }
  if (bool) return 'BoolArray';
  if (dict) return 'DictArray';
  if (str) return 'StringArray';
  if (num) return 'NumberArray';
  if (list) return 'NestedArray';
  return 'MixedArray'; // anything else, including any null element
}

// ---------------------------------------------------------------------- budget K (adaptive) --

// Faithful-in-spirit port of compute_optimal_k. Headroom uses SimHash(MD5 4-gram)+Kneedle+zlib to
// pick a per-array budget; we use distinct-count uniqueness + the knee-fallback formula. Both agree
// on every SmartCrusher parity fixture (diverse arrays → 15, all-identical → 3). CEILING: on a real
// payload with near-duplicate-but-not-identical rows the SimHash clustering could pick a tighter
// budget than distinct-count does; upgrade path = port SimHash/Kneedle if a payload ever needs it.
function computeOptimalK(itemStrings, bias, minK, maxK) {
  const n = itemStrings.length;
  if (n <= 8) return n;
  const uniq = new Set(itemStrings).size;
  const clamp = (x) => Math.max(minK, Math.min(x, maxK));
  if (uniq <= 3) return clamp(Math.max(3, uniq));
  const d = uniq / n;
  const knee = Math.max(3, trunc(n * (0.3 + 0.7 * d)));
  let k = Math.max(3, trunc(knee * bias));
  k = Math.min(k, maxK);
  return Math.max(3, Math.min(k, maxK));
}

// number/string split — round-half-to-even, clamped so first+last ≤ total.
function computeKSplit(kTotal, cfg) {
  let kFirst = Math.max(1, roundHalfEven(kTotal * cfg.firstFraction));
  let kLast = Math.max(1, roundHalfEven(kTotal * cfg.lastFraction));
  kFirst = Math.min(kFirst, kTotal);
  kLast = Math.min(kLast, kTotal - kFirst);
  return { kFirst, kLast };
}

// -------------------------------------------------------------- dict-array field statistics --

// Sorted (ASCII) union of keys across all items — the determinism contract; a missing key = null.
function unionKeys(items) {
  const set = new Set();
  for (const it of items) for (const k of Object.keys(it)) set.add(k);
  return [...set].sort();
}

function fieldValues(items, key) {
  return items.map((it) => (Object.prototype.hasOwnProperty.call(it, key) ? it[key] : null));
}

function uniqueRatio(values) {
  if (!values.length) return 0;
  const set = new Set(values.map((v) => compact(v)));
  return set.size / values.length;
}

function firstNonNullType(values) {
  for (const v of values) {
    if (v === null) continue;
    const t = typeof v;
    if (t === 'boolean') return 'bool';
    if (t === 'number') return 'number';
    if (t === 'string') return 'string';
    return 'other';
  }
  return 'null';
}

// A field is id-like when its values are (near-)unique and look like identifiers.
function idConfidence(values, key) {
  const present = values.filter((v) => v !== null);
  if (!present.length) return 0;
  const ur = uniqueRatio(values);
  if (ur < 0.9) return 0; // hard gate
  const type = firstNonNullType(values);
  if (type === 'string') {
    const sample = present.slice(0, 20);
    const uuidish = sample.filter((v) => /^[0-9a-fA-F-]{8,}$/.test(String(v))).length;
    if (uuidish > 0.8 * sample.length) return 0.95;
    if (ur > 0.95) return 0.8;
  } else if (type === 'number') {
    const nums = present.map(Number);
    let sequential = true;
    for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] !== 1) { sequential = false; break; }
    if (sequential && ur > 0.95) return 0.9;
    const mm = minMax(nums);
    const range = mm.max - mm.min;
    if (range > 0 && ur > 0.95) return 0.85;
  }
  if (ur > 0.98) return 0.7;
  return 0;
}

// Structural outliers: items owning a rare field, or holding a rare value in an otherwise-uniform
// common field. Returns a Set of indices. (§ detect_structural_outliers)
function structuralOutliers(items, keys) {
  const n = items.length;
  const out = new Set();
  if (n < 5) return out;
  const presence = {};
  for (const k of keys) presence[k] = items.filter((it) => Object.prototype.hasOwnProperty.call(it, k)).length;
  const rareFields = keys.filter((k) => presence[k] < n * 0.2);
  const commonFields = keys.filter((k) => presence[k] >= n * 0.8);
  // rare-field owners
  items.forEach((it, i) => {
    if (rareFields.some((k) => Object.prototype.hasOwnProperty.call(it, k))) out.add(i);
  });
  // rare-status values in common fields
  for (const k of commonFields) {
    const values = fieldValues(items, k);
    const distinct = new Set(values.filter((v) => v !== null).map((v) => compact(v)));
    const card = distinct.size;
    if (card < 2 || card > 50) continue;
    const counts = new Map();
    for (const v of values) {
      const key = v === null ? '__none__' : compact(v);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const total = values.length;
    const threshold = Math.ceil(total * 0.8);
    const ordered = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const topK = new Set();
    let cum = 0;
    for (const [val, c] of ordered) {
      topK.add(val);
      cum += c;
      if (cum >= threshold) break;
    }
    if (topK.size > 5) continue;
    values.forEach((v, i) => {
      const key = v === null ? '__none__' : compact(v);
      if (!topK.has(key)) out.add(i);
    });
  }
  return out;
}

function errorItems(items) {
  const out = new Set();
  items.forEach((it, i) => {
    const s = compact(it).toLowerCase();
    if (ERROR_KEYWORDS.some((kw) => s.includes(kw))) out.add(i);
  });
  return out;
}

// Per numeric field, indices where |v - mean| > 2σ (strict). (§ anomaly_count)
function numericAnomalies(items, keys, cfg) {
  const out = new Set();
  for (const k of keys) {
    const values = fieldValues(items, k);
    if (firstNonNullType(values) !== 'number') continue;
    const nums = [];
    const idx = [];
    values.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v)) { nums.push(v); idx.push(i); } });
    if (nums.length < 2) continue;
    const m = mean(nums);
    const sd = sampleStd(nums);
    if (sd <= 0) continue;
    nums.forEach((v, j) => { if (Math.abs(v - m) > cfg.varianceThreshold * sd) out.add(idx[j]); });
  }
  return out;
}

// Change points on a numeric series: window-5 running means, |R-L| > 2·(global σ), ≥ window apart.
function changePointsForSeries(nums, cfg) {
  const out = new Set();
  const n = nums.length;
  if (n < 10) return out;
  const sd = sampleStd(nums);
  if (sd <= 0) return out;
  const w = 5;
  const cps = [];
  for (let i = w; i < n - w; i++) {
    const L = mean(nums.slice(i - w, i));
    const R = mean(nums.slice(i, i + w));
    if (Math.abs(R - L) > cfg.varianceThreshold * sd) cps.push(i);
  }
  // greedy dedup: keep change-points more than `window` apart
  let last = -Infinity;
  for (const cp of cps) { if (cp - last > w) { out.add(cp); last = cp; } }
  return out;
}

function dictChangePoints(items, keys, cfg) {
  const out = new Set();
  for (const k of keys) {
    const values = fieldValues(items, k);
    if (firstNonNullType(values) !== 'number') continue;
    const nums = values.map((v) => (typeof v === 'number' ? v : NaN));
    if (nums.some((x) => Number.isNaN(x))) continue; // needs a full numeric column
    for (const cp of changePointsForSeries(nums, cfg)) out.add(cp);
  }
  return out;
}

// ------------------------------------------------------------------ dict-array analysis --

// Decide whether a dict array is worth crushing and which generic strategy applies.
// Returns { crushable, strategy, reason, signals:{errors,structural,anomalies,changePoints} }.
function analyseDictArray(items, cfg) {
  const n = items.length;
  const keys = unionKeys(items);

  // id field = the max-confidence id-like field (first in sorted order wins ties)
  let idKey = null, bestConf = 0;
  for (const k of keys) {
    const conf = idConfidence(fieldValues(items, k), k);
    if (conf > bestConf) { bestConf = conf; idKey = k; }
  }
  const hasId = bestConf >= 0.7;
  const idUniqueness = idKey ? uniqueRatio(fieldValues(items, idKey)) : 0;

  // signals
  const errors = errorItems(items);
  const structural = structuralOutliers(items, keys);
  const anomalies = numericAnomalies(items, keys, cfg);
  const changePoints = dictChangePoints(items, keys, cfg);
  const errorCount = Math.max(structural.size, errors.size);
  const hasChangePoints = changePoints.size > 0;
  // error keywords only count as a signal when there are no structural outliers
  const errorKwSignal = structural.size === 0 && errors.size > 0;
  // score-field routing (TopN / search_results) is intentionally omitted — the parity corpus never
  // exercises it and every crushable case routes to SmartSample.
  const hasAnySignal = structural.size > 0 || errorKwSignal || anomalies.size > 0 || hasChangePoints;

  // uniqueness metrics (string / numeric fields, excluding the id field)
  const stringUniq = [];
  const numUniq = [];
  for (const k of keys) {
    if (hasId && k === idKey) continue;
    const values = fieldValues(items, k);
    const t = firstNonNullType(values);
    if (t === 'string') stringUniq.push(uniqueRatio(values));
    else if (t === 'number') numUniq.push(uniqueRatio(values));
  }
  const avgStringUniq = stringUniq.length ? mean(stringUniq) : 0;
  const avgNumUniq = numUniq.length ? mean(numUniq) : 0;
  const maxUniqueness = Math.max(avgStringUniq, hasId ? idUniqueness : 0, 0);
  const nonIdContentUniqueness = Math.max(avgStringUniq, avgNumUniq);

  const sig = { errors, structural, anomalies, changePoints, errorCount };

  // crushability decision tree — first match wins, strict comparisons
  let crushable, reason;
  if (nonIdContentUniqueness < 0.1 && hasId) { crushable = true; reason = 'repetitive_content_with_ids'; }
  else if (maxUniqueness < 0.3) { crushable = true; reason = 'low_uniqueness_safe_to_sample'; }
  else if (hasId && maxUniqueness > 0.8 && !hasAnySignal) { crushable = false; reason = 'unique_entities_no_signal'; }
  else if (maxUniqueness > 0.8 && hasAnySignal) { crushable = true; reason = 'unique_entities_with_signal'; }
  else if (!hasAnySignal) { crushable = false; reason = 'medium_uniqueness_no_signal'; }
  else { crushable = true; reason = 'medium_uniqueness_with_signal'; }

  if (n < cfg.minItemsToAnalyze) return { crushable: false, strategy: 'none', reason: '', sig };
  if (!crushable) return { crushable: false, strategy: 'skip', reason, sig };

  // strategy: the parity corpus only ever needs SmartSample once crushable (time_series is caught
  // by the Skip branch above). TopN/Cluster/TimeSeries routing would slot in here.
  return { crushable: true, strategy: 'smart_sample', reason, sig };
}

// -------------------------------------------------------------------- index selection --

// Position anchors — spread a small budget across front / middle / back regions. (§ select_anchors)
function selectAnchors(items, maxItems) {
  const n = items.length;
  const keep = new Set();
  if (n <= maxItems) { for (let i = 0; i < n; i++) keep.add(i); return keep; }
  let budget = Math.min(12, Math.max(3, trunc(maxItems * 0.25)));
  budget = Math.min(budget, n);
  const frontSlots = Math.max(1, trunc(budget * 0.5));
  const backSlots = Math.max(1, trunc(budget * 0.4));
  const middleSlots = budget - frontSlots - backSlots;
  const hash = (i) => compact(items[i]);

  const selectRegion = (start, end, slots, set) => {
    const size = end - start;
    if (size <= 0 || slots <= 0) return;
    if (slots >= size) { for (let i = start; i < end; i++) set.add(i); return; }
    const step = size / (slots + 1);
    const seen = new Set([...set].map(hash));
    for (let j = 0; j < slots; j++) {
      let idx = start + trunc((j + 1) * step);
      if (idx >= end) idx = end - 1;
      // skip content-dupes via +1,-1,+2,-2 nudges
      const nudges = [0, 1, -1, 2, -2];
      for (const d of nudges) {
        const cand = idx + d;
        if (cand < start || cand >= end) continue;
        if (!set.has(cand) && !seen.has(hash(cand))) { set.add(cand); seen.add(hash(cand)); break; }
      }
    }
  };

  const frontEnd = Math.min(frontSlots * 2, Math.floor(n / 3));
  selectRegion(0, frontEnd, frontSlots, keep);
  const backStart = Math.max(n - backSlots * 2, Math.floor((2 * n) / 3));
  selectRegion(backStart, n, backSlots, keep);
  if (middleSlots > 0) {
    // info-density middle: gather slots*3 stride candidates, score, take the top `middleSlots`
    const mStart = keep.size ? Math.min(...keep) + 1 : Math.floor(n / 3);
    const mEnd = keep.size ? Math.max(...keep) : Math.floor((2 * n) / 3);
    const lo = Math.max(frontEnd, 1);
    const hi = Math.min(backStart, n);
    const region = Math.max(0, hi - lo);
    if (region > 0) {
      const want = middleSlots * 3;
      const step = region / (want + 1);
      const cands = [];
      for (let j = 0; j < want; j++) {
        let idx = lo + trunc((j + 1) * step);
        if (idx >= hi) idx = hi - 1;
        if (idx >= lo && !cands.includes(idx)) cands.push(idx);
      }
      const scored = cands.map((i) => {
        const s = compact(items[i]);
        const rareness = 1 - (items.filter((x) => compact(x) === s).length / n);
        const lengthScore = Math.min(1, s.length / 200);
        const structural = new Set(Object.keys(items[i] || {})).size / Math.max(1, unionKeys(items).length);
        return { i, score: 0.4 * rareness + 0.3 * lengthScore + 0.3 * structural };
      });
      scored.sort((a, b) => (b.score - a.score) || (a.i - b.i));
      for (let j = 0; j < middleSlots && j < scored.length; j++) keep.add(scored[j].i);
    }
  }
  return keep;
}

// Collapse content-identical indices to the lowest, fill toward the budget, or trim if over. (§ prioritize_indices)
// signalSet = errors ∪ structural ∪ anomalies — force-kept (in full) when over budget.
function prioritizeIndices(keep, items, n, effectiveMax, signalSet) {
  const hash = (i) => compact(items[i]);
  // dedup by content → lowest index wins
  const byHash = new Map();
  for (const i of [...keep].sort((a, b) => a - b)) { const h = hash(i); if (!byHash.has(h)) byHash.set(h, i); }
  let current = new Set([...byHash.values()]);

  if (current.size < effectiveMax && current.size < n) {
    current = fillRemainingSlots(current, items, n, effectiveMax);
  }
  if (current.size <= effectiveMax) return current;

  // over-budget: keep ALL signals (may exceed budget), then first-3, last-2, then the rest ascending.
  const over = new Set();
  for (const i of [...(signalSet || new Set())].filter((i) => i >= 0 && i < n).sort((a, b) => a - b)) over.add(i);
  for (const i of [0, 1, 2]) if (i < n && over.size < effectiveMax) over.add(i);
  for (const i of [n - 2, n - 1]) if (i >= 0 && over.size < effectiveMax) over.add(i);
  for (const i of [...current].sort((a, b) => a - b)) { if (over.size >= effectiveMax) break; over.add(i); }
  return over;
}

function fillRemainingSlots(current, items, n, effectiveMax) {
  const hash = (i) => compact(items[i]);
  const remaining = effectiveMax - current.size;
  const candidates = [];
  for (let i = 0; i < n; i++) if (!current.has(i)) candidates.push(i);
  if (!candidates.length || remaining <= 0) return current;
  const step = Math.max(trunc(candidates.length / (remaining + 1)), 1);
  const seen = new Set([...current].map(hash));
  let added = 0;
  for (let startOffset = 0; startOffset < step && added < remaining; startOffset++) {
    for (let i = startOffset; i < candidates.length && added < remaining; i += step) {
      const idx = candidates[i];
      const h = hash(idx);
      if (!seen.has(h)) { current.add(idx); seen.add(h); added++; }
    }
  }
  return current;
}

// ------------------------------------------------------------------------- markers / spill --

// The one home for "where spills live" — shared by every writer (this module's crush spill, the
// mcp-slim hook's whole-original spill) AND the sweep, so the sweep scans the same DIR we write to.
function spillRoot(dir) {
  return dir || process.env.FND_MCP_SLIM_DIR || os.tmpdir();
}

function spillPath(cfg) {
  const dir = spillRoot(cfg.spillDir);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return path.join(dir, `fnd-crush-${crypto.randomUUID()}.json`);
}

// Build the {_ccr_dropped:…} sentinel. 'ccr' reproduces Headroom's content hash (byte-parity
// tests); 'spill' writes the dropped rows to a file and references them as full=<path>.
function buildMarker(originalItems, droppedItems, droppedCount, cfg) {
  if (cfg.markerMode === 'ccr') {
    const hash = sha256hex12(compact(originalItems));
    return `<<ccr:${hash} ${droppedCount}_rows_offloaded>>`;
  }
  const p = spillPath(cfg);
  // If the spill can't be written the dropped rows would be unrecoverable — signal failure so the
  // caller keeps the array uncrushed rather than emit a handle to a file that does not exist.
  try { fs.writeFileSync(p, compact(droppedItems)); } catch (_) { return null; }
  return `<<full=${p} ${droppedCount}_rows_offloaded>>`;
}

// ------------------------------------------------------------------------- spill hygiene --

// The only file prefixes the sweep will ever delete. Keep in sync with the writers' filenames:
// `spillPath` here (fnd-crush-), `spillOriginal` in hooks/mcp-slim.cjs (fnd-mcp-slim-), and
// `spillBlob` in hooks/prompt-json-guard.cjs (fnd-prompt-json-, swept only when it lands in the
// sweep dir). The literals are duplicated on purpose — importing this module into a per-prompt
// hook just for a string would drag the whole compressor into every UserPromptSubmit.
const SPILL_PREFIXES = ['fnd-crush-', 'fnd-mcp-slim-', 'fnd-prompt-json-'];
// One directory scan per throttle window, gated by this marker's mtime — the hook's hot path
// pays one stat, not a readdir of the whole tmpdir on every MCP call. A dotfile, so it matches
// no SPILL_PREFIX (it is excluded for good measure anyway).
const SWEEP_MARKER = '.fnd-mcp-slim-sweep';
const SWEEP_THROTTLE_MS = 10 * 60 * 1000;
// The FND_MCP_SLIM_DEBUG log basename (its writer + rotation live in the debug-log section below);
// defined here so SWEEP_KEEP is the single source of truth — the sweep must never prune it.
const DEBUG_LOG = 'fnd-mcp-slim-debug.log';
// Files that share a spill prefix but must survive: the debug log + its one rotation, and the sweep
// marker. Excluded by EXACT name, so `fnd-mcp-slim-debug.log` is never mistaken for a spill and swept.
const SWEEP_KEEP = new Set([DEBUG_LOG, `${DEBUG_LOG}.1`, SWEEP_MARKER]);

// Parse FND_MCP_SLIM_TTL as hours. Default 24; exactly `0` disables the sweep. ANY invalid value —
// non-numeric, NaN, negative — falls back to 24: a negative TTL must NEVER become a past cutoff
// that mass-deletes fresh spills (the rule that keeps a typo safe). parseFloat, so `0.5` works.
function spillTtlHours(raw) {
  if (raw === undefined || raw === null || raw === '') return 24;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 24;
  return n;
}

// Age-based TTL sweep of the shared spill dir. Best-effort and fully self-contained: every error
// is swallowed so a sweep NEVER affects the hook's emitted result or the CLI's output/exit code.
// Deletes only our-prefixed files whose mtime is older than the TTL — files written by the current
// process are always fresh, so an in-flight `full=<path>` handle survives up to the TTL (a day
// covers same-day conversation resume; an older, expired handle is an already-tolerated re-fetch).
// Called by BOTH entry points (the mcp-slim hook after it writes stdout, the CLI at exit) so one
// implementation covers every writer. NB the prompt-json guard's WORKSPACE-placed spills ride with
// the task workspace, outside this dir; its tmpdir spills are swept only when the sweep dir is the
// default os.tmpdir() (FND_MCP_SLIM_DIR unset — the common case). Returns a small summary for tests.
function sweepSpills(dir) {
  const summary = { disabled: false, throttled: false, swept: 0 };
  try {
    const ttl = spillTtlHours(process.env.FND_MCP_SLIM_TTL);
    if (ttl === 0) { summary.disabled = true; return summary; }
    const root = spillRoot(dir);
    const marker = path.join(root, SWEEP_MARKER);
    const now = Date.now();
    try {
      if (now - fs.statSync(marker).mtimeMs < SWEEP_THROTTLE_MS) { summary.throttled = true; return summary; }
    } catch (_) {} // no marker yet → first sweep in this dir
    // Touch BEFORE scanning so a sibling hook firing during the scan sees a fresh marker and skips
    // — one scan per window even under parallel MCP calls.
    try { fs.writeFileSync(marker, ''); } catch (_) {}
    const cutoff = now - ttl * 3600 * 1000;
    let names;
    try { names = fs.readdirSync(root); } catch (_) { return summary; }
    for (const name of names) {
      if (SWEEP_KEEP.has(name)) continue;
      if (!SPILL_PREFIXES.some((p) => name.startsWith(p))) continue;
      try {
        const p = path.join(root, name);
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) { fs.unlinkSync(p); summary.swept++; }
      } catch (_) {} // gone / racing another sweep / unreadable → skip
    }
  } catch (_) {} // any failure → no-op
  return summary;
}

// ---------------------------------------------------------------------------- debug log --

// Opt-in observability (FND_MCP_SLIM_DEBUG, off by default): one JSONL metadata line per hook/CLI
// invocation → <spill-dir>/<DEBUG_LOG>. Metadata ONLY (bytes/decision/reason/stages) — never any
// payload content. The M5 sweep excludes this file and its rotation by exact name (SWEEP_KEEP, where
// DEBUG_LOG is defined). Single home: the mcp-slim hook and this module's CLI both call debugLog().
const DEBUG_LOG_MAX = 5 * 1024 * 1024; // rotate one generation past ~5 MB (bounded, keeps the recent window)

// On only when FND_MCP_SLIM_DEBUG is explicitly enabled (1/true/yes/on). Unset / 0 / false → off,
// so the default really is zero side effects: debugLog opens nothing and creates no file.
function debugEnabled() {
  const raw = process.env.FND_MCP_SLIM_DEBUG;
  return !!raw && /^(1|true|yes|on)$/i.test(raw.trim());
}

// Append one JSONL trace line (`ts` stamped here, insertion order preserved after it). Best-effort:
// disabled → no-op; every error swallowed so logging NEVER touches the hook's emitted result or the
// CLI's stdout / exit code. Rotates the log to `.log.1` (overwrite) once it passes DEBUG_LOG_MAX.
// `dir` shares the spill root so the log lives beside the spills it describes.
function debugLog(record, dir) {
  try {
    if (!debugEnabled()) return;
    const root = spillRoot(dir);
    try { fs.mkdirSync(root, { recursive: true }); } catch (_) {}
    const logPath = path.join(root, DEBUG_LOG);
    try {
      if (fs.statSync(logPath).size >= DEBUG_LOG_MAX) fs.renameSync(logPath, path.join(root, `${DEBUG_LOG}.1`));
    } catch (_) {} // no log yet, or rotate failed → just append below
    fs.appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`);
  } catch (_) {}
}

// ------------------------------------------------------------------------ per-type crush --

// DictArray: analyse → select indices → keep ascending → append sentinel for the dropped rows.
function crushDictArray(items, cfg) {
  const n = items.length;
  const itemStrings = items.map(compact);
  const adaptiveK = computeOptimalK(itemStrings, 1, 3, cfg.maxItemsAfterCrush);

  if (n <= adaptiveK) return { items, info: 'none:adaptive_at_limit', keptCount: n };

  const analysis = analyseDictArray(items, cfg);
  if (analysis.strategy === 'skip') return { items, info: `skip:${analysis.reason}`, keptCount: n };
  if (!analysis.crushable) return { items, info: '', keptCount: n };

  const { errors, structural, anomalies, changePoints } = analysis.sig;
  const keep = new Set();
  for (const i of selectAnchors(items, adaptiveK)) keep.add(i);
  const signalSet = new Set();
  for (const s of [errors, structural, anomalies]) for (const i of s) { keep.add(i); signalSet.add(i); }
  for (const cp of changePoints) for (const d of [-1, 0, 1]) { const i = cp + d; if (i >= 0 && i < n) keep.add(i); }

  const kept = prioritizeIndices(keep, items, n, adaptiveK, signalSet);
  const keptSorted = [...kept].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const outItems = keptSorted.map((i) => items[i]);
  const keptCount = outItems.length; // real rows, excluding the sentinel appended below
  const droppedCount = n - keptCount;
  if (droppedCount > 0 && cfg.enableMarker) {
    const dropped = items.filter((_, i) => !kept.has(i));
    const marker = buildMarker(items, dropped, droppedCount, cfg);
    if (marker === null) return { items, info: '', keptCount: n }; // spill failed → keep rows uncrushed
    outItems.push({ _ccr_dropped: marker });
  }
  return { items: outItems, info: 'smart_sample', keptCount };
}

// NumberArray: first/last slice ∪ outliers ∪ change-points, stride-fill to K. No dedup, no marker.
function sampleNumberArray(arr, cfg) {
  const n = arr.length;
  if (n <= 8) return { value: arr, info: 'number:passthrough' };
  const finiteIdx = [];
  arr.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v)) finiteIdx.push(i); });
  if (!finiteIdx.length) return { value: arr, info: 'number:no_finite' };
  const kTotal = computeOptimalK(arr.map(compact), 1, 3, cfg.maxItemsAfterCrush);
  const { kFirst, kLast } = computeKSplit(kTotal, cfg);
  const nums = arr.map((v) => (typeof v === 'number' ? v : NaN));
  const finite = finiteIdx.map((i) => arr[i]);
  const m = mean(finite);
  const sd = sampleStd(finite);
  const keep = new Set();
  const outliers = new Set();
  if (sd > 0) arr.forEach((v, i) => { if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v - m) > cfg.varianceThreshold * sd) { outliers.add(i); keep.add(i); } });
  if (cfg.preserveChangePoints && n > 10 && sd > 0) {
    const w = 5;
    for (let i = w; i < n - w; i++) {
      const L = mean(nums.slice(i - w, i));
      const R = mean(nums.slice(i, i + w));
      if (Number.isFinite(L) && Number.isFinite(R) && Math.abs(R - L) > cfg.varianceThreshold * sd) keep.add(i);
    }
  }
  for (let i = 0; i < kFirst && i < n; i++) keep.add(i);
  for (let i = Math.max(0, n - kLast); i < n; i++) keep.add(i);
  let remaining = kTotal - keep.size;
  if (remaining > 0) {
    const stride = Math.max(trunc((n - 1) / (remaining + 1)), 1);
    const cap = kTotal + outliers.size;
    for (let i = 0; i < n; i += stride) { if (keep.size >= cap) break; keep.add(i); }
  }
  const idx = [...keep].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const value = idx.map((i) => arr[i]);
  const sorted = [...finite].sort((a, b) => a - b);
  const mm = minMax(finite);
  const stats = `min=${fmtStat(mm.min)},max=${fmtStat(mm.max)},mean=${fmtStat(m)},median=${fmtStat(median(sorted))},stddev=${fmtStat(sd)},p25=${fmtStat(percentile(sorted, 25))},p75=${fmtStat(percentile(sorted, 75))}`;
  return { value, info: `number:adaptive(${n}->${value.length},${stats})` };
}

// StringArray: first/last slice ∪ length-anomalies, stride-fill, dedup by raw string. No marker.
function sampleStringArray(arr, cfg) {
  const n = arr.length;
  if (n <= 8) return { value: arr, info: 'string:passthrough' };
  const kTotal = computeOptimalK(arr, 1, 3, cfg.maxItemsAfterCrush);
  const { kFirst, kLast } = computeKSplit(kTotal, cfg);
  const lens = arr.map((s) => s.length);
  const m = mean(lens);
  const sd = sampleStd(lens);
  const keep = new Set();
  const anomalies = new Set();
  if (sd > 0) arr.forEach((s, i) => { if (Math.abs(s.length - m) > cfg.varianceThreshold * sd) { anomalies.add(i); keep.add(i); } });
  for (let i = 0; i < kFirst && i < n; i++) keep.add(i);
  for (let i = Math.max(0, n - kLast); i < n; i++) keep.add(i);
  let remaining = kTotal - keep.size;
  if (remaining > 0) {
    const stride = Math.max(trunc((n - 1) / (remaining + 1)), 1);
    const cap = kTotal + anomalies.size;
    const seen = new Set([...keep].map((i) => arr[i]));
    for (let i = 0; i < n; i += stride) {
      if (keep.size >= cap) break;
      if (!seen.has(arr[i])) { keep.add(i); seen.add(arr[i]); }
    }
  }
  const idx = [...keep].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const value = idx.map((i) => arr[i]);
  return { value, info: `string:adaptive(${n}->${value.length})` };
}

// Number sub-group inside a mixed array: first/last slice ∪ outliers only (no change-points, no
// stride-fill — unlike the standalone number sampler). (§3.6 "number→k-split+outliers")
function sampleMixedNumberGroup(nums, cfg) {
  const n = nums.length;
  if (n <= 8) return nums;
  const kTotal = computeOptimalK(nums.map(compact), 1, 3, cfg.maxItemsAfterCrush);
  const { kFirst, kLast } = computeKSplit(kTotal, cfg);
  const m = mean(nums);
  const sd = sampleStd(nums);
  const keep = new Set();
  if (sd > 0) nums.forEach((v, i) => { if (Math.abs(v - m) > cfg.varianceThreshold * sd) keep.add(i); });
  for (let i = 0; i < kFirst && i < n; i++) keep.add(i);
  for (let i = Math.max(0, n - kLast); i < n; i++) keep.add(i);
  return [...keep].sort((a, b) => a - b).map((i) => nums[i]);
}

// MixedArray: group by JSON type (first-seen order), keep-all groups < 5, sub-sample the rest,
// reassemble in original index order. No sentinel marker on this path (parity-faithful — Headroom's
// mixed path emits none), so rows dropped here are NOT independently spilled; recovery of a mixed
// array's dropped rows relies on the M2 hook spilling the whole original tool result.
function sampleMixedArray(arr, cfg) {
  const n = arr.length;
  if (n <= 8) return { value: arr, info: 'mixed:passthrough' };
  const groupsOrder = [];
  const groups = new Map();
  arr.forEach((v, i) => {
    const t = jsonType(v);
    const key = t === 'dict' ? 'dict' : t === 'str' ? 'str' : t === 'bool' ? 'bool' : t === 'number' ? 'num' : t === 'list' ? 'list' : 'none';
    if (!groups.has(key)) { groups.set(key, []); groupsOrder.push(key); }
    groups.get(key).push(i);
  });
  const kept = new Set();
  const parts = [];
  for (const key of groupsOrder) {
    const idxs = groups.get(key);
    const sub = idxs.map((i) => arr[i]);
    if (sub.length < 5) { idxs.forEach((i) => kept.add(i)); parts.push(`${key}:${sub.length}->${sub.length}`); continue; }
    let keptVals;
    if (key === 'dict') keptVals = crushDictArray(sub, { ...cfg, enableMarker: false }).items;
    else if (key === 'str') keptVals = sampleStringArray(sub, cfg).value;
    else if (key === 'num') keptVals = sampleMixedNumberGroup(sub, cfg);
    else { idxs.forEach((i) => kept.add(i)); parts.push(`${key}:${sub.length}->${sub.length}`); continue; }
    // map kept sub-values back to original indices by greedy forward match
    let p = 0;
    for (let j = 0; j < idxs.length && p < keptVals.length; j++) {
      if (compact(arr[idxs[j]]) === compact(keptVals[p])) { kept.add(idxs[j]); p++; }
    }
    // Headroom labels the number group by size only (`num:20`); str/dict report `type:n->m`.
    parts.push(key === 'num' ? `num:${sub.length}` : `${key}:${sub.length}->${keptVals.length}`);
  }
  const idx = [...kept].filter((i) => i >= 0 && i < n).sort((a, b) => a - b);
  const value = idx.map((i) => arr[i]);
  return { value, info: `mixed:adaptive(${n}->${value.length},${parts.join(',')})` };
}

// ---------------------------------------------------------------- recursive crush walk --

const MAX_DEPTH = 50;

// process_value: recurse the whole structure, crushing every qualifying array/object in place.
// Returns [value, info] where info is a comma-join of child strategy fragments.
function processValue(value, depth, cfg) {
  if (depth >= MAX_DEPTH) return [value, ''];
  const t = jsonType(value);
  if (t === 'list') {
    const arr = value;
    const n = arr.length;
    if (n >= cfg.minItemsToAnalyze) {
      const cls = classifyArray(arr);
      if (cls === 'DictArray') {
        const r = crushDictArray(arr, cfg);
        return [r.items, r.info ? `${r.info}(${n}->${r.keptCount})` : ''];
      }
      if (cls === 'StringArray') { const r = sampleStringArray(arr, cfg); return [r.value, `${r.info}(${n}->${r.value.length})`]; }
      if (cls === 'NumberArray') { const r = sampleNumberArray(arr, cfg); return [r.value, `${r.info}(${n}->${r.value.length})`]; }
      if (cls === 'MixedArray') { const r = sampleMixedArray(arr, cfg); return [r.value, `${r.info}(${n}->${r.value.length})`]; }
      // Empty / Bool / Nested → fall through to element recursion
    }
    const outArr = [];
    const infos = [];
    for (const el of arr) { const [v, inf] = processValue(el, depth + 1, cfg); outArr.push(v); if (inf) infos.push(inf); }
    return [outArr, infos.join(',')];
  }
  if (t === 'dict') {
    const out = {};
    const infos = [];
    for (const k of Object.keys(value)) {
      if (cfg.preserveFields && cfg.preserveFields[k]) { out[k] = value[k]; continue; }
      const [v, inf] = processValue(value[k], depth + 1, cfg);
      out[k] = v;
      if (inf) infos.push(inf);
    }
    return [out, infos.join(',')];
  }
  return [value, ''];
}

// ------------------------------------------------------------------------------- crush() --

// crush a JSON *string* → { compressed, wasModified, strategy }. Mirrors SmartCrusher::crush.
// Any transform failure → the original passes through untouched (safety rail).
function crush(content, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (typeof content !== 'string') return { compressed: content, wasModified: false, strategy: 'passthrough' };
  let parsed;
  try { parsed = JSON.parse(content); } catch (_) {
    return { compressed: content, wasModified: false, strategy: 'passthrough' };
  }
  try {
    const [crushed, info] = processValue(parsed, 0, cfg);
    const compressed = compact(crushed);
    const wasModified = compressed !== content.trim();
    return { compressed, wasModified, strategy: info !== '' ? info : 'passthrough' };
  } catch (_) {
    return { compressed: content, wasModified: false, strategy: 'passthrough' };
  }
}

// crush a parsed VALUE (no re-parse) — used by the fnd pipeline after the ADF/noise/truncate stages.
// A transform failure returns the value unchanged (crash-safety parity with crush()).
function crushValue(value, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  try { return processValue(value, 0, cfg)[0]; } catch (_) { return value; }
}

// ============================================================ fnd pipeline stages (slim) ==

// Stage 1 — replace every ADF doc node ({type:'doc',version,content}) with its markdown string.
function adfStage(value, cfg, depth) {
  depth = depth || 0;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => adfStage(v, cfg, depth + 1));
  if (value && typeof value === 'object') {
    if (value.type === 'doc' && Array.isArray(value.content)) {
      const md = adfToMarkdown(value);
      if (md != null) return md;
    }
    const out = {};
    for (const k of Object.keys(value)) {
      if (cfg.preserveFields && cfg.preserveFields[k]) { out[k] = value[k]; continue; }
      out[k] = adfStage(value[k], cfg, depth + 1);
    }
    return out;
  }
  return value;
}

const AVATAR_KEY = /avatar|iconurl|24x24|16x16|32x32|48x48|thumbnail/i;

// A `self` value that is a REST-navigation URL — Jira/Confluence stamp one on every nested
// resource (`.../rest/api/2/status/3`, Confluence `_links.self`). The model never dereferences
// them (it acts through MCP tools, not raw REST), and the full result is spilled for recovery,
// so dropping them is safe. Matched only on Atlassian's `/rest/` (Jira, classic Confluence) or
// `/wiki/` (Confluence v2) path markers — NOT a bare `/api/`, which non-Atlassian servers use for
// real, actionable resource URLs. Precise key+value guard so a `self` holding real content survives.
const REST_LINK = /^https?:\/\/.*\/(rest|wiki)\//;

// Stage 3 — drop nulls, empty containers, avatar-class decoration keys, and `self` REST links.
function noiseStage(value, cfg, depth) {
  depth = depth || 0;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => noiseStage(v, cfg, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (cfg.preserveFields && cfg.preserveFields[k]) { out[k] = value[k]; continue; }
      if (AVATAR_KEY.test(k)) continue;
      if (cfg.dropRestLinks && k === 'self' && typeof value[k] === 'string' && REST_LINK.test(value[k])) continue;
      const v = noiseStage(value[k], cfg, depth + 1);
      if (v === null) continue;
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[k] = v;
    }
    return out;
  }
  return value;
}

// Only OPAQUE long strings are truncated: data-URIs (anchored to a real `type/subtype;|,` shape so
// prose that merely starts "data: …" is NOT matched), pure base64 blobs, and single-token URLs.
// Prose / markdown (incl. ADF-derived descriptions) is NEVER clipped by length alone — clipping it
// would be unrecoverable data loss, and stage 1 has already converted ADF to compact markdown.
const LONG_STRING = /^data:[\w.+-]+\/[\w.+-]+[;,]|^[A-Za-z0-9+/]{200,}={0,2}$|^https?:\/\/\S{160,}$/;

// Stage 4 — clip data-URIs / base64 / very long URLs to head + a length note.
function truncateStage(value, cfg, depth) {
  depth = depth || 0;
  if (depth >= MAX_DEPTH) return value;
  if (typeof value === 'string') {
    if (value.length > cfg.stringLimit && LONG_STRING.test(value)) {
      return `${value.slice(0, 64)}…(len=${value.length})`;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => truncateStage(v, cfg, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (cfg.preserveFields && cfg.preserveFields[k]) { out[k] = value[k]; continue; }
      out[k] = truncateStage(value[k], cfg, depth + 1);
    }
    return out;
  }
  return value;
}

// Optional stage — lossless tabular re-serialization of uniform arrays of flat objects (TOON-lite).
// Behind a flag; a basic variant kept as a benchmark option (CEILING: not the full TOON spec).
function toonStage(value, depth) {
  depth = depth || 0;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    if (value.length >= 3 && value.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      const keys = Object.keys(value[0]);
      const uniform = keys.length > 0 && value.every((o) => {
        const ks = Object.keys(o);
        return ks.length === keys.length && ks.every((k, i) => k === keys[i]) &&
          keys.every((k) => o[k] === null || typeof o[k] !== 'object');
      });
      if (uniform) {
        return { _toon: `${keys.join(',')}`, rows: value.map((o) => keys.map((k) => o[k])) };
      }
    }
    return value.map((v) => toonStage(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = toonStage(value[k], depth + 1);
    return out;
  }
  return value;
}

// slim a JSON *string* through the full pipeline →
//   { output, wasModified, bytesIn, bytesOut, ratio, stages, reason? }.
// `stages` names the pipeline stages that actually changed the serialized bytes (adf / noise /
// truncate / crush / toon) — the FND_MCP_SLIM_DEBUG instrumentation; populated ONLY when
// `cfg.trace` (off by default), so the compression hot path stays single-serialization. `reason`
// marks a non-compressing outcome the debug log reports verbatim (`non-json` / `error-shape` /
// `transform-error`). Any stage failure → the original passes through untouched (safety rail).
function slim(content, config) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  if (typeof content !== 'string') return { output: content, wasModified: false, bytesIn: 0, bytesOut: 0, ratio: 0, stages: [] };
  const bytesIn = Buffer.byteLength(content, 'utf8');
  let parsed;
  try { parsed = JSON.parse(content); } catch (_) {
    return { output: content, wasModified: false, bytesIn, bytesOut: bytesIn, ratio: 0, reason: 'non-json', stages: [] };
  }
  // Never touch error envelopes — write-gating elsewhere depends on seeing them verbatim.
  if (isErrorShape(parsed)) {
    return { output: content, wasModified: false, bytesIn, bytesOut: bytesIn, ratio: 0, error: true, reason: 'error-shape', stages: [] };
  }
  let value = parsed;
  const stages = [];
  try {
    // The pipeline always runs; the compact()-per-stage byte-delta bookkeeping is opt-in (cfg.trace,
    // set by the FND_MCP_SLIM_DEBUG feed). Off ⇒ the hot path serializes exactly ONCE (the final
    // compact below) — no per-stage cost for a disabled feature, and `stages` stays empty.
    let prev = cfg.trace ? compact(value) : '';
    const runStage = (name, next) => {
      value = next;
      if (cfg.trace) { const cur = compact(value); if (cur !== prev) { stages.push(name); prev = cur; } }
    };
    if (cfg.adf) runStage('adf', adfStage(value, cfg));
    if (cfg.noise) runStage('noise', noiseStage(value, cfg));
    if (cfg.truncate) runStage('truncate', truncateStage(value, cfg));
    runStage('crush', crushValue(value, cfg));
    if (cfg.toon) runStage('toon', toonStage(value));
    const output = compact(value);
    const bytesOut = Buffer.byteLength(output, 'utf8');
    return {
      output,
      wasModified: output !== content.trim(),
      bytesIn,
      bytesOut,
      ratio: bytesIn ? 1 - bytesOut / bytesIn : 0,
      stages,
    };
  } catch (_) {
    return { output: content, wasModified: false, bytesIn, bytesOut: bytesIn, ratio: 0, reason: 'transform-error', stages: [] };
  }
}

// An MCP/tool error envelope — never compress these (write-gating elsewhere reads them verbatim).
function isErrorShape(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.isError === true) return true; // MCP CallToolResult error result
  const e = v.errors; // GraphQL: an empty errors:[] is a SUCCESS, not an envelope
  if (Array.isArray(e) ? e.length > 0 : !!e) return true;
  if (Array.isArray(v.userErrors) && v.userErrors.length) return true;
  if (v.error) return true;
  return false;
}

module.exports = {
  slim, crush, crushValue,
  classifyArray, computeOptimalK, analyseDictArray, isErrorShape,
  adfStage, noiseStage, truncateStage, toonStage,
  sweepSpills, spillTtlHours, spillRoot,
  debugLog, debugEnabled,
  DEFAULTS,
};

// -------------------------------------------------------------------------------- CLI --

if (require.main === module) {
  const t0 = Date.now();
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const fileArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--jq');

  let raw;
  try { raw = fileArg ? fs.readFileSync(fileArg, 'utf8') : fs.readFileSync(0, 'utf8'); } catch (e) {
    process.stderr.write('json-slim: cannot read input: ' + e.message + '\n');
    process.exit(1);
  }

  const cfg = {};
  if (has('--toon')) cfg.toon = true;
  if (has('--no-spill')) cfg.enableMarker = false;

  // --jq <dot.path>: narrow to a sub-path before slimming (simple key/index walk, no jq dependency).
  const jq = opt('--jq');
  if (jq) {
    let v;
    try { v = JSON.parse(raw); } catch (e) { process.stderr.write('json-slim: input is not valid JSON: ' + e.message + '\n'); process.exit(1); }
    for (const seg of jq.split('.').filter(Boolean)) {
      if (v == null) break;
      v = Array.isArray(v) && /^\d+$/.test(seg) ? v[Number(seg)] : v[seg];
    }
    raw = JSON.stringify(v === undefined ? null : v); // a missed path yields null, never a crash
  }

  const res = slim(raw, { ...cfg, trace: debugEnabled() }); // trace only when the debug log will consume `stages`
  process.stdout.write(res.output + '\n');
  if (has('--stats')) {
    process.stderr.write(`json-slim: ${res.bytesIn} → ${res.bytesOut} bytes (${(res.ratio * 100).toFixed(1)}% reduction)${res.error ? ' [error-shape passthrough]' : ''}\n`);
  }
  // Debug trace (opt-in FND_MCP_SLIM_DEBUG) — one JSONL line for this run; never touches stdout.
  const compressed = res.wasModified && res.bytesOut < res.bytesIn;
  debugLog({
    entry: 'cli',
    tool: fileArg || null,
    decision: compressed ? 'compressed' : 'passthrough',
    reason: compressed ? null : (res.reason || 'no-gain'),
    bytes_in: res.bytesIn,
    bytes_out: res.bytesOut,
    pct: Math.round((res.ratio || 0) * 1000) / 10,
    stages: res.stages || [],
    spill: null,
    ms: Date.now() - t0,
  }, cfg.spillDir);
  // Spill hygiene at exit — prune stale spills (best-effort; never affects output or exit code).
  sweepSpills(cfg.spillDir);
}
