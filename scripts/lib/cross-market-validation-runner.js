"use strict";
/**
 * Deterministic cross-market / cross-period validation runner (WO-0030).
 *
 * Answers: did this strategy only work on one symbol during one stretch of history, or
 * does it behave consistently across several markets and several periods?
 *
 * SCOPE NOTE: same reuse decision as WO-0027/0028/0029 (see
 * docs/research/walk-forward-contract.md). No MarketCandle/HistoricalDatasetDescriptor
 * contract exists in this repository, so this reuses the real production modules
 * apps/desktop/src/{researchDataset,backtestEngine,strategyEngine}.ts. It never bypasses
 * PaperBroker and never reimplements a mini broker. `execution.latencyCandles` is
 * accepted only as 0 and rejected otherwise, never silently ignored.
 *
 * HARD FAIRNESS RULES, enforced by construction rather than by convention:
 *   - Every cell runs the SAME strategy parameters. There is no per-market parameter
 *     selection anywhere in this module.
 *   - Every cell runs the SAME cost conditions and the SAME risk policy.
 *   - Every dataset must share one timeframe AND one quote currency; a mixed request is
 *     rejected rather than silently resampled or converted.
 *   - A cell that cannot be evaluated is reported BLOCKED and counted. It is never
 *     silently dropped, and a losing cell is never excluded.
 *
 * SIZING COMPARABILITY. A fixed order quantity applied to markets at very different
 * price levels buys very different notional exposure (0.001 units is ~100 KRW of a
 * 100,000 KRW asset but ~0.8 KRW of an 800 KRW asset). Net-PnL contribution compared
 * across such markets measures the sizing policy, not the strategy, so when the
 * notional spread exceeds the declared tolerance the concentration analysis is reported
 * NOT_COMPARABLE instead of producing a number that looks meaningful and is not.
 *
 * DATA PROVENANCE. `dataProvenance` must be declared. When it is SYNTHETIC_FIXTURE the
 * research assessment is forced to INCONCLUSIVE no matter how the synthetic numbers
 * come out: exercising the pipeline on invented candles is an implementation result,
 * never a research finding about a market.
 */
const path = require("node:path");
const { canonicalHash } = require("./canonical-hash.js");

const REQUIRED_COST_CONDITIONS = ["BASE", "MODERATE", "SEVERE"];
const FIXED_BENCHMARK_PARAMETER = Object.freeze({ shortWindow: 5, longWindow: 20 });
/** Mirrors apps/desktop/src/strategy/backtestEngine.ts's DEFAULT_ORDER_QUANTITY. */
const DEFAULT_ORDER_QUANTITY = 0.001;
/** A market may carry at most this many times another market's notional before
 * cross-market net-PnL comparison is declared meaningless. */
const DEFAULT_NOTIONAL_SPREAD_TOLERANCE = 2;

function loadProductionModules(repositoryRoot) {
  const distRoot = path.join(repositoryRoot, "dist", "apps", "desktop", "src");
  return {
    researchDataset: require(path.join(distRoot, "cloud", "researchDataset.js")),
    backtestEngine: require(path.join(distRoot, "strategy", "backtestEngine.js")),
    strategyEngine: require(path.join(distRoot, "strategy", "strategyEngine.js"))
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

  if (!["SYNTHETIC_FIXTURE", "REAL_MARKET_DATA"].includes(request.dataProvenance)) {
    errors.push("request.dataProvenance must be declared as SYNTHETIC_FIXTURE or REAL_MARKET_DATA");
  }

  const comparison = request.comparisonPolicy ?? {};
  if (comparison.timeframePolicy !== "REQUIRE_EQUAL") errors.push("comparisonPolicy.timeframePolicy must be REQUIRE_EQUAL (automatic resampling is not supported)");
  if (comparison.quoteCurrencyPolicy !== "REQUIRE_EQUAL") errors.push("comparisonPolicy.quoteCurrencyPolicy must be REQUIRE_EQUAL (automatic currency conversion is not supported)");
  if (!["EQUAL_INITIAL_CAPITAL", "NO_CROSS_MARKET_AGGREGATION"].includes(comparison.aggregationPolicy)) {
    errors.push("comparisonPolicy.aggregationPolicy must be EQUAL_INITIAL_CAPITAL or NO_CROSS_MARKET_AGGREGATION");
  }
  if (comparison.notionalSpreadTolerance !== undefined && (!Number.isFinite(comparison.notionalSpreadTolerance) || comparison.notionalSpreadTolerance < 1)) {
    errors.push("comparisonPolicy.notionalSpreadTolerance must be a finite number >= 1 when present");
  }

  const strategy = request.strategy ?? {};
  if (strategy.kind !== "SMA_CROSSOVER") errors.push(`unsupported strategy.kind: ${strategy.kind}`);
  if (!isPositiveInteger(strategy.shortWindow)) errors.push("strategy.shortWindow must be a positive integer");
  if (!isPositiveInteger(strategy.longWindow) || strategy.longWindow <= strategy.shortWindow) errors.push("strategy.longWindow must be a positive integer greater than shortWindow");

  const datasets = request.datasets;
  if (!Array.isArray(datasets) || datasets.length === 0) {
    errors.push("request.datasets must be a non-empty array");
    return errors;
  }

  const seenDatasetIds = new Set();
  const seenCells = new Set();
  const intervals = new Set();
  const quoteCurrencies = new Set();
  const symbols = new Set();
  const periods = new Set();
  for (const dataset of datasets) {
    if (typeof dataset?.quoteCurrency !== "string" || dataset.quoteCurrency.length === 0) errors.push(`dataset ${dataset?.datasetId}: quoteCurrency must be a non-empty string`);
    else quoteCurrencies.add(dataset.quoteCurrency);
    if (typeof dataset?.datasetId !== "string" || dataset.datasetId.length === 0) { errors.push("every dataset needs a non-empty datasetId"); continue; }
    if (seenDatasetIds.has(dataset.datasetId)) errors.push(`duplicate datasetId: ${dataset.datasetId}`);
    seenDatasetIds.add(dataset.datasetId);
    if (typeof dataset.symbol !== "string" || dataset.symbol.length === 0) errors.push(`dataset ${dataset.datasetId}: symbol must be a non-empty string`);
    if (typeof dataset.periodLabel !== "string" || dataset.periodLabel.length === 0) errors.push(`dataset ${dataset.datasetId}: periodLabel must be a non-empty string`);
    const cellKey = `${dataset.symbol}|${dataset.periodLabel}`;
    if (seenCells.has(cellKey)) errors.push(`duplicate market/period cell: ${cellKey}`);
    seenCells.add(cellKey);
    symbols.add(dataset.symbol);
    periods.add(dataset.periodLabel);

    if (!Array.isArray(dataset.candles) || dataset.candles.length === 0) { errors.push(`dataset ${dataset.datasetId}: candles must be a non-empty array`); continue; }
    try { modules.researchDataset.validateResearchCandles(dataset.candles, { allowMissing: false }); }
    catch (error) { errors.push(`dataset ${dataset.datasetId}: candles failed validation: ${error instanceof Error ? error.message : String(error)}`); continue; }
    intervals.add(dataset.candles[0].interval);
    if (dataset.candles[0].market !== dataset.symbol) errors.push(`dataset ${dataset.datasetId}: candle market ${dataset.candles[0].market} does not match declared symbol ${dataset.symbol}`);
  }

  if (intervals.size > 1) errors.push(`mixed timeframes are not comparable: found ${[...intervals].join(", ")}`);
  if (quoteCurrencies.size > 1) errors.push(`mixed quote currencies are not comparable: found ${[...quoteCurrencies].join(", ")}`);
  if (symbols.size < 2) errors.push("cross-market validation requires at least 2 distinct symbols");
  if (periods.size < 2) errors.push("cross-period validation requires at least 2 distinct period labels");

  if (!isNonNegativeInteger(request.minimumSample?.candlesPerCell)) errors.push("minimumSample.candlesPerCell must be a non-negative integer");
  if (!isNonNegativeInteger(request.minimumSample?.tradesPerCell)) errors.push("minimumSample.tradesPerCell must be a non-negative integer");

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

/** Canonical cell ordering: symbol asc, then period start time asc, then datasetId asc. */
function buildCellPlan(datasets) {
  return [...datasets]
    .map((dataset) => ({
      datasetId: dataset.datasetId,
      symbol: dataset.symbol,
      periodLabel: dataset.periodLabel,
      startTime: dataset.candles[0].openTime,
      endTime: dataset.candles[dataset.candles.length - 1].closeTime,
      candleCount: dataset.candles.length
    }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.startTime - b.startTime || a.datasetId.localeCompare(b.datasetId));
}

/** The window during which every symbol has data. Used only for the direct
 * market-to-market comparison, never mixed with the full-available-period view. */
function computeCommonPeriod(datasets) {
  const bySymbol = new Map();
  for (const dataset of datasets) {
    const start = dataset.candles[0].openTime;
    const end = dataset.candles[dataset.candles.length - 1].closeTime;
    const existing = bySymbol.get(dataset.symbol);
    if (!existing) bySymbol.set(dataset.symbol, { start, end });
    else bySymbol.set(dataset.symbol, { start: Math.min(existing.start, start), end: Math.max(existing.end, end) });
  }
  let start = -Infinity;
  let end = Infinity;
  for (const range of bySymbol.values()) {
    start = Math.max(start, range.start);
    end = Math.min(end, range.end);
  }
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { startTime: start, endTime: end } : null;
}

function runCell(modules, candles, strategy, execConfig) {
  const points = modules.researchDataset.candlesToBacktestPoints(candles);
  const factory = () => new modules.strategyEngine.SmaCrossoverStrategy(strategy.shortWindow, strategy.longWindow);
  return modules.backtestEngine.runBacktest(points, factory, execConfig);
}

function summarizeCell(result) {
  return {
    totalReturn: result.metrics.totalReturn,
    maxDrawdown: result.metrics.maxDrawdown,
    profitFactor: result.performance.profitFactor ?? null,
    tradeCount: result.performance.trades,
    netProfit: result.performance.netProfit,
    fees: result.metrics.feesPaid,
    buyAndHoldReturn: result.benchmark.buyAndHoldReturn,
    benchmarkExcessReturn: result.benchmark.outperformance
  };
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
};

function evaluateCells(modules, datasets, request, sliceToCommonPeriod) {
  const commonPeriod = sliceToCommonPeriod ? computeCommonPeriod(datasets) : null;
  const cells = [];
  for (const cell of buildCellPlan(datasets)) {
    const dataset = datasets.find((entry) => entry.datasetId === cell.datasetId);
    let candles = dataset.candles;
    if (sliceToCommonPeriod) {
      if (!commonPeriod) {
        cells.push({ ...cell, status: "BLOCKED", blockedReason: "NO_COMMON_PERIOD" });
        continue;
      }
      candles = candles.filter((candle) => candle.openTime >= commonPeriod.startTime && candle.closeTime <= commonPeriod.endTime);
    }
    if (candles.length < request.minimumSample.candlesPerCell || candles.length <= request.strategy.longWindow) {
      cells.push({ ...cell, status: "BLOCKED", blockedReason: "INSUFFICIENT_DATA", availableCandles: candles.length });
      continue;
    }

    const byCondition = {};
    for (const cost of request.costConditions) {
      const execConfig = {
        market: dataset.symbol,
        initialCash: request.execution.initialCash,
        feeRate: cost.feeRate,
        orderQuantity: request.execution.orderQuantity,
        riskPolicy: request.execution.riskPolicy,
        executionCosts: { spreadBps: request.execution.executionCosts?.spreadBps ?? 0, slippageBps: cost.slippageBps }
      };
      byCondition[cost.name] = summarizeCell(runCell(modules, candles, request.strategy, execConfig));
    }

    // Fixed 5/20 benchmark: the production default re-run on the exact same cell with
    // the exact same BASE cost assumptions. Never re-selected per market.
    const baseCost = request.costConditions.find((c) => c.name === "BASE");
    const fixedResult = runCell(modules, candles, FIXED_BENCHMARK_PARAMETER, {
      market: dataset.symbol,
      initialCash: request.execution.initialCash,
      feeRate: baseCost.feeRate,
      orderQuantity: request.execution.orderQuantity,
      riskPolicy: request.execution.riskPolicy,
      executionCosts: { spreadBps: request.execution.executionCosts?.spreadBps ?? 0, slippageBps: baseCost.slippageBps }
    });

    const base = byCondition.BASE;
    cells.push({
      ...cell,
      evaluatedCandleCount: candles.length,
      status: base.tradeCount < request.minimumSample.tradesPerCell ? "INCONCLUSIVE" : "PASS",
      byCondition,
      benchmarks: {
        cashReturn: 0,
        buyAndHoldReturn: base.buyAndHoldReturn,
        fixedParameter5x20Return: fixedResult.metrics.totalReturn
      },
      beatsCash: base.totalReturn > 0,
      beatsBuyAndHold: base.totalReturn > base.buyAndHoldReturn,
      beatsFixed5x20: base.totalReturn > fixedResult.metrics.totalReturn
    });
  }
  return { cells, commonPeriod };
}

function summarizeGroup(cells, keyName) {
  const groups = new Map();
  for (const cell of cells) {
    const key = cell[keyName];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(cell);
  }
  const summaries = [];
  for (const [key, groupCells] of [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const evaluated = groupCells.filter((cell) => cell.status !== "BLOCKED");
    const returns = evaluated.map((cell) => cell.byCondition.BASE.totalReturn);
    summaries.push({
      key,
      cellCount: groupCells.length,
      evaluatedCellCount: evaluated.length,
      blockedCellCount: groupCells.filter((cell) => cell.status === "BLOCKED").length,
      inconclusiveCellCount: groupCells.filter((cell) => cell.status === "INCONCLUSIVE").length,
      positiveCellCount: evaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length,
      negativeCellCount: evaluated.filter((cell) => cell.byCondition.BASE.totalReturn < 0).length,
      cashOutperformCount: evaluated.filter((cell) => cell.beatsCash).length,
      buyAndHoldOutperformCount: evaluated.filter((cell) => cell.beatsBuyAndHold).length,
      medianReturn: median(returns),
      worstReturn: returns.length ? Math.min(...returns) : 0,
      bestReturn: returns.length ? Math.max(...returns) : 0,
      medianMaxDrawdown: median(evaluated.map((cell) => cell.byCondition.BASE.maxDrawdown)),
      worstMaxDrawdown: evaluated.length ? Math.max(...evaluated.map((cell) => cell.byCondition.BASE.maxDrawdown)) : 0,
      totalTrades: evaluated.reduce((sum, cell) => sum + cell.byCondition.BASE.tradeCount, 0),
      totalNetProfit: evaluated.reduce((sum, cell) => sum + cell.byCondition.BASE.netProfit, 0),
      severeSurvivorCount: evaluated.filter((cell) => cell.byCondition.SEVERE.totalReturn > 0).length
    });
  }
  return summaries;
}

/**
 * Is net PnL comparable across these markets at all?
 *
 * With a fixed order quantity, notional exposure scales with price level. Comparing
 * net PnL between a 100,000 KRW asset and an 800 KRW asset then measures the sizing
 * policy rather than the strategy. This computes the per-market typical notional and
 * declares comparability only when the spread stays inside the declared tolerance.
 */
function assessSizingComparability(datasets, orderQuantity, tolerance) {
  if (!Number.isFinite(orderQuantity) || orderQuantity <= 0) {
    return { comparable: false, reason: "ORDER_QUANTITY_UNDECLARED", notionalByMarket: {}, notionalSpreadRatio: null, tolerance };
  }
  const notionalByMarket = {};
  for (const dataset of datasets) {
    const prices = dataset.candles.map((candle) => candle.close).sort((a, b) => a - b);
    const medianPrice = prices[Math.floor((prices.length - 1) / 2)];
    const notional = medianPrice * orderQuantity;
    notionalByMarket[dataset.symbol] = Math.max(notionalByMarket[dataset.symbol] ?? 0, notional);
  }
  const values = Object.values(notionalByMarket);
  const spread = values.length ? Math.max(...values) / Math.min(...values) : 1;
  return {
    comparable: spread <= tolerance,
    reason: spread <= tolerance ? null : "NOTIONAL_EXPOSURE_SPREAD_EXCEEDS_TOLERANCE",
    notionalByMarket,
    notionalSpreadRatio: spread,
    tolerance
  };
}

/** Contribution concentration measured on absolute net profit, so a single dominant
 * winner cannot hide behind an averaged return. */
function analyzeConcentration(cells, keyName) {
  const evaluated = cells.filter((cell) => cell.status !== "BLOCKED");
  const totals = new Map();
  for (const cell of evaluated) {
    const key = keyName ? cell[keyName] : `${cell.symbol}|${cell.periodLabel}`;
    totals.set(key, (totals.get(key) ?? 0) + cell.byCondition.BASE.netProfit);
  }
  const magnitudes = [...totals.entries()].map(([key, value]) => ({ key, netProfit: value, magnitude: Math.abs(value) }));
  const totalMagnitude = magnitudes.reduce((sum, entry) => sum + entry.magnitude, 0);
  const sorted = [...magnitudes].sort((a, b) => b.magnitude - a.magnitude);
  return {
    topKey: sorted[0]?.key ?? null,
    topContributionRatio: totalMagnitude > 0 ? (sorted[0]?.magnitude ?? 0) / totalMagnitude : 0,
    negativeContributors: magnitudes.filter((entry) => entry.netProfit < 0).map((entry) => entry.key)
  };
}

/**
 * Fixed, pre-declared generalization rules. Sample gates are checked first so a thin
 * matrix can never be called generalizable, and an incomparable sizing policy also
 * forces INCONCLUSIVE -- a pattern computed from an apples-to-oranges comparison is
 * not a finding.
 */
function assessGeneralization(cells, marketSummaries, periodSummaries, sizingComparability) {
  const evaluated = cells.filter((cell) => cell.status === "PASS");
  if (evaluated.length === 0) return "INCONCLUSIVE";
  if (marketSummaries.length < 2 || periodSummaries.length < 2) return "INCONCLUSIVE";
  if (evaluated.length < cells.length / 2) return "INCONCLUSIVE";
  if (sizingComparability && sizingComparability.comparable === false) return "INCONCLUSIVE";

  const positiveRatio = evaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length / evaluated.length;
  const buyAndHoldRatio = evaluated.filter((cell) => cell.beatsBuyAndHold).length / evaluated.length;

  // "Concentrated" means the wins CLUSTER in some markets/periods and are absent from
  // others. Requiring a group to be uniformly positive was wrong: a market that is
  // positive in every period and a period that is negative in every market cannot both
  // exist (their shared cell would have to be both), which made the combined branch
  // unreachable. The test is therefore "some group has no wins at all, while some other
  // group has at least one".
  const marketsWithNoWins = marketSummaries.filter((summary) => summary.evaluatedCellCount > 0 && summary.positiveCellCount === 0);
  const marketsWithWins = marketSummaries.filter((summary) => summary.evaluatedCellCount > 0 && summary.positiveCellCount > 0);
  const periodsWithNoWins = periodSummaries.filter((summary) => summary.evaluatedCellCount > 0 && summary.positiveCellCount === 0);
  const periodsWithWins = periodSummaries.filter((summary) => summary.evaluatedCellCount > 0 && summary.positiveCellCount > 0);

  const marketSplit = marketsWithNoWins.length > 0 && marketsWithWins.length > 0;
  const periodSplit = periodsWithNoWins.length > 0 && periodsWithWins.length > 0;

  // Checked before the concentration branches: when almost everything loses, "weak" is
  // the honest headline, not "concentrated".
  if (positiveRatio <= 0.25) return "BROADLY_WEAK";
  if (marketSplit && periodSplit) return "MARKET_AND_PERIOD_CONCENTRATED";
  if (marketSplit) return "MARKET_CONCENTRATED";
  if (periodSplit) return "PERIOD_CONCENTRATED";
  if (positiveRatio >= 0.6 && buyAndHoldRatio >= 0.5) return "BROADLY_GENERALIZABLE";
  if (positiveRatio >= 0.4) return "MIXED";
  return "INCONSISTENT";
}

function buildView(modules, request, sliceToCommonPeriod, sizingComparability) {
  const { cells, commonPeriod } = evaluateCells(modules, request.datasets, request, sliceToCommonPeriod);
  const marketSummaries = summarizeGroup(cells, "symbol");
  const periodSummaries = summarizeGroup(cells, "periodLabel");
  const evaluated = cells.filter((cell) => cell.status === "PASS");

  const aggregate = {
    marketCount: marketSummaries.length,
    periodCount: periodSummaries.length,
    cellCount: cells.length,
    evaluatedCellCount: evaluated.length,
    blockedCellCount: cells.filter((cell) => cell.status === "BLOCKED").length,
    inconclusiveCellCount: cells.filter((cell) => cell.status === "INCONCLUSIVE").length,
    positiveCellRatio: evaluated.length ? evaluated.filter((cell) => cell.byCondition.BASE.totalReturn > 0).length / evaluated.length : 0,
    cashOutperformRatio: evaluated.length ? evaluated.filter((cell) => cell.beatsCash).length / evaluated.length : 0,
    buyAndHoldOutperformRatio: evaluated.length ? evaluated.filter((cell) => cell.beatsBuyAndHold).length / evaluated.length : 0,
    fixed5x20OutperformRatio: evaluated.length ? evaluated.filter((cell) => cell.beatsFixed5x20).length / evaluated.length : 0,
    medianCellReturn: median(evaluated.map((cell) => cell.byCondition.BASE.totalReturn)),
    worstCellReturn: evaluated.length ? Math.min(...evaluated.map((cell) => cell.byCondition.BASE.totalReturn)) : 0,
    bestCellReturn: evaluated.length ? Math.max(...evaluated.map((cell) => cell.byCondition.BASE.totalReturn)) : 0,
    worstCellMaxDrawdown: evaluated.length ? Math.max(...evaluated.map((cell) => cell.byCondition.BASE.maxDrawdown)) : 0,
    severeCostSurvivalRatio: evaluated.length ? evaluated.filter((cell) => cell.byCondition.SEVERE.totalReturn > 0).length / evaluated.length : 0,
    noTradeCellCount: evaluated.filter((cell) => cell.byCondition.BASE.tradeCount === 0).length
  };

  // Net-PnL contribution is only meaningful when every market carries a comparable
  // notional. When it does not, the numbers are withheld rather than published with a
  // caveat nobody reads.
  const aggregationBlocked = request.comparisonPolicy.aggregationPolicy === "NO_CROSS_MARKET_AGGREGATION" || sizingComparability.comparable === false;
  const concentration = aggregationBlocked
    ? {
        status: "NOT_COMPARABLE",
        reason: sizingComparability.comparable === false ? sizingComparability.reason : "AGGREGATION_POLICY_DISABLED",
        byMarket: null,
        byPeriod: null,
        byCell: null
      }
    : {
        status: "COMPUTED",
        reason: null,
        byMarket: analyzeConcentration(cells, "symbol"),
        byPeriod: analyzeConcentration(cells, "periodLabel"),
        byCell: analyzeConcentration(cells, null)
      };

  return {
    commonPeriod: sliceToCommonPeriod ? commonPeriod : null,
    cells,
    marketSummaries,
    periodSummaries,
    aggregate,
    concentration,
    generalizationAssessment: assessGeneralization(cells, marketSummaries, periodSummaries, sizingComparability)
  };
}

function runCrossMarketValidation(request, options = {}) {
  const repositoryRoot = options.repositoryRoot || path.resolve(__dirname, "..", "..");
  const modules = loadProductionModules(repositoryRoot);

  const requestErrors = validateRequest(request, modules);
  if (requestErrors.length > 0) {
    return { schemaVersion: 1, requestId: request && request.id, status: "FAIL", fullAvailablePeriod: null, commonPeriod: null, warnings: [], failures: requestErrors, hashes: null };
  }

  const sizingComparability = assessSizingComparability(
    request.datasets,
    request.execution.orderQuantity ?? DEFAULT_ORDER_QUANTITY,
    request.comparisonPolicy.notionalSpreadTolerance ?? DEFAULT_NOTIONAL_SPREAD_TOLERANCE
  );

  const fullAvailablePeriod = buildView(modules, request, false, sizingComparability);
  const commonPeriodView = buildView(modules, request, true, sizingComparability);

  const warnings = [];
  if (fullAvailablePeriod.concentration.status === "COMPUTED") {
    if (fullAvailablePeriod.concentration.byCell.topContributionRatio >= 0.5) warnings.push("PROFIT_CONCENTRATED_IN_ONE_CELL");
    if (fullAvailablePeriod.concentration.byMarket.topContributionRatio >= 0.6) warnings.push("PROFIT_CONCENTRATED_IN_ONE_MARKET");
  } else {
    warnings.push(`CONCENTRATION_NOT_COMPARABLE:${fullAvailablePeriod.concentration.reason}`);
  }
  if (!sizingComparability.comparable) warnings.push("FIXED_QUANTITY_PRODUCES_UNEQUAL_NOTIONAL_EXPOSURE_ACROSS_MARKETS");
  if (fullAvailablePeriod.aggregate.blockedCellCount > 0) warnings.push("BLOCKED_CELLS_PRESENT");
  if (fullAvailablePeriod.aggregate.inconclusiveCellCount > 0) warnings.push("INCONCLUSIVE_CELLS_PRESENT");
  if (fullAvailablePeriod.generalizationAssessment !== commonPeriodView.generalizationAssessment) warnings.push("FULL_PERIOD_AND_COMMON_PERIOD_DISAGREE");
  if (request.dataProvenance === "SYNTHETIC_FIXTURE") warnings.push("SYNTHETIC_DATA_NO_RESEARCH_CONCLUSION");

  const result = {
    schemaVersion: 1,
    requestId: request.id,
    status: "PASS",
    strategy: request.strategy,
    execution: request.execution,
    costConditions: request.costConditions,
    minimumSample: request.minimumSample,
    datasets: request.datasets.map((dataset) => ({
      datasetId: dataset.datasetId,
      symbol: dataset.symbol,
      periodLabel: dataset.periodLabel,
      candleCount: dataset.candles.length,
      interval: dataset.candles[0].interval,
      startTime: dataset.candles[0].openTime,
      endTime: dataset.candles[dataset.candles.length - 1].closeTime,
      contentSha256: modules.researchDataset.calculateCandleSha256(dataset.candles)
    })),
    fullAvailablePeriod,
    commonPeriod: commonPeriodView,
    sizingComparability,
    // Technical execution and research judgement are reported separately, and the
    // research judgement is gated on provenance: a pattern computed from invented
    // candles exercises the pipeline, it does not describe a market. It is surfaced as
    // `syntheticPatternObserved` so it can never be mistaken for a finding.
    executionStatus: "PASS",
    researchAssessment: request.dataProvenance === "SYNTHETIC_FIXTURE" ? "INCONCLUSIVE" : fullAvailablePeriod.generalizationAssessment,
    researchAssessmentBasis: request.dataProvenance === "SYNTHETIC_FIXTURE"
      ? "Forced to INCONCLUSIVE: dataProvenance is SYNTHETIC_FIXTURE, so no market conclusion is drawn regardless of the computed pattern."
      : "Derived from the full-available-period generalization rules over real market data.",
    syntheticPatternObserved: request.dataProvenance === "SYNTHETIC_FIXTURE" ? fullAvailablePeriod.generalizationAssessment : null,
    dataProvenance: request.dataProvenance,
    selectionBiasDisclosure: {
      marketsAreResearcherSelected: true,
      delistedOrHaltedMarketsIncluded: false,
      survivorshipBiasPresent: true,
      note: "Markets and period boundaries are chosen by the researcher before the run. Delisted or halted markets are absent, so survivorship bias is present and is not corrected for here."
    },
    warnings,
    failures: []
  };
  result.hashes = {
    requestSha256: canonicalHash(request),
    datasetListSha256: canonicalHash(result.datasets),
    strategySha256: canonicalHash(request.strategy),
    executionSha256: canonicalHash({ execution: request.execution, costConditions: request.costConditions }),
    cellPlanSha256: canonicalHash(buildCellPlan(request.datasets)),
    marketSummarySha256: canonicalHash(fullAvailablePeriod.marketSummaries),
    periodSummarySha256: canonicalHash(fullAvailablePeriod.periodSummaries),
    aggregateResultSha256: canonicalHash(fullAvailablePeriod.aggregate)
  };
  return result;
}

module.exports = {
  runCrossMarketValidation, validateRequest, buildCellPlan, computeCommonPeriod,
  summarizeGroup, analyzeConcentration, assessGeneralization, assessSizingComparability,
  FIXED_BENCHMARK_PARAMETER, DEFAULT_ORDER_QUANTITY, DEFAULT_NOTIONAL_SPREAD_TOLERANCE
};
