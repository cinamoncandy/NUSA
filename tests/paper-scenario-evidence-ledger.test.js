const test = require("node:test");
const assert = require("node:assert/strict");
const { appendPaperScenarioEvent, replayPaperScenarioEvidence } = require("../dist/apps/cloud/src/paperScenarioEvidenceLedger.js");

const event = (eventId, type, occurredAt, scenario) => ({ eventId, type, occurredAt, ...(scenario ? { scenario } : {}) });

test("records real scenario evidence and derives immutable counters", () => {
  let records = [];
  records = appendPaperScenarioEvent(records, event("s1", "SESSION_OBSERVED", 1));
  records = appendPaperScenarioEvent(records, event("o1", "ORDER_COMPLETED", 2));
  records = appendPaperScenarioEvent(records, event("r1", "REGIME_OBSERVED", 3, "TREND"));
  records = appendPaperScenarioEvent(records, event("r2", "REGIME_OBSERVED", 4, "RANGE"));
  records = appendPaperScenarioEvent(records, event("f1", "FAULT_SCENARIO_PASSED", 5, "KILL_SWITCH"));
  const summary = replayPaperScenarioEvidence(records);
  assert.deepEqual(summary, { sessionCount: 1, completedOrderCount: 1, regimeCount: 2, recoveryPassCount: 0, duplicateOrderCheckCount: 0, passedFaultScenarios: ["KILL_SWITCH"], firstOccurredAt: 1, lastOccurredAt: 5 });
  assert.ok(Object.isFrozen(summary));
});

test("rejects duplicate, reverse-time, and tampered evidence", () => {
  let records = appendPaperScenarioEvent([], event("s1", "SESSION_OBSERVED", 10));
  assert.throws(() => appendPaperScenarioEvent(records, event("s1", "SESSION_OBSERVED", 11)), /duplicate/);
  assert.throws(() => appendPaperScenarioEvent(records, event("s2", "SESSION_OBSERVED", 9)), /non-decreasing/);
  assert.throws(() => replayPaperScenarioEvidence([{ ...records[0], hash: "f".repeat(64) }]), /hash chain/);
});
