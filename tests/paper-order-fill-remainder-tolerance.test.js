const test = require("node:test");
const assert = require("node:assert/strict");
const { createPaperOrderLifecycle, transitionPaperOrderLifecycle, validatePaperOrderLifecycle } = require("../dist/apps/cloud/src/paperOrderLifecycle.js");

const open = (quantity) => {
  let state = createPaperOrderLifecycle(quantity, 1000);
  state = transitionPaperOrderLifecycle(state, "ACCEPTED", 1000);
  return transitionPaperOrderLifecycle(state, "OPEN", 1000);
};

test("a fill that finishes the order within float rounding settles as exactly filled", () => {
  const first = transitionPaperOrderLifecycle(open(0.3), "PARTIALLY_FILLED", 1001, 0.1);
  const over = transitionPaperOrderLifecycle(first, "FILLED", 1002, 0.3 - 0.1 + 1e-12);
  assert.equal(over.status, "FILLED");
  assert.equal(over.remainingQuantity, 0);
  assert.equal(over.filledQuantity, 0.3);
  assert.doesNotThrow(() => validatePaperOrderLifecycle(over));
  const under = transitionPaperOrderLifecycle(first, "FILLED", 1002, 0.3 - 0.1 - 1e-12);
  assert.equal(under.remainingQuantity, 0);
  assert.doesNotThrow(() => validatePaperOrderLifecycle(under));
});

test("exact fills behave as before and real shortfalls or overshoots are still refused", () => {
  assert.equal(transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 2).remainingQuantity, 0);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 1.9), /filled transition must consume remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 2.0001), /fill quantity exceeds remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "PARTIALLY_FILLED", 1001, 2 + 1e-12), /fill quantity exceeds remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "PARTIALLY_FILLED", 1001, 2), /partial fill must leave remaining quantity/);
});
