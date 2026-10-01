const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperTradingExecutionLoop } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { CloudPaperExecutionBoundary } = require("../dist/apps/cloud/src/cloudPaperExecutionBoundary.js");
const { validatePaperExecutionIntent, paperExecutionIntentCommandId } = require("../dist/apps/cloud/src/paperExecutionIntent.js");

/**
 * Lineage check for one real PAPER fill through the canonical boundary: the fill must lead back,
 * through identities and fingerprints that already exist, to the exact order, the immutable
 * execution intent, the candidate binding, its dataset identity and the CIO decision/portfolio
 * plan that caused it; and forward from the decision to the fill, order and idempotency ledger.
 *
 * Scope note: this proves the links that exist today. A fill does not yet reference the exact
 * market observation (ticker/orderbook) id that produced its decision; that missing link is the
 * open gap of the integrated upgrade brief (P0 evidence lineage) and is deliberately not asserted.
 */

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
  candidateStrategy: Object.freeze({ candidateId: "sma-5-20", familyId: "sma-crossover", lineageId: "fixture-lineage", specificationHash: "d".repeat(64), codeSha: "e".repeat(40), costModelVersion: "fixture-cost-v1", parameters: Object.freeze({ shortPeriod: 5, longPeriod: 20 }) })
});

const decision = Object.freeze({
  symbol: "KRW-BTC", action: "BUY", confidence: 1, risk: "LOW", allocation: 0.1, leverage: 1, score: 1,
  reasons: Object.freeze(["fixture"]), decidedAt: 1_000,
  paperCandidateBinding: candidateBinding,
  paperCandidateStrategyDecision: Object.freeze({ action: "BUY", score: 1, confidence: 1, reason: "SMA_CROSSOVER:5/20:fixture", observedAt: 950 })
});

const portfolio = Object.freeze({
  allocations: Object.freeze([Object.freeze({ symbol: "KRW-BTC", instrument: "SPOT", action: "BUY", capital: 1_000_000, share: 0.1, leverage: 1, confidence: 1, risk: "LOW" })]),
  deployedCapital: 1_000_000, cashCapital: 9_000_000, reservedCapital: 0, grossShare: 0.1, futuresShare: 0, decidedAt: 1_000
});

const tick = Object.freeze({ now: 2_000, market: "KRW-BTC", price: 50_000_000, observedAt: 1_500, mode: "PAPER", killSwitchActive: false, tradingAllowed: true, overallHealth: "HEALTHY", portfolio, decisions: Object.freeze([decision]) });

function fillThroughBoundary() {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const riskGate = { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) };
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate, readP0State: () => ({ openP0: false }) });
  const result = boundary.processTick(tick);
  return { result, state: loop.snapshot() };
}

test("a PAPER fill traces back to its order, intent, binding, dataset and decision", () => {
  const { result, state } = fillThroughBoundary();
  assert.equal(result.status, "FILLED");
  const fill = state.fills[0];
  const order = state.orders.find((item) => item.id === fill.orderId);
  assert.ok(order, "fill -> order");
  const intent = validatePaperExecutionIntent(fill.executionIntent);
  assert.deepEqual(intent, fill.executionIntent, "the intent fingerprint recomputes from its own content");
  assert.equal(order.idempotencyKey, paperExecutionIntentCommandId(intent), "order -> intent (command identity)");
  assert.equal(intent.candidateBindingFingerprintSha256, fill.candidateProvenance.binding.bindingFingerprintSha256, "intent -> binding");
  assert.equal(fill.candidateProvenance.binding.bindingFingerprintSha256, decision.paperCandidateBinding.bindingFingerprintSha256);
  assert.equal(fill.candidateProvenance.binding.datasetContentSha256, decision.paperCandidateBinding.datasetContentSha256, "binding -> dataset identity");
  assert.equal(fill.candidateProvenance.binding.datasetId, decision.paperCandidateBinding.datasetId);
  assert.equal(intent.candidateId, decision.paperCandidateBinding.candidateId, "intent -> strategy identity");
  assert.equal(intent.decisionDecidedAt, decision.decidedAt, "intent -> decision time");
  assert.equal(fill.candidateProvenance.decisionAt, decision.decidedAt);
  assert.equal(intent.portfolioDecidedAt, portfolio.decidedAt, "intent -> portfolio plan time");
});

test("the same decision leads forward to exactly one order, one fill and a consumed idempotency key", () => {
  const { state } = fillThroughBoundary();
  const fill = state.fills[0];
  const commandId = paperExecutionIntentCommandId(fill.executionIntent);
  assert.equal(state.orders.filter((order) => order.idempotencyKey === commandId).length, 1, "decision -> one order");
  assert.equal(state.fills.filter((item) => item.orderId === state.orders.find((order) => order.idempotencyKey === commandId).id).length, 1, "order -> one fill");
  assert.ok(state.processedIdempotencyKeys.includes(commandId), "the command identity is recorded in the idempotency ledger");
});

test("replaying the identical tick does not create a second order or fill", () => {
  const loop = new PaperTradingExecutionLoop({ initialCapital: 10_000_000, feeRate: 0, readP0State: () => ({ openP0: false }) });
  const boundary = new CloudPaperExecutionBoundary({ loop, riskGate: { evaluate: () => Object.freeze({ status: "ALLOW", reasonCodes: Object.freeze([]) }) }, readP0State: () => ({ openP0: false }) });
  boundary.processTick(tick);
  const before = loop.snapshot();
  const replay = boundary.processTick(tick);
  const after = loop.snapshot();
  assert.notEqual(replay.status, "FILLED", "a replay must not fill again");
  assert.equal(after.orders.length, before.orders.length);
  assert.equal(after.fills.length, before.fills.length);
  assert.equal(after.cash, before.cash);
});
