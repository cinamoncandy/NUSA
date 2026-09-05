const assert = require("node:assert/strict");
const test = require("node:test");
const { classify } = require("../scripts/classify-actual-paper-runtime-readiness.js");

const base = {
  result: "PASS",
  authority: { mode: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
  market_data: { channel: "PUBLIC_TICKER" },
  supervisor: { restart_count: 1 },
  execution: { status: "NO_ACTIONABLE_SIGNAL", order_count: 0, fill_count: 0 },
  first_runtime: { orderCount: 0, realizedPnl: 0, unrealizedPnl: 0, position: null },
  prohibited_capabilities: { real_money_mutation: false },
};

test("runtime/safety smoke can PASS while autonomous trading certification stays INCOMPLETE", () => {
  const result = classify(base);
  assert.equal(result.result, "INCOMPLETE");
  assert.equal(result.runtime_safety_smoke.status, "PASS");
  assert.equal(result.autonomous_trading_certification.status, "INCOMPLETE_NO_AUTONOMOUS_ORDER_FILL_PNL");
  assert.equal(result.production_readiness.account_or_pnl_change_observed, false);
  assert.equal(result.production_readiness.completion_claim_allowed, false);
});

test("zero-quantity position is not an account change", () => {
  const result = classify({
    ...base,
    first_runtime: {
      orderCount: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      position: { market: "KRW-BTC", quantity: 0, averagePrice: 0 },
    },
  });
  assert.equal(result.production_readiness.account_or_pnl_change_observed, false);
  assert.equal(result.result, "INCOMPLETE");
});

test("autonomous fill plus account change can be classified complete while LIVE remains zero", () => {
  const result = classify({
    ...base,
    execution: { status: "AUTOMATICALLY_FILLED", order_id: "o1", fill_id: "f1" },
    first_runtime: { orderCount: 1, realizedPnl: 0, unrealizedPnl: 0, position: { market: "KRW-BTC", quantity: 1 } },
  });
  assert.equal(result.result, "PASS");
  assert.equal(result.runtime_safety_smoke.status, "PASS");
  assert.equal(result.autonomous_trading_certification.status, "COMPLETE_AUTONOMOUS_EXECUTION_OBSERVED");
  assert.equal(result.production_readiness.live_mutation_observed, false);
  assert.equal(result.production_readiness.completion_claim_allowed, true);
});

test("LIVE mutation evidence can never authorize a completion claim", () => {
  const result = classify({
    ...base,
    execution: { status: "AUTOMATICALLY_FILLED", order_id: "o1", fill_id: "f1" },
    first_runtime: { orderCount: 1, position: { market: "KRW-BTC", quantity: 1 } },
    prohibited_capabilities: { real_money_mutation: true },
  });
  assert.equal(result.runtime_safety_smoke.status, "FAIL");
  assert.equal(result.production_readiness.live_mutation_observed, true);
  assert.equal(result.production_readiness.completion_claim_allowed, false);
  assert.equal(result.result, "INCOMPLETE");
});
