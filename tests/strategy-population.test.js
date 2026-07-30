const test = require("node:test");
const assert = require("node:assert/strict");
const { selectStrategyPopulation } = require("../dist/apps/cloud/src/strategyPopulation.js");

const policy = { maximumDrawdown: 0.3, requireEvidence: true, requireCertification: true, maximumPopulation: 2 };
const candidate = (strategyId, expectedReturn, overrides = {}) => ({ strategyId, version: "1.0.0", expectedReturn, maximumDrawdown: 0.2, evidenceComplete: true, certified: true, ...overrides });

test("population selection is deterministic and bounded", () => {
  const result = selectStrategyPopulation([candidate("slow", 0.1), candidate("fast", 0.2), candidate("third", 0.05)], policy);
  assert.deepEqual(result.eligible.map((item) => item.strategyId), ["fast", "slow"]);
  assert.equal(result.automaticPromotionAllowed, false);
});

test("uncertified or risky candidates are rejected", () => {
  const result = selectStrategyPopulation([candidate("risky", 0.4, { maximumDrawdown: 0.4 }), candidate("uncertified", 0.3, { certified: false })], policy);
  assert.deepEqual(result.eligible, []);
  assert.deepEqual(result.rejected, ["risky@1.0.0", "uncertified@1.0.0"]);
});
