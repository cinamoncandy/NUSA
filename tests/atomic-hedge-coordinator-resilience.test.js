const test = require("node:test");
const assert = require("node:assert/strict");
const { planAtomicHedge, submitAtomicHedge } = require("../dist/apps/cloud/src/atomicHedgeCoordinator.js");

const plan = () => planAtomicHedge({
  id: "hedge-resilience",
  mode: "PAPER",
  contractMultiplier: 1,
  deltaTolerance: 0.01,
  createdAt: 1_000,
  spotOrder: { clientOrderId: "spot-resilience", symbol: "BTC-USDT", side: "BUY", quantity: 1 },
  perpetualOrder: { clientOrderId: "perp-resilience", symbol: "BTC-PERP", side: "SELL", quantity: 1 }
});

test("captures one-leg submission exception without rejecting the coordinator", async () => {
  const result = await submitAtomicHedge(plan(), {
    submit: async (order) => {
      if (order.clientOrderId.startsWith("perp")) throw new Error("perp unavailable");
      return { clientOrderId: order.clientOrderId, accepted: true, exchangeOrderId: "spot-order" };
    },
    cancel: async () => true
  }, 1_001);

  assert.equal(result.state.status, "FAULTED");
  assert.equal(result.receipts[0].accepted, true);
  assert.equal(result.receipts[1].accepted, false);
  assert.equal(result.receipts[1].error, "perp unavailable");
  assert.ok(result.state.audit.some((item) => item.type === "KILL_SWITCH_RECOMMENDED"));
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.receipts));
});

test("records both-leg submission exceptions deterministically", async () => {
  const adapter = {
    submit: async () => { throw new Error("venue offline"); },
    cancel: async () => false
  };
  const first = await submitAtomicHedge(plan(), adapter, 1_001);
  const second = await submitAtomicHedge(plan(), adapter, 1_001);

  assert.equal(first.state.status, "FAULTED");
  assert.deepEqual(first, second);
  assert.equal(first.receipts.every((item) => item.accepted === false), true);
  assert.equal(first.state.audit.some((item) => item.type === "KILL_SWITCH_RECOMMENDED"), false);
});
