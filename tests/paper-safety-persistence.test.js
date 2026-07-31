const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");
const { createPaperSafetySnapshot } = require("../dist/apps/desktop/src/paperSafetySnapshot.js");
function snapshot(id) { return createPaperSafetySnapshot({ snapshotId: id, createdAt: 1, tradingMode: "PAPER_MANUAL", killSwitch: { active: false, activatedAt: null, reason: null }, approval: null, fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" }, deploymentIntegrity: { status: "PASS", checkedAt: 1, reasonCodes: [] }, reconciliation: { status: "REQUIRED", checkedAt: null, ledgerSha256: null, reasonCodes: [] }, idempotency: { signalIds: [], commandIds: [], clientOrderIds: [], orderIds: [], fillIds: [] }, openAlerts: [], lossState: { tradingDay: "2026-07-27", dayStartEquity: 1, realizedDailyPnl: 0, unrealizedDailyPnl: 0, consecutiveLossCount: 0, sessionPeakEquity: 1, sessionDrawdown: 0 }, marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }, sourceCommitSha: "a".repeat(40) }); }
test("SQLite stores a complete validated Paper safety snapshot atomically", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-paper-safety-"));
  try { const store = new DesktopPersistenceStore(path.join(dir, "paper.db")); store.savePaperSafetySnapshot(snapshot("first")); assert.equal(store.loadPaperSafetySnapshot().snapshotId, "first"); store.savePaperSafetySnapshot(snapshot("second")); assert.equal(store.loadPaperSafetySnapshot().snapshotId, "second"); store.close(); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});


test("an invalid replacement preserves the prior durable snapshot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-paper-safety-"));
  try {
    const store = new DesktopPersistenceStore(path.join(dir, "paper.db"));
    store.savePaperSafetySnapshot(snapshot("known-good"));
    assert.throws(() => store.savePaperSafetySnapshot({ ...snapshot("unsafe"), automaticTrading: true }), /unsafe/);
    assert.equal(store.loadPaperSafetySnapshot().snapshotId, "known-good");
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
