import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBrierScore, computeExpectedCalibrationError, computeDisagreementRate } from "./aiEvaluationCalibrationMetrics";
describe("calibration metrics", () => {
  it("computes Brier score", () => assert.deepEqual(computeBrierScore([{ predictionId:"p1", predictedProbability:1, realizedOutcome:1 },{ predictionId:"p2", predictedProbability:0, realizedOutcome:0 }]), { resolved:true, value:0, sampleSize:2 }));
  it("fails closed on malformed probability", () => assert.deepEqual(computeBrierScore([{ predictionId:"p1", predictedProbability:2, realizedOutcome:1 }]), { resolved:false, reason:"INVALID_INPUT" }));
  it("computes ECE", () => assert.equal(computeExpectedCalibrationError([{ predictionId:"p1", predictedProbability:.5, realizedOutcome:1 },{ predictionId:"p2", predictedProbability:.5, realizedOutcome:0 }], 10).resolved, true));
  it("computes disagreement", () => assert.deepEqual(computeDisagreementRate([{ predictionId:"p1", providerDecisions:["BUY","SELL"] }]), { resolved:true, value:1, sampleSize:1 }));
});
