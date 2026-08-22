const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  evaluateDecision,
  createDecisionAuditEnvelope,
  issueDecisionExecutionAuthorization,
  createDecisionExecutionIntent,
  verifyDecisionExecutionReceipt
} = require("../dist/packages/contracts/src/index.js");
const { PaperBroker } = require("../dist/apps/desktop/src/paper/paperBroker.js");
const { executeSpotPaperDecision } = require("../dist/apps/desktop/src/paper/decisionPaperExecution.js");

function approved(action = DecisionAction.LONG, market = "KRW-BTC") {
  const result = evaluateDecision({
    policyId: "committee-v1",
    policyVersion: "1.0.0",
    eligibleMembers: 3,
    minimumQuorum: 3,
    minimumAgreementRatio: 0.66
  }, [
    { memberId: "trend", memberVersion: "1", family: "trend", action, support: 0.8, evidenceRefs: ["e:1"], evaluatedAt: "2026-07-16T00:00:00.000Z" },
    { memberId: "regime", memberVersion: "1", family: "regime", action, support: 0.8, evidenceRefs: ["e:2"], evaluatedAt: "2026-07-16T00:00:00.000Z" },
    { memberId: "risk", memberVersion: "1", family: "risk", action, support: 0.8, evidenceRefs: ["e:3"], evaluatedAt: "2026-07-16T00:00:00.000Z" }
  ], [{ gateId: "risk", passed: true }, { gateId: "persistence", passed: true }]);
  const envelope = createDecisionAuditEnvelope({
    decisionId: `decision-${action}`,
    market,
    snapshotId: "snapshot-1",
    snapshotChecksum: "a".repeat(64),
    createdAt: "2026-07-16T00:00:00.000Z",
    codeVersion: "test",
    result
  });
  const authorization = issueDecisionExecutionAuthorization({
    authorizationId: `auth-${action}`,
    envelope,
    issuedAt: "2026-07-16T00:00:00.000Z",
    expiresAt: "2026-07-16T00:05:00.000Z",
    nonce: `nonce-${action}`
  });
  const intent = createDecisionExecutionIntent({
    intentId: `intent-${action}`,
    authorization,
    envelope,
    quantity: "0.01",
    createdAt: "2026-07-16T00:00:01.000Z"
  });
  return { envelope, authorization, intent };
}

test("approved LONG executes one spot Paper buy and returns a linked receipt", () => {
  const chain = approved();
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0.0005);
  const execution = executeSpotPaperDecision({
    broker,
    ...chain,
    markPrice: 100_000_000,
    now: new Date("2026-07-16T00:00:02.000Z")
  });
  assert.equal(execution.order.side, "BUY");
  assert.equal(execution.order.quantity, 0.01);
  assert.equal(execution.receipt.decisionId, chain.intent.decisionId);
  assert.equal(verifyDecisionExecutionReceipt(execution.receipt, chain.intent), true);
  assert.equal(broker.snapshot(100_000_000).position.quantity, 0.01);
});

test("EXIT sells an existing Paper position", () => {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0.0005);
  broker.execute("BUY", 0.01, 100_000_000, new Date("2026-07-15T23:59:00.000Z"));
  const chain = approved(DecisionAction.EXIT);
  const execution = executeSpotPaperDecision({
    broker,
    ...chain,
    markPrice: 101_000_000,
    now: new Date("2026-07-16T00:00:02.000Z")
  });
  assert.equal(execution.order.side, "SELL");
  assert.equal(broker.snapshot(101_000_000).position.quantity, 0);
});

test("spot execution fails closed for SHORT, expired intents, and duplicate receipts", () => {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0.0005);
  const shortChain = approved(DecisionAction.SHORT);
  assert.throws(() => executeSpotPaperDecision({
    broker,
    ...shortChain,
    markPrice: 100_000_000,
    now: new Date("2026-07-16T00:00:02.000Z")
  }), /SHORT is not supported/);

  const longChain = approved();
  assert.throws(() => executeSpotPaperDecision({
    broker,
    ...longChain,
    markPrice: 100_000_000,
    now: new Date("2026-07-16T00:06:00.000Z")
  }), /invalid or expired/);

  const first = executeSpotPaperDecision({
    broker,
    ...longChain,
    markPrice: 100_000_000,
    now: new Date("2026-07-16T00:00:02.000Z")
  });
  assert.throws(() => executeSpotPaperDecision({
    broker,
    ...longChain,
    markPrice: 100_000_000,
    now: new Date("2026-07-16T00:00:03.000Z"),
    existingReceipts: [first.receipt]
  }), /already has a receipt|idempotency key already recorded/);
});
