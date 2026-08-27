"use strict";

const { mapUpbitDayCandlesToResearchCandles } = require("../dist/apps/desktop/src/exchange/upbitCandleAdapter.js");
const { createHistoricalDatasetManifest, runWalkForwardExperiment } = require("../dist/apps/desktop/src/cloud/researchDataset.js");
const { SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { buildResearchRunRegimeEvaluation } = require("../dist/apps/desktop/src/cloud/researchRunRegimeEvidence.js");
const { buildResearchRunPboEvidence } = require("../dist/apps/desktop/src/cloud/researchRunPboEvidence.js");
const { buildResearchRunDsrEvidence } = require("../dist/apps/desktop/src/cloud/researchRunDsrEvidence.js");

const STRATEGY_FAMILY_ID = "sma-crossover";
const MARKET = "KRW-BTC";
const CANDLE_COUNT = 200;
const REQUEST_CANDLE_COUNT = CANDLE_COUNT + 1;
const REQUEST_PATH = `/v1/candles/days?market=${MARKET}&count=${REQUEST_CANDLE_COUNT}`;

const BACKTEST_CONFIG = {
  market: MARKET,
  feeRate: 0.0005,
  orderQuantity: 0.001,
  executionCosts: { spreadBps: 5, slippageBps: 5 }
};

const WALK_FORWARD_CONFIG = {
  trainSize: 120,
  testSize: 20,
  minimumWindows: 2,
  backtestConfig: BACKTEST_CONFIG,
  selectionPolicy: { minimumClosedTrades: 0 }
};

const SMA_PARAMETER_NEIGHBORHOOD = [
  { shortPeriod: 3, longPeriod: 15 }, { shortPeriod: 5, longPeriod: 15 },
  { shortPeriod: 5, longPeriod: 20 }, { shortPeriod: 5, longPeriod: 25 },
  { shortPeriod: 8, longPeriod: 20 }, { shortPeriod: 10, longPeriod: 30 }
];

async function fetchRealDayCandles() {
  const response = await fetch(`https://api.upbit.com${REQUEST_PATH}`);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body;
}

async function main() {
  const raw = await fetchRealDayCandles();
  const dataAsOf = Date.now();
  const candles = mapUpbitDayCandlesToResearchCandles(raw, { completedBy: dataAsOf, maxCount: CANDLE_COUNT });
  if (candles.length !== CANDLE_COUNT) throw new Error(`Upbit returned only ${candles.length} completed daily candles; expected ${CANDLE_COUNT}`);
  const manifest = createHistoricalDatasetManifest(candles, {
    source: "upbit-public-api",
    sourceRequest: `GET ${REQUEST_PATH}`,
    createdAt: new Date(dataAsOf).toISOString()
  });

  const candidates = SMA_PARAMETER_NEIGHBORHOOD.map(({ shortPeriod, longPeriod }) => ({ id: `sma-${shortPeriod}-${longPeriod}`, strategyFactory: () => new SmaCrossoverStrategy(shortPeriod, longPeriod), parameters: { shortPeriod, longPeriod } }));
  const generatedAt = new Date().toISOString();
  const result = runWalkForwardExperiment({ candles, manifest }, candidates, WALK_FORWARD_CONFIG, { generatedAt });

  const leagueCandidates = SMA_PARAMETER_NEIGHBORHOOD.map(({ shortPeriod, longPeriod }) => {
    const id = `sma-${shortPeriod}-${longPeriod}`;
    const experiment = runWalkForwardExperiment({ candles, manifest }, [{ id, strategyFactory: () => new SmaCrossoverStrategy(shortPeriod, longPeriod), parameters: { shortPeriod, longPeriod } }], WALK_FORWARD_CONFIG, { generatedAt });
    const regimeAwareEvaluation = buildResearchRunRegimeEvaluation(experiment, [{ manifest, candles }], { lookbackPeriods: 20 });
    return { id, familyId: STRATEGY_FAMILY_ID, experiment, regimeAwareEvaluation };
  });

  const deflatedSharpe = buildResearchRunDsrEvidence(leagueCandidates);
  let probabilityBacktestOverfitting;
  let pboUnavailableReason;
  try { probabilityBacktestOverfitting = buildResearchRunPboEvidence(leagueCandidates); }
  catch (error) { if (error?.code !== "ZERO_RETURN_VARIANCE") throw error; pboUnavailableReason = error.code; }
  const league = buildResearchRunLeague(leagueCandidates.map((candidate) => ({ ...candidate, deflatedSharpe: deflatedSharpe.evidenceByCandidate.get(candidate.id) })), { generatedAt, ...(probabilityBacktestOverfitting == null ? {} : { probabilityBacktestOverfitting }) });

  const oos = result.walkForwardResult.combinedOutOfSampleMetrics;
  console.log(JSON.stringify({
    NOTICE: "REAL_MARKET_DATA_RESEARCH_TIER_ONLY -- not operational Paper evidence, does not authorize release",
    dataset: { datasetId: manifest.datasetId, market: manifest.market, interval: manifest.interval, candleCount: manifest.candleCount, startOpenTime: new Date(manifest.startOpenTime).toISOString(), endCloseTime: new Date(manifest.endCloseTime).toISOString(), contentSha256: manifest.contentSha256, completedBy: new Date(dataAsOf).toISOString() },
    windowCount: result.walkForwardResult.windows.length,
    parameterNeighborhood: { candidateSelectionCounts: result.walkForwardResult.candidateSelectionCounts, selectionChurn: result.walkForwardResult.stabilityDiagnostics.selectionChurn, selectionChurnRatio: result.walkForwardResult.stabilityDiagnostics.selectionChurnRatio, candidates: result.walkForwardResult.stabilityDiagnostics.candidates },
    outOfSample: { totalOosPoints: oos.totalOosPoints, totalOosClosedTrades: oos.totalOosClosedTrades, winRate: oos.winRate, totalReturn: oos.totalReturn, maximumDrawdown: oos.maximumDrawdown, profitFactor: oos.profitFactor ?? null, turnover: oos.turnover, totalTradingCost: oos.totalTradingCost, profitableWindowRatio: oos.profitableWindowRatio, benchmarkOutperformanceWindowRatio: oos.benchmarkOutperformanceWindowRatio },
    searchOverfitting: { status: probabilityBacktestOverfitting == null ? "INSUFFICIENT" : "AVAILABLE", unavailableReason: pboUnavailableReason ?? null, strategyCount: probabilityBacktestOverfitting?.strategyCount ?? null, observationCount: probabilityBacktestOverfitting?.observationCount ?? null, partitions: probabilityBacktestOverfitting?.partitions ?? null, splitCount: probabilityBacktestOverfitting?.splitCount ?? null, probabilityBacktestOverfitting: probabilityBacktestOverfitting?.probabilityBacktestOverfitting ?? null, medianLogit: probabilityBacktestOverfitting?.medianLogit ?? null },
    league: { evidenceMode: league.evidenceMode, reasons: league.reasons, probabilityBacktestOverfitting: league.standing.probabilityBacktestOverfitting ?? null, allocationUnavailableReason: league.allocationUnavailableReason ?? null, standing: league.standing.entries.map((entry) => ({ id: entry.id, familyId: entry.familyId, rank: entry.rank ?? null, eligible: entry.eligible, leagueScore: entry.leagueScore ?? null, evidenceBreadth: entry.evidenceBreadth, deflatedSharpeProbability: entry.components.riskAdjusted ?? null, deflatedSharpeUnavailableReason: deflatedSharpe.unavailableReasons.get(entry.id) ?? null, regimeRobustness: entry.components.regimeRobustness ?? null, regimeRobustnessClass: entry.components.regimeRobustnessClass ?? null, reasons: entry.reasons })), researchAllocation: league.allocation == null ? null : league.allocation.entries.map((entry) => ({ id: entry.id, familyId: entry.familyId, researchWeight: entry.researchWeight })) },
    warnings: result.warnings
  }, null, 2));
}

main().catch((error) => { console.error("research real-market run failed:", error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
