const test = require("node:test");
const assert = require("node:assert/strict");
const { RiskEngine } = require("../dist/apps/server/src/pipeline/riskEngine.js");

function intent(type) { return { type, reason: "test", confidence: 1, timestamp: 0 }; }

test("HOLD is never approved regardless of context", () => {
  const engine = new RiskEngine();
  const decision = engine.evaluate(intent("HOLD"), { autoTradeAllowed: true, positionQuantity: 1 });
  assert.equal(decision.approved, false);
  assert.equal(decision.reason, "HOLD");
});

test("BUY/SELL are rejected when automatic trading is not allowed", () => {
  const engine = new RiskEngine();
  for (const type of ["BUY", "SELL"]) {
    const decision = engine.evaluate(intent(type), { autoTradeAllowed: false, positionQuantity: 1 });
    assert.equal(decision.approved, false);
    assert.match(decision.reason, /not enabled/);
  }
});

test("SELL is rejected with zero or negative position", () => {
  const engine = new RiskEngine();
  assert.equal(engine.evaluate(intent("SELL"), { autoTradeAllowed: true, positionQuantity: 0 }).approved, false);
  assert.match(engine.evaluate(intent("SELL"), { autoTradeAllowed: true, positionQuantity: 0 }).reason, /insufficient/);
});

test("BUY is approved with auto-trade enabled regardless of position; SELL is approved with a positive position", () => {
  const engine = new RiskEngine();
  assert.equal(engine.evaluate(intent("BUY"), { autoTradeAllowed: true, positionQuantity: 0 }).approved, true);
  assert.equal(engine.evaluate(intent("SELL"), { autoTradeAllowed: true, positionQuantity: 0.5 }).approved, true);
});
