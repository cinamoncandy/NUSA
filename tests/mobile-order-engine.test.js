const test = require("node:test");
const assert = require("node:assert/strict");
const { MockExecutionEngine, OrderEngine } = require("../dist/apps/mobile/src/orderEngine.js");

test("order engine validates and fills paper buy and sell orders", async () => {
  const engine = new OrderEngine();
  const result = await engine.submit({ market: "KRW/BTC", side: "BUY", quantity: 2, price: 100, nowMs: 1 });
  assert.equal(result.order.state, "FILLED");
  assert.deepEqual(result.fill, { id: "fill-1", orderId: "paper-order-1", quantity: 2, price: 100, createdAtMs: 1 });
  assert.equal(engine.getOrder(result.order.id).state, "FILLED");
});

test("order engine rejects invalid requests without creating a fill", async () => {
  const engine = new OrderEngine();
  await assert.rejects(() => engine.submit({ market: "KRW/BTC", side: "BUY", quantity: 0, price: 100, nowMs: 1 }), /quantity must be positive/);
  const order = engine.getOrder("paper-order-1");
  assert.equal(order.state, "REJECTED");
  assert.equal(engine.getFill("fill-1"), null);
});

test("order state machine rejects cancellation after fill", async () => {
  const engine = new OrderEngine();
  const { order } = await engine.submit({ market: "KRW/BTC", side: "SELL", quantity: 1, price: 100, nowMs: 1 });
  assert.throws(() => engine.cancel(order.id, 2), /invalid order transition: FILLED -> CANCELLED/);
});

test("order engine rejects mismatched execution results", async () => {
  const execution = new MockExecutionEngine();
  const engine = new OrderEngine({ async execute(order) { const fill = await execution.execute(order); return { ...fill, quantity: fill.quantity + 1 }; } });
  await assert.rejects(() => engine.submit({ market: "KRW/BTC", side: "BUY", quantity: 1, price: 100, nowMs: 1 }), /execution result does not match order/);
});
