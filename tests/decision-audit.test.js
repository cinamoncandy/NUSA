const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  DecisionState,
  createDecisionAuditEnvelope,
  verifyDecisionAuditEnvelope
} = require("../dist/packages/contracts/src/index.js");

const result = Object.freeze({
  state: DecisionState.APPROVED_PAPER_ACTION,
  action: DecisionAction.LONG,
  respondingMembers: 3,
  countedMembers: 3,
  agreementCount: 2,
  agreementRatio: 2 / 3,
  reasons: Object.freeze(["approved LONG with 2/3"]),
  ballots: Object.freeze([
    Object.freeze({ memberId: "trend", memberVersion: "1.0.0", family: "trend", action: DecisionAction.LONG, support: 0.8, evidenceRefs: Object.freeze(["e:1"]), evaluatedAt: "2026-07-16T00:00:00.000Z" }),
    Object.freeze({ memberId: "regime", memberVersion: "1.0.0", family: "regime", action: DecisionAction.LONG, support: 0.7, evidenceRefs: Object.freeze(["e:2"]), evaluatedAt: "2026-07-16T00:00:00.000Z" }),
    Object.freeze({ memberId: "mean", memberVersion: "1.0.0", family: "mean", action: DecisionAction.SHORT, support: 0.6, evidenceRefs: Object.freeze(["e:3"]), evaluatedAt: "2026-07-16T00:00:00.000Z" })
  ]),
  gates: Object.freeze([Object.freeze({ gateId: "risk", passed: true })]),
  policyId: "committee-v1",
  policyVersion: "1.0.0"
});

const input = () => ({
  decisionId: "decision-1",
  market: "UPBIT:KRW-BTC",
  snapshotId: "snapshot-1",
  snapshotChecksum: "a".repeat(64),
  createdAt: "2026-07-16T00:00:01.000Z",
  codeVersion: "abc123",
  result
});

test("decision audit envelope is deterministic and verifiable", () => {
  const first = createDecisionAuditEnvelope(input());
  const second = createDecisionAuditEnvelope(input());
  assert.equal(first.envelopeChecksum, second.envelopeChecksum);
  assert.match(first.envelopeChecksum, /^[a-f0-9]{64}$/);
  assert.equal(verifyDecisionAuditEnvelope(first), true);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.ballots));
});

test("decision audit verification fails after tampering", () => {
  const envelope = createDecisionAuditEnvelope(input());
  const tampered = { ...envelope, countedMembers: envelope.countedMembers + 1 };
  assert.equal(verifyDecisionAuditEnvelope(tampered), false);
});

test("audit envelope preserves Paper-only approved record state", () => {
  const envelope = createDecisionAuditEnvelope(input());
  assert.equal(envelope.record.action, DecisionAction.LONG);
  assert.equal(envelope.record.state, "APPROVED_PAPER_ACTION");
  assert.deepEqual(envelope.record.paperOrderIds, []);
  assert.deepEqual(envelope.record.paperFillIds, []);
});
