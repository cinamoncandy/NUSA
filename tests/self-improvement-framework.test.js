const test = require("node:test");
const assert = require("node:assert/strict");
const { generateImprovementProposals } = require("../dist/apps/cloud/src/selfImprovementFramework.js");

test("degradation creates a review-only proposal", () => {
  const result = generateImprovementProposals([{ observationId: "latency", metric: "latencyMs", baseline: 100, current: 130, threshold: 10 }]);
  assert.equal(result[0].status, "REVIEW_REQUIRED");
  assert.equal(result[0].automaticChangeAllowed, false);
});

test("healthy observations do not create changes", () => {
  const result = generateImprovementProposals([{ observationId: "drawdown", metric: "drawdown", baseline: 0.2, current: 0.21, threshold: 0.05 }]);
  assert.equal(result[0].status, "NO_CHANGE");
});
