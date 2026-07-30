const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateMetaEvolution } = require("../dist/apps/cloud/src/metaEvolution.js");

const observation = (overrides = {}) => ({ policyId: "policy-1", priorQuality: 0.9, currentQuality: 0.8, sampleCount: 100, minimumSamples: 50, ...overrides });

test("policy degradation requires review without automatic mutation", () => {
  const result = evaluateMetaEvolution([observation()])[0];
  assert.equal(result.decision, "REVIEW_REQUIRED");
  assert.equal(result.automaticPolicyChangeAllowed, false);
});

test("insufficient policy evidence is not treated as stable", () => {
  assert.equal(evaluateMetaEvolution([observation({ sampleCount: 1 })])[0].decision, "INSUFFICIENT_DATA");
});
