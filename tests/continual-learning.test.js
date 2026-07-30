const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateContinualLearning } = require("../dist/apps/cloud/src/continualLearning.js");

const observation = (overrides = {}) => ({ observationId: "obs-1", modelId: "model-1", priorAccuracy: 0.8, currentAccuracy: 0.7, sampleCount: 100, minimumSamples: 50, ...overrides });

test("degradation recommends learning without changing the model", () => {
  const result = evaluateContinualLearning([observation()])[0];
  assert.equal(result.status, "LEARNING_RECOMMENDED");
  assert.equal(result.automaticModelChangeAllowed, false);
});

test("insufficient samples remain unknown to learning", () => {
  assert.equal(evaluateContinualLearning([observation({ sampleCount: 2 })])[0].status, "INSUFFICIENT_DATA");
});
