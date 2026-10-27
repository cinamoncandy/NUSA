const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPaperExecutionIntent,
  validatePaperExecutionIntent,
  applyExchangeMinimumOrder,
  UPBIT_KRW_MINIMUM_ORDER_KRW,
  MINIMUM_ORDER_HEADROOM_RATIO,
  MINIMUM_ORDER_MAX_EQUITY_RATIO,
  MINIMUM_ORDER_FEE_RESERVE_RATIO,
} = require("../dist/apps/cloud/src/paperExecutionIntent.js");

const TARGET = 5_050;
const PRICE = 100_000;

const binding = Object.freeze({
  schemaVersion: 1,
  status: "BOUND_UNVERIFIED",
  authority: "PAPER_RESEARCH_ONLY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  candidateId: "candidate-a",
  datasetId: "dataset-a",
  datasetContentSha256: "a".repeat(64),
  advisoryGeneratedAt: 100,
  periodStartAt: 200,
  advisoryFingerprintSha256: "b".repeat(64),
  bindingFingerprintSha256: "c".repeat(64),
  candidateStrategy: Object.freeze({
    candidateId: "candidate-a",
    familyId: "family-a",
    lineageId: "lineage-a",
    specificationHash: "d".repeat(64),
    codeSha: "e".repeat(40),
    costModelVersion: "cost-v1",
    parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 }),
  }),
});

const decision = (allocation = 0.1) => Object.freeze({
  symbol: "KRW-BTC",
  action: "BUY",
  confidence: 0.9,
  risk: "LOW",
  allocation,
  leverage: 1,
  score: 0.9,
  reasons: Object.freeze(["fixture"]),
  decidedAt: 1_000,
  paperCandidateBinding: binding,
  paperCandidateStrategyDecision: Object.freeze({ action: "BUY", score: 0.9, confidence: 0.9, reason: "fixture", observedAt: 900 }),
});

const account = (equity, cash) => Object.freeze({
  version: 1,
  initialCapital: equity,
  cash,
  equity,
  realizedPnL: 0,
  unrealizedPnL: 0,
  positions: Object.freeze([]),
  orders: Object.freeze([]),
  fills: Object.freeze([]),
  processedIdempotencyKeys: Object.freeze([]),
  updatedAt: 900,
});

const portfolio = (equity, capital, share) => Object.freeze({
  allocations: Object.freeze([Object.freeze({ symbol: "KRW-BTC", instrument: "SPOT", action: "BUY", capital, share, leverage: 1, confidence: 0.9, risk: "LOW" })]),
  deployedCapital: capital,
  cashCapital: equity - capital,
  reservedCapital: 0,
  grossShare: share,
  futuresShare: 0,
  decidedAt: 1_000,
});

const build = ({ equity = 10_000, cash = equity, capital = 600, share = 0.06, investmentPercent = 100 } = {}) => buildPaperExecutionIntent({
  now: 1_000,
  market: "KRW-BTC",
  referencePrice: PRICE,
  portfolio: portfolio(equity, capital, share),
  decision: decision(0.1),
  state: account(equity, cash),
  investmentPercent,
});

test("the exchange constants are the owner-approved values", () => {
  assert.equal(UPBIT_KRW_MINIMUM_ORDER_KRW, 5_000);
  assert.equal(MINIMUM_ORDER_HEADROOM_RATIO, 1.01);
  assert.equal(MINIMUM_ORDER_MAX_EQUITY_RATIO, 0.6);
  assert.equal(MINIMUM_ORDER_FEE_RESERVE_RATIO, 1.005);
});

test("a KRW 600 plan on a KRW 10,000 account is raised to the exchange minimum with headroom", () => {
  const intent = build();
  assert.equal(intent.allocationCapital, TARGET);
  assert.equal(intent.allocationShare, 0.505);
  assert.equal(intent.quantity, TARGET / PRICE);
  assert.ok(intent.quantity * PRICE >= UPBIT_KRW_MINIMUM_ORDER_KRW, "the order value meets Upbit's minimum");
  assert.ok(intent.allocationCapital <= 10_000 * MINIMUM_ORDER_MAX_EQUITY_RATIO, "never above the 60% equity ceiling");
  assert.deepEqual(validatePaperExecutionIntent(intent), intent, "the raised intent is fingerprint-consistent");
});

test("a plan that already meets the minimum is left exactly as planned", () => {
  const intent = build({ equity: 10_000_000, capital: 1_000_000, share: 0.1 });
  assert.equal(intent.allocationCapital, 1_000_000);
  assert.equal(intent.allocationShare, 0.1);
  assert.deepEqual(applyExchangeMinimumOrder({ market: "KRW-BTC", plannedCapital: TARGET, equity: 10_000, cash: 10_000 }), { allocationCapital: TARGET, raised: false });
});

test("the raise fails closed when it would exceed the 60% equity ceiling", () => {
  // 5,050 > 6,000 * 0.6
  assert.throws(() => build({ equity: 6_000, cash: 6_000, capital: 400, share: 400 / 6_000 }), /PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_EQUITY_CEILING/);
});

test("the raise fails closed when cash cannot pay for the order and its fee", () => {
  // equity is fine (ceiling 6,000) but only 5,000 is cash: 5,050 * 1.005 = 5,075.25 > 5,000
  assert.throws(() => build({ equity: 10_000, cash: 5_000 }), /PAPER_EXECUTION_INTENT_MINIMUM_ORDER_EXCEEDS_CASH/);
  assert.equal(build({ equity: 10_000, cash: 5_076 }).allocationCapital, TARGET, "just enough cash raises the order");
});

test("a zero investment percentage still means no order, never a raise", () => {
  assert.throws(() => build({ investmentPercent: 0 }), /PAPER_EXECUTION_INTENT_ALLOCATION_ZERO/);
});

test("only KRW markets are raised", () => {
  assert.deepEqual(applyExchangeMinimumOrder({ market: "USDT-BTC", plannedCapital: 600, equity: 10_000, cash: 10_000 }), { allocationCapital: 600, raised: false });
  assert.equal(applyExchangeMinimumOrder({ market: "krw-eth", plannedCapital: 600, equity: 10_000, cash: 10_000 }).allocationCapital, TARGET);
});

test("cash already promised to open BUY working orders is not spent again by a raised order", () => {
  const working = Object.freeze({ side: "BUY", remainingAllocationCapital: 4_000, lifecycle: Object.freeze({ remainingQuantity: 0.04 }) });
  const state = Object.freeze({ ...account(10_000, 10_000), workingOrders: Object.freeze([working]) });
  const attempt = () => buildPaperExecutionIntent({ now: 1_000, market: "KRW-BTC", referencePrice: PRICE, portfolio: portfolio(10_000, 600, 0.06), decision: decision(0.1), state, investmentPercent: 100 });
  // free cash is 6,000, so 5,050 * 1.005 fits; with 5,000 committed it no longer does
  assert.equal(attempt().allocationCapital, TARGET);
  const tight = Object.freeze({ ...state, workingOrders: Object.freeze([Object.freeze({ ...working, remainingAllocationCapital: 6_000 })]) });
  assert.throws(() => buildPaperExecutionIntent({ now: 1_000, market: "KRW-BTC", referencePrice: PRICE, portfolio: portfolio(10_000, 600, 0.06), decision: decision(0.1), state: tight, investmentPercent: 100 }), /MINIMUM_ORDER_EXCEEDS_CASH/);
});
