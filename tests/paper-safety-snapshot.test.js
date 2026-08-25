const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaperSafetySnapshot, serializePaperSafetySnapshot, validatePaperSafetySnapshot, recoverPaperSafetySnapshot } = require("../dist/apps/desktop/src/paper/paperSafetySnapshot.js");

const fingerprints = Object.freeze({ strategy: "strategy", config: "config", runtime: "runtime", riskPolicy: "risk" });
function input(overrides = {}) { return {
  snapshotId: "snapshot-1", createdAt: 100, tradingMode: "PAPER_CANARY", killSwitch: { active: false, activatedAt: null, reason: null }, approval: null, fingerprints,
  deploymentIntegrity: { status: "PASS", checkedAt: 100, reasonCodes: [] }, reconciliation: { status: "PASS", checkedAt: 100, ledgerSha256: null, reasonCodes: [] },
  idempotency: { signalIds: ["signal-1"], commandIds: ["command-1"], clientOrderIds: ["client-1"], orderIds: ["order-1"], fillIds: ["fill-1"] }, openAlerts: [],
  lossState: { tradingDay: "2026-07-27", dayStartEquity: 100, realizedDailyPnl: 0, unrealizedDailyPnl: 0, consecutiveLossCount: 0, sessionPeakEquity: 100, sessionDrawdown: 0 },
  marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }, sourceCommitSha: "a".repeat(40), ...overrides
}; }

test("Paper safety snapshots serialize and hash deterministically with automatic trading off", () => {
  const first = createPaperSafetySnapshot(input());
  const second = createPaperSafetySnapshot(input());
  assert.equal(first.automaticTrading, false);
  assert.equal(first.snapshotSha256, second.snapshotSha256);
  assert.equal(serializePaperSafetySnapshot(first), serializePaperSafetySnapshot(second));
});

test("snapshot validation rejects tampering, partial data, duplicate identities and future schema", () => {
  const snapshot = createPaperSafetySnapshot(input());
  assert.throws(() => validatePaperSafetySnapshot({ ...snapshot, sourceCommitSha: "b".repeat(40) }), /hash mismatch/);
  assert.throws(() => validatePaperSafetySnapshot({ ...snapshot, schemaVersion: 2 }), /unsupported/);
  assert.throws(() => validatePaperSafetySnapshot({ ...snapshot, idempotency: { ...snapshot.idempotency, signalIds: ["same", "same"] } }), /invalid signalIds/);
  assert.throws(() => validatePaperSafetySnapshot({ ...snapshot, lossState: { ...snapshot.lossState, sessionDrawdown: Infinity } }), /invalid loss state/);
});

test("restart recovery downgrades canary, preserves blockers, and always requires reconciliation", () => {
  const snapshot = createPaperSafetySnapshot(input({ killSwitch: { active: true, activatedAt: 100, reason: "operator" }, openAlerts: [{ alertId: "p0", severity: "P0", status: "ACKNOWLEDGED", reasonCode: "TEST", createdAt: 100, acknowledgedBy: "owner" }] }));
  const recovery = recoverPaperSafetySnapshot(snapshot, { sourceCommitSha: "a".repeat(40), fingerprints });
  assert.equal(recovery.mode, "SHADOW");
  assert.equal(recovery.automaticTrading, false);
  assert.equal(recovery.reconciliation, "REQUIRED");
  assert.ok(recovery.reasonCodes.includes("KILL_SWITCH_ACTIVE"));
  assert.ok(recovery.reasonCodes.includes("OPEN_P0_ALERT"));
});
