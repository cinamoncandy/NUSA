const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRuntimeHealthReport } = require("../dist/apps/cloud/src/runtimeHealthMonitor.js");

const thresholds = {
  maximumRunAgeMs: 1_000,
  maximumSnapshotAgeMs: 500,
  maximumQueueDepth: 10,
  maximumConsecutiveFailures: 2,
  warningAverageStageDurationMs: 100
};

const successRecord = (overrides = {}) => ({
  runId: "run-1",
  status: "SUCCESS",
  startedAt: 100,
  completedAt: 200,
  stages: [{ stage: "Research", status: "SUCCESS", startedAt: 100, completedAt: 150, durationMs: 50 }],
  skippedStages: [],
  killSwitchRecommended: false,
  ...overrides
});

const input = (overrides = {}) => ({
  now: 300,
  records: [successRecord()],
  snapshotGeneratedAt: 250,
  ipcHealthy: true,
  queueDepth: 0,
  killSwitchActive: false,
  ...overrides
});

test("builds a healthy immutable runtime report", () => {
  const report = buildRuntimeHealthReport(input(), thresholds);
  assert.equal(report.status, "HEALTHY");
  assert.equal(report.score, 100);
  assert.equal(report.lastSuccessfulRunAt, 200);
  assert.equal(report.stages[0].stage, "Research");
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.stages));
  assert.ok(Object.isFrozen(report.stages[0]));
});

test("kill switch has highest BLOCKED severity", () => {
  const report = buildRuntimeHealthReport(input({ killSwitchActive: true, ipcHealthy: false }), thresholds);
  assert.equal(report.status, "BLOCKED");
  assert.match(report.reasons.join(" "), /Kill Switch/);
});

test("consecutive failures and unhealthy IPC become critical", () => {
  const failed = (runId, completedAt) => successRecord({
    runId,
    status: "FAILED",
    startedAt: completedAt - 20,
    completedAt,
    stages: [{ stage: "Risk", status: "FAILED", startedAt: completedAt - 20, completedAt, durationMs: 20, reason: "risk adapter failed" }],
    skippedStages: ["Publish"],
    killSwitchRecommended: true
  });
  const report = buildRuntimeHealthReport(input({ records: [failed("run-a", 180), failed("run-b", 220)], ipcHealthy: false }), thresholds);
  assert.equal(report.status, "CRITICAL");
  assert.equal(report.consecutiveFailures, 2);
  assert.equal(report.stages.find((stage) => stage.stage === "Publish").lastStatus, "SKIPPED");
});

test("stale run, stale snapshot, deep queue and slow stage create warnings", () => {
  const slow = successRecord({
    completedAt: 200,
    stages: [{ stage: "Research", status: "SUCCESS", startedAt: 0, completedAt: 150, durationMs: 150 }]
  });
  const report = buildRuntimeHealthReport(input({ now: 2_000, records: [slow], snapshotGeneratedAt: 1_000, queueDepth: 11 }), thresholds);
  assert.equal(report.status, "WARNING");
  assert.ok(report.reasons.length >= 3);
});

test("missing records and snapshot fail closed as warning", () => {
  const report = buildRuntimeHealthReport(input({ records: [], snapshotGeneratedAt: null }), thresholds);
  assert.equal(report.status, "WARNING");
  assert.equal(report.lastSuccessfulRunAt, null);
});

test("rejects duplicate runs, future data and invalid thresholds", () => {
  assert.throws(() => buildRuntimeHealthReport(input({ records: [successRecord(), successRecord()] }), thresholds), /unique runId/);
  assert.throws(() => buildRuntimeHealthReport(input({ snapshotGeneratedAt: 301 }), thresholds), /future/);
  assert.throws(() => buildRuntimeHealthReport(input(), { ...thresholds, maximumRunAgeMs: 0 }), /greater than zero/);
});
