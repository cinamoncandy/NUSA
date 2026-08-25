const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

/**
 * WO-0019. main.ts's recordKillSwitchAudit() (source-verified in
 * risk-safety-runtime-wiring.test.js) has exactly one shape: build the audit record, call
 * persistenceStore.appendOperationsAudit(record), and only THEN does the caller flip
 * persistedKillSwitchActive. Electron's main process cannot be booted under node --test, so
 * this test exercises the actual mechanism that guarantees "audit write failure never changes
 * kill switch state": if appendOperationsAudit throws, a synchronous caller stops at that
 * statement and no code after it -- including a state assignment -- ever runs. That is
 * ordinary JavaScript control flow, not something specific to Electron, so it is fully
 * verifiable here against the real persistence implementation.
 */

function tempDbFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-kill-switch-audit-"));
  return path.join(dir, "paper.sqlite");
}

test("appendOperationsAudit persists a kill-switch action record and it is readable back", () => {
  const file = tempDbFile();
  const store = new DesktopPersistenceStore(file);
  try {
    const record = Object.freeze({
      auditId: "audit-kill-switch-1",
      actor: "LOCAL_OPERATOR",
      action: "KILL_SWITCH_RELEASED",
      target: null,
      metadata: Object.freeze({ reason: "operator verified market data", previousState: true, newState: false }),
      createdAt: new Date().toISOString()
    });
    store.appendOperationsAudit(record);
    const loaded = store.loadOperationsAudit();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].action, "KILL_SWITCH_RELEASED");
    assert.equal(loaded[0].metadata.previousState, true);
    assert.equal(loaded[0].metadata.newState, false);
  } finally {
    store.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test("a failed audit write throws synchronously, so a caller sequencing the state change after it never reaches that assignment", () => {
  const file = tempDbFile();
  const store = new DesktopPersistenceStore(file);
  store.close(); // The connection is now closed; any further write throws.

  // Mirrors main.ts's recordKillSwitchAudit()'s exact statement order, followed by the caller's
  // state assignment -- proving the assignment is unreachable when the audit write throws.
  let killSwitchActive = true;
  let threw = false;
  try {
    store.appendOperationsAudit(Object.freeze({
      auditId: "audit-kill-switch-2", actor: "LOCAL_OPERATOR", action: "KILL_SWITCH_RELEASED", target: null,
      metadata: Object.freeze({ reason: "test", previousState: true, newState: false }), createdAt: new Date().toISOString()
    }));
    killSwitchActive = false; // Unreachable if the write above throws.
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
  assert.equal(killSwitchActive, true, "kill switch state must be unchanged when the audit write fails");
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
