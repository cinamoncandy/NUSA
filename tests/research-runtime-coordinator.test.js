const test = require("node:test");
const assert = require("node:assert/strict");
const { SqliteDatabase, SqliteResearchEvaluationLedger } = require("../dist/packages/storage/src/index.js");
const { InMemoryResearchEvaluationLedger, ResearchRuntimeCoordinator, ResearchRuntimeError } = require("../dist/apps/cloud/src/researchRuntimeCoordinator.js");

function input(overrides = {}) {
  return {
    researchRunId: "run-1",
    evaluationId: "evaluation-1",
    strategyId: "family-1",
    strategyVersion: "comparison-1",
    marketDataTimestamp: 1000,
    evaluationTimestamp: 2000,
    modelVersion: "research-model-1",
    fillModelVersion: "fill-1",
    feeModelVersion: "fee-1",
    slippageModelVersion: "slippage-1",
    strategyState: "RESEARCHING",
    staleWindowMs: 30_000,
    marketData: [{ market: "KRW-BTC", price: 100, observedAt: 1000 }],
    startingCash: 1_000_000,
    startingPositionQuantity: 0,
    ...overrides
  };
}

function evaluator(strategyId, strategyVersion, authority, netReturn, seen) {
  return {
    strategyId,
    strategyVersion,
    authority,
    evaluatorVersion: `${strategyId}-evaluator-1`,
    evaluate(context) {
      seen?.push(context);
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.input), true);
      return { strategyId, strategyVersion, authority, evaluatorVersion: `${strategyId}-evaluator-1`, canonicalInputHash: context.canonicalInputHash, metrics: { netReturn, sharpeRatio: netReturn }, signal: "HOLD" };
    }
  };
}

test("champion and challenger receive one immutable input hash and shared cost models", () => {
  const seen = [];
  const coordinator = new ResearchRuntimeCoordinator({
    champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1, seen),
    challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2, seen)
  });
  const result = coordinator.evaluate(input());
  assert.equal(result.result, "CHALLENGER_BETTER");
  assert.equal(result.champion.authority, "PAPER_ONLY");
  assert.equal(result.challenger.authority, "ZERO_AUTHORITY");
  assert.equal(seen.length, 2);
  assert.strictEqual(seen[0].input, seen[1].input);
  assert.equal(seen[0].canonicalInputHash, seen[1].canonicalInputHash);
  assert.equal(seen[0].fillModelVersion, "fill-1");
  assert.equal(seen[1].feeModelVersion, "fee-1");
  assert.equal(seen[0].slippageModelVersion, "slippage-1");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.promotionAllowed, false);
});

test("evaluator context hash mismatch is inconclusive and never promotes", () => {
  const coordinator = new ResearchRuntimeCoordinator({
    champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1),
    challenger: { ...evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2), evaluate(context) { return { ...evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2).evaluate(context), canonicalInputHash: "f".repeat(64) }; } }
  });
  const result = coordinator.evaluate(input());
  assert.equal(result.result, "INCONCLUSIVE");
  assert.equal(result.reason, "EVALUATOR_CONTEXT_MISMATCH");
});

test("challenger is zero-authority and receives no broker or execution surface", () => {
  let context;
  const coordinator = new ResearchRuntimeCoordinator({
    champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1),
    challenger: { strategyId: "challenger-1", strategyVersion: "1.0.0", authority: "ZERO_AUTHORITY", evaluatorVersion: "challenger-evaluator-1", evaluate(value) { context = value; return { strategyId: "challenger-1", strategyVersion: "1.0.0", authority: "ZERO_AUTHORITY", evaluatorVersion: "challenger-evaluator-1", canonicalInputHash: value.canonicalInputHash, metrics: { netReturn: 0.1 }, signal: "HOLD" }; } }
  });
  coordinator.evaluate(input());
  assert.equal("broker" in context, false);
  assert.equal("submitOrder" in context, false);
  assert.equal("cancelOrder" in context, false);
});

test("stale, missing, and unknown strategy state fail closed as inconclusive", () => {
  const ledger = new InMemoryResearchEvaluationLedger();
  const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2), ledger });
  assert.equal(coordinator.evaluate(input({ marketData: [] })).result, "INCONCLUSIVE");
  assert.match(coordinator.evaluate(input({ marketData: [{ market: "KRW-BTC", price: 100, observedAt: 0 }], evaluationTimestamp: 40_000, staleWindowMs: 30_000, evaluationId: "evaluation-2" })).reason, /STALE_MARKET_DATA/);
  assert.match(coordinator.evaluate(input({ strategyState: "UNKNOWN", evaluationId: "evaluation-3" })).reason, /UNSUPPORTED_STRATEGY_STATE/);
  assert.equal(ledger.list().length, 3);
});

test("evaluator exceptions become inconclusive and deterministic input replay matches", () => {
  const failing = new ResearchRuntimeCoordinator({ champion: { ...evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), evaluate() { throw new Error("boom"); } }, challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2) });
  assert.equal(failing.evaluate(input()).result, "INCONCLUSIVE");
  const make = () => new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2) });
  assert.deepEqual(make().evaluate(input()), make().evaluate(input()));
});

test("unsupported input values fail closed without fallback string hashing", () => {
  const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2) });
  const malformed = input({ marketData: [{ market: "KRW-BTC", price: 100, observedAt: 1000, unsupported: () => "secret-like value" }] });
  const first = coordinator.evaluate(malformed);
  const second = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2) }).evaluate(malformed);
  assert.equal(first.result, "INCONCLUSIVE");
  assert.equal(first.reason, "NON_CANONICAL_INPUT");
  assert.equal(first.champion, null);
  assert.equal(first.challenger, null);
  assert.equal(first.canonicalInputHash, second.canonicalInputHash);
  assert.equal(first.canonicalInputHash.includes("secret-like"), false);
});

test("malformed market data shape fails closed instead of throwing", () => {
  const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2) });
  const missingCollection = coordinator.evaluate(input({ marketData: null }));
  const malformedPoint = coordinator.evaluate(input({ marketData: [null], evaluationId: "evaluation-malformed-point" }));
  assert.equal(missingCollection.result, "INCONCLUSIVE");
  assert.match(missingCollection.reason, /INVALID_MARKET_DATA/);
  assert.equal(malformedPoint.result, "INCONCLUSIVE");
  assert.match(malformedPoint.reason, /INVALID_MARKET_DATA/);
});

test("comparison ledger persists and rejects conflicting evaluation identities", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteResearchEvaluationLedger(db);
    const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2), ledger });
    const record = coordinator.evaluate(input());
    assert.deepEqual(ledger.list(), [record]);
    assert.throws(() => ledger.append({ ...record, reason: "tampered" }), /conflict/);
  } finally { db.close(); }
});

test("ledger persistence failures fail closed", () => {
  const coordinator = new ResearchRuntimeCoordinator({ champion: evaluator("champion-1", "1.0.0", "PAPER_ONLY", 0.1), challenger: evaluator("challenger-1", "1.0.0", "ZERO_AUTHORITY", 0.2), ledger: { append() { throw new Error("disk unavailable"); }, list() { return []; } } });
  assert.throws(() => coordinator.evaluate(input()), (error) => error instanceof ResearchRuntimeError && error.code === "LEDGER_PERSISTENCE_FAILED");
});
