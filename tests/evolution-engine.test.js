const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateEvolution } = require("../dist/apps/cloud/src/evolutionEngine.js");

const parent = { candidateId: "parent", netReturn: 0.1, maximumDrawdown: 0.2, evidenceComplete: true, paperValidated: true };
const candidate = (overrides = {}) => ({ candidateId: "child", parentId: "parent", netReturn: 0.2, maximumDrawdown: 0.2, evidenceComplete: true, paperValidated: true, ...overrides });

test("validated improvement is recommended for review only", () => {
  const result = evaluateEvolution(parent, candidate(), { maximumDrawdown: 0.3, minimumImprovement: 0.05 });
  assert.equal(result.decision, "RECOMMEND_REVIEW");
  assert.equal(result.automaticPromotionAllowed, false);
});

test("unvalidated or unsafe evolution is rejected", () => {
  const result = evaluateEvolution(parent, candidate({ evidenceComplete: false, maximumDrawdown: 0.4 }), { maximumDrawdown: 0.3, minimumImprovement: 0.05 });
  assert.equal(result.decision, "REJECT");
  assert.deepEqual(result.reasons, ["EVIDENCE_INCOMPLETE", "DRAWDOWN_LIMIT_EXCEEDED"]);
});
