const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");

const decision = Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 1,
  risk: "LOW",
  allocation: 0.1,
  leverage: 1,
  score: 1,
  reasons: Object.freeze(["fixture"]),
  decidedAt: 1_000
});

const tick = Object.freeze({
  now: 2_000,
  market: "KRW-BTC",
  price: 50_000_000,
  observedAt: 1_500,
  mode: "PAPER",
  killSwitchActive: false,
  tradingAllowed: true,
  overallHealth: "HEALTHY",
  decisions: Object.freeze([decision])
});

function build(status) {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  let evaluations = 0;
  const riskGate = {
    evaluate() {
      evaluations += 1;
      return Object.freeze({ status, reasonCodes: Object.freeze(status === "ALLOW" ? [] : [status === "HALT" ? "KILL_SWITCH_ACTIVE" : "MAX_ORDER_NOTIONAL"]) });
    }
  };
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate, readP0State: () => ({ openP0: false }) });
  return { loop, boundary, evaluations: () => evaluations };
}

for (const status of ["HALT", "REJECT"]) {
  test(`${status} produces zero orders, fills, cash mutation, and position mutation`, () => {
    const { loop, boundary, evaluations } = build(status);
    const before = loop.snapshot();
    const result = boundary.processTick(tick);
    const after = loop.snapshot();
    assert.equal(evaluations(), 1);
    assert.equal(result.status, status === "HALT" ? "BLOCKED" : "REJECTED");
    assert.deepEqual(after, before);
    assert.equal(after.orders.length, 0);
    assert.equal(after.fills.length, 0);
    assert.equal(after.positions.length, 0);
    assert.equal(after.cash, 10_000_000);
  });
}

test("canonical ALLOW executes an approved PAPER-only CIO strategy tick", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const result = boundary.processTick(tick);
  const after = loop.snapshot();
  assert.equal(evaluations(), 1);
  assert.equal(result.status, "FILLED");
  assert.equal(after.orders.length, 1);
  assert.equal(after.fills.length, 1);
  assert.equal(after.positions.length, 1);
  assert.equal(after.positions[0].market, "KRW-BTC");
  assert.equal(after.positions[0].quantity, 0.02);
  assert.equal(after.cash, 9_000_000);
});

test("automatic strategy approval rejects non-spot or high-risk CIO mutations before risk evaluation", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const unsafe = Object.freeze({ ...decision, leverage: 2, risk: "HIGH" });
  const before = loop.snapshot();
  const result = boundary.processTick(Object.freeze({ ...tick, decisions: Object.freeze([unsafe]) }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "STRATEGY_APPROVAL_REJECTED");
  assert.equal(evaluations(), 0);
  assert.deepEqual(loop.snapshot(), before);
});

test("P0 uncertainty fails closed before risk evaluation and before mutation", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0 });
  let evaluations = 0;
  const boundary = new CloudPaperExecutionBoundary({
    loop,
    riskGate: { evaluate() { evaluations += 1; return { status: "ALLOW", reasonCodes: [] }; } },
    readP0State: () => { throw new Error("unavailable"); }
  });
  const before = loop.snapshot();
  const result = boundary.processTick(tick);
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "P0_STATE_UNVERIFIABLE");
  assert.equal(evaluations, 0);
  assert.deepEqual(loop.snapshot(), before);
});
