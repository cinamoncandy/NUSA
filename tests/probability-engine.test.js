const test = require("node:test");
const assert = require("node:assert/strict");
const { estimateProbability } = require("../dist/apps/cloud/src/probabilityEngine.js");

const generatedAt = "2026-07-13T03:40:00.000Z";
const marketState = {
  market: "BTC-USD",
  regime: "TREND_UP",
  trendScore: 0.8,
  volatilityScore: 0.4,
  liquidityScore: 0.9,
  stressScore: 0.1,
  uncertaintyScore: 0.15,
  confidence: 0.9,
  generatedAt,
  provenance: []
};

const feature = (overrides = {}) => ({
  featureId: "order-book-imbalance",
  featureVersion: 1,
  value: 0.4,
  normalizedValue: 0.4,
  weight: 1,
  quality: 0.95,
  generatedAt,
  provenance: "snapshot-1",
  ...overrides
});

const samples = Array.from({ length: 20 }, (_, index) => ({
  sampleId: `sample-${index}`,
  predictedProbability: index < 10 ? 0.7 : 0.8,
  outcome: index < 16 ? 1 : 0,
  predictedAt: "2026-07-12T00:00:00.000Z",
  outcomeAt: "2026-07-12T01:00:00.000Z"
}));

const baseInput = (overrides = {}) => ({
  marketState,
  features: [feature()],
  calibrationSamples: samples,
  generatedAt,
  modelVersion: "probability-v1",
  outcomeDefinition: "BTC closes higher after 5 minutes",
  minimumCalibrationSamples: 10,
  maximumUncertainty: 0.5,
  ...overrides
});

test("produces immutable calibrated probability with evidence and metrics", () => {
  const result = estimateProbability(baseInput());
  assert.equal(result.market, "BTC-USD");
  assert.equal(result.metrics.sampleSize, 20);
  assert.equal(result.abstain, false);
  assert.ok(result.rawProbability > 0.5);
  assert.ok(result.calibratedProbability >= 0 && result.calibratedProbability <= 1);
  assert.ok(result.metrics.brierScore >= 0);
  assert.ok(result.metrics.logLoss >= 0);
  assert.ok(result.metrics.reliability.length === 10);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.evidence));
  assert.ok(Object.isFrozen(result.metrics));
});

test("abstains when calibration evidence is insufficient", () => {
  const result = estimateProbability(baseInput({ calibrationSamples: samples.slice(0, 3) }));
  assert.equal(result.abstain, true);
  assert.ok(result.abstainReasons.includes("INSUFFICIENT_CALIBRATION_SAMPLES"));
});

test("abstains during liquidity stress", () => {
  const result = estimateProbability(baseInput({
    marketState: { ...marketState, regime: "LIQUIDITY_STRESS" }
  }));
  assert.equal(result.abstain, true);
  assert.ok(result.abstainReasons.includes("LIQUIDITY_STRESS"));
});

test("rejects duplicate feature identities", () => {
  assert.throws(
    () => estimateProbability(baseInput({ features: [feature(), feature()] })),
    /duplicate probability feature/
  );
});

test("rejects future feature timestamps", () => {
  assert.throws(
    () => estimateProbability(baseInput({
      features: [feature({ generatedAt: "2026-07-13T03:41:00.000Z" })]
    })),
    /cannot be generated in the future/
  );
});

test("does not use calibration outcomes that were unknown at evaluation time", () => {
  const result = estimateProbability(baseInput({
    calibrationSamples: [{
      sampleId: "future-outcome",
      predictedProbability: 0.9,
      outcome: 1,
      predictedAt: "2026-07-13T03:39:00.000Z",
      outcomeAt: "2026-07-13T04:00:00.000Z"
    }]
  }));
  assert.equal(result.metrics.sampleSize, 0);
  assert.equal(result.abstain, true);
});

test("rejects malformed or duplicated calibration samples", () => {
  assert.throws(
    () => estimateProbability(baseInput({ calibrationSamples: [samples[0], samples[0]] })),
    /duplicate calibration sample/
  );
  assert.throws(
    () => estimateProbability(baseInput({
      calibrationSamples: [{ ...samples[0], predictedProbability: 1.2 }]
    })),
    /must be between 0 and 1/
  );
});
