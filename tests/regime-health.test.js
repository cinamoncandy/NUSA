"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assessRegimeHealth, RegimeHealthError } = require("../dist/apps/desktop/src/cloud/regimeHealth.js");

function frame({ breadth = 0.75, medianReturn = 0.08, medianVol = 0.02, drawdowns = [-0.04, -0.05], dispersion = 0.03 } = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-26T00:00:00.000Z",
    lookbackPeriods: 20,
    markets: drawdowns.map((maxDrawdown, index) => ({
      market: `M${index}`,
      interval: "1d",
      datasetId: `dataset-${index}`,
      asOf: 1000 + index,
      lastClose: 100,
      onePeriodReturn: 0,
      lookbackReturn: medianReturn,
      realizedVolatility: medianVol,
      maxDrawdown,
      averageVolume: 1,
    })),
    aggregate: {
      marketCount: drawdowns.length,
      positiveBreadth: breadth,
      medianLookbackReturn: medianReturn,
      medianRealizedVolatility: medianVol,
      crossSectionalDispersion: dispersion,
    },
    sourceDatasetIds: drawdowns.map((_, index) => `dataset-${index}`),
  };
}

test("healthy regime requires broad positive participation", () => {
  const result = assessRegimeHealth(frame());
  assert.equal(result.state, "HEALTHY");
  assert.ok(result.score > 0.5);
  assert.deepEqual(result.reasons, ["BROAD_POSITIVE_PARTICIPATION"]);
});

test("stressed regime requires multiple independent stress votes", () => {
  const result = assessRegimeHealth(frame({ breadth: 0.2, medianReturn: -0.08, medianVol: 0.06, drawdowns: [-0.2, -0.16] }));
  assert.equal(result.state, "STRESSED");
  assert.ok(result.reasons.includes("BREADTH_STRESS"));
  assert.ok(result.reasons.includes("RETURN_STRESS"));
  assert.ok(result.reasons.includes("DRAWDOWN_STRESS"));
  assert.ok(result.reasons.includes("VOLATILITY_STRESS"));
});

test("conflicting evidence remains mixed rather than forcing a regime", () => {
  const result = assessRegimeHealth(frame({ breadth: 0.5, medianReturn: 0.01, medianVol: 0.02, drawdowns: [-0.04, -0.05] }));
  assert.equal(result.state, "MIXED");
  assert.deepEqual(result.reasons, ["CONFLICTING_MARKET_EVIDENCE"]);
});

test("assessment fails closed on inconsistent frame evidence", () => {
  const bad = frame();
  bad.aggregate.marketCount = 99;
  assert.throws(() => assessRegimeHealth(bad), error => error instanceof RegimeHealthError && error.code === "MARKET_COUNT_MISMATCH");
});
