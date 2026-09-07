"use strict";
/**
 * Deterministic SMA parameter-neighborhood robustness runner (WO-0028).
 *
 * SCOPE NOTE: same situation as WO-0027 (see docs/research/walk-forward-contract.md).
 * No MarketCandle/HistoricalDatasetDescriptor contract exists in this repository, so
 * this reuses apps/desktop/src/{researchDataset,backtestEngine,strategyEngine}.ts, the
 * real production modules, plus scripts/lib/walk-forward-runner.js's generic (non
 * domain-specific) windowing/compounding utilities. It never bypasses PaperBroker and
 * never reimplements a mini broker.
 *
 * This is NOT a parameter search: the neighborhood offsets and cost conditions are
 * fixed by the request before any candidate runs, and every candidate is evaluated
 * under identical assumptions. This module never re-selects a "best" parameter after
 * seeing results.
 */
const path = require("node:path");
const { canonicalHash } = require("./canonical-hash.js");
const { buildWindowPlan, compoundedSequence, computeMaxDrawdownFromCurve } = require("./walk-forward-runner.js");

function loadProductionModules(repositoryRoot) {
  const distRoot = path.join(repositoryRoot, "dist", "apps", "desktop", "src");
  return {
    researchDataset: require(path.join(distRoot, "cloud", "researchDataset.js")),
    backtestEngine: require(path.join(distRoot, "strategy", "backtestEngine.js")),
    strategyEngine: require(path.join(distRoot, "strategy", "strategyEngine.js"))
  };
}

const REQUIRED_COST_CONDITIONS = ["BASE", "MODERATE", "SEVERE"];

function isPositiveInteger(value) { return Number.isInteger(value) && value > 0; }
function isNonNegativeInteger(value) { return Number.isInteger(value) && value >= 0; }
function isFiniteNonNegative(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }

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

  const references = request.referenceParameters;
  if (!Array.isArray(references) || references.length === 0) errors.push("request.referenceParameters must be a non-empty array");
  else {
    for (const ref of references) {
      if (!["PRODUCTION_DEFAULT", "WALK_FORWARD_SELECTED", "MANUAL_RESEARCH_REFERENCE"].includes(ref?.source)) errors.push(`referenceParameters entry has an invalid source: ${ref?.source}`);
      if (!isPositiveInteger(ref?.shortWindow)) errors.push("referenceParameters entry needs a positive integer shortWindow");
      if (!isPositiveInteger(ref?.longWindow) || ref.longWindow <= ref.shortWindow) errors.push(`referenceParameters entry ${ref?.shortWindow}/${ref?.longWindow} must have longWindow > shortWindow`);
    }
  }

  const neighborhood = request.neighborhood ?? {};
  if (!Array.isArray(neighborhood.shortOffsets) || neighborhood.shortOffsets.length === 0 || !neighborhood.shortOffsets.every(Number.isInteger)) errors.push("neighborhood.shortOffsets must be a non-empty array of integers");
  if (!Array.isArray(neighborhood.longOffsets) || neighborhood.longOffsets.length === 0 || !neighborhood.longOffsets.every(Number.isInteger)) errors.push("neighborhood.longOffsets must be a non-empty array of integers");

  if (!isNonNegativeInteger(request.minimumTrades)) errors.push("request.minimumTrades must be a non-negative integer");

  const execution = request.execution ?? {};
  if (!Number.isFinite(execution.initialCash) || execution.initialCash <= 0) errors.push("execution.initialCash must be a positive finite number");
  if (execution.latencyCandles !== undefined && execution.latencyCandles !== 0) errors.push("execution.latencyCandles must be 0 (see scope note in file header)");

  const evaluation = request.evaluation ?? {};
  if (!["FULL_SAMPLE", "WALK_FORWARD_OOS_WINDOWS", "BOTH"].includes(evaluation.mode)) errors.push(`evaluation.mode must be one of FULL_SAMPLE, WALK_FORWARD_OOS_WINDOWS, BOTH (got ${evaluation.mode})`);
  if (evaluation.mode === "WALK_FORWARD_OOS_WINDOWS" || evaluation.mode === "BOTH") {
    const windows = evaluation.oosWindows ?? {};
    if (!isPositiveInteger(windows.trainingCandles)) errors.push("evaluation.oosWindows.trainingCandles must be a positive integer");
    if (!isPositiveInteger(windows.testCandles)) errors.push("evaluation.oosWindows.testCandles must be a positive integer");
    if (!isPositiveInteger(windows.stepCandles)) errors.push("evaluation.oosWindows.stepCandles must be a positive integer");
    if (isPositiveInteger(windows.stepCandles) && isPositiveInteger(windows.testCandles) && windows.stepCandles < windows.testCandles) errors.push("evaluation.oosWindows.stepCandles must not be smaller than testCandles");
  }

  const costConditions = request.costConditions;
  if (!Array.isArray(costConditions) || costConditions.length !== 3) {
    errors.push("request.costConditions must contain exactly 3 entries (BASE, MODERATE, SEVERE)");
  } else {
    const names = costConditions.map((c) => c?.name);
    for (const required of REQUIRED_COST_CONDITIONS) if (!names.includes(required)) errors.push(`costConditions is missing the required condition: ${required}`);
    for (const condition of costConditions) {
      if (!isFiniteNonNegative(condition?.feeRate)) errors.push(`costConditions.${condition?.name}.feeRate must be a non-negative finite number`);
      if (!isFiniteNonNegative(condition?.slippageBps)) errors.push(`costConditions.${condition?.name}.slippageBps must be a non-negative finite number`);
    }
    const byName = Object.fromEntries(costConditions.map((c) => [c?.name, c]));
    if (byName.BASE && byName.MODERATE && (byName.MODERATE.feeRate < byName.BASE.feeRate || byName.MODERATE.slippageBps < byName.BASE.slippageBps)) errors.push("costConditions.MODERATE must not be less stressful than BASE");
    if (byName.MODERATE && byName.SEVERE && (byName.SEVERE.feeRate < byName.MODERATE.feeRate || byName.SEVERE.slippageBps < byName.MODERATE.slippageBps)) errors.push("costConditions.SEVERE must not be less stressful than MODERATE");
  }

  return errors;
}

function buildCandidateGrid(referenceParameters, neighborhood, trainingCandleBound) {
  const seen = new Map();
  for (const ref of referenceParameters) {
    for (const shortOffset of neighborhood.shortOffsets) {
      for (const longOffset of neighborhood.longOffsets) {
        const shortWindow = ref.shortWindow + shortOffset;
        const longWindow = ref.longWindow + longOffset;
        const key = `${shortWindow}/${longWindow}`;
        // Keep the research neighborhood aligned with the production
        // SmaCrossoverStrategy constructor, which requires shortPeriod >= 2.
        // A positive shortWindow of 1 would otherwise be admitted here and
        // fail only after the candidate reaches strategy construction.
        const valid = Number.isInteger(shortWindow) && shortWindow >= 2 && isPositiveInteger(longWindow) && longWindow > shortWindow && (trainingCandleBound == null || longWindow < trainingCandleBound);
        const distances = referenceParameters.map((r) => ({
          source: r.source,
          short: Math.abs(shortWindow - r.shortWindow),
          long: Math.abs(longWindow - r.longWindow),
          normalized: Math.abs(shortWindow - r.shortWindow) + Math.abs(longWindow - r.longWindow)
        }));
        if (!seen.has(key)) seen.set(key, { shortWindow, longWindow, valid, distanceFromReferences: distances, isReference: referenceParameters.some((r) => r.shortWindow === shortWindow && r.longWindow === longWindow) });
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.shortWindow - b.shortWindow || a.longWindow - b.longWindow);
}

/** Immediate neighbors of `reference`: candidates one offset-index step away in the
 * declared shortOffsets/longOffsets grids (Chebyshev-adjacent), excluding the
 * reference cell itself. Distance is measured in grid-index space, not raw value, so
 * an irregular offset grid (e.g. [-5,-2,0,2,5]) is still treated as "adjacent" between
 * consecutive declared offsets. */
function findImmediateNeighbors(grid, reference, neighborhood) {
  const sortedShort = [...new Set(neighborhood.shortOffsets)].sort((a, b) => a - b);
  const sortedLong = [...new Set(neighborhood.longOffsets)].sort((a, b) => a - b);
  const refShortIndex = sortedShort.indexOf(0);
  const refLongIndex = sortedLong.indexOf(0);
  return grid.filter((candidate) => {
    if (candidate.shortWindow === reference.shortWindow && candidate.longWindow === reference.longWindow) return false;
    const shortIndex = sortedShort.indexOf(candidate.shortWindow - reference.shortWindow);
    const longIndex = sortedLong.indexOf(candidate.longWindow - reference.longWindow);
    if (shortIndex === -1 || longIndex === -1) return false;
    return Math.abs(shortIndex - refShortIndex) <= 1 && Math.abs(longIndex - refLongIndex) <= 1;
  });
}

function runFullSample(modules, points, param, execConfig) {
  const factory = () => new modules.strategyEngine.SmaCrossoverStrategy(param.shortWindow, param.longWindow);
  return modules.backtestEngine.runBacktest(points, factory, execConfig);
}

function runOosFixed(modules, points, param, execConfig, oosWindows) {
  const plan = buildWindowPlan(points.map((p) => ({ market: execConfig.market, interval: "1m", openTime: p.timestamp - 1, closeTime: p.timestamp, open: p.close, high: p.close, low: p.close, close: p.close, volume: 1 })), { trainingCandles: oosWindows.trainingCandles, validationCandles: 0, testCandles: oosWindows.testCandles, stepCandles: oosWindows.stepCandles });
  if (plan.length === 0) return null;
  const factory = () => new modules.strategyEngine.SmaCrossoverStrategy(param.shortWindow, param.longWindow);
  const testResults = plan.map((boundary) => modules.backtestEngine.runBacktest(points.slice(boundary.testStartIndex, boundary.testEndIndex + 1), factory, execConfig));
  const compoundedReturn = compoundedSequence(testResults.map((r) => r.metrics.totalReturn));
  let base = execConfig.initialCash;
  const curve = [];
  for (const result of testResults) {
    const windowInitial = result.metrics.initialEquity;
    for (const point of result.equityCurve) curve.push({ timestamp: point.timestamp, equity: base * (point.equity / windowInitial) });
    base *= (1 + result.metrics.totalReturn);
  }
  const profitableWindows = testResults.filter((r) => r.metrics.totalReturn > 0).length;
  return { windowCount: plan.length, compoundedReturn, maxDrawdown: curve.length ? computeMaxDrawdownFromCurve(curve) : 0, profitableWindowRatio: plan.length ? profitableWindows / plan.length : 0, totalTrades: testResults.reduce((sum, r) => sum + r.performance.trades, 0) };
}

function summarizeFullSample(result) {
  return { totalReturn: result.metrics.totalReturn, maxDrawdown: result.metrics.maxDrawdown, profitFactor: result.performance.profitFactor ?? null, tradeCount: result.performance.trades, benchmarkExcessReturn: result.benchmark.outperformance };
}

function runParameterRobustnessRequest(request, options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, "..", "..");
  const modules = loadProductionModules(repositoryRoot);

  const requestErrors = validateRequest(request, modules);
  if (requestErrors.length > 0) {
    return { schemaVersion: 1, requestId: request && request.id, status: "FAIL", references: [], candidates: [], aggregate: null, warnings: [], failures: requestErrors, hashes: null };
  }

  const candles = request.candles;
  const points = modules.researchDataset.candlesToBacktestPoints(candles);
  const trainingBound = request.evaluation.mode === "FULL_SAMPLE" ? candles.length : request.evaluation.oosWindows.trainingCandles;
  const grid = buildCandidateGrid(request.referenceParameters, request.neighborhood, trainingBound);
  const validCandidates = grid.filter((c) => c.valid);
  if (validCandidates.length === 0) {
    return { schemaVersion: 1, requestId: request.id, status: "FAIL", references: [], candidates: grid, aggregate: null, warnings: [], failures: ["no valid candidate could be constructed from the declared neighborhood"], hashes: null };
  }

  const execConfigFor = (cost) => ({ market: request.market, initialCash: request.execution.initialCash, feeRate: cost.feeRate, orderQuantity: request.execution.orderQuantity, riskPolicy: request.execution.riskPolicy, executionCosts: { spreadBps: request.execution.executionCosts?.spreadBps ?? 0, slippageBps: cost.slippageBps } });

  const failures = [];
  const candidateResults = grid.map((candidate) => {
    if (!candidate.valid) return { ...candidate, status: "INVALID_CANDIDATE" };

    const costResults = {};
    for (const cost of request.costConditions) {
      const execConfig = execConfigFor(cost);
      const fullSampleResult = request.evaluation.mode !== "WALK_FORWARD_OOS_WINDOWS" ? runFullSample(modules, points, candidate, execConfig) : null;
      const oosResult = (request.evaluation.mode === "WALK_FORWARD_OOS_WINDOWS" || request.evaluation.mode === "BOTH") ? runOosFixed(modules, points, candidate, execConfig, request.evaluation.oosWindows) : null;
      costResults[cost.name] = {
        fullSample: fullSampleResult ? summarizeFullSample(fullSampleResult) : null,
        oos: oosResult
      };
    }

    const baseFullSample = costResults.BASE.fullSample;
    const eligible = baseFullSample ? baseFullSample.tradeCount >= request.minimumTrades : (costResults.BASE.oos ? costResults.BASE.oos.totalTrades >= request.minimumTrades : false);

    return { ...candidate, status: "EVALUATED", eligible, costResults };
  });

  const references = request.referenceParameters.map((ref) => {
    const referenceCandidate = candidateResults.find((c) => c.shortWindow === ref.shortWindow && c.longWindow === ref.longWindow);
    if (!referenceCandidate || referenceCandidate.status !== "EVALUATED") {
      failures.push(`reference ${ref.source} (${ref.shortWindow}/${ref.longWindow}) could not be evaluated`);
      return { source: ref.source, shortWindow: ref.shortWindow, longWindow: ref.longWindow, assessment: "INVALID" };
    }
    const immediateNeighbors = findImmediateNeighbors(validCandidates, ref, request.neighborhood).filter((n) => candidateResults.find((c) => c.shortWindow === n.shortWindow && c.longWindow === n.longWindow)?.status === "EVALUATED");
    const referenceReturn = referenceCandidate.costResults.BASE.fullSample?.totalReturn ?? referenceCandidate.costResults.BASE.oos?.compoundedReturn ?? 0;

    const neighborReturns = immediateNeighbors.map((n) => {
      const nc = candidateResults.find((c) => c.shortWindow === n.shortWindow && c.longWindow === n.longWindow);
      return nc.costResults.BASE.fullSample?.totalReturn ?? nc.costResults.BASE.oos?.compoundedReturn ?? 0;
    });
    const neighborBenchmarkExcess = immediateNeighbors.map((n) => {
      const nc = candidateResults.find((c) => c.shortWindow === n.shortWindow && c.longWindow === n.longWindow);
      return nc.costResults.BASE.fullSample?.benchmarkExcessReturn ?? 0;
    });
    const matchingDirectionRatio = neighborReturns.length ? neighborReturns.filter((r) => (r > 0) === (referenceReturn > 0)).length / neighborReturns.length : 0;
    const benchmarkOutperformRatio = neighborBenchmarkExcess.length ? neighborBenchmarkExcess.filter((r) => r > 0).length / neighborBenchmarkExcess.length : 0;
    const allValidReturns = validCandidates.map((c) => {
      const cc = candidateResults.find((x) => x.shortWindow === c.shortWindow && x.longWindow === c.longWindow);
      return cc.costResults.BASE.fullSample?.totalReturn ?? cc.costResults.BASE.oos?.compoundedReturn ?? 0;
    });
    const positiveRatioAll = allValidReturns.filter((r) => r > 0).length / allValidReturns.length;

    // Local smoothness / abrupt edges across the whole grid (4-connected: adjacent in
    // exactly one dimension), reused for the UNSTABLE classification below.
    const sortedShort = [...new Set(request.neighborhood.shortOffsets)].sort((a, b) => a - b);
    const sortedLong = [...new Set(request.neighborhood.longOffsets)].sort((a, b) => a - b);
    let signReversals = 0;
    let adjacentPairs = 0;
    for (const candidate of validCandidates) {
      const cc = candidateResults.find((c) => c.shortWindow === candidate.shortWindow && c.longWindow === candidate.longWindow);
      const cReturn = cc.costResults.BASE.fullSample?.totalReturn ?? cc.costResults.BASE.oos?.compoundedReturn ?? 0;
      const shortIdx = sortedShort.indexOf(candidate.shortWindow - ref.shortWindow);
      const longIdx = sortedLong.indexOf(candidate.longWindow - ref.longWindow);
      for (const [ds, dl] of [[1, 0], [0, 1]]) {
        const neighborShortOffsetValue = sortedShort[shortIdx + ds];
        const neighborLongOffsetValue = sortedLong[longIdx + dl];
        if (neighborShortOffsetValue === undefined || neighborLongOffsetValue === undefined) continue;
        const neighborCandidate = validCandidates.find((c) => c.shortWindow === ref.shortWindow + neighborShortOffsetValue && c.longWindow === ref.longWindow + neighborLongOffsetValue);
        if (!neighborCandidate) continue;
        const nc = candidateResults.find((c) => c.shortWindow === neighborCandidate.shortWindow && c.longWindow === neighborCandidate.longWindow);
        const nReturn = nc.costResults.BASE.fullSample?.totalReturn ?? nc.costResults.BASE.oos?.compoundedReturn ?? 0;
        adjacentPairs += 1;
        if ((cReturn > 0) !== (nReturn > 0)) signReversals += 1;
      }
    }
    const signReversalRatio = adjacentPairs ? signReversals / adjacentPairs : 0;

    let assessment;
    if (signReversalRatio >= 0.5) assessment = "UNSTABLE";
    else if (referenceReturn <= 0) assessment = "FLAT_WEAK";
    else if (matchingDirectionRatio >= 0.75 && benchmarkOutperformRatio >= 0.5) assessment = "BROAD_PLATEAU";
    else if (matchingDirectionRatio >= 0.5) assessment = "NARROW_PLATEAU";
    else assessment = "ISOLATED_PEAK";

    return {
      source: ref.source, shortWindow: ref.shortWindow, longWindow: ref.longWindow,
      referenceReturn, immediateNeighborCount: immediateNeighbors.length,
      immediateNeighborPositiveRatio: matchingDirectionRatio, immediateNeighborBenchmarkOutperformRatio: benchmarkOutperformRatio,
      allCandidatePositiveRatio: positiveRatioAll, signReversalRatio, assessment
    };
  });

  const overallStatus = failures.length === 0 ? "PASS" : "FAIL";

  const validReturns = validCandidates.map((c) => {
    const cc = candidateResults.find((x) => x.shortWindow === c.shortWindow && x.longWindow === c.longWindow);
    return cc.costResults.BASE.fullSample?.totalReturn ?? cc.costResults.BASE.oos?.compoundedReturn ?? 0;
  }).sort((a, b) => a - b);
  const median = validReturns.length ? (validReturns.length % 2 === 1 ? validReturns[(validReturns.length - 1) / 2] : (validReturns[validReturns.length / 2 - 1] + validReturns[validReturns.length / 2]) / 2) : 0;
  const q1 = validReturns.length ? validReturns[Math.floor((validReturns.length - 1) * 0.25)] : 0;
  const q3 = validReturns.length ? validReturns[Math.floor((validReturns.length - 1) * 0.75)] : 0;

  const survivorsByCondition = Object.fromEntries(REQUIRED_COST_CONDITIONS.map((name) => [name, validCandidates.filter((c) => {
    const cc = candidateResults.find((x) => x.shortWindow === c.shortWindow && x.longWindow === c.longWindow);
    const value = cc.costResults[name].fullSample?.totalReturn ?? cc.costResults[name].oos?.compoundedReturn ?? 0;
    return value > 0;
  }).length]));

  const aggregate = {
    candidateCount: grid.length,
    validCandidateCount: validCandidates.length,
    invalidCandidateCount: grid.length - validCandidates.length,
    positiveRatio: validReturns.length ? validReturns.filter((r) => r > 0).length / validReturns.length : 0,
    medianReturn: median,
    returnIqr: q3 - q1,
    worstReturn: validReturns.length ? validReturns[0] : 0,
    bestReturn: validReturns.length ? validReturns[validReturns.length - 1] : 0,
    costSurvivorCounts: survivorsByCondition
  };

  const warnings = [];
  if (references.some((r) => r.assessment === "ISOLATED_PEAK")) warnings.push("REFERENCE_ISOLATED_PEAK");
  if (references.some((r) => r.assessment === "UNSTABLE")) warnings.push("UNSTABLE_LOCAL_SURFACE");
  if (survivorsByCondition.SEVERE < survivorsByCondition.BASE * 0.5) warnings.push("SEVERE_COST_COLLAPSE_MAJORITY");

  const result = {
    schemaVersion: 1,
    requestId: request.id,
    status: overallStatus,
    dataset: { market: request.market, candleCount: candles.length, datasetContentSha256: modules.researchDataset.calculateCandleSha256(candles) },
    referenceParameters: request.referenceParameters,
    neighborhood: request.neighborhood,
    costConditions: request.costConditions,
    references,
    candidates: candidateResults,
    aggregate,
    warnings,
    failures
  };
  result.hashes = {
    requestSha256: canonicalHash(request),
    datasetContentSha256: result.dataset.datasetContentSha256,
    referenceParametersSha256: canonicalHash(request.referenceParameters),
    neighborhoodGridSha256: canonicalHash(grid.map((c) => ({ shortWindow: c.shortWindow, longWindow: c.longWindow, valid: c.valid }))),
    candidateResultsSha256: canonicalHash(candidateResults),
    aggregateResultSha256: canonicalHash(aggregate)
  };
  return result;
}

module.exports = { runParameterRobustnessRequest, validateRequest, buildCandidateGrid, findImmediateNeighbors };
