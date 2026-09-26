"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ResidualAlphaCombinerError,
  combineResidualAlphaSignals,
} = require("../dist/packages/core/src/residualAlphaCombiner.js");

function histories(length = 30) {
  const duplicateA = Array.from({ length }, (_, index) =>
    Math.sin(index * 0.71) * 0.01 + (index >= length - 8 ? 0.004 : 0),
  );
  const independent = Array.from({ length }, (_, index) =>
    Math.cos(index * 1.17) * 0.008 + (index >= length - 8 ? -0.003 : 0),
  );
  return {
    duplicateA,
    duplicateB: [...duplicateA],
    independent,
  };
}

const researchConfig = {
  lookback: 30,
  estimationWindow: 8,
  minimumObservations: 10,
  ridgePenalty: 1,
  volatilityFloor: 1e-8,
};

test("residual alpha combiner uses only returns before asOfExclusive", () => {
  const base = histories();
  const futureContaminated = Object.fromEntries(
    Object.entries(base).map(([id, values], signalIndex) => [
      id,
      [...values, 1_000_000 * (signalIndex + 1), -1_000_000 * (signalIndex + 1)],
    ]),
  );
  const input = {
    returnsBySignal: base,
    currentSignals: { duplicateA: 0.7, duplicateB: 0.7, independent: -0.4 },
    asOfExclusive: 30,
  };
  const baseline = combineResidualAlphaSignals(input, researchConfig);
  const withFutureData = combineResidualAlphaSignals(
    { ...input, returnsBySignal: futureContaminated },
    researchConfig,
  );

  assert.deepEqual(withFutureData, baseline);
  assert.equal(baseline.mode, "PAPER_ONLY");
});

test("ridge residualization suppresses duplicated strategy information", () => {
  const result = combineResidualAlphaSignals(
    {
      returnsBySignal: histories(),
      currentSignals: { duplicateA: 1, duplicateB: 1, independent: 1 },
      asOfExclusive: 30,
    },
    researchConfig,
  );

  assert.equal(result.status, "READY");
  assert.ok(result.diagnostics.duplicateA.residualRms < result.diagnostics.independent.residualRms);
  assert.ok(result.diagnostics.duplicateB.residualRms < result.diagnostics.independent.residualRms);
  assert.ok(result.diagnostics.duplicateA.residualRms < 0.1);
});

test("weights are inverse-volatility residual-alpha proportions with unit gross weight", () => {
  const result = combineResidualAlphaSignals(
    {
      returnsBySignal: histories(),
      currentSignals: { duplicateA: 0.8, duplicateB: -0.2, independent: 0.4 },
      asOfExclusive: 30,
    },
    researchConfig,
  );

  assert.equal(result.status, "READY");
  const gross = Object.values(result.weights).reduce((sum, weight) => sum + Math.abs(weight), 0);
  assert.ok(Math.abs(gross - 1) < 1e-12);
  const recombined = Object.entries(result.weights).reduce(
    (sum, [id, weight]) => sum + weight * { duplicateA: 0.8, duplicateB: -0.2, independent: 0.4 }[id],
    0,
  );
  assert.ok(Math.abs(result.combinedSignal - recombined) < 1e-12);
});

test("near-zero-volatility strategies are excluded instead of receiving explosive weights", () => {
  const base = histories();
  const result = combineResidualAlphaSignals(
    {
      returnsBySignal: { ...base, constant: Array.from({ length: 30 }, () => 0.01) },
      currentSignals: { duplicateA: 0.4, duplicateB: 0.3, independent: -0.2, constant: 1 },
      asOfExclusive: 30,
    },
    researchConfig,
  );

  assert.equal(result.status, "READY");
  assert.equal(result.diagnostics.constant.active, false);
  assert.equal(result.weights.constant, 0);
});

test("thin history fails closed with zero combined signal", () => {
  const short = histories(6);
  const result = combineResidualAlphaSignals(
    {
      returnsBySignal: short,
      currentSignals: { duplicateA: 1, duplicateB: 1, independent: 1 },
      asOfExclusive: 6,
    },
    researchConfig,
  );

  assert.equal(result.status, "INSUFFICIENT_HISTORY");
  assert.equal(result.combinedSignal, 0);
  assert.deepEqual(result.weights, { duplicateA: 0, duplicateB: 0, independent: 0 });
});

test("regularization remains defined when signal count exceeds observation count", () => {
  const length = 6;
  const returnsBySignal = Object.fromEntries(
    Array.from({ length: 10 }, (_, signalIndex) => [
      `signal${signalIndex}`,
      Array.from({ length }, (_, index) =>
        Math.sin(index * 0.7 + signalIndex * 0.23) * 0.01 + (index >= 4 ? signalIndex * 0.0002 : 0),
      ),
    ]),
  );
  const currentSignals = Object.fromEntries(
    Array.from({ length: 10 }, (_, signalIndex) => [`signal${signalIndex}`, signalIndex / 10]),
  );
  const result = combineResidualAlphaSignals(
    { returnsBySignal, currentSignals, asOfExclusive: length },
    { ...researchConfig, lookback: 6, estimationWindow: 3, minimumObservations: 4 },
  );

  assert.equal(result.status, "READY");
  assert.ok(Number.isFinite(result.combinedSignal));
});

test("invalid chronology and non-finite inputs are rejected", () => {
  const base = histories();
  assert.throws(
    () =>
      combineResidualAlphaSignals(
        {
          returnsBySignal: base,
          currentSignals: { duplicateA: 1, duplicateB: 1, independent: 1 },
          asOfExclusive: 31,
        },
        researchConfig,
      ),
    (error) => error instanceof ResidualAlphaCombinerError && error.code === "INVALID_AS_OF",
  );

  assert.throws(
    () =>
      combineResidualAlphaSignals(
        {
          returnsBySignal: base,
          currentSignals: { duplicateA: Number.NaN, duplicateB: 1, independent: 1 },
          asOfExclusive: 30,
        },
        researchConfig,
      ),
    (error) => error instanceof ResidualAlphaCombinerError && error.code === "NON_FINITE_SIGNAL",
  );
});
