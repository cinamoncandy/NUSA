const test = require("node:test");
const assert = require("node:assert/strict");
const { DefaultRiskEngine } = require("../dist/packages/core/src/risk/riskEngine.js");

const clone = (value) => JSON.parse(JSON.stringify(value));

function basePolicy() {
  return Object.freeze({ minimumOrderValue: 100, maximumPositionValue: 10_000 });
}
function baseContext(overrides = {}) {
  return Object.freeze({ marketPrice: 10, availableQuoteBalance: 5_000, currentPositionValue: 2_000, ...overrides });
}
function intent(side, quantity) {
  return Object.freeze({ side, quantity });
}

test("a normal BUY within all limits is ALLOWed with the computed orderValue", () => {
  const engine = new DefaultRiskEngine();
  const decision = engine.evaluate(intent("BUY", 50), baseContext(), basePolicy());
  assert.deepEqual(decision, { outcome: "ALLOW", orderValue: 500 });
});

test("a normal SELL within the minimum-order-value floor is ALLOWed with the computed orderValue", () => {
  const engine = new DefaultRiskEngine();
  const decision = engine.evaluate(intent("SELL", 50), baseContext(), basePolicy());
  assert.deepEqual(decision, { outcome: "ALLOW", orderValue: 500 });
});

test("quantity 0, negative, NaN, and Infinity are all INVALID_QUANTITY, for both sides", () => {
  const engine = new DefaultRiskEngine();
  for (const side of ["BUY", "SELL"]) {
    for (const quantity of [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const decision = engine.evaluate(intent(side, quantity), baseContext(), basePolicy());
      assert.equal(decision.outcome, "BLOCK", `quantity=${quantity} side=${side}`);
      assert.equal(decision.code, "INVALID_QUANTITY");
    }
  }
});

test("marketPrice 0, negative, NaN, and Infinity are all INVALID_MARKET_PRICE", () => {
  const engine = new DefaultRiskEngine();
  for (const marketPrice of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    const decision = engine.evaluate(intent("BUY", 10), baseContext({ marketPrice }), basePolicy());
    assert.equal(decision.outcome, "BLOCK");
    assert.equal(decision.code, "INVALID_MARKET_PRICE");
  }
});

test("invalid RiskPolicy values (negative/zero/NaN/Infinity) are INVALID_POLICY", () => {
  const engine = new DefaultRiskEngine();
  const invalidPolicies = [
    { minimumOrderValue: -1, maximumPositionValue: 10_000 },
    { minimumOrderValue: Number.NaN, maximumPositionValue: 10_000 },
    { minimumOrderValue: 100, maximumPositionValue: 0 },
    { minimumOrderValue: 100, maximumPositionValue: -1 },
    { minimumOrderValue: 100, maximumPositionValue: Number.NaN },
    { minimumOrderValue: 100, maximumPositionValue: Number.POSITIVE_INFINITY }
  ];
  for (const policy of invalidPolicies) {
    const decision = engine.evaluate(intent("BUY", 10), baseContext(), Object.freeze(policy));
    assert.equal(decision.outcome, "BLOCK", JSON.stringify(policy));
    assert.equal(decision.code, "INVALID_POLICY");
  }
});

test("minimumOrderValue: below the floor blocks, exactly at the floor allows -- both sides", () => {
  const engine = new DefaultRiskEngine();
  for (const side of ["BUY", "SELL"]) {
    const atFloor = engine.evaluate(intent(side, 10), baseContext(), basePolicy()); // orderValue = 100
    assert.equal(atFloor.outcome, "ALLOW", side);
    assert.equal(atFloor.orderValue, 100);

    const belowFloor = engine.evaluate(intent(side, 9.9), baseContext(), basePolicy()); // orderValue = 99
    assert.equal(belowFloor.outcome, "BLOCK", side);
    assert.equal(belowFloor.code, "BELOW_MINIMUM_ORDER_VALUE");
  }
});

test("availableQuoteBalance: BUY exactly at the balance allows, one over blocks", () => {
  const engine = new DefaultRiskEngine();
  const context = baseContext({ availableQuoteBalance: 5_000, currentPositionValue: 0 });

  const atBalance = engine.evaluate(intent("BUY", 500), context, basePolicy()); // orderValue = 5000
  assert.equal(atBalance.outcome, "ALLOW");
  assert.equal(atBalance.orderValue, 5_000);

  const overBalance = engine.evaluate(intent("BUY", 501), context, basePolicy()); // orderValue = 5010
  assert.equal(overBalance.outcome, "BLOCK");
  assert.equal(overBalance.code, "INSUFFICIENT_BALANCE");
});

test("maximumPositionValue: BUY landing exactly on the cap allows, one over blocks", () => {
  const engine = new DefaultRiskEngine();
  const context = baseContext({ availableQuoteBalance: 100_000, currentPositionValue: 2_000 });
  const policy = Object.freeze({ minimumOrderValue: 100, maximumPositionValue: 10_000 });

  const atCap = engine.evaluate(intent("BUY", 800), context, policy); // orderValue 8000, projected 10000
  assert.equal(atCap.outcome, "ALLOW");
  assert.equal(atCap.orderValue, 8_000);

  const overCap = engine.evaluate(intent("BUY", 801), context, policy); // orderValue 8010, projected 10010
  assert.equal(overCap.outcome, "BLOCK");
  assert.equal(overCap.code, "MAXIMUM_POSITION_EXCEEDED");
});

test("SELL is exempt from availableQuoteBalance and maximumPositionValue checks entirely", () => {
  const engine = new DefaultRiskEngine();
  // A BUY of the same size would fail both INSUFFICIENT_BALANCE and MAXIMUM_POSITION_EXCEEDED.
  const context = baseContext({ marketPrice: 10, availableQuoteBalance: 5_000, currentPositionValue: 2_000 });
  const policy = basePolicy();

  const buyOfSameSize = engine.evaluate(intent("BUY", 2_000), context, policy); // orderValue 20000
  assert.equal(buyOfSameSize.outcome, "BLOCK");
  assert.equal(buyOfSameSize.code, "INSUFFICIENT_BALANCE");

  const sellOfSameSize = engine.evaluate(intent("SELL", 2_000), context, policy); // orderValue 20000
  assert.deepEqual(sellOfSameSize, { outcome: "ALLOW", orderValue: 20_000 });
});

test("inputs (intent, context, policy) are never mutated", () => {
  const engine = new DefaultRiskEngine();
  const intentValue = intent("BUY", 50);
  const contextValue = baseContext();
  const policyValue = basePolicy();
  const intentBefore = clone(intentValue);
  const contextBefore = clone(contextValue);
  const policyBefore = clone(policyValue);

  engine.evaluate(intentValue, contextValue, policyValue);

  assert.deepEqual(clone(intentValue), intentBefore);
  assert.deepEqual(clone(contextValue), contextBefore);
  assert.deepEqual(clone(policyValue), policyBefore);
});

test("evaluate is deterministic: identical inputs always produce identical decisions", () => {
  const engine = new DefaultRiskEngine();
  const results = Array.from({ length: 5 }, () => engine.evaluate(intent("BUY", 50), baseContext(), basePolicy()));
  for (const result of results) assert.deepEqual(result, results[0]);

  const blockedResults = Array.from({ length: 5 }, () => engine.evaluate(intent("BUY", 501), baseContext({ availableQuoteBalance: 5_000 }), basePolicy()));
  for (const result of blockedResults) assert.deepEqual(result, blockedResults[0]);
});
