const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfflineSyncSnapshot, transitionOfflineSync } = require("../dist/apps/execution/src/offline-synchronization.js");

test("recovery must validate before syncing and completing", () => {
  let snapshot = createOfflineSyncSnapshot(1000);
  snapshot = transitionOfflineSync(snapshot, "RECOVERY_VALIDATED", 1100);
  snapshot = transitionOfflineSync(snapshot, "SYNC_STARTED", 1200);
  snapshot = transitionOfflineSync(snapshot, "SYNC_COMPLETED", 1300);

  assert.equal(snapshot.state, "ONLINE");
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.lastHealthyAtMs, 1300);
  assert.equal(snapshot.staleSinceMs, null);
});

test("invalid state skips and time reversal fail closed", () => {
  const snapshot = createOfflineSyncSnapshot(1000);
  assert.throws(() => transitionOfflineSync(snapshot, "SYNC_COMPLETED", 1100), /invalid offline synchronization transition/);
  assert.throws(() => transitionOfflineSync(snapshot, "RECOVERY_VALIDATED", 900), /time is invalid/);
});

test("connection degradation and failed sync preserve stale state", () => {
  let snapshot = createOfflineSyncSnapshot(1000, "ONLINE");
  snapshot = transitionOfflineSync(snapshot, "CONNECTION_DEGRADED", 1100);
  snapshot = transitionOfflineSync(snapshot, "CONNECTION_LOST", 1200);
  snapshot = transitionOfflineSync(snapshot, "RECOVERY_VALIDATED", 1300);
  snapshot = transitionOfflineSync(snapshot, "SYNC_STARTED", 1400);
  snapshot = transitionOfflineSync(snapshot, "SYNC_FAILED", 1500);

  assert.equal(snapshot.state, "OFFLINE");
  assert.equal(snapshot.staleSinceMs, 1100);
  assert.equal(snapshot.lastHealthyAtMs, 1000);
});
