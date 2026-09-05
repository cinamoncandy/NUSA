"use strict";
/**
 * Deterministic Walk-Forward validation runner (WO-0027).
 *
 * SCOPE NOTE (read before touching this file): the literal WO-0027 spec asked for a
 * brand-new MarketCandle contract, a HistoricalDatasetDescriptor with separate
 * source/normalized SHA-256 hashes, and a purpose-built candle-native BacktestEngine.
 * None of that exists in this repository (verified by direct grep before starting this
 * work; WO-0023 through WO-0026 were never implemented under those names). Rather than
 * inventing a parallel, untested contract stack, this runner reuses the REAL, already
 * tested, deterministic production modules that exist today:
 *
 *   - apps/desktop/src/cloud/researchDataset.ts  (candle validation + single contentSha256)
 *   - apps/desktop/src/strategy/backtestEngine.ts   (runBacktest: real PaperBroker + StrategyEngine)
 *   - apps/desktop/src/strategy/strategyEngine.ts   (SmaCrossoverStrategy, configurable periods)
 *
 * Consequences that must be disclosed, not hidden:
 *   - There is a single dataset content hash, not a source/normalized pair.
 *   - runBacktest() fills at the SAME candle's close (adjusted by spread/slippage), not
 *     at the next candle's open. This is a real, deterministic, cost-adjusted execution
 *     model, but it is NOT literally "next-candle execution" -- `execution.latencyCandles`
 *     is therefore only accepted as 0 and rejected otherwise, rather than silently ignored.
 *   - Only rolling windows are supported (anchored is explicitly out of scope, matching
 *     the WO's own "초기 구현은 rolling window 하나만 지원" recommendation).
 *   - Only one selection metric (RETURN_OVER_DRAWDOWN) is implemented.
 *
 * This module never bypasses PaperBroker and never reimplements a mini broker: every
 * candidate is evaluated through the real runBacktest() function.
 */
const path = require("node:path");
const { canonicalHash } = require("./canonical-hash.js");

const MIN_CANDIDATES = 4;
const MAX_CANDIDATES = 12;
const VALIDATION_SHORTLIST_SIZE = 3;

function loadProductionModules(repositoryRoot) {
  const distRoot = path.join(repositoryRoot, "dist", "apps", "desktop", "src");
  return {
    researchDataset: require(path.join(distRoot, "cloud", "researchDataset.js")),
    backtestEngine: require(path.join(distRoot, "strategy", "backtestEngine.js")),
    strategyEngine: require(path.join(distRoot, "strategy", "strategyEngine.js"))
  };
}

function isPositiveInteger(value) { return Number.isInteger(value) && value > 0; }
function isNonNegativeInteger(value) { return Number.isInteger(value) && value >= 0; }

function validateRequest(request, modules) {
  const errors = [];
  if (request == null || typeof request !== "object") { errors.push("request must be an object"); return errors; }
  if (request.schemaVersion !== 1) errors.push(`unsupported schemaVersion: ${request.schemaVersion}`);
  if (typeof request.id !== "string" || request.id.length === 0) errors.push("request.id must be a non-empty string");
  if (typeof request.market !== "string" || request.market.length === 0) errors.push("request.market must be a non-empty string");

  if (!Array.isArray(request.candles) || request.candles.length === 0) {
    errors.push("request.candles must be a non-empty array");
  } else {
    try { modules.researchDataset.validateResearchCandles(request.candles, { allowMissing: false }); }
    catch (error) { errors.push(`candles failed validation: ${error instanceof Error ? error.message : String(error)}`); }
  }

  const windows = request.windows ?? {};
  if (!isPositiveInteger(windows.trainingCandles)) errors.push("windows.trainingCandles must be a positive integer");
  if (!isNonNegativeInteger(windows.validationCandles)) errors.push("windows.validationCandles must be a non-negative integer");
  if (!isPositiveInteger(windows.testCandles)) errors.push("windows.testCandles must be a positive integer");
  if (!isPositiveInteger(windows.stepCandles)) errors.push("windows.stepCandles must be a positive integer");
  if (isPositiveInteger(windows.stepCandles) && isPositiveInteger(windows.testCandles) && windows.stepCandles < windows.testCandles) {
    errors.push("windows.stepCandles must not be smaller than windows.testCandles (it would overlap test windows)");
  }

  const grid = request.parameterGrid;
  if (!Array.isArray(grid) || grid.length < MIN_CANDIDATES || grid.length > MAX_CANDIDATES) {
    errors.push(`parameterGrid must contain between ${MIN_CANDIDATES} and ${MAX_CANDIDATES} candidates`);
  } else {
    const seen = new Set();
    for (const candidate of grid) {
      if (!isPositiveInteger(candidate?.shortWindow)) { errors.push("every parameterGrid entry needs a positive integer shortWindow"); continue; }
      if (!isPositiveInteger(candidate?.longWindow) || candidate.longWindow <= candidate.shortWindow) { errors.push(`parameterGrid entry ${candidate.shortWindow}/${candidate.longWindow} must have longWindow > shortWindow`); continue; }
      if (isPositiveInteger(windows.trainingCandles) && candidate.longWindow >= windows.trainingCandles) errors.push(`parameterGrid entry ${candidate.shortWindow}/${candidate.longWindow}: longWindow must be smaller than windows.trainingCandles`);
      const key = `${candidate.shortWindow}/${candidate.longWindow}`;
      if (seen.has(key)) errors.push(`duplicate parameterGrid tuple: ${key}`);
      seen.add(key);
    }
  }

  if (request.selectionMetric !== "RETURN_OVER_DRAWDOWN") errors.push(`unsupported selectionMetric: ${request.selectionMetric} (only RETURN_OVER_DRAWDOWN is implemented)`);
  if (!isNonNegativeInteger(request.minimumTrades)) errors.push("request.minimumTrades must be a non-negative integer");

  const execution = request.execution ?? {};
  if (!Number.isFinite(execution.initialCash) || execution.initialCash <= 0) errors.push("execution.initialCash must be a positive finite number");
  if (!Number.isFinite(execution.feeRate) || execution.feeRate < 0) errors.push("execution.feeRate must be a non-negative finite number");
  if (execution.latencyCandles !== undefined && execution.latencyCandles !== 0) errors.push("execution.latencyCandles must be 0 (next-candle latency is not supported by the reused BacktestEngine; see file header)");
  const costs = execution.executionCosts ?? {};
  if (costs.spreadBps !== undefined && (!Number.isFinite(costs.spreadBps) || costs.spreadBps < 0)) errors.push("execution.executionCosts.spreadBps must be a non-negative finite number");
  if (costs.slippageBps !== undefined && (!Number.isFinite(costs.slippageBps) || costs.slippageBps < 0)) errors.push("execution.executionCosts.slippageBps must be a non-negative finite number");

  return errors;
}

function sortedGrid(grid) {
  return [...grid].sort((a, b) => a.shortWindow - b.shortWindow || a.longWindow - b.longWindow);
}

function buildWindowPlan(candles, windows) {
  const { trainingCandles, validationCandles, testCandles, stepCandles } = windows;
  const plan = [];
  for (let index = 0, base = 0; ; index += 1, base += stepCandles) {
    const trainingStartIndex = base;
    const trainingEndIndex = trainingStartIndex + trainingCandles - 1;
    const hasValidation = validationCandles > 0;
    const validationStartIndex = hasValidation ? trainingEndIndex + 1 : null;
    const validationEndIndex = hasValidation ? validationStartIndex + validationCandles - 1 : null;
    const testStartIndex = hasValidation ? validationEndIndex + 1 : trainingEndIndex + 1;
    const testEndIndex = testStartIndex + testCandles - 1;
    if (testEndIndex >= candles.length) break;
    plan.push(Object.freeze({
      index,
      trainingStartIndex, trainingEndIndex,
      validationStartIndex, validationEndIndex,
      testStartIndex, testEndIndex,
      trainingStartTime: candles[trainingStartIndex].openTime,
      trainingEndTime: candles[trainingEndIndex].closeTime,
      validationStartTime: hasValidation ? candles[validationStartIndex].openTime : null,
      validationEndTime: hasValidation ? candles[validationEndIndex].closeTime : null,
      testStartTime: candles[testStartIndex].openTime,
      testEndTime: candles[testEndIndex].closeTime
    }));
  }
  return plan;
}

function computeScore(result) {
  const { totalReturn, maxDrawdown } = result.metrics;
  if (maxDrawdown === 0) return totalReturn;
  return totalReturn / Math.abs(maxDrawdown);
}

/** Fixed, documented, deterministic tie-break order (WO-0027 section G). */
function compareTieBreak(a, b) {
  if (a.result.metrics.maxDrawdown !== b.result.metrics.maxDrawdown) return a.result.metrics.maxDrawdown - b.result.metrics.maxDrawdown;
  const profitFactorA = a.result.performance.profitFactor ?? 0;
  const profitFactorB = b.result.performance.profitFactor ?? 0;
  if (profitFactorA !== profitFactorB) return profitFactorB - profitFactorA;
  if (a.result.metrics.turnover !== b.result.metrics.turnover) return a.result.metrics.turnover - b.result.metrics.turnover;
  if (a.param.longWindow !== b.param.longWindow) return b.param.longWindow - a.param.longWindow;
  if (a.param.shortWindow !== b.param.shortWindow) return a.param.shortWindow - b.param.shortWindow;
  return a.param.longWindow - b.param.longWindow;
}

function runCandidate(modules, points, param, execConfig) {
  const factory = () => new modules.strategyEngine.SmaCrossoverStrategy(param.shortWindow, param.longWindow);
  return modules.backtestEngine.runBacktest(points, factory, execConfig);
}

function evaluateCandidates(modules, grid, points, execConfig, minimumTrades) {
  return grid.map((param) => {
    const result = runCandidate(modules, points, param, execConfig);
    const eligible = result.performance.trades >= minimumTrades;
    return { param, result, eligible, score: eligible ? computeScore(result) : null };
  });
}

function selectCandidate(evaluatedTraining, validationPoints, modules, execConfig) {
  const eligible = evaluatedTraining.filter((c) => c.eligible);
  if (eligible.length === 0) return { error: "ALL_CANDIDATES_INVALID" };

  const rankedByTraining = [...eligible].sort((a, b) => (b.score - a.score) || compareTieBreak(a, b));

  if (!validationPoints) {
    const winner = rankedByTraining[0];
    return { selected: winner.param, trainResult: winner.result, validationResult: null, selectionReason: "highest eligible train-only RETURN_OVER_DRAWDOWN score (no validation window configured)" };
  }

  const shortlist = rankedByTraining.slice(0, Math.min(VALIDATION_SHORTLIST_SIZE, rankedByTraining.length));
  const withValidation = shortlist.map((candidate) => {
    const validationResult = runCandidate(modules, validationPoints, candidate.param, execConfig);
    return { ...candidate, validationResult, validationScore: computeScore(validationResult) };
  });
  withValidation.sort((a, b) => (b.validationScore - a.validationScore) || compareTieBreak(
    { param: a.param, result: a.validationResult },
    { param: b.param, result: b.validationResult }
  ));
  const winner = withValidation[0];
  return { selected: winner.param, trainResult: winner.result, validationResult: winner.validationResult, selectionReason: `best validation RETURN_OVER_DRAWDOWN score among top ${shortlist.length} training-ranked candidates` };
}

function summarize(result) {
  return {
    totalReturn: result.metrics.totalReturn,
    maxDrawdown: result.metrics.maxDrawdown,
    profitFactor: result.performance.profitFactor ?? null,
    tradeCount: result.performance.trades,
    fees: result.metrics.feesPaid,
    benchmarkReturn: result.benchmark.buyAndHoldReturn,
    benchmarkExcessReturn: result.benchmark.outperformance,
    initialEquity: result.metrics.initialEquity,
    finalEquity: result.metrics.finalEquity
  };
}

function computeMaxDrawdownFromCurve(curve) {
  let peak = curve[0]?.equity ?? 0;
  let maxDrawdown = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }
  return maxDrawdown;
}

function compoundedSequence(returns) {
  let multiplier = 1;
  for (const value of returns) multiplier *= (1 + value);
  return multiplier - 1;
}

function buildAggregate(windowResults, initialCash) {
  const passed = windowResults.filter((w) => w.status === "PASS");
  const testReturns = passed.map((w) => w.test.summary.totalReturn);
  const profitable = testReturns.filter((r) => r > 0).length;
  const losing = testReturns.filter((r) => r < 0).length;
  const noTrade = passed.filter((w) => w.test.summary.tradeCount === 0).length;

  let base = initialCash;
  const sequentialCurve = [];
  for (const window of passed) {
    const curve = window.test.equityCurve;
    const windowInitial = window.test.summary.initialEquity;
    for (const point of curve) sequentialCurve.push({ timestamp: point.timestamp, equity: base * (point.equity / windowInitial) });
    base *= (1 + window.test.summary.totalReturn);
  }
  const aggregateMaxDrawdown = sequentialCurve.length ? computeMaxDrawdownFromCurve(sequentialCurve) : 0;

  const sorted = [...testReturns].sort((a, b) => a - b);
  const median = sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const average = sorted.length === 0 ? 0 : sorted.reduce((sum, v) => sum + v, 0) / sorted.length;

  let parameterSwitchCount = 0;
  for (let index = 1; index < passed.length; index += 1) {
    const previous = passed[index - 1].selectedParameter;
    const current = passed[index].selectedParameter;
    if (previous.shortWindow !== current.shortWindow || previous.longWindow !== current.longWindow) parameterSwitchCount += 1;
  }

  const selectionCounts = new Map();
  for (const window of passed) {
    const key = `${window.selectedParameter.shortWindow}/${window.selectedParameter.longWindow}`;
    selectionCounts.set(key, (selectionCounts.get(key) ?? 0) + 1);
  }
  let mostSelected = null;
  let mostSelectedCount = -1;
  for (const [key, count] of selectionCounts) { if (count > mostSelectedCount) { mostSelected = key; mostSelectedCount = count; } }
  let longestStreak = 0;
  let currentStreak = 0;
  for (let index = 0; index < passed.length; index += 1) {
    if (index === 0 || (passed[index - 1].selectedParameter.shortWindow === passed[index].selectedParameter.shortWindow && passed[index - 1].selectedParameter.longWindow === passed[index].selectedParameter.longWindow)) currentStreak += 1;
    else currentStreak = 1;
    longestStreak = Math.max(longestStreak, currentStreak);
  }

  const degradations = passed.map((window) => {
    const trainingReturn = window.training.summary.totalReturn;
    const validationReturn = window.validation ? window.validation.summary.totalReturn : null;
    const testReturn = window.test.summary.totalReturn;
    return {
      trainingToValidation: validationReturn == null ? null : trainingReturn - validationReturn,
      validationToTest: validationReturn == null ? null : validationReturn - testReturn,
      trainingToTest: trainingReturn - testReturn,
      trainingPositiveTestNegative: trainingReturn > 0 && testReturn < 0,
      validationTestReversal: validationReturn != null && ((validationReturn > 0 && testReturn < 0) || (validationReturn < 0 && testReturn > 0))
    };
  });

  return {
    windowCount: windowResults.length,
    passedWindowCount: passed.length,
    profitableTestWindows: profitable,
    losingTestWindows: losing,
    noTradeTestWindows: noTrade,
    positiveReturnRatio: passed.length === 0 ? 0 : profitable / passed.length,
    compoundedOosReturn: compoundedSequence(testReturns),
    aggregateMaxDrawdown,
    averageTestReturn: average,
    medianTestReturn: median,
    worstTestReturn: sorted.length ? sorted[0] : 0,
    bestTestReturn: sorted.length ? sorted[sorted.length - 1] : 0,
    totalTrades: passed.reduce((sum, w) => sum + w.test.summary.tradeCount, 0),
    totalFees: passed.reduce((sum, w) => sum + w.test.summary.fees, 0),
    averageProfitFactor: (() => {
      const values = passed.map((w) => w.test.summary.profitFactor).filter((v) => v != null);
      return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
    })(),
    parameterStability: {
      mostSelectedParameter: mostSelected,
      mostSelectedCount,
      uniqueParameterCount: selectionCounts.size,
      parameterSwitchCount,
      longestConsecutiveRepeat: longestStreak
    },
    degradation: {
      perWindow: degradations,
      trainingPositiveTestNegativeCount: degradations.filter((d) => d.trainingPositiveTestNegative).length,
      validationTestReversalCount: degradations.filter((d) => d.validationTestReversal).length
    }
  };
}

function buildWarnings(aggregate, _windowResults) {
  const warnings = [];
  const passedCount = aggregate.passedWindowCount;
  if (passedCount >= 2 && aggregate.degradation.trainingPositiveTestNegativeCount / passedCount >= 0.5) warnings.push("TRAINING_POSITIVE_TEST_NEGATIVE_REPEATED");
  if (passedCount > 1 && aggregate.parameterStability.parameterSwitchCount / (passedCount - 1) >= 0.5) warnings.push("FREQUENT_PARAMETER_SWITCHING");
  if (aggregate.totalTrades < passedCount) warnings.push("LOW_TRADE_COUNT");
  if (passedCount >= 2 && aggregate.degradation.validationTestReversalCount / passedCount >= 0.5) warnings.push("VALIDATION_TEST_DIRECTION_REVERSAL");
  return warnings;
}

function runWalkForwardRequest(request, options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, "..", "..");
  const modules = loadProductionModules(repositoryRoot);

  const requestErrors = validateRequest(request, modules);
  if (requestErrors.length > 0) {
    return { schemaVersion: 1, requestId: request && request.id, status: "FAIL", windows: [], aggregate: null, benchmarks: null, warnings: [], failures: requestErrors, hashes: null };
  }

  const candles = request.candles;
  const grid = sortedGrid(request.parameterGrid);
  const plan = buildWindowPlan(candles, request.windows);
  if (plan.length === 0) {
    return { schemaVersion: 1, requestId: request.id, status: "FAIL", windows: [], aggregate: null, benchmarks: null, warnings: [], failures: ["no complete window can be built from the supplied candles and window plan"], hashes: null };
  }

  const points = modules.researchDataset.candlesToBacktestPoints(candles);
  const execConfig = {
    market: request.market,
    initialCash: request.execution.initialCash,
    feeRate: request.execution.feeRate,
    orderQuantity: request.execution.orderQuantity,
    riskPolicy: request.execution.riskPolicy,
    executionCosts: { spreadBps: request.execution.executionCosts?.spreadBps ?? 0, slippageBps: request.execution.executionCosts?.slippageBps ?? 0 }
  };

  const failures = [];
  const windowResults = [];

  for (const boundary of plan) {
    const trainPoints = points.slice(boundary.trainingStartIndex, boundary.trainingEndIndex + 1);
    const validationPoints = boundary.validationStartIndex == null ? null : points.slice(boundary.validationStartIndex, boundary.validationEndIndex + 1);
    const testPoints = points.slice(boundary.testStartIndex, boundary.testEndIndex + 1);

    const evaluatedTraining = evaluateCandidates(modules, grid, trainPoints, execConfig, request.minimumTrades);
    const selection = selectCandidate(evaluatedTraining, validationPoints, modules, execConfig);

    if (selection.error) {
      failures.push(`window ${boundary.index}: ${selection.error}`);
      windowResults.push({ index: boundary.index, boundaries: boundary, status: "FAIL", failureReason: selection.error, candidateEvaluations: evaluatedTraining.map((c) => ({ shortWindow: c.param.shortWindow, longWindow: c.param.longWindow, eligible: c.eligible, score: c.score, trades: c.result.performance.trades })) });
      continue;
    }

    const testResult = runCandidate(modules, testPoints, selection.selected, execConfig);
    const windowResult = {
      index: boundary.index,
      boundaries: boundary,
      candidateEvaluations: evaluatedTraining.map((c) => ({ shortWindow: c.param.shortWindow, longWindow: c.param.longWindow, eligible: c.eligible, score: c.score, trades: c.result.performance.trades })),
      selectedParameter: selection.selected,
      selectionReason: selection.selectionReason,
      training: { summary: summarize(selection.trainResult) },
      validation: selection.validationResult ? { summary: summarize(selection.validationResult) } : null,
      test: { summary: summarize(testResult), equityCurve: testResult.equityCurve },
      status: "PASS"
    };
    windowResult.hashes = {
      trainingResultSha256: canonicalHash(windowResult.training.summary),
      validationResultSha256: windowResult.validation ? canonicalHash(windowResult.validation.summary) : null,
      testResultSha256: canonicalHash(windowResult.test.summary)
    };
    windowResults.push(windowResult);
  }

  const overallStatus = failures.length === 0 ? "PASS" : "FAIL";
  const aggregate = buildAggregate(windowResults, request.execution.initialCash);
  const warnings = buildWarnings(aggregate, windowResults);

  // Benchmarks: CASH is trivially flat; BUY_AND_HOLD is compounded from each PASSed
  // test window's own benchmark field (already computed by the real BacktestEngine
  // under identical dataset/cost/window boundaries); FIXED_PARAMETER_5_20 re-runs the
  // production default on the exact same test windows with no re-selection.
  const passedWindows = windowResults.filter((w) => w.status === "PASS");
  const buyAndHoldCompounded = compoundedSequence(passedWindows.map((w) => w.test.summary.benchmarkReturn));
  const fixedParam = { shortWindow: 5, longWindow: 20 };
  const fixedResults = plan.map((boundary) => runCandidate(modules, points.slice(boundary.testStartIndex, boundary.testEndIndex + 1), fixedParam, execConfig));
  const fixedCompounded = compoundedSequence(fixedResults.map((r) => r.metrics.totalReturn));

  const windowsForHash = windowResults.map((w) => ({ index: w.index, boundaries: w.boundaries }));
  const result = {
    schemaVersion: 1,
    requestId: request.id,
    status: overallStatus,
    dataset: { market: request.market, candleCount: candles.length, datasetContentSha256: modules.researchDataset.calculateCandleSha256(candles) },
    windowPlan: { trainingCandles: request.windows.trainingCandles, validationCandles: request.windows.validationCandles, testCandles: request.windows.testCandles, stepCandles: request.windows.stepCandles, totalWindows: plan.length, incompleteFinalWindowPolicy: "EXCLUDED" },
    parameterGrid: grid,
    selectionMetric: request.selectionMetric,
    minimumTrades: request.minimumTrades,
    windows: windowResults,
    aggregate,
    benchmarks: {
      cash: { compoundedReturn: 0 },
      buyAndHold: { compoundedReturn: buyAndHoldCompounded },
      fixedParameter5x20: { compoundedReturn: fixedCompounded, vsSelected: aggregate.compoundedOosReturn - fixedCompounded }
    },
    warnings,
    failures
  };
  result.hashes = {
    requestSha256: canonicalHash(request),
    datasetContentSha256: result.dataset.datasetContentSha256,
    windowPlanSha256: canonicalHash(windowsForHash),
    candidateGridSha256: canonicalHash(grid),
    aggregateResultSha256: canonicalHash(aggregate)
  };
  return result;
}

module.exports = { runWalkForwardRequest, validateRequest, buildWindowPlan, sortedGrid, computeScore, compareTieBreak, compoundedSequence, computeMaxDrawdownFromCurve };
