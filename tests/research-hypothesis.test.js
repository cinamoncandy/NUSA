"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildResearchHypothesis,
  validateResearchHypothesis,
  validateResearchHypothesisBinding,
  ResearchHypothesisError,
} = require("../dist/apps/desktop/src/cloud/researchHypothesis.js");

function input(overrides = {}) {
  return {
    hypothesisId: "real-run:dataset-1:sma-crossover",
    familyId: "sma-crossover",
    market: "KRW-BTC",
    interval: "1d",
    direction: "LONG",
    thesis: "A short/long SMA crossover may identify a reproducible directional edge after costs.",
    sourceDatasetId: "dataset-1",
    sourceObservationAsOf: Date.parse("2026-01-01T00:00:00.000Z"),
    generatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("builds deterministic, frozen hypothesis provenance", () => {
  const first = buildResearchHypothesis(input());
  const second = buildResearchHypothesis(input());

  assert.deepEqual(first, second);
  assert.equal(validateResearchHypothesis(first, {
    nowMs: Date.parse("2026-01-02T00:00:00.000Z"),
  }).status, "VERIFIED");
  assert.ok(Object.isFrozen(first));
  assert.equal(first.sourceDatasetId, "dataset-1");
});

test("binds hypothesis to the evaluated market dataset and chronology", () => {
  const hypothesis = buildResearchHypothesis(input());
  const decision = validateResearchHypothesisBinding(hypothesis, {
    hypothesisId: hypothesis.hypothesisId,
    familyId: "sma-crossover",
    market: "KRW-BTC",
    interval: "1d",
    sourceDatasetId: "dataset-1",
    evaluationGeneratedAt: "2026-01-02T00:00:00.000Z",
  });

  assert.equal(decision.status, "VERIFIED");
  assert.match(decision.hypothesisHash, /^[a-f0-9]{64}$/);
});

test("rejects future and post-observation hypotheses instead of creating a candidate", () => {
  assert.throws(
    () => buildResearchHypothesis(input({
      sourceObservationAsOf: Date.parse("2026-01-03T00:00:00.000Z"),
    })),
    (error) => error instanceof ResearchHypothesisError
      && error.code === "HYPOTHESIS_NOT_AFTER_SOURCE_OBSERVATION",
  );

  const decision = validateResearchHypothesis(input({
    generatedAt: "2026-01-04T00:00:00.000Z",
  }), { nowMs: Date.parse("2026-01-03T00:00:00.000Z") });
  assert.equal(decision.status, "REJECTED");
  assert.ok(decision.reasons.includes("FUTURE_HYPOTHESIS"));
});

test("rejects provenance and identity mismatches", () => {
  const hypothesis = buildResearchHypothesis(input());
  const decision = validateResearchHypothesisBinding(hypothesis, {
    hypothesisId: hypothesis.hypothesisId,
    familyId: "other-family",
    market: "KRW-BTC",
    interval: "1d",
    sourceDatasetId: "other-dataset",
    evaluationGeneratedAt: "2026-01-02T00:00:00.000Z",
  });

  assert.equal(decision.status, "REJECTED");
  assert.ok(decision.reasons.includes("HYPOTHESIS_FAMILY_MISMATCH"));
  assert.ok(decision.reasons.includes("HYPOTHESIS_DATASET_MISMATCH"));
});
