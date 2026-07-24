const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../dist/apps/desktop/src/paperBroker.js");
const { PaperExecutor } = require("../dist/apps/server/src/pipeline/paperExecutor.js");

test("PaperExecutor.execute delegates directly to PaperBroker.execute with the plan's side/quantity", () => {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0);
  const executor = new PaperExecutor(broker);
  const order = executor.execute({ side: "BUY", quantity: 0.001 }, 100_000_000);
  assert.equal(order.side, "BUY");
  assert.equal(order.quantity, 0.001);
  assert.equal(broker.snapshot(100_000_000).position.quantity, 0.001);
});

test("PaperExecutor propagates PaperBroker's own validation errors", () => {
  const broker = new PaperBroker(10_000_000, "KRW-BTC", 0, { maxOrderNotional: 1 });
  const executor = new PaperExecutor(broker);
  assert.throws(() => executor.execute({ side: "BUY", quantity: 0.001 }, 100_000_000), /max order notional/);
});
