const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  DecisionExecutionMode,
  DecisionExecutionReceiptStatus,
  createDecisionExecutionReceipt,
  verifyDecisionExecutionReceipt,
  assertUniqueDecisionExecutionReceipt
} = require("../dist/packages/contracts/src/index.js");

const intent = (overrides = {}) => Object.freeze({
  intentId: "intent-1",
  idempotencyKey: "a".repeat(64),
  authorizationId: "auth-1",
  authorizationChecksum: "b".repeat(64),
  decisionId: "decision-1",
  auditChecksum: "c".repeat(64),
  mode: DecisionExecutionMode.PAPER,
  market: "KRW-BTC",
  action: DecisionAction.LONG,
  quantity: "0.0100",
  createdAt: "2026-07-16T00:00:00.000Z",
  checksum: "d".repeat(64),
  ...overrides
});

const receipt = (overrides = {}) => createDecisionExecutionReceipt({
  receiptId: "receipt-1",
  intent: intent(),
  status: DecisionExecutionReceiptStatus.FILLED,
  paperOrderId: "paper-order-1",
  paperFillIds: ["paper-fill-1"],
  filledQuantity: "0.0100",
  recordedAt: "2026-07-16T00:00:01.000Z",
  ...overrides
});

test("filled Paper receipt is immutable and verifies against its execution intent", () => {
  const sourceIntent = intent();
  const result = createDecisionExecutionReceipt({
    receiptId: "receipt-1",
    intent: sourceIntent,
    status: DecisionExecutionReceiptStatus.FILLED,
    paperOrderId: "paper-order-1",
    paperFillIds: ["paper-fill-1"],
    filledQuantity: "0.0100",
    recordedAt: "2026-07-16T00:00:01.000Z"
  });
  assert.equal(result.mode, DecisionExecutionMode.PAPER);
  assert.equal(result.decisionId, sourceIntent.decisionId);
  assert.equal(result.intentChecksum, sourceIntent.checksum);
  assert.equal(verifyDecisionExecutionReceipt(result, sourceIntent), true);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.paperFillIds));
});

test("partial, rejected, cancelled, and accepted receipts enforce quantity semantics", () => {
  assert.doesNotThrow(() => receipt({
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.004",
    paperFillIds: ["paper-fill-partial"]
  }));
  assert.doesNotThrow(() => receipt({
    status: DecisionExecutionReceiptStatus.ACCEPTED,
    filledQuantity: "0",
    paperFillIds: []
  }));
  assert.doesNotThrow(() => receipt({
    status: DecisionExecutionReceiptStatus.REJECTED,
    filledQuantity: "0",
    paperFillIds: [],
    reason: "risk gate changed"
  }));
  assert.throws(() => receipt({
    status: DecisionExecutionReceiptStatus.FILLED,
    filledQuantity: "0.009"
  }), /fully filled/);
  assert.throws(() => receipt({
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0"
  }), /positive partial/);
  assert.throws(() => receipt({
    status: DecisionExecutionReceiptStatus.REJECTED,
    filledQuantity: "0",
    paperFillIds: [],
    reason: undefined
  }), /requires a reason/);
  assert.throws(() => receipt({ filledQuantity: "0.0200" }), /cannot exceed/);
});

test("filled receipts require unique Paper fill identifiers", () => {
  assert.throws(() => receipt({ paperFillIds: [] }), /at least one/);
  assert.throws(() => receipt({ paperFillIds: ["fill-1", "fill-1"] }), /duplicate paper fill/);
});

test("receipt verification fails after intent or receipt tampering", () => {
  const sourceIntent = intent();
  const result = createDecisionExecutionReceipt({
    receiptId: "receipt-1",
    intent: sourceIntent,
    status: DecisionExecutionReceiptStatus.FILLED,
    paperOrderId: "paper-order-1",
    paperFillIds: ["paper-fill-1"],
    filledQuantity: "0.0100",
    recordedAt: "2026-07-16T00:00:01.000Z"
  });
  assert.equal(verifyDecisionExecutionReceipt({ ...result, market: "BTCUSDT" }, sourceIntent), false);
  assert.equal(verifyDecisionExecutionReceipt(result, intent({ checksum: "e".repeat(64) })), false);
  assert.equal(verifyDecisionExecutionReceipt({ ...result, filledQuantity: "0.001" }, sourceIntent), false);
});

test("one execution intent can produce only one durable receipt", () => {
  const first = receipt();
  assert.throws(() => assertUniqueDecisionExecutionReceipt([first], receipt({ receiptId: "receipt-2" })), /already has a receipt/);
  assert.throws(() => assertUniqueDecisionExecutionReceipt([first], receipt()), /duplicate execution receipt id/);
});
