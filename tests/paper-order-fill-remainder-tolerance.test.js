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

test("a settled order matches the saved order record exactly (the check that refused the save in production)", () => {
  const round8 = (value) => Math.round(value * 1e8) / 1e8;
  for (const [requested, parts] of [[0.3, [0.1, 0.2 + 1e-12]], [0.3, [0.1, 0.2 - 1e-12]], [12.34567891, [4.1, 8.24567891 + 3e-9]], [2, [2 - 4e-9]]]) {
    let state = open(requested);
    const fills = [];
    parts.forEach((quantity, index) => {
      fills.push(quantity);
      state = transitionPaperOrderLifecycle(state, index === parts.length - 1 ? "FILLED" : "PARTIALLY_FILLED", 1001 + index, quantity);
    });
    const recordQuantity = round8(fills.reduce((sum, item) => sum + item, 0));
    // The same comparisons as validateState in paperTradingExecutionLoop.ts (lifecycle vs order record).
    assert.equal(state.filledQuantity, recordQuantity);
    assert.equal(state.requestedQuantity, recordQuantity);
    assert.equal(state.remainingQuantity, 0);
    assert.doesNotThrow(() => validatePaperOrderLifecycle(state));
  }
});

test("exact fills behave as before and real shortfalls or overshoots are still refused", () => {
  assert.equal(transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 2).remainingQuantity, 0);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 1.9), /filled transition must consume remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "FILLED", 1001, 2.0001), /fill quantity exceeds remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "PARTIALLY_FILLED", 1001, 2 + 1e-12), /fill quantity exceeds remaining quantity/);
  assert.throws(() => transitionPaperOrderLifecycle(open(2), "PARTIALLY_FILLED", 1001, 2), /partial fill must leave remaining quantity/);
});
