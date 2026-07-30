const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateUncertainty } = require("../dist/apps/cloud/src/uncertaintyEngine.js");

test("strong evidence produces low uncertainty", () => {
  const result = evaluateUncertainty({ evidenceFreshness: 1, sourceAgreement: 1, sampleAdequacy: 1, modelStability: 1, missingCriticalInputs: false });
  assert.equal(result.level, "VERY_LOW");
  assert.equal(result.maximumRecommendedWeight, 1);
});

test("missing critical input fails closed", () => {
  const result = evaluateUncertainty({ evidenceFreshness: 1, sourceAgreement: 1, sampleAdequacy: 1, modelStability: 1, missingCriticalInputs: true });
  assert.equal(result.level, "VERY_HIGH");
  assert.equal(result.maximumRecommendedWeight, 0);
  assert.deepEqual(result.reasons, ["CRITICAL_INPUT_MISSING"]);
});
