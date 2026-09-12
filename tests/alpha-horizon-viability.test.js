"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateHorizonViability, roundTripRate,
  UPBIT_KRW_SPOT_ROUND_TRIP, UPBIT_MAJOR_HORIZON_FLOOR_HOURS
} = require("../dist/apps/cloud/src/alpha/horizonViability.js");

/**
 * The order-book imbalance alpha was built, tested, frozen and never asked whether its horizon
 * could pay a round trip. It could not: it holds for seconds, and seconds do not move 0.17%.
 * These lock the arithmetic in place so the next strategy cannot skip it.
 */

const measured = (horizonHours, medianPercent, quietPercent) => ({
  horizonHours,
  medianAbsoluteMoveRate: medianPercent / 100,
  quietQuartileMoveRate: quietPercent / 100,
  sampleDescription: "2000 hourly candles, KRW majors, 2026-06-18..2026-09-10"
});

test("a round trip is fees twice, slippage twice, and the spread once", () => {
  // The spread is paid once per round trip -- bought at the ask, sold at the bid -- and hides
  // inside gross PnL rather than in the fee or slippage column.
  assert.equal(roundTripRate(UPBIT_KRW_SPOT_ROUND_TRIP), 0.00032 + 0.0005 * 2 + 0.0002 * 2);
  assert.ok(Math.abs(roundTripRate(UPBIT_KRW_SPOT_ROUND_TRIP) - 0.00172) < 1e-9);
});

test("an unmeasured horizon never passes", () => {
  // A strategy whose economics nobody checked is precisely the case this guard exists for.
  assert.equal(evaluateHorizonViability(undefined).verdict, "UNMEASURED");
  assert.equal(evaluateHorizonViability({ horizonHours: 8, sampleDescription: "" }).verdict, "UNMEASURED");
  assert.equal(evaluateHorizonViability({ ...measured(8, 0.45, 0.2), medianAbsoluteMoveRate: Number.NaN }).verdict, "UNMEASURED");
  assert.equal(evaluateHorizonViability({ ...measured(8, 0.45, 0.2), horizonHours: 0 }).verdict, "UNMEASURED");
});

test("the horizon the order-book strategy actually held is refused outright", () => {
  // ~25 seconds. Measured median absolute move on BTC over that interval was 0.014%.
  const decision = evaluateHorizonViability(measured(25 / 3600, 0.014, 0.004));
  assert.equal(decision.verdict, "COST_EXCEEDS_MOVEMENT");
  assert.match(decision.reason, /perfect direction-caller would still lose/);
});

test("the measured BTC curve reproduces the eight-hour floor", () => {
  assert.equal(evaluateHorizonViability(measured(1, 0.158, 0.071)).verdict, "COST_EXCEEDS_MOVEMENT");
  assert.equal(evaluateHorizonViability(measured(2, 0.222, 0.102)).verdict, "MEDIAN_ONLY");
  assert.equal(evaluateHorizonViability(measured(4, 0.302, 0.135)).verdict, "MEDIAN_ONLY");
  assert.equal(evaluateHorizonViability(measured(8, 0.446, 0.202)).verdict, "VIABLE");
  assert.equal(evaluateHorizonViability(measured(24, 0.815, 0.357)).verdict, "VIABLE");
  assert.equal(UPBIT_MAJOR_HORIZON_FLOOR_HOURS, 8);
});

test("surviving the median is not surviving the quiet quarter", () => {
  // Sizing to the median leaves a strategy underwater through the quarter that is ordinary.
  const decision = evaluateHorizonViability(measured(4, 0.302, 0.135));
  assert.equal(decision.verdict, "MEDIAN_ONLY");
  assert.ok(decision.costToQuietMoveRatio > 1);
});

test("an incoherent measurement is a fault, not a verdict", () => {
  assert.throws(() => evaluateHorizonViability(measured(8, 0.2, 0.5)), /quiet-quartile movement cannot exceed the median/);
  assert.throws(() => roundTripRate({ spreadRate: -1, perLegFeeRate: 0.0005, perLegSlippageRate: 0.0002 }), /non-negative/);
});
