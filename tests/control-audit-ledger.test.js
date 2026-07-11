const test = require("node:test");
const assert = require("node:assert/strict");
const {
  appendControlAuditEvent,
  replayControlAuditLedger
} = require("../dist/apps/cloud/src/controlAuditLedger.js");

const event = (overrides = {}) => ({
  commandId: "cmd-1",
  userId: "user-1",
  deviceId: "device-1",
  type: "PAUSE",
  status: "ACCEPTED",
  decidedAt: 100,
  reason: "owner request",
  resultingMode: "STOPPED",
  cancelOpenOrders: false,
  ...overrides
});

test("appends deterministic hash-chained records", () => {
  const first = appendControlAuditEvent([], event());
  const second = appendControlAuditEvent(first, event({
    commandId: "cmd-2",
    type: "RESUME_PAPER",
    decidedAt: 101,
    resultingMode: "PAPER"
  }));
  assert.equal(first.length, 1);
  assert.equal(second.length, 2);
  assert.equal(second[1].previousHash, second[0].hash);
  assert.deepEqual(second, appendControlAuditEvent(first, event({
    commandId: "cmd-2",
    type: "RESUME_PAPER",
    decidedAt: 101,
    resultingMode: "PAPER"
  })));
});

test("replays accepted pause and paper resume", () => {
  let ledger = appendControlAuditEvent([], event());
  ledger = appendControlAuditEvent(ledger, event({
    commandId: "cmd-2",
    type: "RESUME_PAPER",
    decidedAt: 101,
    resultingMode: "PAPER"
  }));
  const state = replayControlAuditLedger(ledger);
  assert.equal(state.mode, "PAPER");
  assert.equal(state.killSwitchActive, false);
  assert.deepEqual([...state.processedCommandIds].sort(), ["cmd-1", "cmd-2"]);
  assert.equal(state.ledgerHash, ledger[1].hash);
});

test("replays emergency stop as irreversible kill switch", () => {
  const ledger = appendControlAuditEvent([], event({
    type: "EMERGENCY_STOP",
    resultingMode: "STOPPED",
    cancelOpenOrders: true
  }));
  const state = replayControlAuditLedger(ledger);
  assert.equal(state.mode, "STOPPED");
  assert.equal(state.killSwitchActive, true);

  assert.throws(() => appendControlAuditEvent(ledger, event({
    commandId: "cmd-2",
    type: "RESUME_PAPER",
    decidedAt: 101,
    resultingMode: "PAPER"
  })), /active kill switch/);
});

test("permits duplicate audit only after an original decision", () => {
  let ledger = appendControlAuditEvent([], event());
  ledger = appendControlAuditEvent(ledger, event({
    status: "DUPLICATE",
    decidedAt: 101,
    reason: "command already processed"
  }));
  assert.equal(replayControlAuditLedger(ledger).processedCommandIds.size, 1);

  assert.throws(() => appendControlAuditEvent([], event({
    status: "DUPLICATE"
  })), /no prior command decision/);
});

test("rejects conflicting decisions and invalid cancellation semantics", () => {
  const ledger = appendControlAuditEvent([], event());
  assert.throws(() => appendControlAuditEvent(ledger, event({
    decidedAt: 101
  })), /decided more than once/);
  assert.throws(() => appendControlAuditEvent([], event({
    type: "EMERGENCY_STOP",
    cancelOpenOrders: false
  })), /must request open-order cancellation/);
  assert.throws(() => appendControlAuditEvent([], event({
    type: "PAUSE",
    cancelOpenOrders: true
  })), /only emergency stop/);
});

test("detects tampering, broken ordering, and mode mismatch", () => {
  const ledger = appendControlAuditEvent([], event());
  assert.throws(() => replayControlAuditLedger([{ ...ledger[0], hash: "f".repeat(64) }]), /hash mismatch/);
  assert.throws(() => replayControlAuditLedger([{ ...ledger[0], sequence: 2 }]), /sequence mismatch/);
  assert.throws(() => appendControlAuditEvent(ledger, event({
    commandId: "cmd-2",
    decidedAt: 99
  })), /timestamps must be non-decreasing/);
  assert.throws(() => appendControlAuditEvent([], event({
    type: "RESUME_PAPER",
    resultingMode: "STOPPED"
  })), /resulting mode mismatch/);
});

test("returns frozen records and replay state", () => {
  const ledger = appendControlAuditEvent([], event());
  const state = replayControlAuditLedger(ledger);
  assert.equal(Object.isFrozen(ledger), true);
  assert.equal(Object.isFrozen(ledger[0]), true);
  assert.equal(Object.isFrozen(ledger[0].event), true);
  assert.equal(Object.isFrozen(state), true);
});
