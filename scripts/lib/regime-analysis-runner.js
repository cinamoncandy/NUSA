"use strict";
/**
 * Deterministic market-regime performance analysis runner (WO-0029).
 *
 * SCOPE NOTE: apps/desktop/src/strategy/marketRegime.ts ALREADY implements the trailing-only
 * regime classifier this work order describes (trend from a trailing log return over
 * `trendLookback`, realized volatility from trailing log returns, warm-up -> UNKNOWN,
 * a SHA-256 classifier id over the canonical config, and transition counting). It is
 * already covered by tests/market-regime.test.js. This module therefore does NOT write
 * a second classifier -- it calls buildRegimeTimeline() and builds the analysis layer
 * (segments, trade attribution, per-regime metrics, transitions, rare-regime gate,
 * assessments) on top, exactly as WO-0027/WO-0028 reused the existing Backtest Engine.
 *
 * Disclosed deviations from the literal work order, none of them silent:
 *
 *  - THRESHOLD SOURCE IS FIXED_ABSOLUTE, NOT TRAINING QUANTILES. The existing
 *    classifier takes absolute lowVolatilityThreshold/highVolatilityThreshold values,
 *    declared in the request before any candle is read. No distribution is estimated
 *    from any window, so there is no in-sample/out-of-sample quantile-leakage path to
 *    guard against by construction -- but equally, the training-quantile mode the work
 *    order recommends is NOT implemented, and thresholds are a researcher choice.
 *  - ENTRY_SIGNAL_REGIME AND ENTRY_FILL_REGIME ARE IDENTICAL HERE. The reused Backtest
 *    Engine fills at the same candle's close (see docs/research/walk-forward-contract.md),
 *    so a trade's signal candle and fill candle are the same candle. They are reported
 *    as one field rather than pretending two independent attributions were derived.
 *  - Regime keys use trend x volatility only. The classifier also emits a liquidity
 *    dimension; it is recorded per candle but is not part of the combination matrix,
 *    matching the work order's own 3x3 + UNKNOWN specification.
 *
 * Never bypasses PaperBroker, never reimplements a mini broker, never re-labels a
 * regime after seeing performance.
 */
const path = require("node:path");
const { canonicalHash } = require("./canonical-hash.js");

const REQUIRED_COST_CONDITIONS = ["BASE", "MODERATE", "SEVERE"];
const TREND_REGIMES = ["UP_TREND", "DOWN_TREND", "RANGE"];
const VOLATILITY_REGIMES = ["LOW_VOLATILITY", "NORMAL_VOLATILITY", "HIGH_VOLATILITY"];

function loadProductionModules(repositoryRoot) {
  const distRoot = path.join(repositoryRoot, "dist", "apps", "desktop", "src");
  return {
    researchDataset: require(path.join(distRoot, "cloud", "researchDataset.js")),
    backtestEngine: require(path.join(distRoot, "strategy", "backtestEngine.js")),
    strategyEngine: require(path.join(distRoot, "strategy", "strategyEngine.js")),
    marketRegime: require(path.join(distRoot, "strategy", "marketRegime.js"))
  };
}

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
const isFiniteNonNegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;

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

  const strategy = request.strategy ?? {};
  if (!isPositiveInteger(strategy.shortWindow)) errors.push("strategy.shortWindow must be a positive integer");
  if (!isPositiveInteger(strategy.longWindow) || strategy.longWindow <= strategy.shortWindow) errors.push("strategy.longWindow must be a positive integer greater than shortWindow");

  const classifier = request.classifier ?? {};
  try { modules.marketRegime.calculateRegimeClassifierId(classifier); }
  catch (error) { errors.push(`classifier config is invalid: ${error instanceof Error ? error.message : String(error)}`); }
  if (request.thresholdSource !== "FIXED_ABSOLUTE") errors.push("thresholdSource must be FIXED_ABSOLUTE (training-quantile mode is not implemented; see file header)");

  const minimumSample = request.minimumSample ?? {};
  for (const key of ["candles", "segments", "trades"]) {
    if (!isNonNegativeInteger(minimumSample[key])) errors.push(`minimumSample.${key} must be a non-negative integer`);
  }

  const transitionWindow = request.transitionWindow ?? {};
  if (!isPositiveInteger(transitionWindow.preCandles)) errors.push("transitionWindow.preCandles must be a positive integer");
  if (!isPositiveInteger(transitionWindow.postCandles)) errors.push("transitionWindow.postCandles must be a positive integer");

  const execution = request.execution ?? {};
  if (!Number.isFinite(execution.initialCash) || execution.initialCash <= 0) errors.push("execution.initialCash must be a positive finite number");
  if (execution.latencyCandles !== undefined && execution.latencyCandles !== 0) errors.push("execution.latencyCandles must be 0 (see file header)");

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

const regimeKey = (trend, volatility) => `${trend}|${volatility}`;

/** Consecutive candles sharing one (trend, volatility) pair become one segment. Short
 * segments are never deleted or merged away -- every labeled candle belongs to exactly
 * one segment. */
function buildSegments(candles, timeline) {
  const segments = [];
  let current = null;
  for (let index = 0; index < candles.length; index += 1) {
    const regime = timeline.points[index].regime;
    const key = regimeKey(regime.trend, regime.volatility);
    if (current && current.key === key) {
      current.endIndex = index;
      current.candleCount += 1;
    } else {
      if (current) segments.push(current);
      current = { segmentId: `SEG-${String(segments.length).padStart(4, "0")}`, key, trend: regime.trend, volatility: regime.volatility, startIndex: index, endIndex: index, candleCount: 1 };
    }
  }
  if (current) segments.push(current);
  return segments.map((segment) => {
    const startCandle = candles[segment.startIndex];
    const endCandle = candles[segment.endIndex];
    return {
      ...segment,
      startTime: startCandle.openTime,
      endTime: endCandle.closeTime,
      startPrice: startCandle.close,
      endPrice: endCandle.close,
      segmentReturn: startCandle.close === 0 ? 0 : endCandle.close / startCandle.close - 1
    };
  });
}

function runStrategy(modules, points, strategy, execConfig) {
  const factory = () => new modules.strategyEngine.SmaCrossoverStrategy(strategy.shortWindow, strategy.longWindow);
  return modules.backtestEngine.runBacktest(points, factory, execConfig);
}

/**
 * Attributes each closed trade to EXACTLY ONE regime -- the regime of the candle the
 * position was entered on (which, under this engine's same-candle fill model, is also
 * the fill candle). The exit candle's regime is recorded separately for reference but
 * is never used to add the trade to a second regime's totals.
 */
function attributeTrades(trades, closeTimeToIndex, timeline) {
  return trades.map((trade) => {
    const entryIndex = closeTimeToIndex.get(trade.entryTime);
    const exitIndex = closeTimeToIndex.get(trade.exitTime);
    const entryRegime = entryIndex == null ? null : timeline.points[entryIndex].regime;
    const exitRegime = exitIndex == null ? null : timeline.points[exitIndex].regime;
    return {
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryIndex: entryIndex ?? null,
      exitIndex: exitIndex ?? null,
      netPnL: trade.netPnL,
      grossPnL: trade.grossPnL,
      fees: trade.fees,
      holdingCandles: entryIndex == null || exitIndex == null ? null : exitIndex - entryIndex,
      entryRegimeKey: entryRegime ? regimeKey(entryRegime.trend, entryRegime.volatility) : "UNATTRIBUTED",
      exitRegimeKey: exitRegime ? regimeKey(exitRegime.trend, exitRegime.volatility) : "UNATTRIBUTED"
    };
  });
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

/** Per-regime drawdown convention: each segment's own equity slice is rescaled onto a
 * running base and concatenated in time order, then a single running peak is applied.
 * This is an aggregation convention over disjoint time slices, NOT a simulation of a
 * portfolio that only traded during that regime. */
function regimeDrawdown(segments, equityByIndex) {
  let base = 1;
  const curve = [];
  for (const segment of segments) {
    const startEquity = equityByIndex[segment.startIndex];
    if (startEquity == null || startEquity === 0) continue;
    for (let index = segment.startIndex; index <= segment.endIndex; index += 1) {
      const equity = equityByIndex[index];
      if (equity == null) continue;
      curve.push({ equity: base * (equity / startEquity) });
    }
    const endEquity = equityByIndex[segment.endIndex];
    if (endEquity != null) base *= endEquity / startEquity;
  }
  return curve.length ? computeMaxDrawdownFromCurve(curve) : 0;
}

/** Buy-and-hold return attributable to a regime: the compounded product of each of its
 * segments' own price returns. Documented as a market-return attribution over that
 * regime's disjoint time slices, not a claim of equivalence with the strategy's basis. */
function regimeBenchmarkReturn(segments) {
  let multiplier = 1;
  for (const segment of segments) multiplier *= (1 + segment.segmentReturn);
  return multiplier - 1;
}

function summarizeRegime(key, segments, attributedTrades, equityByIndex, minimumSample) {
  const regimeSegments = segments.filter((segment) => segment.key === key);
  const candleCount = regimeSegments.reduce((sum, segment) => sum + segment.candleCount, 0);
  const trades = attributedTrades.filter((trade) => trade.entryRegimeKey === key);
  const wins = trades.filter((trade) => trade.netPnL > 0);
  const losses = trades.filter((trade) => trade.netPnL < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.grossPnL, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.grossPnL, 0));
  const netPnL = trades.reduce((sum, trade) => sum + trade.netPnL, 0);
  const fees = trades.reduce((sum, trade) => sum + trade.fees, 0);
  const benchmarkReturn = regimeBenchmarkReturn(regimeSegments);
  const holdingCandles = trades.map((trade) => trade.holdingCandles).filter((value) => value != null).sort((a, b) => a - b);

  let consecutiveLossStreak = 0;
  let currentStreak = 0;
  for (const trade of trades) {
    if (trade.netPnL < 0) { currentStreak += 1; consecutiveLossStreak = Math.max(consecutiveLossStreak, currentStreak); }
    else currentStreak = 0;
  }

  const insufficient = candleCount < minimumSample.candles || regimeSegments.length < minimumSample.segments || trades.length < minimumSample.trades;

  return {
    key,
    trend: key.split("|")[0],
    volatility: key.split("|")[1],
    candleCount,
    segmentCount: regimeSegments.length,
    tradeCount: trades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    grossProfit,
    grossLoss,
    netPnL,
    fees,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
    costToGrossProfitRatio: grossProfit === 0 ? (fees > 0 ? null : 0) : fees / grossProfit,
    averageTradePnL: trades.length ? netPnL / trades.length : 0,
    medianHoldingCandles: holdingCandles.length ? holdingCandles[Math.floor((holdingCandles.length - 1) / 2)] : null,
    consecutiveLossStreak,
    maxDrawdown: regimeDrawdown(regimeSegments, equityByIndex),
    benchmarkReturn,
    insufficientSample: insufficient
  };
}

/**
 * Fixed, pre-declared assessment rules. Evaluated per regime on the BASE cost
 * condition, with SEVERE used only for the STRONG survival requirement. The sample
 * gate is checked FIRST so a lucky rare regime can never be labeled STRONG.
 */
function assessRegime(baseSummary, severeSummary) {
  // A warm-up bucket is not a market state. Candles the classifier could not label are
  // reported separately and are never given a performance verdict, however profitable
  // the trades that happened to open during warm-up were.
  if (baseSummary.trend === "UNKNOWN" || baseSummary.volatility === "UNKNOWN") return "UNCLASSIFIED";
  if (baseSummary.insufficientSample) return "INCONCLUSIVE";
  const costDominates = baseSummary.costToGrossProfitRatio != null && baseSummary.costToGrossProfitRatio >= 0.5;
  if (baseSummary.netPnL < 0 && (costDominates || baseSummary.winRate < 0.25)) return "HOSTILE";
  if (baseSummary.netPnL <= 0) return "WEAK";
  // STRONG additionally requires surviving the SEVERE cost condition with positive PnL.
  // A regime that is only profitable at BASE cost is ACCEPTABLE, never STRONG.
  if (severeSummary.netPnL > 0) return "STRONG";
  return "ACCEPTABLE";
}

/** Fixed, pre-declared strategy-dependency rules over the CONCLUSIVE trend regimes. */
function assessStrategyDependency(trendSummaries) {
  const conclusive = Object.entries(trendSummaries).filter(([, summary]) => !summary.insufficientSample);
  if (conclusive.length === 0) return "INCONCLUSIVE";
  const sign = (value) => (value > 0 ? 1 : value < 0 ? -1 : 0);
  const positives = conclusive.filter(([, summary]) => sign(summary.netPnL) > 0).map(([key]) => key);
  const negatives = conclusive.filter(([, summary]) => sign(summary.netPnL) < 0).map(([key]) => key);

  if (negatives.length === 0) return "BROADLY_STABLE";
  if (negatives.includes("RANGE") && positives.length > 0 && !negatives.some((key) => key !== "RANGE")) return "RANGE_SENSITIVE";
  const trendPositive = positives.includes("UP_TREND") || positives.includes("DOWN_TREND");
  if (trendPositive && negatives.length > 0) return "TREND_DEPENDENT";
  if (positives.length === 0) return "BROADLY_WEAK";
  return "REGIME_UNSTABLE";
}

function buildTransitions(segments, attributedTrades, transitionWindow, candles) {
  const transitions = [];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    const boundaryIndex = current.startIndex;
    const preStart = Math.max(0, boundaryIndex - transitionWindow.preCandles);
    const postEnd = Math.min(candles.length - 1, boundaryIndex + transitionWindow.postCandles - 1);
    const preTrades = attributedTrades.filter((trade) => trade.entryIndex != null && trade.entryIndex >= preStart && trade.entryIndex < boundaryIndex);
    const postTrades = attributedTrades.filter((trade) => trade.entryIndex != null && trade.entryIndex >= boundaryIndex && trade.entryIndex <= postEnd);
    transitions.push({
      fromKey: previous.key,
      toKey: current.key,
      boundaryIndex,
      boundaryTime: candles[boundaryIndex].openTime,
      preTradeCount: preTrades.length,
      postTradeCount: postTrades.length,
      preNetPnL: preTrades.reduce((sum, trade) => sum + trade.netPnL, 0),
      postNetPnL: postTrades.reduce((sum, trade) => sum + trade.netPnL, 0),
      postLossCount: postTrades.filter((trade) => trade.netPnL < 0).length
    });
  }
  return transitions;
}

function runRegimeAnalysisRequest(request, options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, "..", "..");
  const modules = loadProductionModules(repositoryRoot);

  const requestErrors = validateRequest(request, modules);
  if (requestErrors.length > 0) {
    return { schemaVersion: 1, requestId: request && request.id, status: "FAIL", coverage: null, segments: [], regimes: [], transitions: [], aggregate: null, warnings: [], failures: requestErrors, hashes: null };
  }

  const candles = request.candles;
  const timeline = modules.marketRegime.buildRegimeTimeline(candles, request.classifier);
  const points = modules.researchDataset.candlesToBacktestPoints(candles);
  const closeTimeToIndex = new Map(candles.map((candle, index) => [candle.closeTime, index]));
  const segments = buildSegments(candles, timeline);

  const unknownCandles = timeline.points.filter((entry) => entry.regime.trend === "UNKNOWN" || entry.regime.volatility === "UNKNOWN").length;
  const coverage = {
    totalCandles: candles.length,
    labeledCandles: candles.length - unknownCandles,
    unknownCandles,
    coverageRatio: candles.length ? (candles.length - unknownCandles) / candles.length : 0,
    segmentCount: segments.length,
    warmUpCandles: Math.max(request.classifier.trendLookback, request.classifier.volatilityLookback, request.classifier.minimumSamples)
  };

  const failures = [];
  const perCondition = {};
  for (const cost of request.costConditions) {
    const execConfig = {
      market: request.market,
      initialCash: request.execution.initialCash,
      feeRate: cost.feeRate,
      orderQuantity: request.execution.orderQuantity,
      riskPolicy: request.execution.riskPolicy,
      executionCosts: { spreadBps: request.execution.executionCosts?.spreadBps ?? 0, slippageBps: cost.slippageBps }
    };
    const backtest = runStrategy(modules, points, request.strategy, execConfig);
    const equityByIndex = [];
    for (const entry of backtest.equityCurve) {
      const index = closeTimeToIndex.get(entry.timestamp);
      if (index != null) equityByIndex[index] = entry.equity;
    }
    const attributed = attributeTrades(backtest.trades, closeTimeToIndex, timeline);
    const unattributed = attributed.filter((trade) => trade.entryRegimeKey === "UNATTRIBUTED").length;
    if (unattributed > 0) failures.push(`${cost.name}: ${unattributed} trade(s) could not be attributed to a regime candle`);
    perCondition[cost.name] = { backtest, attributed, equityByIndex };
  }

  const allKeys = [];
  for (const trend of [...TREND_REGIMES, "UNKNOWN"]) {
    for (const volatility of [...VOLATILITY_REGIMES, "UNKNOWN"]) allKeys.push(regimeKey(trend, volatility));
  }
  const observedKeys = allKeys.filter((key) => segments.some((segment) => segment.key === key));

  const regimes = observedKeys.map((key) => {
    const byCondition = Object.fromEntries(REQUIRED_COST_CONDITIONS.map((name) => [
      name,
      summarizeRegime(key, segments, perCondition[name].attributed, perCondition[name].equityByIndex, request.minimumSample)
    ]));
    return { key, trend: key.split("|")[0], volatility: key.split("|")[1], byCondition, assessment: assessRegime(byCondition.BASE, byCondition.SEVERE) };
  });

  // Trend-only and volatility-only rollups reuse the same one-trade-one-regime rule:
  // a trade is counted under its entry regime's trend bucket and its volatility bucket,
  // but never twice inside the same bucket dimension.
  const rollup = (dimensionValues, extract) => Object.fromEntries(dimensionValues.map((value) => {
    const keys = observedKeys.filter((key) => extract(key) === value);
    const merged = Object.fromEntries(REQUIRED_COST_CONDITIONS.map((name) => {
      const parts = regimes.filter((regime) => keys.includes(regime.key)).map((regime) => regime.byCondition[name]);
      const netPnL = parts.reduce((sum, part) => sum + part.netPnL, 0);
      const fees = parts.reduce((sum, part) => sum + part.fees, 0);
      const tradeCount = parts.reduce((sum, part) => sum + part.tradeCount, 0);
      const candleCount = parts.reduce((sum, part) => sum + part.candleCount, 0);
      const segmentCount = parts.reduce((sum, part) => sum + part.segmentCount, 0);
      const winCount = parts.reduce((sum, part) => sum + part.winCount, 0);
      const grossProfit = parts.reduce((sum, part) => sum + part.grossProfit, 0);
      const grossLoss = parts.reduce((sum, part) => sum + part.grossLoss, 0);
      const relevantSegments = segments.filter((segment) => keys.includes(segment.key));
      return [name, {
        candleCount, segmentCount, tradeCount, winCount,
        winRate: tradeCount ? winCount / tradeCount : 0,
        grossProfit, grossLoss, netPnL, fees,
        profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
        costToGrossProfitRatio: grossProfit === 0 ? (fees > 0 ? null : 0) : fees / grossProfit,
        maxDrawdown: regimeDrawdown(relevantSegments, perCondition[name].equityByIndex),
        benchmarkReturn: regimeBenchmarkReturn(relevantSegments),
        insufficientSample: candleCount < request.minimumSample.candles || segmentCount < request.minimumSample.segments || tradeCount < request.minimumSample.trades
      }];
    }));
    return [value, { ...merged, assessment: assessRegime(merged.BASE, merged.SEVERE) }];
  }));

  const trendSummaries = rollup(TREND_REGIMES, (key) => key.split("|")[0]);
  const volatilitySummaries = rollup(VOLATILITY_REGIMES, (key) => key.split("|")[1]);
  const transitions = buildTransitions(segments, perCondition.BASE.attributed, request.transitionWindow, candles);

  const strategyDependency = assessStrategyDependency(Object.fromEntries(Object.entries(trendSummaries).map(([key, value]) => [key, value.BASE])));

  const totalBaseTrades = perCondition.BASE.attributed.length;
  const attributedTradeSum = regimes.reduce((sum, regime) => sum + regime.byCondition.BASE.tradeCount, 0);
  if (attributedTradeSum !== totalBaseTrades) failures.push(`trade attribution does not partition all trades: ${attributedTradeSum} attributed vs ${totalBaseTrades} total`);

  const aggregate = {
    strategyDependency,
    totalTrades: totalBaseTrades,
    totalNetPnL: perCondition.BASE.attributed.reduce((sum, trade) => sum + trade.netPnL, 0),
    totalFees: perCondition.BASE.attributed.reduce((sum, trade) => sum + trade.fees, 0),
    observedRegimeCount: observedKeys.length,
    inconclusiveRegimeCount: regimes.filter((regime) => regime.assessment === "INCONCLUSIVE").length,
    hostileRegimeCount: regimes.filter((regime) => regime.assessment === "HOSTILE").length,
    strongestRegime: [...regimes].filter((r) => r.assessment !== "INCONCLUSIVE" && r.assessment !== "UNCLASSIFIED").sort((a, b) => b.byCondition.BASE.netPnL - a.byCondition.BASE.netPnL)[0]?.key ?? null,
    weakestRegime: [...regimes].filter((r) => r.assessment !== "INCONCLUSIVE" && r.assessment !== "UNCLASSIFIED").sort((a, b) => a.byCondition.BASE.netPnL - b.byCondition.BASE.netPnL)[0]?.key ?? null,
    unclassifiedRegimeCount: regimes.filter((regime) => regime.assessment === "UNCLASSIFIED").length,
    transitionCount: transitions.length
  };

  const warnings = [];
  if (coverage.coverageRatio < 0.5) warnings.push("UNKNOWN_REGIME_DOMINATES");
  if (aggregate.hostileRegimeCount > 0) warnings.push("HOSTILE_REGIME_PRESENT");
  if (aggregate.inconclusiveRegimeCount > observedKeys.length / 2) warnings.push("MAJORITY_REGIMES_INCONCLUSIVE");
  for (const warning of timeline.warnings) warnings.push(`CLASSIFIER_${warning}`);

  const result = {
    schemaVersion: 1,
    requestId: request.id,
    status: failures.length === 0 ? "PASS" : "FAIL",
    dataset: { market: request.market, candleCount: candles.length, datasetContentSha256: modules.researchDataset.calculateCandleSha256(candles) },
    classification: {
      classifierId: timeline.classifierId,
      classifierVersion: request.classifier.classifierVersion,
      thresholdSource: "FIXED_ABSOLUTE",
      trendLookback: request.classifier.trendLookback,
      volatilityLookback: request.classifier.volatilityLookback,
      trendThreshold: request.classifier.trendThreshold,
      lowVolatilityThreshold: request.classifier.lowVolatilityThreshold,
      highVolatilityThreshold: request.classifier.highVolatilityThreshold,
      entryAttribution: "ENTRY_SIGNAL_REGIME (identical to ENTRY_FILL_REGIME under same-candle fill)"
    },
    strategy: request.strategy,
    minimumSample: request.minimumSample,
    costConditions: request.costConditions,
    coverage,
    segments,
    regimes,
    trendSummaries,
    volatilitySummaries,
    transitions,
    aggregate,
    warnings,
    failures
  };
  result.hashes = {
    requestSha256: canonicalHash(request),
    datasetContentSha256: result.dataset.datasetContentSha256,
    classificationConfigSha256: canonicalHash(request.classifier),
    classifierId: timeline.classifierId,
    labelsSha256: canonicalHash(timeline.points.map((entry) => regimeKey(entry.regime.trend, entry.regime.volatility))),
    segmentsSha256: canonicalHash(segments),
    performanceSha256: canonicalHash(regimes),
    aggregateResultSha256: canonicalHash(aggregate)
  };
  return result;
}

module.exports = { runRegimeAnalysisRequest, validateRequest, buildSegments, assessRegime, assessStrategyDependency, regimeBenchmarkReturn, regimeKey };
