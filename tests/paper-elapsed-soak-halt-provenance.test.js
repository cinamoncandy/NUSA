const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeSnapshot, validateSoakObservations } = require("../scripts/paper-elapsed-soak.js");

function snapshot(overrides = {}) {
  return {
    generatedAt: 1,
    mode: "PAPER",
    health: "FAIL_CLOSED",
    readyForPaperOperations: false,
    dashboard: {
      mode: "FAULTED",
      overallHealth: "DOWN",
      killSwitchActive: true,
    },
    research: null,
    operations: {
      runtimeState: "HALTED",
      schedulerRunning: true,
      schedulerMode: "ACTIVE",
      pipelineStage: "PAPER_DECISION",
      transport: "ONLINE",
      killSwitchActive: true,
      accountHalted: true,
      pendingWrites: 0,
      heartbeat: {
        eventCount: 10,
        decisionCount: 10,
        lastHeartbeatAt: 1,
        lastMarketEventAt: 1,
        lastError: "sensitive-detail-must-not-be-copied",
      },
    },
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    ...overrides,
  };
}

test("soak summary preserves bounded HALT provenance without copying error text", () => {
  const summary = summarizeSnapshot(snapshot(), 1000);

  assert.equal(summary.runtimeState, "HALTED");
  assert.equal(summary.schedulerRunning, true);
  assert.equal(summary.dashboardMode, "FAULTED");
  assert.equal(summary.dashboardHealth, "DOWN");
  assert.equal(summary.dashboardKillSwitchActive, true);
  assert.equal(summary.operationsKillSwitchActive, true);
  assert.equal(summary.accountHalted, true);
  assert.equal(summary.heartbeatErrorPresent, true);
  assert.deepEqual(summary.haltReasons, [
    "DASHBOARD_FAULTED",
    "DASHBOARD_HEALTH_DOWN",
    "DASHBOARD_KILL_SWITCH_ACTIVE",
    "OPERATIONS_KILL_SWITCH_ACTIVE",
    "ACCOUNT_HALTED",
  ]);
  assert.equal(JSON.stringify(summary).includes("sensitive-detail-must-not-be-copied"), false);
  assert.equal(summary.liveAuthority, "NONE");
  assert.equal(summary.productionMutationAllowed, false);
});

test("unattributed HALT is explicit and remains fail-closed", () => {
  const halted = summarizeSnapshot(snapshot({
    health: "HEALTHY",
    dashboard: { mode: "PAPER", overallHealth: "HEALTHY", killSwitchActive: false },
    operations: {
      runtimeState: "HALTED",
      schedulerRunning: true,
      schedulerMode: "ACTIVE",
      pipelineStage: "PAPER_DECISION",
      transport: "ONLINE",
      killSwitchActive: false,
      accountHalted: false,
      pendingWrites: 0,
      heartbeat: { eventCount: 2, decisionCount: 2, lastHeartbeatAt: 2, lastMarketEventAt: 2, lastError: null },
    },
  }), 1000);
  assert.deepEqual(halted.haltReasons, ["HALTED_CAUSE_UNATTRIBUTED"]);

  const validation = validateSoakObservations([
    { ...halted, observedAt: "2026-09-11T00:00:00.000Z", monotonicElapsedMs: 0, runtimeState: "RUNNING", eventCount: 1, decisionCount: 1 },
    { ...halted, observedAt: "2026-09-11T00:00:01.000Z", monotonicElapsedMs: 1000, eventCount: 2, decisionCount: 2 },
  ], 1000);

  assert.equal(validation.accepted, false);
  assert.deepEqual(validation.reasons, ["PAPER_RUNTIME_NOT_ACTIVE"]);
  assert.equal(validation.liveAuthority, "NONE");
  assert.equal(validation.productionMutationAllowed, false);
  assert.equal(validation.aiAuthority, "ZERO_AUTHORITY");
});
