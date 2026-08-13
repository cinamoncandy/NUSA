const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAiInferenceCost, DEFAULT_AI_COST_RATE_CARD } = require("../dist/apps/cloud/src/ai/costQualityEvaluator.js");

const rateCard = {
  schemaVersion: 1,
  rateCardId: "TEST_CARD",
  rateCardVersion: "1.0.0-test",
  currency: "USD",
  rates: { "anthropic:claude-test": { inputPricePerMillionTokens: 3, outputPricePerMillionTokens: 15 } }
};

const verifiedSnapshot = (overrides = {}) => ({
  schemaVersion: 1,
  health: "HEALTHY",
  policy: { schemaVersion: 1, policyId: "p", policyVersion: "1", maxModelCalls: 4, maxTotalAttempts: 8, maxCumulativeOutputTokens: 16384, maxInputBytes: 4096, maxWallClockMs: 90000, requireUsageAccounting: true },
  modelCalls: 1,
  attempts: 1,
  reservedOutputTokens: 1000,
  inputBytes: 500,
  usageAccountingStatus: "VERIFIED",
  actualInputTokens: 1_000_000,
  actualOutputTokens: 500_000,
  actualTotalTokens: 1_500_000,
  elapsedMs: 1000,
  attemptsEvidence: [],
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  ...overrides
});

test("a verified snapshot with a known rate produces an exact ESTIMATED cost", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot(), "anthropic", "claude-test", rateCard);
  assert.equal(result.status, "ESTIMATED");
  // 1,000,000 input tokens @ $3/M = $3.00; 500,000 output tokens @ $15/M = $7.50; total $10.50
  assert.equal(result.estimatedCost, 10.5);
  assert.equal(result.currency, "USD");
  assert.equal(result.rateCardVersion, "1.0.0-test");
});

test("unverified usage accounting fails closed to UNVERIFIED, never a fabricated cost", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot({ usageAccountingStatus: "PARTIAL" }), "anthropic", "claude-test", rateCard);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.estimatedCost, null);
});

test("null actual token counts fail closed to UNVERIFIED", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot({ actualInputTokens: null }), "anthropic", "claude-test", rateCard);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.estimatedCost, null);
});

test("an unpriced provider/model pair fails closed to UNVERIFIED, not a silent zero", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot(), "openai", "gpt-unpriced", rateCard);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.estimatedCost, null);
  // The rate card identity is still surfaced even on failure, so a reader can see WHICH card was checked.
  assert.equal(result.rateCardId, "TEST_CARD");
});

test("a missing snapshot, providerId, or modelVersionId fails closed", () => {
  assert.equal(evaluateAiInferenceCost(undefined, "anthropic", "claude-test", rateCard).status, "UNVERIFIED");
  assert.equal(evaluateAiInferenceCost(verifiedSnapshot(), undefined, "claude-test", rateCard).status, "UNVERIFIED");
  assert.equal(evaluateAiInferenceCost(verifiedSnapshot(), "anthropic", undefined, rateCard).status, "UNVERIFIED");
});

test("the default rate card has no priced entries, so every estimate against it is UNVERIFIED until an operator configures real prices", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot(), "anthropic", "claude-test", DEFAULT_AI_COST_RATE_CARD);
  assert.equal(result.status, "UNVERIFIED");
  assert.equal(DEFAULT_AI_COST_RATE_CARD.rateCardVersion, "0.0.0-unset");
});

test("zero actual tokens still produces an exact zero cost, distinct from UNVERIFIED", () => {
  const result = evaluateAiInferenceCost(verifiedSnapshot({ actualInputTokens: 0, actualOutputTokens: 0 }), "anthropic", "claude-test", rateCard);
  assert.equal(result.status, "ESTIMATED");
  assert.equal(result.estimatedCost, 0);
});

test("evaluation is deterministic given the same inputs", () => {
  const a = evaluateAiInferenceCost(verifiedSnapshot(), "anthropic", "claude-test", rateCard);
  const b = evaluateAiInferenceCost(verifiedSnapshot(), "anthropic", "claude-test", rateCard);
  assert.deepEqual(a, b);
});
