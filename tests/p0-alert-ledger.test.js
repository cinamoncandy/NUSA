const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  appendP0AlertEvent,
  replayP0AlertLedger
} = require("../dist/apps/cloud/src/p0AlertLedger.js");
const { SqliteP0AlertRepository } = require("../dist/apps/cloud/src/p0AlertRepository.js");
const { readPaperEngineControlState } = require("../dist/apps/cloud/src/paperEngineControlState.js");
const { appendControlAuditEvent } = require("../dist/apps/cloud/src/controlAuditLedger.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");

const event = (overrides = {}) => ({
  eventId: "p0-event-1",
  incidentId: "incident-1",
  type: "OPENED",
  occurredAt: 100,
  reason: "critical runtime invariant failed",
  ...overrides
});

const emergencyStop = () => ({
  commandId: "stop-1",
  userId: "operator",
  deviceId: "console",
  type: "EMERGENCY_STOP",
  status: "ACCEPTED",
  decidedAt: 100,
  reason: "safety stop",
  resultingMode: "STOPPED",
  cancelOpenOrders: true
});

test("P0 ledger opens, partially resolves, and fully clears incidents deterministically", () => {
  let ledger = appendP0AlertEvent([], event());
  ledger = appendP0AlertEvent(ledger, event({ eventId: "p0-event-2", incidentId: "incident-2", occurredAt: 101 }));
  let state = replayP0AlertLedger(ledger);
  assert.equal(state.openP0, true);
  assert.deepEqual(state.openIncidentIds, ["incident-1", "incident-2"]);

  ledger = appendP0AlertEvent(ledger, event({ eventId: "p0-event-3", type: "RESOLVED", occurredAt: 102, reason: "incident one resolved" }));
  state = replayP0AlertLedger(ledger);
  assert.equal(state.openP0, true);
  assert.deepEqual(state.openIncidentIds, ["incident-2"]);

  ledger = appendP0AlertEvent(ledger, event({ eventId: "p0-event-4", incidentId: "incident-2", type: "RESOLVED", occurredAt: 103, reason: "incident two resolved" }));
  state = replayP0AlertLedger(ledger);
  assert.equal(state.openP0, false);
  assert.deepEqual(state.openIncidentIds, []);
});

test("P0 ledger rejects invalid lifecycle, duplicates, timestamp regression, and tampering", () => {
  const opened = appendP0AlertEvent([], event());
  assert.throws(() => appendP0AlertEvent(opened, event({ eventId: "again", occurredAt: 101 })), /already open/);
  assert.throws(() => appendP0AlertEvent([], event({ type: "RESOLVED" })), /is not open/);
  assert.throws(() => appendP0AlertEvent(opened, event({ incidentId: "incident-2", occurredAt: 99 })), /non-decreasing/);
  assert.throws(() => appendP0AlertEvent(opened, event({ incidentId: "incident-2" })), /duplicated/);
  assert.throws(() => replayP0AlertLedger([{ ...opened[0], sequence: 2 }]), /sequence mismatch/);
  assert.throws(() => replayP0AlertLedger([{ ...opened[0], previousHash: "f".repeat(64) }]), /previous hash mismatch/);
  assert.throws(() => replayP0AlertLedger([{ ...opened[0], hash: "f".repeat(64) }]), /hash mismatch/);
});

test("SQLite P0 repository persists replayable safety state across reopen", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-p0-"));
  const filename = path.join(directory, "state.sqlite");
  let db = new SqliteDatabase(filename);
  let repository = new SqliteP0AlertRepository(db);
  repository.append(event());
  assert.equal(repository.readState().openP0, true);
  db.close();

  db = new SqliteDatabase(filename);
  repository = new SqliteP0AlertRepository(db);
  assert.equal(repository.readState().openP0, true);
  repository.append(event({ eventId: "p0-event-2", type: "RESOLVED", occurredAt: 101, reason: "recovered" }));
  assert.equal(repository.readState().openP0, false);
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("SQLite P0 repository fails closed when persisted hash evidence is corrupted", () => {
  const db = new SqliteDatabase(":memory:");
  const repository = new SqliteP0AlertRepository(db);
  repository.append(event());
  db.connection.prepare("UPDATE cloud_p0_alert_events SET hash = ? WHERE sequence = 1").run("f".repeat(64));
  assert.throws(() => repository.readState(), /hash mismatch/);
  db.close();
});

test("paper engine control state derives both independent HALT-capable inputs from ledgers", () => {
  const controls = appendControlAuditEvent([], emergencyStop());
  const p0 = appendP0AlertEvent([], event());
  const state = readPaperEngineControlState(controls, p0);
  assert.equal(state.killSwitchActive, true);
  assert.equal(state.openP0, true);
  assert.equal(Object.isFrozen(state), true);
});
