"use strict";
/**
 * Independent verification of a Walk-Forward result (WO-0027). Deliberately does NOT
 * call scripts/lib/walk-forward-runner.js's window-plan, aggregate, or hash-input
 * builders -- every check here is re-derived from the raw request and the result's
 * own recorded numbers, using separate arithmetic, so a bug in the runner cannot also
 * be baked into its own verifier.
 */
const { canonicalHash } = require("./canonical-hash.js");

function rebuildBoundaries(candles, windows) {
  const { trainingCandles, validationCandles, testCandles, stepCandles } = windows;
  const boundaries = [];
  let base = 0;
  while (true) {
    const trainingStartIndex = base;
    const trainingEndIndex = trainingStartIndex + trainingCandles - 1;
    const hasValidation = validationCandles > 0;
    const validationStartIndex = hasValidation ? trainingEndIndex + 1 : null;
    const validationEndIndex = hasValidation ? validationStartIndex + validationCandles - 1 : null;
    const testStartIndex = hasValidation ? validationEndIndex + 1 : trainingEndIndex + 1;
    const testEndIndex = testStartIndex + testCandles - 1;
    if (testEndIndex >= candles.length) break;
    boundaries.push({ trainingStartIndex, trainingEndIndex, validationStartIndex, validationEndIndex, testStartIndex, testEndIndex });
    base += stepCandles;
  }
  return boundaries;
}

function verifyWalkForwardResult(request, result) {
  const errors = [];

  if (!result || result.status === undefined) { errors.push("result is missing a status field"); return { status: "FAIL", errors }; }
  if (result.status === "FAIL" && result.windows.length === 0) return { status: "PASS", errors: [], note: "request-level validation failure; nothing further to verify" };

  const candles = request.candles;
  const boundaries = rebuildBoundaries(candles, request.windows);
  if (boundaries.length !== result.windowPlan.totalWindows) errors.push(`window count mismatch: independently derived ${boundaries.length}, result reports ${result.windowPlan.totalWindows}`);

  for (let index = 0; index < boundaries.length; index += 1) {
    const expected = boundaries[index];
    const actual = result.windows[index]?.boundaries;
    if (!actual) { errors.push(`missing window at index ${index}`); continue; }
    for (const key of ["trainingStartIndex", "trainingEndIndex", "validationStartIndex", "validationEndIndex", "testStartIndex", "testEndIndex"]) {
      if (expected[key] !== actual[key]) errors.push(`window ${index} boundary ${key} mismatch: expected ${expected[key]}, got ${actual[key]}`);
    }
    // No-overlap invariant, checked independently of how the runner derived indices.
    if (actual.validationStartIndex != null && actual.validationStartIndex <= actual.trainingEndIndex) errors.push(`window ${index}: validation overlaps training`);
    if (actual.testStartIndex <= actual.trainingEndIndex) errors.push(`window ${index}: test overlaps training`);
    if (actual.validationEndIndex != null && actual.testStartIndex <= actual.validationEndIndex) errors.push(`window ${index}: test overlaps validation`);
  }

  // Parameter grid completeness: every selected parameter must actually be a member of
  // the declared, canonically-sorted parameter grid (guards against a corrupted result
  // claiming a selection that was never a candidate).
  const gridKeys = new Set(request.parameterGrid.map((p) => `${p.shortWindow}/${p.longWindow}`));
  for (const window of result.windows) {
    if (window.status !== "PASS") continue;
    const key = `${window.selectedParameter.shortWindow}/${window.selectedParameter.longWindow}`;
    if (!gridKeys.has(key)) errors.push(`window ${window.index}: selected parameter ${key} is not in the declared parameterGrid`);
    // Re-derive the tie-break winner independently from the window's own recorded
    // candidateEvaluations and confirm no eligible candidate scores strictly higher.
    const eligible = window.candidateEvaluations.filter((c) => c.eligible);
    const bestScore = Math.max(...eligible.map((c) => c.score));
    const selectedScore = eligible.find((c) => c.shortWindow === window.selectedParameter.shortWindow && c.longWindow === window.selectedParameter.longWindow)?.score;
    if (window.validation == null && selectedScore != null && selectedScore < bestScore - 1e-9) {
      errors.push(`window ${window.index}: a higher-scoring eligible candidate (${bestScore}) was not selected (selected score ${selectedScore}) though no validation window was configured`);
    }
  }

  // Independent aggregate compounding recomputation (separate loop, separate formula
  // construction from the runner's compoundedSequence, though the underlying math is
  // necessarily the same product-of-(1+r) definition -- what matters is that it is
  // recomputed from the per-window recorded returns, not copied from result.aggregate).
  const passed = result.windows.filter((w) => w.status === "PASS");
  let multiplier = 1;
  for (const window of passed) multiplier *= (1 + window.test.summary.totalReturn);
  const recomputedCompoundedReturn = multiplier - 1;
  if (Math.abs(recomputedCompoundedReturn - result.aggregate.compoundedOosReturn) > 1e-9) {
    errors.push(`aggregate compoundedOosReturn mismatch: recomputed ${recomputedCompoundedReturn}, result reports ${result.aggregate.compoundedOosReturn}`);
  }

  const profitable = passed.filter((w) => w.test.summary.totalReturn > 0).length;
  if (profitable !== result.aggregate.profitableTestWindows) errors.push(`profitableTestWindows mismatch: recomputed ${profitable}, result reports ${result.aggregate.profitableTestWindows}`);

  const totalFees = passed.reduce((sum, w) => sum + w.test.summary.fees, 0);
  if (Math.abs(totalFees - result.aggregate.totalFees) > 1e-6) errors.push(`totalFees mismatch: recomputed ${totalFees}, result reports ${result.aggregate.totalFees}`);

  const totalTrades = passed.reduce((sum, w) => sum + w.test.summary.tradeCount, 0);
  if (totalTrades !== result.aggregate.totalTrades) errors.push(`totalTrades mismatch: recomputed ${totalTrades}, result reports ${result.aggregate.totalTrades}`);

  // Benchmark parity: buy-and-hold must be the same compounding formula applied to
  // each window's own benchmarkReturn field.
  let benchmarkMultiplier = 1;
  for (const window of passed) benchmarkMultiplier *= (1 + window.test.summary.benchmarkReturn);
  const recomputedBenchmark = benchmarkMultiplier - 1;
  if (Math.abs(recomputedBenchmark - result.benchmarks.buyAndHold.compoundedReturn) > 1e-9) errors.push(`buyAndHold benchmark mismatch: recomputed ${recomputedBenchmark}, result reports ${result.benchmarks.buyAndHold.compoundedReturn}`);

  // Hash re-verification.
  if (result.hashes) {
    const recomputedRequestHash = canonicalHash(request);
    if (recomputedRequestHash !== result.hashes.requestSha256) errors.push(`requestSha256 mismatch: recomputed ${recomputedRequestHash}, result reports ${result.hashes.requestSha256}`);
    const recomputedGridHash = canonicalHash(result.parameterGrid);
    if (recomputedGridHash !== result.hashes.candidateGridSha256) errors.push(`candidateGridSha256 mismatch`);
    const recomputedAggregateHash = canonicalHash(result.aggregate);
    if (recomputedAggregateHash !== result.hashes.aggregateResultSha256) errors.push(`aggregateResultSha256 mismatch (result.aggregate may have been altered after hashing)`);
    for (const window of result.windows) {
      if (window.status !== "PASS") continue;
      if (canonicalHash(window.training.summary) !== window.hashes.trainingResultSha256) errors.push(`window ${window.index}: trainingResultSha256 mismatch (altered training summary)`);
      if (canonicalHash(window.test.summary) !== window.hashes.testResultSha256) errors.push(`window ${window.index}: testResultSha256 mismatch (altered test summary)`);
    }
  } else {
    errors.push("result.hashes is missing");
  }

  return { status: errors.length === 0 ? "PASS" : "FAIL", errors };
}

module.exports = { verifyWalkForwardResult, rebuildBoundaries };
