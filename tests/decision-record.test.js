const test = require("node:test");
const assert = require("node:assert/strict");
const { DecisionAction, DecisionState } = require("../dist/packages/contracts/src/decision.js");
const {
  DecisionRecordState,
  createDecisionRecord,
  canTransitionDecisionRecord,
  transitionDecisionRecord,
  isTerminalDecisionRecord
} = require("../dist/packages/contracts/src/decisionRecord.js");

const result = (overrides = {}) => ({
  state: DecisionState.APPROVED_PAPER_ACTION,
  action: DecisionAction.LONG,
  respondingMembers: 3,
  countedMembers: 3,
  agreementCount: 3,
  agreementRatio: 1,
  reasons: ["approved LONG with 3/3"],
  ballots: [],
  gates: [],
  policyId: "committee-v1",
  policyVersion: "1.0.0",
  ...overrides
});

const record = (overrides = {}) => createDecisionRecord({
  decisionId: "decision-1",
  market: "UPBIT:KRW-BTC",
  snapshotId: "snapshot-1",
  snapshotChecksum: "abc123",
  createdAt: "2026-07-16T00:00:00.000Z",
  codeVersion: "deadbeef",
  result: result(overrides)
});

test("decision results become immutable auditable records", () => {
  const value = record();
  assert.equal(value.state, DecisionRecordState.APPROVED_PAPER_ACTION);
  assert.equal(value.action, DecisionAction.LONG);
  assert.equal(value.policyId, "committee-v1");
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.reasons));
  assert.deepEqual(value.paperOrderIds, []);
});

test("non-approved outcomes cannot enter Paper execution", () => {
  const blocked = record({ state: DecisionState.BLOCKED, action: DecisionAction.ABSTAIN, reasons: ["risk blocked"] });
  assert.equal(blocked.state, DecisionRecordState.BLOCKED);
  assert.equal(isTerminalDecisionRecord(blocked), true);
  assert.equal(canTransitionDecisionRecord(blocked.state, DecisionRecordState.EXECUTING_PAPER), false);
  assert.throws(
    () => transitionDecisionRecord(blocked, DecisionRecordState.EXECUTING_PAPER, "2026-07-16T00:01:00.000Z"),
    /invalid decision transition/
  );
});

test("approved decisions link Paper orders and fills through explicit transitions", () => {
  const approved = record();
  const executing = transitionDecisionRecord(
    approved,
    DecisionRecordState.EXECUTING_PAPER,
    "2026-07-16T00:01:00.000Z",
    { paperOrderId: "paper-order-1" }
  );
  const recorded = transitionDecisionRecord(
    executing,
    DecisionRecordState.RECORDED,
    "2026-07-16T00:02:00.000Z",
    { paperOrderId: "paper-order-1", paperFillId: "paper-fill-1" }
  );
  assert.deepEqual(recorded.paperOrderIds, ["paper-order-1"]);
  assert.deepEqual(recorded.paperFillIds, ["paper-fill-1"]);
  assert.equal(isTerminalDecisionRecord(recorded), true);
  assert.throws(
    () => transitionDecisionRecord(recorded, DecisionRecordState.EXECUTING_PAPER, "2026-07-16T00:03:00.000Z"),
    /invalid decision transition/
  );
});

test("the lifecycle permits fail-closed blocking before or during Paper execution", () => {
  assert.equal(canTransitionDecisionRecord(DecisionRecordState.COLLECTING, DecisionRecordState.BLOCKED), true);
  assert.equal(canTransitionDecisionRecord(DecisionRecordState.APPROVED_PAPER_ACTION, DecisionRecordState.BLOCKED), true);
  assert.equal(canTransitionDecisionRecord(DecisionRecordState.EXECUTING_PAPER, DecisionRecordState.BLOCKED), true);
  assert.equal(canTransitionDecisionRecord(DecisionRecordState.ANALYZING, DecisionRecordState.EXECUTING_PAPER), false);
});
