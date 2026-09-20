const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");
const { buildPaperObservedExecutionQuote } = require("../dist/apps/cloud/src/paperRuntimeExecutionCostEvidence.js");

const genericDecision = Object.freeze({
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

const candidateBinding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "sma-5-20",
  datasetId: "fixture-dataset",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 500,
  periodStartAt: 900,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
  candidateStrategy: Object.freeze({
    candidateId: "sma-5-20",
    familyId: "sma-crossover",
    lineageId: "fixture-lineage",
    specificationHash: "d".repeat(64),
    codeSha: "e".repeat(40),
    costModelVersion: "fixture-cost-v1",
    parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 })
  })
});

const decision = Object.freeze({
  ...genericDecision,
  paperCandidateBinding: candidateBinding,
  paperCandidateStrategyDecision: Object.freeze({
    action: "BUY",
    score: 1,
    confidence: 1,
    reason: "SMA_CROSSOVER:5/20:fixture",
    observedAt: 950
  })
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
  portfolio: Object.freeze({
    allocations: Object.freeze([Object.freeze({
      symbol: "KRW-BTC",
      instrument: "SPOT",
      action: "BUY",
      capital: 1_000_000,
      share: 0.1,
      leverage: 1,
      confidence: 1,
      risk: "LOW"
    })]),
    deployedCapital: 1_000_000,
    cashCapital: 9_000_000,
    reservedCapital: 0,
    grossShare: 0.1,
    futuresShare: 0,
    decidedAt: 1_000
  }),
  decisions: Object.freeze([decision])
});

function build(status, loopOptions = {}) {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }), ...loopOptions });
  let evaluations = 0;
  let lastRiskRequest;
  const riskGate = {
    evaluate(request) {
      evaluations += 1;
      lastRiskRequest = request;
      return Object.freeze({ status, reasonCodes: Object.freeze(status === "ALLOW" ? [] : [status === "HALT" ? "KILL_SWITCH_ACTIVE" : "MAX_ORDER_NOTIONAL"]) });
    }
  };
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate, readP0State: () => ({ openP0: false }) });
  return { loop, boundary, evaluations: () => evaluations, lastRiskRequest: () => lastRiskRequest };
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

test("canonical ALLOW executes an immutable Research/League-bound PAPER challenger tick", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const result = boundary.processTick(tick);
  const after = loop.snapshot();
  assert.equal(evaluations(), 1);
  assert.equal(result.status, "FILLED");
  assert.equal(after.orders.length, 1);
  assert.equal(after.fills.length, 1);
  assert.equal(after.fills[0].candidateProvenance.binding.candidateId, "sma-5-20");
  assert.equal(after.positions.length, 1);
  assert.equal(after.positions[0].market, "KRW-BTC");
  assert.equal(after.positions[0].quantity, 0.02);
  assert.equal(after.cash, 9_000_000);
});

test("PortfolioPlan capital is the canonical BUY sizing source even when CIO decision allocation is larger", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const largerDecision = Object.freeze({ ...decision, allocation: 0.5 });
  const result = boundary.processTick(Object.freeze({ ...tick, decisions: Object.freeze([largerDecision]) }));
  assert.equal(evaluations(), 1);
  assert.equal(result.status, "FILLED");
  assert.equal(result.fills[0].quantity, 0.02);
  assert.equal(result.fills[0].executionIntent.allocationShare, 0.1);
  assert.equal(result.fills[0].executionIntent.allocationCapital, 1_000_000);
  assert.equal(result.fills[0].executionIntent.candidateId, "sma-5-20");
  assert.equal(loop.snapshot().cash, 9_000_000);
});

test("fresh public orderbook depth never exceeds intent capital and cancels an unfillable budget remainder", () => {
  const { loop, boundary, evaluations, lastRiskRequest } = build("ALLOW");
  const observedQuote = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 1_900,
    totalAskSize: 0.05,
    totalBidSize: 0.05,
    units: [Object.freeze({ askPrice: 55_000_000, bidPrice: 54_000_000, askSize: 0.05, bidSize: 0.05 })]
  });
  const result = boundary.processTick(Object.freeze({ ...tick, observedQuote }));
  assert.equal(evaluations(), 1);
  assert.equal(result.status, "WAIT");
  assert.equal(result.reason, "PAPER_STRATEGY_BUDGET_EXHAUSTED");
  assert.equal(result.fills.length, 1);
  assert.equal(result.orders[0].status, "CANCELLED");
  assert.equal(result.state.workingOrders?.length ?? 0, 0);
  const fill = result.fills[0];
  assert.equal(fill.price, 55_000_000);
  assert.ok(fill.quantity < fill.executionIntent.quantity);
  assert.ok(fill.quantity * fill.price <= fill.executionIntent.allocationCapital + 1e-6);
  assert.equal(fill.orderBookExecutionReceipt.model, "DEPTH_VWAP_V1");
  assert.equal(fill.orderBookExecutionReceipt.budgetLimited, true);
  assert.equal(fill.orderBookExecutionReceipt.liquidityLimited, false);
  assert.equal(fill.orderBookExecutionReceipt.requestedQuantity, fill.executionIntent.quantity);
  assert.equal(fill.orderBookExecutionReceipt.filledQuantity, fill.quantity);
  assert.equal(fill.orderBookExecutionReceipt.quoteFingerprintSha256, fill.orderBookQuoteReceipt.fingerprintSha256);
  assert.equal(lastRiskRequest().quantity, fill.executionIntent.quantity);
  assert.equal(lastRiskRequest().payloadFingerprintSha256, fill.executionIntent.intentFingerprintSha256);

  const restored = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, restoredState: structuredClone(loop.snapshot()), readP0State: () => ({ openP0: false }) });
  assert.deepEqual(restored.snapshot(), loop.snapshot());
});

test("canonical strategy order automatically partial-fills and completes on the next risk-approved tick", () => {
  const { loop, boundary, evaluations } = build("ALLOW", { maxFillRatio: 0.5 });
  const first = boundary.processTick(tick);
  assert.equal(first.status, "WAIT");
  assert.equal(first.reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  assert.equal(first.fills[0].quantity, 0.01);
  assert.equal(first.state.workingOrders?.length, 1);
  assert.equal(first.state.workingOrders?.[0]?.lifecycle.remainingQuantity, 0.01);
  assert.equal(first.state.workingOrders?.[0]?.executionIntent.intentFingerprintSha256, first.fills[0].executionIntent.intentFingerprintSha256);
  assert.equal(evaluations(), 1);

  const second = boundary.processTick(Object.freeze({
    ...tick,
    now: 2_100,
    observedAt: 2_050,
    decisions: Object.freeze([])
  }));
  assert.equal(second.status, "FILLED");
  assert.equal(second.reason, "PAPER_STRATEGY_FILLED");
  assert.equal(second.fills[0].quantity, 0.01);
  assert.equal(second.orders[0].quantity, 0.02);
  assert.equal(second.orders[0].lifecycle.status, "FILLED");
  assert.equal(second.state.workingOrders?.length ?? 0, 0);
  assert.equal(second.state.fills.length, 2);
  assert.equal(evaluations(), 2);
});

test("canonical strategy order carries orderbook-liquidity remainder across ticks", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const shallow = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 1_900,
    totalAskSize: 0.005,
    totalBidSize: 0.005,
    units: [Object.freeze({ askPrice: 50_000_000, bidPrice: 49_000_000, askSize: 0.005, bidSize: 0.005 })]
  });
  const first = boundary.processTick(Object.freeze({ ...tick, observedQuote: shallow }));
  assert.equal(first.status, "WAIT");
  assert.equal(first.reason, "PAPER_STRATEGY_PARTIALLY_FILLED");
  assert.equal(first.fills[0].quantity, 0.005);
  assert.equal(first.fills[0].orderBookExecutionReceipt.liquidityLimited, true);
  assert.equal(first.state.workingOrders?.[0]?.lifecycle.remainingQuantity, 0.015);

  const deeper = buildPaperObservedExecutionQuote({
    market: "KRW-BTC",
    observedAt: 2_050,
    totalAskSize: 0.02,
    totalBidSize: 0.02,
    units: [Object.freeze({ askPrice: 50_000_000, bidPrice: 49_000_000, askSize: 0.02, bidSize: 0.02 })]
  });
  const second = boundary.processTick(Object.freeze({
    ...tick,
    now: 2_100,
    observedAt: 2_050,
    decisions: Object.freeze([]),
    observedQuote: deeper
  }));
  assert.equal(second.status, "FILLED");
  assert.equal(second.fills[0].quantity, 0.015);
  assert.equal(second.fills[0].orderBookExecutionReceipt.liquidityLimited, false);
  assert.equal(second.orders[0].quantity, 0.02);
  assert.equal(second.state.workingOrders?.length ?? 0, 0);
  assert.equal(loop.snapshot().cash, 9_000_000);
  assert.equal(evaluations(), 2);
});

test("strategy latency is restart-safe and continuation is risk checked again", () => {
  const { loop, boundary, evaluations } = build("ALLOW", { latencyTicks: 1 });
  const first = boundary.processTick(tick);
  assert.equal(first.status, "WAIT");
  assert.equal(first.reason, "PAPER_STRATEGY_EXECUTION_LATENCY:1/1");
  assert.equal(first.fills.length, 0);
  assert.equal(first.state.workingOrders?.[0]?.observedTicks, 1);

  const restoredState = structuredClone(loop.snapshot());
  let restoredEvaluations = 0;
  const restoredLoop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, latencyTicks: 1, restoredState, readP0State: () => ({ openP0: false }) });
  const restoredBoundary = new CloudPaperExecutionBoundary({
    loop: restoredLoop,
    riskGate: { evaluate() { restoredEvaluations += 1; return Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }); } },
    readP0State: () => ({ openP0: false })
  });
  const second = restoredBoundary.processTick(Object.freeze({ ...tick, now: 2_100, observedAt: 2_050, decisions: Object.freeze([]) }));
  assert.equal(second.status, "FILLED");
  assert.equal(second.orders[0].quantity, 0.02);
  assert.equal(restoredLoop.snapshot().workingOrders?.length ?? 0, 0);
  assert.equal(evaluations(), 1);
  assert.equal(restoredEvaluations, 1);
});

test("risk request and persisted fill share the exact execution-intent fingerprint", () => {
  const { boundary, lastRiskRequest } = build("ALLOW");
  const result = boundary.processTick(tick);
  assert.equal(result.status, "FILLED");
  assert.ok(lastRiskRequest());
  assert.equal(lastRiskRequest().payloadFingerprintSha256, result.fills[0].executionIntent.intentFingerprintSha256);
  assert.equal(lastRiskRequest().commandId, `paper-intent:${result.fills[0].executionIntent.intentFingerprintSha256}`);
  assert.equal(result.orders[0].idempotencyKey, lastRiskRequest().commandId);
});

test("automatic PAPER mutation fails closed when canonical PortfolioPlan is absent", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const before = loop.snapshot();
  const { portfolio: _portfolio, ...withoutPortfolio } = tick;
  const result = boundary.processTick(Object.freeze(withoutPortfolio));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "PAPER_PORTFOLIO_EXECUTION_INTENT_REQUIRED");
  assert.equal(evaluations(), 0);
  assert.deepEqual(loop.snapshot(), before);
});

test("generic CIO action remains advisory and cannot mutate PAPER without a challenger binding", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const before = loop.snapshot();
  const result = boundary.processTick(Object.freeze({ ...tick, decisions: Object.freeze([genericDecision]) }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "PAPER_CANDIDATE_BINDING_REQUIRED");
  assert.equal(evaluations(), 0);
  assert.deepEqual(loop.snapshot(), before);
});

test("candidate-bound action fails closed when it does not match exact strategy semantics", () => {
  const { loop, boundary, evaluations } = build("ALLOW");
  const before = loop.snapshot();
  const mismatched = Object.freeze({
    ...decision,
    paperCandidateStrategyDecision: Object.freeze({ ...decision.paperCandidateStrategyDecision, action: "SELL" })
  });
  const result = boundary.processTick(Object.freeze({ ...tick, decisions: Object.freeze([mismatched]) }));
  assert.equal(result.status, "BLOCKED");
  assert.equal(result.reason, "PAPER_CANDIDATE_STRATEGY_DECISION_INVALID");
  assert.equal(evaluations(), 0);
  assert.deepEqual(loop.snapshot(), before);
});

test("automatic strategy approval rejects non-spot or high-risk challenger mutations before risk evaluation", () => {
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
