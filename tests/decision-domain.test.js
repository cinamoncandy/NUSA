const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  DecisionState,
  evaluateDecision,
  validateDecisionPolicy
} = require("../dist/packages/contracts/src/decision.js");

const policy = (overrides = {}) => ({
  policyId: "committee-v1",
  policyVersion: "1.0.0",
  eligibleMembers: 5,
  minimumQuorum: 3,
  minimumAgreementRatio: 0.6,
  maximumFamilyVotes: 1,
  ...overrides
});

const ballot = (memberId, family, action, overrides = {}) => ({
  memberId,
  memberVersion: "1.0.0",
  family,
  action,
  support: 0.7,
  evidenceRefs: [`evidence:${memberId}`],
  evaluatedAt: "2026-07-16T00:00:00.000Z",
  ...overrides
});

test("decision policy rejects impossible quorum and invalid ratios", () => {
  assert.throws(() => validateDecisionPolicy(policy({ minimumQuorum: 6 })), /cannot exceed/);
  assert.throws(() => validateDecisionPolicy(policy({ minimumAgreementRatio: 1.1 })), /between 0 and 1/);
});

test("missing quorum produces NO_QUORUM and never approves an action", () => {
  const result = evaluateDecision(policy(), [
    ballot("trend", "trend", DecisionAction.LONG),
    ballot("risk", "risk", DecisionAction.ABSTAIN, { stale: true })
  ]);
  assert.equal(result.state, DecisionState.NO_QUORUM);
  assert.equal(result.action, DecisionAction.ABSTAIN);
  assert.equal(result.respondingMembers, 1);
});

test("a failed safety gate vetoes directional agreement", () => {
  const result = evaluateDecision(policy(), [
    ballot("trend", "trend", DecisionAction.LONG),
    ballot("micro", "microstructure", DecisionAction.LONG),
    ballot("regime", "regime", DecisionAction.LONG)
  ], [{ gateId: "persistence", passed: false, reason: "persistence unavailable" }]);
  assert.equal(result.state, DecisionState.BLOCKED);
  assert.equal(result.action, DecisionAction.ABSTAIN);
  assert.deepEqual(result.reasons, ["persistence unavailable"]);
});

test("correlated family votes are capped before agreement is calculated", () => {
  const result = evaluateDecision(policy({ minimumAgreementRatio: 0.66 }), [
    ballot("trend-a", "trend", DecisionAction.LONG),
    ballot("trend-b", "trend", DecisionAction.LONG),
    ballot("mean", "mean-reversion", DecisionAction.SHORT),
    ballot("regime", "regime", DecisionAction.LONG)
  ]);
  assert.equal(result.countedMembers, 3);
  assert.equal(result.agreementCount, 2);
  assert.equal(result.state, DecisionState.APPROVED_PAPER_ACTION);
  assert.equal(result.action, DecisionAction.LONG);
});

test("insufficient agreement produces DISAGREEMENT", () => {
  const result = evaluateDecision(policy({ minimumAgreementRatio: 0.75 }), [
    ballot("trend", "trend", DecisionAction.LONG),
    ballot("mean", "mean-reversion", DecisionAction.SHORT),
    ballot("regime", "regime", DecisionAction.HOLD),
    ballot("micro", "microstructure", DecisionAction.LONG)
  ]);
  assert.equal(result.state, DecisionState.DISAGREEMENT);
  assert.equal(result.action, DecisionAction.ABSTAIN);
});

test("all abstentions and winning HOLD remain non-trading outcomes", () => {
  const abstain = evaluateDecision(policy(), [
    ballot("a", "trend", DecisionAction.ABSTAIN),
    ballot("b", "risk", DecisionAction.ABSTAIN),
    ballot("c", "regime", DecisionAction.ABSTAIN)
  ]);
  assert.equal(abstain.state, DecisionState.ABSTAIN);
  assert.equal(abstain.action, DecisionAction.ABSTAIN);

  const hold = evaluateDecision(policy(), [
    ballot("a", "trend", DecisionAction.HOLD),
    ballot("b", "risk", DecisionAction.HOLD),
    ballot("c", "regime", DecisionAction.LONG)
  ]);
  assert.equal(hold.state, DecisionState.ABSTAIN);
  assert.equal(hold.action, DecisionAction.HOLD);
});

test("sufficient independent agreement approves only a Paper action contract", () => {
  const result = evaluateDecision(policy(), [
    ballot("trend", "trend", DecisionAction.SHORT),
    ballot("micro", "microstructure", DecisionAction.SHORT),
    ballot("regime", "regime", DecisionAction.SHORT),
    ballot("mean", "mean-reversion", DecisionAction.ABSTAIN)
  ], [
    { gateId: "risk", passed: true },
    { gateId: "persistence", passed: true }
  ]);
  assert.equal(result.state, DecisionState.APPROVED_PAPER_ACTION);
  assert.equal(result.action, DecisionAction.SHORT);
  assert.equal(result.agreementRatio, 1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.ballots));
});
