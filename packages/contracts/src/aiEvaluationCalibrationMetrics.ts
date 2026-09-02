/**
 * Brier score, calibration error, and provider disagreement metrics for AI prediction evaluation
 * (WO-AI-011: Governed Longitudinal Held-Out Evaluation).
 *
 * A narrow slice of the larger planning-only work order. Closes only the "accuracy, Brier,
 * calibration error, abstention, disagreement, and faithfulness metrics" requirement (faithfulness
 * itself is out of scope here -- see aiExplanationFaithfulness.ts, which already covers it).
 * Every metric here operates only on a RESOLVED, realized outcome set -- it does not itself
 * decide inclusion/exclusion (that is aiEvaluationCohortAccounting.ts's and
 * aiEvaluationLineage.ts's job) -- and fails closed on malformed input (out-of-range
 * probabilities, non-binary outcomes, empty sets) rather than silently coercing bad data into a
 * number that looks like a real metric.
 */

export interface BinaryPrediction {
  readonly predictionId: string;
  /** Predicted probability of the positive outcome, in [0, 1]. */
  readonly predictedProbability: number;
  /** Realized outcome: 1 for the positive class, 0 for the negative class. */
  readonly realizedOutcome: 0 | 1;
}

export type MetricResult =
  | { readonly resolved: true; readonly value: number; readonly sampleSize: number }
  | { readonly resolved: false; readonly reason: "EMPTY_SET" | "INVALID_INPUT" | "DUPLICATE_PREDICTION_ID" };

function isValidProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function predictionsAreWellFormed(predictions: readonly BinaryPrediction[]): boolean {
  if (predictions.length === 0) return false;
  const seen = new Set<string>();
  for (const prediction of predictions) {
    if (seen.has(prediction.predictionId)) return false;
    seen.add(prediction.predictionId);
    if (!isValidProbability(prediction.predictedProbability)) return false;
    if (prediction.realizedOutcome !== 0 && prediction.realizedOutcome !== 1) return false;
  }
  return true;
}

/**
 * Mean squared error between predicted probability and realized binary outcome (lower is
 * better-calibrated/more-accurate; 0 is perfect). Fails closed on an empty set, an
 * out-of-[0,1]-range or non-finite probability, a non-binary realizedOutcome, or a duplicate
 * predictionId -- never silently clamping or dropping a malformed record.
 */
export function computeBrierScore(predictions: readonly BinaryPrediction[]): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!predictionsAreWellFormed(predictions)) {
    const seen = new Set<string>();
    for (const prediction of predictions) {
      if (seen.has(prediction.predictionId)) return { resolved: false, reason: "DUPLICATE_PREDICTION_ID" };
      seen.add(prediction.predictionId);
    }
    return { resolved: false, reason: "INVALID_INPUT" };
  }
  const sumSquaredError = predictions.reduce((sum, p) => sum + (p.predictedProbability - p.realizedOutcome) ** 2, 0);
  return { resolved: true, value: sumSquaredError / predictions.length, sampleSize: predictions.length };
}

/**
 * Expected Calibration Error (ECE): partitions predictions into `binCount` equal-width
 * probability bins, and returns the sample-size-weighted mean absolute gap between each bin's
 * average predicted probability and its average realized outcome rate. 0 is perfectly calibrated.
 * Bins with zero predictions do not contribute. Fails closed on the same malformed-input
 * conditions as computeBrierScore, plus a non-positive binCount.
 */
export function computeExpectedCalibrationError(predictions: readonly BinaryPrediction[], binCount: number): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  if (!Number.isSafeInteger(binCount) || binCount <= 0) return { resolved: false, reason: "INVALID_INPUT" };
  if (!predictionsAreWellFormed(predictions)) {
    const seen = new Set<string>();
    for (const prediction of predictions) {
      if (seen.has(prediction.predictionId)) return { resolved: false, reason: "DUPLICATE_PREDICTION_ID" };
      seen.add(prediction.predictionId);
    }
    return { resolved: false, reason: "INVALID_INPUT" };
  }

  const bins: { sumProb: number; sumOutcome: number; count: number }[] = Array.from({ length: binCount }, () => ({ sumProb: 0, sumOutcome: 0, count: 0 }));
  for (const prediction of predictions) {
    const binIndex = Math.min(binCount - 1, Math.floor(prediction.predictedProbability * binCount));
    bins[binIndex].sumProb += prediction.predictedProbability;
    bins[binIndex].sumOutcome += prediction.realizedOutcome;
    bins[binIndex].count += 1;
  }

  let weightedGap = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    weightedGap += (bin.count / predictions.length) * Math.abs(bin.sumProb / bin.count - bin.sumOutcome / bin.count);
  }

  return { resolved: true, value: weightedGap, sampleSize: predictions.length };
}

export interface MultiProviderPrediction {
  readonly predictionId: string;
  /** One classification/decision per participating provider for this same prediction. */
  readonly providerDecisions: readonly string[];
}

/**
 * Fraction of predictions where the participating providers did not unanimously agree on the
 * same decision. Fails closed on an empty set, a prediction with fewer than two provider
 * decisions (disagreement is undefined for a single provider), or a duplicate predictionId.
 */
export function computeDisagreementRate(predictions: readonly MultiProviderPrediction[]): MetricResult {
  if (predictions.length === 0) return { resolved: false, reason: "EMPTY_SET" };
  const seen = new Set<string>();
  for (const prediction of predictions) {
    if (seen.has(prediction.predictionId)) return { resolved: false, reason: "DUPLICATE_PREDICTION_ID" };
    seen.add(prediction.predictionId);
    if (prediction.providerDecisions.length < 2) return { resolved: false, reason: "INVALID_INPUT" };
  }
  const disagreementCount = predictions.filter((p) => new Set(p.providerDecisions).size > 1).length;
  return { resolved: true, value: disagreementCount / predictions.length, sampleSize: predictions.length };
}
