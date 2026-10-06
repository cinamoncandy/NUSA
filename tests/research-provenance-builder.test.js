const test = require("node:test");
const assert = require("node:assert/strict");

const { buildResearchProvenance, hashResearchInputCore, ResearchProvenanceError } = require("../dist/apps/cloud/src/researchProvenanceBuilder.js");
const { candleChecksum } = require("../dist/apps/cloud/src/closedCandleAggregator.js");
const { validateResearchProvenance } = require("../dist/packages/contracts/src/researchHardening.js");

const M = 60_000;
const candles = (startMinute, count, base = 100) => Array.from({ length: count }, (_, i) => ({ timestamp: (startMinute + i) * M, open: base + i, high: base + i + 2, low: base + i - 1, close: base + i + 1, volume: 0 }));
const windows = () => ({
  train: { windowId: "w-train", candles: candles(1000, 6) },
  validation: { windowId: "w-val", candles: candles(1010, 3, 110) },
  holdout: { windowId: "w-hold", candles: candles(1020, 3, 120) },
});
const input = (over = {}) => ({
  role: "VALIDATION",
  researchRunId: "run-1", sessionId: "research-2026-10-02", experimentId: "exp-1", evaluationId: "eval-1",
  market: "KRW-BTC", intervalMs: M, windows: windows(),
  featurePipeline: { version: "closed-candle-agg-v1", config: { intervalMs: M, maxInternalGapMs: 30000, volume: 0 } },
  strategy: { id: "sma-crossover", version: "closed-candle-1m-v1", artifact: { dsl: "sma", v: 1 }, config: { fast: 5, slow: 20 } },
  evaluator: { version: "eval-v1", modelVersion: "model-v1" },
  models: { fill: "fill-next-open-v1", fee: "fee-upbit-0.0005-v1", slippage: "slip-5bps-v1" },
  sourceCommitSha: "a".repeat(40),
  split: { identity: "wf-7-2-2", definition: { train: 7, validation: 2, holdout: 2 } },
  walkForwardConfig: { grid: { fast: [3, 5], slow: [20, 30] } },
  experimentFamilyId: "family-1", attempt: 1, hypothesisLineage: "h0",
  finalHoldoutUntouched: true, canonicalInputHash: "b".repeat(64),
  ...over,
});
const code = (fn) => { try { fn(); } catch (e) { assert.ok(e instanceof ResearchProvenanceError, String(e)); return e.code; } return "NO_ERROR"; };

test("builds a provenance that passes the contract validator, with every hash recomputed from the data", () => {
  const w = windows();
  const p = buildResearchProvenance(input());
  assert.deepEqual(validateResearchProvenance(p), []);
  assert.equal(p.trainingWindowHash, candleChecksum(w.train.candles));
  assert.equal(p.validationWindowHash, candleChecksum(w.validation.candles));
  assert.equal(p.finalHoldoutWindowHash, candleChecksum(w.holdout.candles));
  assert.equal(p.datasetContentSha256, candleChecksum([...w.train.candles, ...w.validation.candles, ...w.holdout.candles]));
  assert.equal(p.windowRole, "VALIDATION");
  assert.equal(p.windowId, "w-val");
  assert.equal(p.startEventTime, 1010 * M);
  assert.equal(p.endEventTime, 1012 * M);
  assert.equal(p.interval, "1m");
  assert.equal(p.datasetId, "upbit-1m-closed:KRW-BTC:60000");
  assert.equal(p.finalHoldoutUntouched, true);
});

test("is deterministic and sensitive to the data and the strategy", () => {
  const a = buildResearchProvenance(input());
  const b = buildResearchProvenance(input());
  assert.deepEqual(a, b);
  const changedCandles = input(); changedCandles.windows.train.candles[0] = { ...changedCandles.windows.train.candles[0], close: 999 };
  assert.notEqual(buildResearchProvenance(changedCandles).trainingWindowHash, a.trainingWindowHash);
  assert.notEqual(buildResearchProvenance(changedCandles).datasetContentSha256, a.datasetContentSha256);
  assert.notEqual(buildResearchProvenance(input({ strategy: { id: "sma-crossover", version: "closed-candle-1m-v1", artifact: { dsl: "sma", v: 1 }, config: { fast: 3, slow: 20 } } })).strategyConfigHash, a.strategyConfigHash);
});

test("each role reports its own window and range; the holdout role requires an untouched holdout", () => {
  const t = buildResearchProvenance(input({ role: "TRAIN" }));
  assert.equal(t.windowId, "w-train");
  assert.equal(t.startEventTime, 1000 * M);
  const h = buildResearchProvenance(input({ role: "HOLDOUT" }));
  assert.equal(h.windowId, "w-hold");
  assert.equal(code(() => buildResearchProvenance(input({ role: "HOLDOUT", finalHoldoutUntouched: false }))), "HOLDOUT_CONTAMINATED");
  assert.equal(buildResearchProvenance(input({ role: "VALIDATION", finalHoldoutUntouched: false })).finalHoldoutUntouched, false);
});

test("windows must be non-empty, strictly increasing, on interval boundaries and disjoint in time order", () => {
  const empty = input(); empty.windows.validation = { windowId: "w", candles: [] };
  assert.equal(code(() => buildResearchProvenance(empty)), "EMPTY_WINDOW");
  const unordered = input(); unordered.windows.train = { windowId: "w", candles: [candles(1000, 2)[1], candles(1000, 2)[0]] };
  assert.equal(code(() => buildResearchProvenance(unordered)), "NON_MONOTONIC_WINDOW");
  const offGrid = input(); offGrid.windows.train = { windowId: "w", candles: [{ ...candles(1000, 1)[0], timestamp: 1000 * M + 5 }] };
  assert.equal(code(() => buildResearchProvenance(offGrid)), "INVALID_CANDLE_TIME");
  const overlap = input(); overlap.windows.validation = { windowId: "w", candles: candles(1004, 3) };
  assert.equal(code(() => buildResearchProvenance(overlap)), "WINDOWS_NOT_ORDERED");
  const swapped = input(); swapped.windows.holdout = { windowId: "w", candles: candles(1005, 2) };
  assert.equal(code(() => buildResearchProvenance(swapped)), "WINDOWS_NOT_ORDERED");
  const noId = input(); noId.windows.holdout = { windowId: " ", candles: candles(1020, 2) };
  assert.equal(code(() => buildResearchProvenance(noId)), "INVALID_WINDOW_ID");
});

test("fails closed on a bad commit, attempt, hash, market, interval or a missing field", () => {
  for (const sha of ["", "abc", "A".repeat(40), "a".repeat(41), "g".repeat(40)]) assert.equal(code(() => buildResearchProvenance(input({ sourceCommitSha: sha }))), "INVALID_SOURCE_COMMIT", sha);
  for (const attempt of [0, -1, 1.5, NaN]) assert.equal(code(() => buildResearchProvenance(input({ attempt }))), "INVALID_ATTEMPT", String(attempt));
  assert.equal(code(() => buildResearchProvenance(input({ canonicalInputHash: "x" }))), "INVALID_CANONICAL_INPUT_HASH");
  assert.equal(code(() => buildResearchProvenance(input({ market: "BTC-KRW" }))), "INVALID_MARKET");
  assert.equal(code(() => buildResearchProvenance(input({ intervalMs: 10 }))), "INVALID_INTERVAL");
  assert.equal(code(() => buildResearchProvenance(input({ models: { fill: "f", fee: "", slippage: "s" } }))), "MISSING_FIELD");
  assert.equal(code(() => buildResearchProvenance(input({ strategy: { id: "s", version: "v", artifact: null, config: {} } }))), "MISSING_FIELD");
  assert.equal(code(() => buildResearchProvenance(input({ walkForwardConfig: null }))), "MISSING_FIELD");
});

test("input core hash ignores the provenance key and changes with the data (D2, no circular reference)", () => {
  const core = { researchRunId: "r", evaluationId: "e", strategyId: "s", marketData: [{ market: "KRW-BTC", price: 1, observedAt: 1 }] };
  const withProvenance = { ...core, provenance: { canonicalInputHash: "c".repeat(64), anything: 1 } };
  assert.equal(hashResearchInputCore(core), hashResearchInputCore(withProvenance));
  assert.match(hashResearchInputCore(core), /^[a-f0-9]{64}$/);
  assert.notEqual(hashResearchInputCore(core), hashResearchInputCore({ ...core, strategyId: "other" }));
});
