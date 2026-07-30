const test = require("node:test");
const assert = require("node:assert/strict");
const { explainEvents, auditRuntimeEvents } = require("../dist/apps/cloud/src/decisionExplainAudit.js");

const event = (id, occurredAt, type = "RUN_STARTED") => ({ id, runId: "run-1", type, occurredAt, payload: {} });

test("explain engine produces deterministic replay steps", () => {
  const result = explainEvents([event("b", 2, "RUN_COMPLETED"), event("a", 1)]);
  assert.equal(result.summary, "2 immutable runtime events replayed");
  assert.deepEqual(result.evidenceEventIds, ["a", "b"]);
  assert.equal(Object.isFrozen(result), true);
});

test("audit engine detects duplicate ids and time regression", () => {
  const findings = auditRuntimeEvents([event("a", 2), event("a", 1)]);
  assert.deepEqual(findings.map((finding) => finding.reason), ["DUPLICATE_EVENT_ID", "EVENT_TIME_REGRESSION"]);
});
