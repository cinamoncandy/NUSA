"use strict";
/**
 * Independent verification of a regime-analysis result (WO-0029). Deliberately does
 * NOT call scripts/lib/regime-analysis-runner.js's segment builder, attribution, or
 * assessment functions -- and deliberately does NOT call the production classifier
 * either. It re-derives the trailing-only trend/volatility labels from the raw candles
 * with its own arithmetic, so a bug in apps/desktop/src/strategy/marketRegime.ts could not hide
 * behind a verifier that simply asked that same module what the answer was.
 */
const { canonicalHash } = require("./canonical-hash.js");

/** Independent re-implementation of the trailing-only classifier. Mirrors the declared
 * contract (trailing log return over trendLookback; population stdev of trailing log
 * returns over volatilityLookback; warm-up -> UNKNOWN) without importing it. */
function reclassify(candles, classifier) {
  const labels = [];
  for (let index = 0; index < candles.length; index += 1) {
    const trendStart = index - classifier.trendLookback;
    const volatilityStart = index - classifier.volatilityLookback;
    const hasSamples = index >= classifier.minimumSamples;

    let trend = "UNKNOWN";
    if (trendStart >= 0 && hasSamples) {
      const trailingReturn = Math.log(candles[index].close / candles[trendStart].close);
      if (trailingReturn > classifier.trendThreshold) trend = "UP_TREND";
      else if (trailingReturn < -classifier.trendThreshold) trend = "DOWN_TREND";
      else trend = "RANGE";
    }

    let volatility = "UNKNOWN";
    if (volatilityStart >= 0 && hasSamples) {
      const returns = [];
      for (let i = volatilityStart + 1; i <= index; i += 1) returns.push(Math.log(candles[i].close / candles[i - 1].close));
      const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
      const realized = Math.sqrt(variance);
      if (realized < classifier.lowVolatilityThreshold) volatility = "LOW_VOLATILITY";
      else if (realized > classifier.highVolatilityThreshold) volatility = "HIGH_VOLATILITY";
      else volatility = "NORMAL_VOLATILITY";
    }

    labels.push(`${trend}|${volatility}`);
  }
  return labels;
}

function verifyRegimeAnalysisResult(request, result) {
  const errors = [];
  if (!result || result.status === undefined) { errors.push("result is missing a status field"); return { status: "FAIL", errors }; }
  if (result.status === "FAIL" && result.segments.length === 0) return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };

  const candles = request.candles;
  const labels = reclassify(candles, request.classifier);

  // Trailing-only proof: recomputing every label using ONLY candles at or before each
  // index reproduces the result's own recorded label hash. If the runner (or the
  // classifier it calls) had peeked at a future candle, this would diverge.
  const recomputedLabelsHash = canonicalHash(labels);
  if (result.hashes && recomputedLabelsHash !== result.hashes.labelsSha256) {
    errors.push("labelsSha256 mismatch: independently recomputed trailing-only labels do not match the recorded labels (possible look-ahead or altered labels)");
  }

  // Segment continuity: segments must tile the candle array exactly once, in order,
  // with no gap and no overlap, and each must be internally homogeneous.
  let expectedIndex = 0;
  for (const segment of result.segments) {
    if (segment.startIndex !== expectedIndex) errors.push(`segment ${segment.segmentId} starts at ${segment.startIndex}, expected ${expectedIndex} (gap or overlap)`);
    if (segment.endIndex < segment.startIndex) errors.push(`segment ${segment.segmentId} has an inverted range`);
    if (segment.candleCount !== segment.endIndex - segment.startIndex + 1) errors.push(`segment ${segment.segmentId} candleCount does not match its index range`);
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      if (labels[index] !== segment.key) { errors.push(`segment ${segment.segmentId} contains candle ${index} labeled ${labels[index]}, not ${segment.key}`); break; }
    }
    expectedIndex = segment.endIndex + 1;
  }
  if (result.segments.length > 0 && expectedIndex !== candles.length) errors.push(`segments cover ${expectedIndex} candles, expected ${candles.length}`);

  // Coverage recomputation.
  const unknownCount = labels.filter((label) => label.startsWith("UNKNOWN") || label.endsWith("UNKNOWN")).length;
  if (result.coverage && result.coverage.unknownCandles !== unknownCount) errors.push(`coverage.unknownCandles mismatch: recomputed ${unknownCount}, result reports ${result.coverage.unknownCandles}`);
  if (result.coverage && result.coverage.segmentCount !== result.segments.length) errors.push("coverage.segmentCount does not match the recorded segment array length");

  // Attribution uniqueness: per-regime trade counts and PnL must partition the total
  // exactly once. A trade counted in two regimes, or dropped, fails here.
  const totalAttributedTrades = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.tradeCount, 0);
  if (result.aggregate && totalAttributedTrades !== result.aggregate.totalTrades) {
    errors.push(`trade attribution is not a partition: regimes sum to ${totalAttributedTrades}, aggregate reports ${result.aggregate.totalTrades}`);
  }
  const totalAttributedPnL = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.netPnL, 0);
  if (result.aggregate && Math.abs(totalAttributedPnL - result.aggregate.totalNetPnL) > 1e-6) {
    errors.push(`PnL reconciliation failed: regimes sum to ${totalAttributedPnL}, aggregate reports ${result.aggregate.totalNetPnL}`);
  }
  const totalAttributedFees = result.regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.fees, 0);
  if (result.aggregate && Math.abs(totalAttributedFees - result.aggregate.totalFees) > 1e-6) {
    errors.push(`fee reconciliation failed: regimes sum to ${totalAttributedFees}, aggregate reports ${result.aggregate.totalFees}`);
  }

  // Rare-regime gate: any regime below a declared minimum must not carry a performance
  // verdict, and an UNKNOWN bucket must never be graded at all.
  for (const regime of result.regimes) {
    const base = regime.byCondition.BASE;
    if ((regime.trend === "UNKNOWN" || regime.volatility === "UNKNOWN") && regime.assessment !== "UNCLASSIFIED") {
      errors.push(`regime ${regime.key} contains an UNKNOWN dimension but was graded ${regime.assessment}`);
    }
    const belowGate = base.candleCount < request.minimumSample.candles || base.segmentCount < request.minimumSample.segments || base.tradeCount < request.minimumSample.trades;
    if (belowGate && !["INCONCLUSIVE", "UNCLASSIFIED"].includes(regime.assessment)) {
      errors.push(`regime ${regime.key} is below the declared minimum sample but was graded ${regime.assessment}`);
    }
    if (regime.assessment === "STRONG" && !(regime.byCondition.SEVERE.netPnL > 0)) {
      errors.push(`regime ${regime.key} is graded STRONG but does not survive the SEVERE cost condition`);
    }
    if (regime.assessment === "STRONG" && !(base.netPnL > 0)) {
      errors.push(`regime ${regime.key} is graded STRONG with non-positive BASE PnL`);
    }
  }

  // Cost-condition parity: the same three conditions must be recorded, monotonically.
  const byName = Object.fromEntries((result.costConditions ?? []).map((c) => [c.name, c]));
  if (byName.BASE && byName.MODERATE && (byName.MODERATE.feeRate < byName.BASE.feeRate || byName.MODERATE.slippageBps < byName.BASE.slippageBps)) errors.push("recorded costConditions.MODERATE is less stressful than BASE");
  if (byName.MODERATE && byName.SEVERE && (byName.SEVERE.feeRate < byName.MODERATE.feeRate || byName.SEVERE.slippageBps < byName.MODERATE.slippageBps)) errors.push("recorded costConditions.SEVERE is less stressful than MODERATE");

  // Transition ordering: transitions must be in strictly increasing boundary order and
  // each must sit exactly on a recorded segment start.
  const segmentStarts = new Set(result.segments.map((segment) => segment.startIndex));
  let previousBoundary = -1;
  for (const transition of result.transitions) {
    if (transition.boundaryIndex <= previousBoundary) errors.push(`transition at ${transition.boundaryIndex} is out of order`);
    if (!segmentStarts.has(transition.boundaryIndex)) errors.push(`transition at ${transition.boundaryIndex} does not fall on a segment boundary`);
    previousBoundary = transition.boundaryIndex;
  }
  if (result.segments.length > 1 && result.transitions.length !== result.segments.length - 1) {
    errors.push(`transition count ${result.transitions.length} does not match segment count ${result.segments.length} minus one`);
  }

  if (result.hashes) {
    const recomputedRequestHash = canonicalHash(request);
    if (recomputedRequestHash !== result.hashes.requestSha256) errors.push(`requestSha256 mismatch: recomputed ${recomputedRequestHash}, result reports ${result.hashes.requestSha256}`);
    if (canonicalHash(request.classifier) !== result.hashes.classificationConfigSha256) errors.push("classificationConfigSha256 mismatch");
    if (canonicalHash(result.segments) !== result.hashes.segmentsSha256) errors.push("segmentsSha256 mismatch (segments may have been altered after hashing)");
    if (canonicalHash(result.regimes) !== result.hashes.performanceSha256) errors.push("performanceSha256 mismatch (regime results may have been altered after hashing)");
    if (canonicalHash(result.aggregate) !== result.hashes.aggregateResultSha256) errors.push("aggregateResultSha256 mismatch (aggregate may have been altered after hashing)");
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyRegimeAnalysisResult, reclassify };
