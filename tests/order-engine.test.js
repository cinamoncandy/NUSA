const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CancelReplaceManager,
  DeadLetterQueue,
  ExecutionAudit,
  ExecutionMetrics,
  InventoryReservationManager,
  OrderQueue,
  PartialFillManager,
  WebSocketOrderSynchronizer,
  recoverGhostFills,
  replayOrderEvents,
  retryDelay
} = require("../dist/apps/execution/src/order-engine.js");

const event = (orderId, type, sequence, occurredAtMs, extra = {}) => ({ eventId: `${orderId}-${sequence}`, orderId, type, sequence, occurredAtMs, ...extra });

test("replays a deterministic lifecycle with partial fills and fixed decimal arithmetic", () => {
  const events = [
    event("o-1", "CREATED", 1, 1),
    event("o-1", "QUEUED", 2, 2),
    event("o-1", "SUBMITTING", 3, 3),
    event("o-1", "ACCEPTED", 4, 4),
    event("o-1", "PARTIAL_FILL", 5, 5, { quantity: "1.10", price: "100.00" }),
    event("o-1", "FILLED", 6, 6, { quantity: "1.20", price: "110.00" })
  ];
  assert.deepEqual(replayOrderEvents(events, "2.30"), {
    orderId: "o-1", state: "FILLED", filledQuantity: "2.30", remainingQuantity: "0",
    averageFillPrice: "105.21", sequence: 6
  });
  assert.throws(() => replayOrderEvents(events.slice(0, 4).concat(event("o-1", "PARTIAL_FILL", 5, 5, { quantity: "2.31", price: "1" })), "2.30"), /OVERFILLED/);
});

test("partial fill manager rejects overfill and recovers a missing remote fill without mutating Ledger", () => {
  const manager = new PartialFillManager("3");
  assert.equal(manager.apply({ quantity: "1.25", price: "100" }).remainingQuantity, "1.75");
  assert.equal(manager.apply({ quantity: "1.75", price: "110" }).filledQuantity, "3");
  assert.throws(() => manager.apply({ quantity: "0.01", price: "110" }), /OVERFLOW/);
  const local = [{ exchangeTradeId: "t-1", quantity: "1", price: "100", executedAtMs: 1 }];
  const remote = [...local, { exchangeTradeId: "t-2", quantity: "2", price: "110", executedAtMs: 2 }];
  assert.deepEqual(recoverGhostFills(local, remote), { status: "RECOVERED", recovered: [remote[1]], duplicateIds: [], unknownIds: [] });
  assert.equal(recoverGhostFills(local, [remote[0], remote[0]]).status, "BLOCKED");
});

test("bounded order queue is idempotent and fails closed when full", () => {
  const queue = new OrderQueue(1);
  assert.equal(queue.enqueue({ orderId: "o-1", value: "first", enqueuedAtMs: 1, attempts: 0 }), true);
  assert.equal(queue.enqueue({ orderId: "o-1", value: "duplicate", enqueuedAtMs: 2, attempts: 0 }), false);
  assert.throws(() => queue.enqueue({ orderId: "o-2", value: "second", enqueuedAtMs: 3, attempts: 0 }), /QUEUE_FULL/);
  assert.equal(queue.dequeue().value, "first");
});

test("cancel-replace never submits a replacement after an uncertain cancel", async () => {
  const calls = [];
  const manager = new CancelReplaceManager({
    cancel: async (id) => { calls.push(`cancel:${id}`); return "UNKNOWN"; },
    submit: async () => { calls.push("submit"); return { orderId: "replacement" }; }
  });
  assert.deepEqual(await manager.replace("o-1", { price: "101" }), { status: "BLOCKED" });
  assert.deepEqual(calls, ["cancel:o-1"]);
});

test("retry policy and dead-letter queue preserve bounded failure handling", () => {
  const policy = { maximumAttempts: 3, baseDelayMs: 100, maximumDelayMs: 500, retryableReasons: ["TIMEOUT"] };
  assert.equal(retryDelay(policy, 0, "TIMEOUT"), 100);
  assert.equal(retryDelay(policy, 2, "TIMEOUT"), 400);
  assert.equal(retryDelay(policy, 3, "TIMEOUT"), null);
  assert.equal(retryDelay(policy, 0, "INVALID"), null);
  const queue = new DeadLetterQueue(1);
  queue.append({ orderId: "o-1", value: { attempt: 3 }, reason: "TIMEOUT", failedAtMs: 10 });
  assert.equal(queue.list().length, 1);
  assert.throws(() => queue.append({ orderId: "o-2", value: {}, reason: "TIMEOUT", failedAtMs: 11 }), /FULL/);
});

test("websocket synchronization rejects gaps and stale order updates", () => {
  const sync = new WebSocketOrderSynchronizer();
  const snapshot = { sequence: 1, orderId: "o-1", state: "ACCEPTED", fills: [] };
  assert.equal(sync.apply(snapshot), "APPLIED");
  assert.equal(sync.apply(snapshot), "DUPLICATE");
  assert.equal(sync.apply({ ...snapshot, sequence: 3 }), "GAP");
  assert.equal(sync.apply({ ...snapshot, sequence: 2 }), "APPLIED");
  assert.equal(sync.apply({ ...snapshot, sequence: 1 }), "OUT_OF_ORDER");
});

test("inventory reservations, audit hash chain, and execution metrics are bounded projections", () => {
  const inventory = new InventoryReservationManager();
  inventory.reserve({ orderId: "o-1", market: "KRW-BTC", quantity: "1.25" });
  assert.throws(() => inventory.reserve({ orderId: "o-1", market: "KRW-BTC", quantity: "1" }), /DUPLICATE/);
  assert.equal(inventory.list("KRW-BTC").length, 1);
  inventory.release("o-1");
  assert.equal(inventory.list().length, 0);

  const audit = new ExecutionAudit();
  const first = audit.append({ orderId: "o-1", event: "ACCEPTED", occurredAtMs: 1 });
  const second = audit.append({ orderId: "o-1", event: "FILLED", occurredAtMs: 2 });
  assert.equal(second.previousHash, first.hash);
  assert.equal(audit.list().length, 2);
  audit.verify();
  assert.equal(Object.isFrozen(audit.list()[0]), true);

  const metrics = new ExecutionMetrics();
  metrics.observe("submitted", 2, 10);
  metrics.observe("partialFills", 1, 5);
  metrics.observe("filled", 0, 7);
  assert.deepEqual(metrics.snapshot(), { submitted: 1, accepted: 0, rejected: 0, filled: 1, partialFills: 1, retries: 0, deadLetters: 0, queueHighWaterMark: 2, totalLatencyMs: 22 });
});
