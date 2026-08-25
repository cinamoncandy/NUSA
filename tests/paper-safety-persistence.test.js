const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");
const { createPaperSafetySnapshot, recoverPaperSafetySnapshot } = require("../dist/apps/desktop/src/paper/paperSafetySnapshot.js");

function snapshot(id, killSwitch = { active: false, activatedAt: null, reason: null }) {
  return createPaperSafetySnapshot({
    snapshotId: id,
    createdAt: 1,
    tradingMode: "PAPER_MANUAL",
    killSwitch,
    approval: null,
    fingerprints: { strategy: "s", config: "c", runtime: "r", riskPolicy: "p" },
    deploymentIntegrity: { status: "PASS", checkedAt: 1, reasonCodes: [] },
    reconciliation: { status: "REQUIRED", checkedAt: null, ledgerSha256: null, reasonCodes: [] },
    idempotency: { signalIds: [], commandIds: [], clientOrderIds: [], orderIds: [], fillIds: [] },
    openAlerts: [],
    lossState: { tradingDay: "2026-07-27", dayStartEquity: 1, realizedDailyPnl: 0, unrealizedDailyPnl: 0, consecutiveLossCount: 0, sessionPeakEquity: 1, sessionDrawdown: 0 },
    marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 },
    sourceCommitSha: "a".repeat(40),
  });
}

test("SQLite stores a complete validated Paper safety snapshot atomically", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-paper-safety-"));
  try {
    const store = new DesktopPersistenceStore(path.join(dir, "paper.db"));
    store.savePaperSafetySnapshot(snapshot("first"));
    assert.equal(store.loadPaperSafetySnapshot().snapshotId, "first");
    store.savePaperSafetySnapshot(snapshot("second"));
    assert.equal(store.loadPaperSafetySnapshot().snapshotId, "second");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an invalid replacement preserves the prior durable snapshot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-paper-safety-"));
  try {
    const store = new DesktopPersistenceStore(path.join(dir, "paper.db"));
    store.savePaperSafetySnapshot(snapshot("known-good"));
    assert.throws(() => store.savePaperSafetySnapshot({ ...snapshot("unsafe"), automaticTrading: true }), /unsafe/);
    assert.equal(store.loadPaperSafetySnapshot().snapshotId, "known-good");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("active kill switch survives restart and keeps recovery fail closed", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "nusa-paper-safety-"));
  const databasePath = path.join(dir, "paper.db");
  try {
    let store = new DesktopPersistenceStore(databasePath);
    store.savePaperSafetySnapshot(snapshot("halted", { active: true, activatedAt: 2, reason: "operator emergency stop" }));
    store.close();

    store = new DesktopPersistenceStore(databasePath);
    const loaded = store.loadPaperSafetySnapshot();
    assert.equal(loaded.killSwitch.active, true);
    assert.equal(loaded.killSwitch.reason, "operator emergency stop");

    const recovery = recoverPaperSafetySnapshot(loaded, {
      sourceCommitSha: "a".repeat(40),
      fingerprints: loaded.fingerprints,
    });
    assert.equal(recovery.blocked, true);
    assert.equal(recovery.automaticTrading, false);
    assert.ok(recovery.reasonCodes.includes("KILL_SWITCH_ACTIVE"));
    assert.ok(recovery.reasonCodes.includes("AUTOMATIC_TRADING_OFF_AFTER_RESTART"));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
