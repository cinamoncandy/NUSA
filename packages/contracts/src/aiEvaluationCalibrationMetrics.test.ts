import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeBrierScore, computeExpectedCalibrationError, computeDisagreementRate,
  type BinaryPrediction, type MultiProviderPrediction,
} from "./aiEvaluationCalibrationMetrics";

describe("computeBrierScore", () => {
  it("is 0 for perfectly confident, perfectly correct predictions", () => {
    const predictions: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 1, realizedOutcome: 1 },
      { predictionId: "p2", predictedProbability: 0, realizedOutcome: 0 },
    ];
    const result = computeBrierScore(predictions);
    assert.deepEqual(result, { resolved: true, value: 0, sampleSize: 2 });
  });

  it("is 1 for perfectly confident, perfectly wrong predictions (worst case)", () => {
    const predictions: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 1, realizedOutcome: 0 },
      { predictionId: "p2", predictedProbability: 0, realizedOutcome: 1 },
    ];
    const result = computeBrierScore(predictions);
    assert.deepEqual(result, { resolved: true, value: 1, sampleSize: 2 });
  });

  it("computes the mean squared error for a mixed set", () => {
    const predictions: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 0.5, realizedOutcome: 1 }, // (0.5)^2 = 0.25
      { predictionId: "p2", predictedProbability: 0.5, realizedOutcome: 0 }, // (0.5)^2 = 0.25
    ];
    const result = computeBrierScore(predictions);
    assert.equal((result as { value: number }).value, 0.25);
  });

  it("fails closed on an empty set", () => {
    assert.deepEqual(computeBrierScore([]), { resolved: false, reason: "EMPTY_SET" });
  });

  it("fails closed on an out-of-range probability", () => {
    const invalid: readonly BinaryPrediction[] = [{ predictionId: "p1", predictedProbability: 1.5, realizedOutcome: 1 }];
    assert.deepEqual(computeBrierScore(invalid), { resolved: false, reason: "INVALID_INPUT" });
  });

  it("fails closed on a non-finite probability", () => {
    const invalid: readonly BinaryPrediction[] = [{ predictionId: "p1", predictedProbability: Number.NaN, realizedOutcome: 1 }];
    assert.deepEqual(computeBrierScore(invalid), { resolved: false, reason: "INVALID_INPUT" });
  });

  it("fails closed on a duplicate predictionId", () => {
    const duplicate: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 0.5, realizedOutcome: 1 },
      { predictionId: "p1", predictedProbability: 0.6, realizedOutcome: 0 },
    ];
    assert.deepEqual(computeBrierScore(duplicate), { resolved: false, reason: "DUPLICATE_PREDICTION_ID" });
  });
});

describe("computeExpectedCalibrationError", () => {
  it("is 0 for a perfectly calibrated set", () => {
    // 4 predictions at p=0.5, exactly 2 realized positive -> bin average matches outcome rate
    const predictions: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 0.5, realizedOutcome: 1 },
      { predictionId: "p2", predictedProbability: 0.5, realizedOutcome: 1 },
      { predictionId: "p3", predictedProbability: 0.5, realizedOutcome: 0 },
      { predictionId: "p4", predictedProbability: 0.5, realizedOutcome: 0 },
    ];
    const result = computeExpectedCalibrationError(predictions, 10);
    assert.equal((result as { value: number }).value, 0);
  });

  it("is positive for a miscalibrated set (overconfident predictions)", () => {
    const predictions: readonly BinaryPrediction[] = [
      { predictionId: "p1", predictedProbability: 0.9, realizedOutcome: 0 },
      { predictionId: "p2", predictedProbability: 0.9, realizedOutcome: 0 },
    ];
    const result = computeExpectedCalibrationError(predictions, 10);
    assert.ok((result as { value: number }).value > 0.8);
  });

  it("fails closed on an empty set", () => {
    assert.deepEqual(computeExpectedCalibrationError([], 10), { resolved: false, reason: "EMPTY_SET" });
  });

  it("fails closed on a non-positive binCount", () => {
    const predictions: readonly BinaryPrediction[] = [{ predictionId: "p1", predictedProbability: 0.5, realizedOutcome: 1 }];
    assert.deepEqual(computeExpectedCalibrationError(predictions, 0), { resolved: false, reason: "INVALID_INPUT" });
  });

  it("fails closed on a non-binary realizedOutcome-equivalent malformed probability", () => {
    const invalid: readonly BinaryPrediction[] = [{ predictionId: "p1", predictedProbability: -0.1, realizedOutcome: 1 }];
    assert.deepEqual(computeExpectedCalibrationError(invalid, 10), { resolved: false, reason: "INVALID_INPUT" });
  });
});

describe("computeDisagreementRate", () => {
  it("is 0 when every prediction's providers unanimously agree", () => {
    const predictions: readonly MultiProviderPrediction[] = [
      { predictionId: "p1", providerDecisions: ["BUY", "BUY", "BUY"] },
      { predictionId: "p2", providerDecisions: ["SELL", "SELL"] },
    ];
    assert.deepEqual(computeDisagreementRate(predictions), { resolved: true, value: 0, sampleSize: 2 });
  });

  it("counts a prediction as disagreement when providers differ", () => {
    const predictions: readonly MultiProviderPrediction[] = [
      { predictionId: "p1", providerDecisions: ["BUY", "SELL"] },
      { predictionId: "p2", providerDecisions: ["SELL", "SELL"] },
    ];
    const result = computeDisagreementRate(predictions);
    assert.equal((result as { value: number }).value, 0.5);
  });

  it("fails closed on an empty set", () => {
    assert.deepEqual(computeDisagreementRate([]), { resolved: false, reason: "EMPTY_SET" });
  });

  it("fails closed on a prediction with fewer than two provider decisions", () => {
    const invalid: readonly MultiProviderPrediction[] = [{ predictionId: "p1", providerDecisions: ["BUY"] }];
    assert.deepEqual(computeDisagreementRate(invalid), { resolved: false, reason: "INVALID_INPUT" });
  });

  it("fails closed on a duplicate predictionId", () => {
    const duplicate: readonly MultiProviderPrediction[] = [
      { predictionId: "p1", providerDecisions: ["BUY", "BUY"] },
      { predictionId: "p1", providerDecisions: ["SELL", "SELL"] },
    ];
    assert.deepEqual(computeDisagreementRate(duplicate), { resolved: false, reason: "DUPLICATE_PREDICTION_ID" });
  });
});
