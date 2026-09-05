const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteHedgeRecoveryStore } = require("../dist/packages/storage/src/hedgeRecoveryStore.js");
const { appendHedgeRecoveryEvent, replayHedgeRecoveryLedger } = require("../dist/apps/cloud/src/hedgeRecoveryLedger.js");

const event = (overrides = {}) => ({
  hedgeId: "hedge-1",
  action: "FILL_UPDATED",
  status: "PARTIALLY_HEDGED",
  actualDelta: 0.5,
  reason: "spot leg filled first",
  recordedAt: 1_000,
  ...overrides
});

const appendStored = (store, records, nextEvent) => {
  const next = appendHedgeRecoveryEvent(records, nextEvent);
  const state = replayHedgeRecoveryLedger(next);
  store.appendAndSave(next[next.length - 1], state);
  return next;
};

test("persists and replays partial-fill recovery across restart", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteHedgeRecoveryStore(db);
  let _records = [];
  _records = appendStored(store, _records, event());
  _records = appendStored(store, _records, event({ action: "CANCEL_REMAINING", reason: "cancelled open remainder", recordedAt: 1_001 }));
  _records = appendStored(store, _records, event({ action: "COMPENSATE", status: "REBALANCING", actualDelta: 0.1, reason: "paper compensation filled", recordedAt: 1_002 }));

  const restarted = new SqliteHedgeRecoveryStore(db);
  const replayed = replayHedgeRecoveryLedger(restarted.list("hedge-1"));
  assert.equal(replayed.status, "REBALANCING");
  assert.equal(replayed.actualDelta, 0.1);
  assert.equal(replayed.ledgerHash, restarted.loadState("hedge-1").ledgerHash);
  db.close();
});

test("durably records unresolved exposure and kill-switch recommendation", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteHedgeRecoveryStore(db);
  let _records = appendStored(store, [], event());
  _records = appendStored(store, _records, event({ action: "KILL_SWITCH_RECOMMENDED", status: "FAULTED", reason: "unhedged exposure unresolved", recordedAt: 1_001 }));
  const state = store.loadState("hedge-1");
  assert.equal(state.status, "FAULTED");
  assert.equal(state.killSwitchRecommended, true);
  assert.equal(replayHedgeRecoveryLedger(store.list("hedge-1")).killSwitchRecommended, true);
  db.close();
});

test("rejects tampering, mixed hedge ids, and invalid terminal transitions", () => {
  const records = appendHedgeRecoveryEvent([], event());
  assert.throws(() => replayHedgeRecoveryLedger([{ ...records[0], hash: "0".repeat(64) }]), /hash mismatch/);
  assert.throws(() => appendHedgeRecoveryEvent(records, event({ hedgeId: "hedge-2", recordedAt: 1_001 })), /cannot mix hedge ids/);
  const faulted = appendHedgeRecoveryEvent(records, event({ action: "FAULTED", status: "FAULTED", reason: "recovery failed", recordedAt: 1_001 }));
  assert.throws(() => appendHedgeRecoveryEvent(faulted, event({ action: "COMPENSATE", status: "HEDGED", recordedAt: 1_002 })), /invalid hedge transition/);
});

test("rolls back record and state together when persistence fails", () => {
  const db = new SqliteDatabase(":memory:");
  const store = new SqliteHedgeRecoveryStore(db);
  db.connection.exec(`
    CREATE TRIGGER reject_hedge_state BEFORE INSERT ON hedge_recovery_state
    BEGIN SELECT RAISE(ABORT, 'forced hedge state failure'); END;
  `);
  const records = appendHedgeRecoveryEvent([], event());
  const state = replayHedgeRecoveryLedger(records);
  assert.throws(() => store.appendAndSave(records[0], state), /forced hedge state failure/);
  assert.equal(store.list("hedge-1").length, 0);
  assert.equal(store.loadState("hedge-1"), undefined);
  db.close();
});

test("returns immutable deterministic recovery state", () => {
  const records = appendHedgeRecoveryEvent([], event());
  const first = replayHedgeRecoveryLedger(records);
  const second = replayHedgeRecoveryLedger(records);
  assert.ok(Object.isFrozen(records));
  assert.ok(Object.isFrozen(records[0]));
  assert.ok(Object.isFrozen(first));
  assert.deepEqual(first, second);
});
