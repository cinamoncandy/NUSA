"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluatePreTradeRisk } = require("../dist/apps/desktop/src/risk/independentRiskGateway.js");
const { verifyPreTradeRiskDecision } = require("../scripts/lib/paper-risk-gateway-verifier.js");
const { identity, limits, request } = require("./fixtures/risk-gateway-baseline.js");
const execution = require("../dist/apps/execution/src/index.js");
const contracts = require("../dist/packages/contracts/src/index.js");

const { LedgerSide } = contracts;
const { OrderAdmissionDecisionType, OrderAdmissionReasonCode, InMemoryIdempotencyStore, admitOrder, hashOrderIntent } = execution;

const decide = (mutate) => {
  const input = request();
  mutate(input);
  return { decision: evaluatePreTradeRisk(input, identity, limits), input };
};

/**
 * The price band is the only check that compares the caller's price against observed
 * market. A feed reporting HEALTHY while carrying no price used to skip it silently, so a
 * mispriced order passed every gate at exactly the moment the reference was unavailable.
 */
test("a HEALTHY feed with no price is rejected rather than skipping the price band", () => {
  const { decision, input } = decide((r) => { r.marketDataState.price = null; });
  assert.notEqual(decision.status, "ALLOW");
  assert.ok(decision.reasonCodes.includes("MARKET_DATA_INVALID"));
  // The independent verifier must reach the same conclusion, or the two disagree in production.
  assert.deepEqual(verifyPreTradeRiskDecision(input, identity, limits, decision).errors, []);
});

test("a feed that already reports a fault keeps its own reason and is not double-labelled", () => {
  const { decision } = decide((r) => { r.marketDataState.status = "STALE"; r.marketDataState.price = null; });
  assert.ok(decision.reasonCodes.includes("MARKET_DATA_STALE"));
  assert.ok(!decision.reasonCodes.includes("MARKET_DATA_INVALID"));
});

test("a usable price still enforces the deviation band, and a healthy baseline still allows", () => {
  assert.equal(decide((r) => { r.marketDataState.price = 5; }).decision.reasonCodes.includes("PRICE_DEVIATION_LIMIT"), true);
  assert.equal(evaluatePreTradeRisk(request(), identity, limits).status, "ALLOW");
});

const intent = (patch = {}) => ({
  intentId: "intent-1", idempotencyKey: "key-1", environment: "SYNTHETIC",
  accountId: "account-1", strategyId: "strategy-1", symbol: "BTC-USDT",
  side: LedgerSide.BUY, orderType: "LIMIT", baseQtyRaw: 1n, createdAtMs: 1_000, ...patch
});

test("the payload hash is a full-width digest, not a 32-bit checksum", () => {
  assert.match(hashOrderIntent(intent()), /^[0-9a-f]{64}$/);
  assert.equal(hashOrderIntent(intent()), hashOrderIntent(intent()));
  assert.notEqual(hashOrderIntent(intent()), hashOrderIntent(intent({ symbol: "ETH-USDT" })));
});

/**
 * Two economically distinct intents whose fields differ only in where a delimiter falls.
 * Under a delimiter join they encode identically, so the second order would have been
 * answered DUPLICATE and silently dropped.
 */
test("shifting a delimiter between fields yields a different order, not a duplicate", () => {
  const left = intent({ accountId: "a|b", strategyId: "c" });
  const right = intent({ accountId: "a", strategyId: "b|c" });
  assert.notEqual(hashOrderIntent(left), hashOrderIntent(right));

  const store = new InMemoryIdempotencyStore();
  const context = {
    nowMs: 1_000,
    authorization: {
      environment: "SYNTHETIC", accountIds: ["a|b", "a"], strategyIds: ["c", "b|c"],
      symbols: ["BTC-USDT"], orderTypes: ["LIMIT"], expiresAtMs: 9_000
    },
    riskContext: {}
  };
  assert.equal(admitOrder(left, context, store).type, OrderAdmissionDecisionType.ALLOW);
  const second = admitOrder(right, context, store);
  assert.equal(second.type, OrderAdmissionDecisionType.BLOCK);
  assert.equal(second.reasonCode, OrderAdmissionReasonCode.PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY);
});
