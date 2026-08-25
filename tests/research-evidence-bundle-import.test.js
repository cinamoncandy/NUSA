const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { createResearchRunManifest, validateIntegrity, validateMonteCarlo, validateCostStress, validateWalkForward } = require("../dist/apps/cloud/src/researchRunValidation.js");

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-research-bundle-"));
  const dbPath = path.join(dir, "bundle.sqlite");
  new DatabaseSync(dbPath).close();
  return { dir, dbPath };
}

function entry(runType, result, report) {
  const manifest = createResearchRunManifest({
    runId: `bundle-${runType.toLowerCase()}`,
    runType,
    strategyId: "sma-crossover",
    strategyVersion: "v1",
    parameterSet: { short: 5, long: 20 },
    datasetId: "dataset-1",
    datasetChecksum: "a".repeat(64),
    datasetStart: "2026-01-01T00:00:00.000Z",
    datasetEnd: "2026-01-02T00:00:00.000Z",
    sampleCount: 100,
    createdAt: "2026-01-02T00:00:00.000Z",
    codeVersion: "code-1",
    config: { runType },
    result
  });
  return { manifest, report: { ...report, runId: manifest.runId, runType, resultChecksum: manifest.resultChecksum } };
}

function bundle() {
  return [
    entry("WALK_FORWARD", { fold: 1 }, validateWalkForward({ runId: "x", checkedAt: "2026-01-02T00:00:00.000Z", windows: [{ trainStart: "2026-01-01T00:00:00.000Z", trainEnd: "2026-01-01T06:00:00.000Z", testStart: "2026-01-01T07:00:00.000Z", testEnd: "2026-01-01T08:00:00.000Z", trainSampleCount: 10, testSampleCount: 10, complete: true, outOfSample: true, metrics: { return: 0 } }], minimumFolds: 1, result: { fold: 1 }, includesCosts: true, parameterSelectionFrozen: true })),
    entry("COST_STRESS", { scenarios: 2 }, validateCostStress({ runId: "x", checkedAt: "2026-01-02T00:00:00.000Z", baselineScenarioId: "base", scenarios: [{ scenarioId: "base", result: {}, status: "PASS", costLoadBps: 0, netReturn: 0, totalCost: 0 }, { scenarioId: "stress", result: {}, status: "PASS", costLoadBps: 20, netReturn: 0, totalCost: 1 }], result: { scenarios: 2 } })),
    entry("MONTE_CARLO", { ruinProbability: 0.01 }, validateMonteCarlo({ runId: "x", checkedAt: "2026-01-02T00:00:00.000Z", pathCount: 100, horizon: 10, ruinProbability: 0.01, maximumRuinProbability: 0.02, seedHash: "b".repeat(64), result: { ruinProbability: 0.01 } })),
    entry("INTEGRITY_CHECK", { events: 0 }, validateIntegrity({ runId: "x", checkedAt: "2026-01-02T00:00:00.000Z", eventIds: [], sequenceNumbers: [], eventTypes: [], expectedEventTypes: [], replayedCounters: {}, persistedCounters: {}, referencedRunIds: [], manifests: [], result: { events: 0 } }))
  ];
}

test("research evidence bundle persists all four gates atomically", () => {
  const { dbPath } = setup();
  const store = new DesktopPersistenceStore(dbPath);
  const entries = bundle();
  store.appendResearchEvidenceBundle(entries);
  assert.equal(store.loadResearchRunManifests().length, 4);
  assert.equal(store.loadResearchValidationReports().length, 4);
  store.close();
});

test("research evidence bundle rejects duplicate or mismatched entries before writing", () => {
  const { dbPath } = setup();
  const store = new DesktopPersistenceStore(dbPath);
  const entries = bundle();
  assert.throws(() => store.appendResearchEvidenceBundle([entries[0], entries[0]]), /duplicate runId/);
  assert.equal(store.loadResearchRunManifests().length, 0);
  assert.throws(() => store.appendResearchEvidenceBundle(entries.map((entry, index) => index === 1 ? { ...entry, report: { ...entry.report, resultChecksum: "c".repeat(64) } } : entry)), /identity mismatch/);
  assert.equal(store.loadResearchRunManifests().length, 0);
  store.close();
});
