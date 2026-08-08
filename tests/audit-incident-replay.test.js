"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUDIT_INCIDENT_REPLAY_DESCRIPTOR,
  appendSafetyReplayEvent,
  replaySafetyHistory
} = require("../dist/apps/execution/src/audit-incident-replay.js");
const { validateAuditIncidentReplay } = require("../scripts/validate-audit-incident-replay.js");

const REV = "1".repeat(40);
const CFG = "2".repeat(64);
const base = (overrides = {}) => ({
  eventId: "evt-1",
  eventType: "OPERATIONS_SNAPSHOT",
  actorId: "operator-1",
  actorKind: "HUMAN",
  occurredAt: "2026-08-08T00:00:00.000Z",
  observedAt: "2026-08-08T00:00:01.000Z",
  sourceRefs: ["evidence:ops-1"],
  codeRevision: REV,
  configurationHash: CFG,
  payload: { overallHealth: "HEALTHY" },
  ...overrides
});

function completeHistory() {
  const events = [
    base(),
    base({ eventId: "evt-2", eventType: "HARD_RISK_DECISION", occurredAt: "2026-08-08T00:00:02.000Z", observedAt: "2026-08-08T00:00:03.000Z", payload: { decision: "PASS" } }),
    base({ eventId: "evt-3", eventType: "KILL_SWITCH_STATE", occurredAt: "2026-08-08T00:00:04.000Z", observedAt: "2026-08-08T00:00:05.000Z", payload: { state: "INACTIVE" } }),
    base({ eventId: "evt-4", eventType: "RECONCILIATION", occurredAt: "2026-08-08T00:00:06.000Z", observedAt: "2026-08-08T00:00:07.000Z", payload: { state: "MATCH" } }),
    base({ eventId: "evt-5", eventType: "GOVERNANCE_TRANSITION", occurredAt: "2026-08-08T00:00:08.000Z", observedAt: "2026-08-08T00:00:09.000Z", payload: { state: "RESTRICTED" } }),
    base({ eventId: "evt-6", eventType: "INCIDENT", occurredAt: "2026-08-08T00:00:10.000Z", observedAt: "2026-08-08T00:00:11.000Z", payload: { code: "MARKET_STALE" } }),
    base({ eventId: "evt-7", eventType: "CONTROL_REQUEST", occurredAt: "2026-08-08T00:00:12.000Z", observedAt: "2026-08-08T00:00:13.000Z", payload: { action: "REQUEST_HALT" } })
  ];
  return events.reduce((records, event) => appendSafetyReplayEvent(records, event), []);
}

test("builds deterministic tamper-evident history", () => {
  const first = completeHistory();
  const second = completeHistory();
  assert.deepEqual(second, first);
  const replayA = replaySafetyHistory(first);
  const replayB = replaySafetyHistory(second);
  assert.equal(replayA.chainHash, replayB.chainHash);
  assert.equal(replayA.fingerprint, replayB.fingerprint);
  assert.equal(replayA.status, "VALID");
  assert.equal(replayA.incidentCount, 1);
  assert.equal(replayA.safeControlRequestCount, 1);
  assert.equal(replayA.executionAuthority, false);
  assert.equal(replayA.authorizesLive, false);
});

test("detects tamper, reorder, anchored deletion, and duplicate identity", () => {
  const records = completeHistory();
  assert.throws(() => replaySafetyHistory([{ ...records[0], hash: "f".repeat(64) }, ...records.slice(1)]), /HASH_MISMATCH/);
  assert.throws(() => replaySafetyHistory([records[1], records[0], ...records.slice(2)]), /SEQUENCE_MISMATCH|PREVIOUS_HASH_MISMATCH/);
  assert.throws(() => replaySafetyHistory(records.slice(0, -1), { expectedEventCount: records.length, expectedChainHash: records.at(-1).hash }), /EXPECTED_COUNT_MISMATCH/);
  assert.throws(() => appendSafetyReplayEvent(records, base({ eventId: "evt-1", occurredAt: "2026-08-08T00:00:14.000Z", observedAt: "2026-08-08T00:00:15.000Z" })), /DUPLICATE_EVENT_ID/);
});

test("fails closed on prohibited material and unsafe control requests", () => {
  const sensitiveKey = ["creden", "tial"].join("");
  assert.throws(() => appendSafetyReplayEvent([], base({ payload: { overallHealth: "HEALTHY", [sensitiveKey]: "synthetic-value" } })), /MATERIAL_PROHIBITED/);
  assert.throws(() => appendSafetyReplayEvent([], base({ eventType: "CONTROL_REQUEST", payload: { action: "REQUEST_ACTIVE" } })), /UNSAFE_CONTROL_REQUEST/);
});

test("keeps safety-critical UNKNOWN visible", () => {
  let records = completeHistory();
  records = appendSafetyReplayEvent(records, base({ eventId: "evt-8", eventType: "HARD_RISK_DECISION", occurredAt: "2026-08-08T00:00:14.000Z", observedAt: "2026-08-08T00:00:15.000Z", payload: { decision: "UNKNOWN" } }));
  const replay = replaySafetyHistory(records);
  assert.equal(replay.status, "UNKNOWN");
  assert.equal(replay.hardRisk, "UNKNOWN");
  assert.equal(replay.executionAuthority, false);
});

test("normalizes source references and remains immutable", () => {
  const records = appendSafetyReplayEvent([], base({ sourceRefs: ["evidence:z", "evidence:a"] }));
  assert.deepEqual(records[0].event.sourceRefs, ["evidence:a", "evidence:z"]);
  assert.equal(Object.isFrozen(records), true);
  assert.equal(Object.isFrozen(records[0]), true);
  assert.equal(Object.isFrozen(records[0].event.payload), true);
});

test("source guard keeps replay observational only", () => {
  const result = validateAuditIncidentReplay();
  assert.equal(result.ok, true, result.failures.join(","));
  assert.equal(AUDIT_INCIDENT_REPLAY_DESCRIPTOR.executionAuthority, false);
  assert.equal(AUDIT_INCIDENT_REPLAY_DESCRIPTOR.authorizesLive, false);
  assert.equal(AUDIT_INCIDENT_REPLAY_DESCRIPTOR.realMoneyExecutionAllowed, false);
});
