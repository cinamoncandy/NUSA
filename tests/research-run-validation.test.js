const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createResearchRunManifest,
  validateResearchRunManifest,
  validateWalkForward,
  validateCostStress,
  validateIntegrity,
  allResearchGatesPassed
} = require("../dist/apps/cloud/src/researchRunValidation.js");

const now = "2026-07-15T00:00:00.000Z";
const fold = (index) => ({
  trainStart: `2026-01-0${index + 1}T00:00:00.000Z`,
  trainEnd: `2026-01-1${index + 1}T00:00:00.000Z`,
  testStart: `2026-01-2${index + 1}T00:00:00.000Z`,
  testEnd: `2026-01-2${index + 2}T00:00:00.000Z`,
  trainSampleCount: 100,
  testSampleCount: 20,
  complete: true,
  outOfSample: true,
  metrics: { netReturn: 0.02, maxDrawdown: 0.1 }
});

const manifest = createResearchRunManifest({
  runId: "wf-1",
  runType: "WALK_FORWARD",
  strategyId: "sma",
  strategyVersion: "1.0.0",
  parameterSet: { fast: 5, slow: 20 },
  datasetId: "btc-fixture",
  datasetChecksum: "a".repeat(64),
  datasetStart: "2026-01-01T00:00:00.000Z",
  datasetEnd: "2026-02-01T00:00:00.000Z",
  sampleCount: 120,
  createdAt: now,
  codeVersion: "test-sha",
  config: { minimumFolds: 2 },
  result: { netReturn: 0.02 }
});

test("manifest checksum is deterministic and tamper-evident", () => {
  const second = createResearchRunManifest({
    runId: manifest.runId,
    runType: manifest.runType,
    strategyId: manifest.strategyId,
    strategyVersion: manifest.strategyVersion,
    parameterSet: { slow: 20, fast: 5 },
    datasetId: manifest.datasetId,
    datasetChecksum: manifest.datasetChecksum,
    datasetStart: manifest.datasetStart,
    datasetEnd: manifest.datasetEnd,
    sampleCount: manifest.sampleCount,
    createdAt: manifest.createdAt,
    codeVersion: manifest.codeVersion,
    config: { minimumFolds: 2 },
    result: { netReturn: 0.02 }
  });
  assert.deepEqual(manifest, second);
  validateResearchRunManifest(manifest);
  assert.throws(() => validateResearchRunManifest({ ...manifest, resultChecksum: "b".repeat(64) }));
});

test("walk-forward rejects leakage, incomplete folds, and missing costs", () => {
  const result = validateWalkForward({
    runId: "wf-1", checkedAt: now, windows: [fold(0), { ...fold(1), outOfSample: false }],
    minimumFolds: 2, result: { ok: false }, includesCosts: false, parameterSelectionFrozen: false
  });
  assert.equal(result.status, "FAIL");
  assert.ok(result.reasons.includes("FOLD_1_NOT_OUT_OF_SAMPLE"));
  assert.ok(result.reasons.includes("COSTS_NOT_INCLUDED"));
});

test("cost stress requires independent passing scenarios and baseline", () => {
  const result = validateCostStress({
    runId: "stress-1", checkedAt: now, baselineScenarioId: "baseline",
    scenarios: [
      { scenarioId: "baseline", result: {}, status: "PASS", costLoadBps: 10, netReturn: .1, totalCost: 1 },
      { scenarioId: "high-cost", result: {}, status: "PASS", costLoadBps: 40, netReturn: .03, totalCost: 4 }
    ], result: {}
  });
  assert.equal(result.status, "PASS");
});

test("integrity rejects duplicate IDs, gaps, orphan runs, and counter drift", () => {
  const result = validateIntegrity({
    runId: "integrity-1", checkedAt: now, eventIds: ["a", "a"], sequenceNumbers: [1, 3],
    eventTypes: ["UNKNOWN"], expectedEventTypes: ["KNOWN"], replayedCounters: { PASS: 1 },
    persistedCounters: { PASS: 2 }, referencedRunIds: ["missing"], manifests: [manifest], result: {}
  });
  assert.equal(result.status, "FAIL");
  assert.ok(result.reasons.includes("DUPLICATE_EVENT_ID"));
  assert.ok(result.reasons.includes("SEQUENCE_GAP"));
  assert.ok(result.reasons.includes("ORPHAN_RUN_missing"));
});

test("all research gates require three independent persisted reports", () => {
  const common = { status: "PASS", reasons: [], checkedAt: now, resultChecksum: "a".repeat(64) };
  assert.equal(allResearchGatesPassed([
    { ...common, runId: "wf", runType: "WALK_FORWARD" },
    { ...common, runId: "stress", runType: "COST_STRESS" },
    { ...common, runId: "integrity", runType: "INTEGRITY_CHECK" }
  ]), true);
  assert.equal(allResearchGatesPassed([{ ...common, runId: "wf", runType: "WALK_FORWARD" }]), false);
});
