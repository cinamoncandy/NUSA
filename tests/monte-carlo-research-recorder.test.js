const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { persistMonteCarloResearch } = require("../dist/apps/desktop/src/strategy/monteCarloResearchRecorder.js");

const input = Object.freeze({
  runId: "mc-recorded-1", strategyId: "strategy", strategyVersion: "1.0.0", parameterSet: { fast: 5 },
  datasetId: "dataset", datasetChecksum: "a".repeat(64), datasetStart: "2026-01-01T00:00:00.000Z", datasetEnd: "2026-02-01T00:00:00.000Z",
  codeVersion: "test-sha", createdAt: "2026-07-16T00:00:00.000Z", checkedAt: "2026-07-16T00:00:00.000Z",
  returns: [-0.02, -0.01, 0.01, 0.03], pathCount: 1_000, horizon: 20, ruinThreshold: 0.5, maximumRuinProbability: 1, seed: "dataset-sha|strategy-v1"
});

test("records deterministic Monte Carlo evidence atomically without persisting raw returns or seed", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-mc-recorder-"));
  const store = new DesktopPersistenceStore(join(directory, "paper.sqlite"));
  const first = persistMonteCarloResearch(store, input);
  const second = persistMonteCarloResearch(store, input);
  assert.deepEqual(first, second);
  assert.equal(first.report.status, "PASS");
  assert.equal(store.loadResearchRunManifests().length, 1);
  assert.equal(store.loadResearchValidationReports().length, 1);
  const persisted = JSON.stringify(store.loadResearchRunManifests()[0]);
  assert.equal(persisted.includes(input.seed), false);
  assert.equal(persisted.includes(JSON.stringify(input.returns)), false);
  assert.throws(() => persistMonteCarloResearch(store, { ...input, horizon: 21 }), /identity conflict/);
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test("paired research persistence rejects mismatched identities without partial rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-mc-pair-"));
  const store = new DesktopPersistenceStore(join(directory, "paper.sqlite"));
  const recorded = persistMonteCarloResearch(store, input);
  assert.throws(() => store.appendResearchEvidence(recorded.manifest, { ...recorded.report, resultChecksum: "b".repeat(64) }), /checksum mismatch/);
  assert.equal(store.loadResearchRunManifests().length, 1);
  assert.equal(store.loadResearchValidationReports().length, 1);
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
