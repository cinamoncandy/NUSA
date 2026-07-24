const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DecisionAction,
  DecisionExecutionMode,
  DecisionExecutionReceiptStatus,
  createDecisionExecutionReceipt,
  verifyDecisionExecutionReceipt,
  assertUniqueDecisionExecutionReceipt,
  assertDecisionExecutionReceiptSequence,
  isTerminalDecisionExecutionReceipt
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
  assert.equal(isTerminalDecisionExecutionReceipt(result), true);
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
  assert.doesNotThrow(() => receipt({
    status: DecisionExecutionReceiptStatus.CANCELLED,
    filledQuantity: "0.004",
    paperFillIds: ["paper-fill-partial"],
    reason: "remaining quantity cancelled"
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

test("one execution intent supports a monotonic receipt lifecycle", () => {
  const accepted = receipt({
    receiptId: "receipt-accepted",
    status: DecisionExecutionReceiptStatus.ACCEPTED,
    filledQuantity: "0",
    paperFillIds: [],
    recordedAt: "2026-07-16T00:00:01.000Z"
  });
  const partial = receipt({
    receiptId: "receipt-partial",
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.004",
    paperFillIds: ["fill-1"],
    recordedAt: "2026-07-16T00:00:02.000Z"
  });
  const filled = receipt({
    receiptId: "receipt-filled",
    status: DecisionExecutionReceiptStatus.FILLED,
    filledQuantity: "0.0100",
    paperFillIds: ["fill-1", "fill-2"],
    recordedAt: "2026-07-16T00:00:03.000Z"
  });

  assert.doesNotThrow(() => assertDecisionExecutionReceiptSequence([], accepted));
  assert.doesNotThrow(() => assertDecisionExecutionReceiptSequence([accepted], partial));
  assert.doesNotThrow(() => assertUniqueDecisionExecutionReceipt([accepted, partial], filled));
  assert.throws(() => assertDecisionExecutionReceiptSequence([filled], receipt({ receiptId: "later" })), /terminal/);
});

test("receipt lifecycle rejects time reversal, fill regression, and order mutation", () => {
  const partial = receipt({
    receiptId: "partial-1",
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.004",
    paperFillIds: ["fill-1"],
    recordedAt: "2026-07-16T00:00:02.000Z"
  });
  assert.throws(() => assertDecisionExecutionReceiptSequence([partial], receipt({
    receiptId: "partial-2",
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.003",
    paperFillIds: ["fill-1"],
    recordedAt: "2026-07-16T00:00:03.000Z"
  })), /cannot decrease/);
  assert.throws(() => assertDecisionExecutionReceiptSequence([partial], receipt({
    receiptId: "partial-3",
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.006",
    paperFillIds: ["fill-1", "fill-2"],
    paperOrderId: "different-order",
    recordedAt: "2026-07-16T00:00:03.000Z"
  })), /cannot change/);
  assert.throws(() => assertDecisionExecutionReceiptSequence([partial], receipt({
    receiptId: "partial-4",
    status: DecisionExecutionReceiptStatus.PARTIALLY_FILLED,
    filledQuantity: "0.006",
    paperFillIds: ["fill-1", "fill-2"],
    recordedAt: "2026-07-16T00:00:01.000Z"
  })), /timestamps must increase/);
});
