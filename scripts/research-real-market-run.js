"use strict";

const {
  evaluateUpbitDailyCandleFreshness,
  mapUpbitDayCandlesToResearchCandles
} = require("../dist/apps/desktop/src/exchange/upbitCandleAdapter.js");
const { createHistoricalDatasetManifest, candlesToBacktestPoints, runWalkForwardExperiment } = require("../dist/apps/desktop/src/cloud/researchDataset.js");
const { SmaCrossoverStrategy } = require("../dist/apps/desktop/src/strategy/strategyEngine.js");
const { buildResearchRunLeague } = require("../dist/apps/desktop/src/cloud/researchRunLeagueBridge.js");
const { qualifyResearchFactoryRun } = require("../dist/apps/desktop/src/cloud/researchFactoryQualification.js");
const { buildResearchRunRegimeEvaluation } = require("../dist/apps/desktop/src/cloud/researchRunRegimeEvidence.js");
const { buildResearchRunPboEvidence } = require("../dist/apps/desktop/src/cloud/researchRunPboEvidence.js");
const { buildResearchRunDsrEvidence } = require("../dist/apps/desktop/src/cloud/researchRunDsrEvidence.js");
const { runExecutionCostStress } = require("../dist/apps/desktop/src/strategy/executionCostStress.js");
const { projectExecutionCostStress } = require("./lib/research-cost-stress-projection.js");
const { runParameterRobustnessRequest } = require("./lib/parameter-robustness-runner.js");
const { verifyParameterRobustnessResult } = require("./lib/parameter-robustness-verifier.js");
const { buildResearchRunRobustnessEvidence } = require("../dist/apps/desktop/src/cloud/researchRunRobustnessEvidence.js");
const { buildResearchHypothesis } = require("../dist/apps/desktop/src/cloud/researchHypothesis.js");
const { buildResearchRunTimeline } = require("../dist/apps/desktop/src/cloud/researchRunTimeline.js");
const { buildResearchRunProvenancePlan } = require("../dist/apps/desktop/src/cloud/researchRunFactory.js");

const STRATEGY_FAMILY_ID = "sma-crossover";
const MARKET = "KRW-BTC";
const CANDLE_COUNT = 200;
const REQUEST_PATH = `/v1/candles/days?market=${MARKET}&count=${CANDLE_COUNT}`;

const BACKTEST_CONFIG = {
  market: MARKET,
  initialCash: 10_000_000,
  feeRate: 0.0005,
  orderQuantity: 0.001,
  executionCosts: { spreadBps: 5, slippageBps: 5 }
};

// Fixed before the dataset is observed: the existing cost-stress engine reruns the same
// walk-forward plan under a declared baseline/moderate/severe grid. This is sensitivity
// evidence only; it never changes candidate selection authority or execution policy.
const COST_STRESS_SCENARIOS = [
  {
    id: "BASE",
    label: "configured baseline",
    feeRate: BACKTEST_CONFIG.feeRate,
    spreadBps: BACKTEST_CONFIG.executionCosts.spreadBps,
    slippageBps: BACKTEST_CONFIG.executionCosts.slippageBps
  },
  {
    id: "MODERATE",
    label: "moderate cost inflation",
    feeRate: BACKTEST_CONFIG.feeRate * 1.5,
    spreadBps: BACKTEST_CONFIG.executionCosts.spreadBps * 2,
    slippageBps: BACKTEST_CONFIG.executionCosts.slippageBps * 2
  },
  {
    id: "SEVERE",
    label: "severe cost inflation",
    feeRate: BACKTEST_CONFIG.feeRate * 2,
    spreadBps: BACKTEST_CONFIG.executionCosts.spreadBps * 4,
    slippageBps: BACKTEST_CONFIG.executionCosts.slippageBps * 6
  }
];

const WALK_FORWARD_CONFIG = {
  trainSize: 120,
  testSize: 20,
  minimumWindows: 2,
  backtestConfig: BACKTEST_CONFIG,
  selectionPolicy: { minimumClosedTrades: 0 }
};

const SMA_PARAMETER_NEIGHBORHOOD = [
  { shortPeriod: 3, longPeriod: 15 },
  { shortPeriod: 5, longPeriod: 15 },
  { shortPeriod: 5, longPeriod: 20 },
  { shortPeriod: 5, longPeriod: 25 },
  { shortPeriod: 8, longPeriod: 20 },
  { shortPeriod: 10, longPeriod: 30 }
];

function buildParameterRobustnessRequest({ candles, manifest }) {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error("real parameter robustness requires canonical candles");
  }
  if (
    manifest == null
    || typeof manifest.market !== "string"
    || typeof manifest.datasetId !== "string"
    || typeof manifest.contentSha256 !== "string"
  ) {
    throw new Error("real parameter robustness requires a canonical dataset manifest");
  }
  return {
    schemaVersion: 1,
    id: `real-run:${manifest.datasetId}:parameter-robustness`,
    market: manifest.market,
    candles,
    referenceParameters: [
      { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 }
    ],
    neighborhood: {
      shortOffsets: [-2, -1, 0, 1, 2],
      longOffsets: [-5, -2, 0, 2, 5]
    },
    minimumTrades: 0,
    execution: {
      initialCash: BACKTEST_CONFIG.initialCash,
      orderQuantity: BACKTEST_CONFIG.orderQuantity,
      executionCosts: {
        spreadBps: BACKTEST_CONFIG.executionCosts.spreadBps
      },
      latencyCandles: 0,
      riskPolicy: {}
    },
    evaluation: {
      mode: "BOTH",
      oosWindows: {
        trainingCandles: WALK_FORWARD_CONFIG.trainSize,
        testCandles: WALK_FORWARD_CONFIG.testSize,
        stepCandles: WALK_FORWARD_CONFIG.testSize
      }
    },
    costConditions: COST_STRESS_SCENARIOS.map(({ id, feeRate, slippageBps }) => ({
      name: id,
      feeRate,
      slippageBps
    }))
  };
}

function requiredResearchSourceCommitSha() {
  const value = process.env.NUSA_SOURCE_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "";
  if (!/^[a-f0-9]{40}$/i.test(value)) {
    throw new Error("real research run requires NUSA_SOURCE_COMMIT_SHA or GITHUB_SHA");
  }
  return value.toLowerCase();
}

function requiredResearchCostModelVersion() {
  const value = process.env.NUSA_RESEARCH_COST_MODEL_VERSION ?? "";
  if (!value.trim()) {
    throw new Error("real research run requires NUSA_RESEARCH_COST_MODEL_VERSION");
  }
  return value.trim();
}

function runProvenanceBoundExperiment({ id, shortPeriod, longPeriod, candles, manifest, candidateSpecification }) {
  const rawExperiment = runWalkForwardExperiment(
    { candles, manifest },
    [{
      id,
      strategyFactory: () => new SmaCrossoverStrategy(shortPeriod, longPeriod),
      parameters: { shortPeriod, longPeriod }
    }],
    WALK_FORWARD_CONFIG,
    { generatedAt: candidateSpecification.evaluationStartedAt }
  );
  const experiment = Object.freeze({
    ...rawExperiment,
    generatedAt: candidateSpecification.evaluationEndedAt
  });
  return { experiment, candidateSpecification };
}

async function fetchDayCandlePage(path) {
  const response = await fetch(`https://api.upbit.com${path}`);
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body;
}

async function main() {
  const dataAsOf = Date.now();
  const timeline = buildResearchRunTimeline(dataAsOf);
  const primaryRaw = await fetchDayCandlePage(REQUEST_PATH);
  const sourceRequests = [`GET ${REQUEST_PATH}`];
  let allRaw = primaryRaw;
  let candles = mapUpbitDayCandlesToResearchCandles(allRaw, { completedBy: dataAsOf, maxCount: CANDLE_COUNT });

  if (candles.length < CANDLE_COUNT) {
    const missingCount = CANDLE_COUNT - candles.length;
    const oldestCompletedOpenTime = candles[0]?.openTime;
    if (oldestCompletedOpenTime == null) throw new Error("Upbit completed-candle backfill has no anchor");
    const backfillPath = `/v1/candles/days?market=${MARKET}&count=${missingCount}&to=${encodeURIComponent(new Date(oldestCompletedOpenTime).toISOString())}`;
    const backfillRaw = await fetchDayCandlePage(backfillPath);
    sourceRequests.push(`GET ${backfillPath}`);
    allRaw = [...primaryRaw, ...backfillRaw];
    candles = mapUpbitDayCandlesToResearchCandles(allRaw, { completedBy: dataAsOf, maxCount: CANDLE_COUNT });
  }

  if (candles.length !== CANDLE_COUNT) {
    throw new Error(`Upbit returned only ${candles.length} completed daily candles; expected ${CANDLE_COUNT}`);
  }
  const freshness = evaluateUpbitDailyCandleFreshness(candles, dataAsOf);
  if (!freshness.fresh) {
    throw new Error(`Upbit completed daily candle source is stale by ${freshness.lagDays} UTC day(s)`);
  }
  const manifest = createHistoricalDatasetManifest(candles, {
    source: "upbit-public-api",
    sourceRequest: sourceRequests.join(" | "),
    createdAt: new Date(dataAsOf).toISOString()
  });
  const sourceCommitSha = requiredResearchSourceCommitSha();
  const costModelVersion = requiredResearchCostModelVersion();
  const hypothesis = buildResearchHypothesis({
    hypothesisId: `real-run:${manifest.datasetId}:sma-crossover`,
    familyId: STRATEGY_FAMILY_ID,
    market: manifest.market,
    interval: manifest.interval,
    direction: "LONG",
    thesis: "A short/long SMA crossover may identify a reproducible directional edge after explicit execution costs.",
    sourceDatasetId: manifest.datasetId,
    sourceObservationAsOf: manifest.endCloseTime,
    generatedAt: timeline.hypothesisGeneratedAt
  });

  const candidateSeeds = SMA_PARAMETER_NEIGHBORHOOD.map(({ shortPeriod, longPeriod }) => ({
    candidateId: `sma-${shortPeriod}-${longPeriod}`,
    familyId: STRATEGY_FAMILY_ID,
    lineageId: `${STRATEGY_FAMILY_ID}-v1`,
    parameters: { shortPeriod, longPeriod },
    codeSha: sourceCommitSha,
    costModelVersion
  }));
  const provenancePlan = buildResearchRunProvenancePlan({
    manifest,
    hypothesis,
    timeline,
    sourceCommitSha,
    candidates: candidateSeeds
  });
  const candidateSpecifications = new Map(
    provenancePlan.candidates.map((candidate) => [candidate.candidateId, candidate.specification])
  );
  const candidates = provenancePlan.candidates.map((candidate) => ({
    id: candidate.candidateId,
    strategyFactory: () => new SmaCrossoverStrategy(
      Number(candidate.parameters.shortPeriod),
      Number(candidate.parameters.longPeriod)
    ),
    parameters: candidate.parameters
  }));

  const costStress = runExecutionCostStress(
    candlesToBacktestPoints(candles),
    candidates,
    WALK_FORWARD_CONFIG,
    {
      scenarios: COST_STRESS_SCENARIOS,
      baselineScenarioId: "BASE",
      candidateSelectionMode: "FIX_BASELINE_SELECTION"
    },
    {
      sourceExperimentSha: `real-run:${manifest.datasetId}`,
      datasetSha256: manifest.contentSha256
    }
  );

  const parameterRobustnessRequest = buildParameterRobustnessRequest({ candles, manifest });
  const parameterRobustness = runParameterRobustnessRequest(parameterRobustnessRequest);
  if (parameterRobustness.status !== "PASS") {
    throw new Error(
      `real parameter robustness failed: ${parameterRobustness.failures.join(", ")}`
    );
  }
  const parameterRobustnessVerification = verifyParameterRobustnessResult(
    parameterRobustnessRequest,
    parameterRobustness
  );
  if (parameterRobustnessVerification.status !== "PASS") {
    throw new Error(
      `real parameter robustness verification failed: ${parameterRobustnessVerification.errors.join(", ")}`
    );
  }
  const parameterRobustnessEvidence = {
    ...parameterRobustness,
    verification: { status: parameterRobustnessVerification.status },
    provenance: {
      sourceCommitSha,
      costModelVersion,
      datasetId: manifest.datasetId,
      datasetContentSha256: manifest.contentSha256
    }
  };
  const costStressEvidence = projectExecutionCostStress(costStress);
  const robustnessEvidence = buildResearchRunRobustnessEvidence({
    datasetId: manifest.datasetId,
    datasetContentSha256: manifest.contentSha256,
    parameterRobustness: parameterRobustnessEvidence,
    costStress: costStressEvidence
  });

  const generatedAt = timeline.generatedAt;
  const result = runWalkForwardExperiment(
    { candles, manifest },
    candidates,
    WALK_FORWARD_CONFIG,
    { generatedAt }
  );

  const leagueCandidates = SMA_PARAMETER_NEIGHBORHOOD.map(({ shortPeriod, longPeriod }) => {
    const id = `sma-${shortPeriod}-${longPeriod}`;
    const { experiment, candidateSpecification } = runProvenanceBoundExperiment({
      id,
      shortPeriod,
      longPeriod,
      candles,
      manifest,
      candidateSpecification: candidateSpecifications.get(id)
    });
    const regimeAwareEvaluation = buildResearchRunRegimeEvaluation(
      experiment,
      [{ manifest, candles }],
      { lookbackPeriods: 20 }
    );
    return { id, familyId: STRATEGY_FAMILY_ID, experiment, candidateSpecification, regimeAwareEvaluation };
  });

  const deflatedSharpe = buildResearchRunDsrEvidence(leagueCandidates);
  let probabilityBacktestOverfitting;
  let pboUnavailableReason;
  try {
    probabilityBacktestOverfitting = buildResearchRunPboEvidence(leagueCandidates);
  } catch (error) {
    if (error?.code !== "ZERO_RETURN_VARIANCE") throw error;
    pboUnavailableReason = error.code;
  }
  const league = buildResearchRunLeague(
    leagueCandidates.map((candidate) => ({
      ...candidate,
      deflatedSharpe: deflatedSharpe.evidenceByCandidate.get(candidate.id),
      trialLedgerSummary: deflatedSharpe.trialLedgerSummary
    })),
    {
      generatedAt,
      ...(probabilityBacktestOverfitting == null ? {} : { probabilityBacktestOverfitting }),
      robustnessEvidence,
      hypothesis
    }
  );
  const factoryQualification = qualifyResearchFactoryRun(league);

  const oos = result.walkForwardResult.combinedOutOfSampleMetrics;
  console.log(JSON.stringify({
    NOTICE: "REAL_MARKET_DATA_RESEARCH_TIER_ONLY -- not operational Paper evidence, does not authorize release",
    hypothesis: league.hypothesis ?? hypothesis,
    dataset: {
      datasetId: manifest.datasetId,
      market: manifest.market,
      interval: manifest.interval,
      candleCount: manifest.candleCount,
      startOpenTime: new Date(manifest.startOpenTime).toISOString(),
      endCloseTime: new Date(manifest.endCloseTime).toISOString(),
      contentSha256: manifest.contentSha256,
      completedBy: new Date(dataAsOf).toISOString(),
      freshness: {
        status: "FRESH",
        expectedLatestCloseTime: new Date(freshness.expectedLatestCloseTime).toISOString(),
        actualLatestCloseTime: new Date(freshness.actualLatestCloseTime).toISOString(),
        lagDays: freshness.lagDays
      }
    },
    windowCount: result.walkForwardResult.windows.length,
    parameterNeighborhood: {
      candidateSelectionCounts: result.walkForwardResult.candidateSelectionCounts,
      selectionChurn: result.walkForwardResult.stabilityDiagnostics.selectionChurn,
      selectionChurnRatio: result.walkForwardResult.stabilityDiagnostics.selectionChurnRatio,
      candidates: result.walkForwardResult.stabilityDiagnostics.candidates
    },
    costStress: costStressEvidence,
    parameterRobustness: parameterRobustnessEvidence,
    outOfSample: {
      totalOosPoints: oos.totalOosPoints,
      totalOosClosedTrades: oos.totalOosClosedTrades,
      winRate: oos.winRate,
      totalReturn: oos.totalReturn,
      maximumDrawdown: oos.maximumDrawdown,
      profitFactor: oos.profitFactor ?? null,
      turnover: oos.turnover,
      totalTradingCost: oos.totalTradingCost,
      profitableWindowRatio: oos.profitableWindowRatio,
      benchmarkOutperformanceWindowRatio: oos.benchmarkOutperformanceWindowRatio
    },
    searchOverfitting: {
      status: probabilityBacktestOverfitting == null ? "INSUFFICIENT" : "AVAILABLE",
      unavailableReason: pboUnavailableReason ?? null,
      strategyCount: probabilityBacktestOverfitting?.strategyCount ?? null,
      observationCount: probabilityBacktestOverfitting?.observationCount ?? null,
      partitions: probabilityBacktestOverfitting?.partitions ?? null,
      splitCount: probabilityBacktestOverfitting?.splitCount ?? null,
      probabilityBacktestOverfitting: probabilityBacktestOverfitting?.probabilityBacktestOverfitting ?? null,
      medianLogit: probabilityBacktestOverfitting?.medianLogit ?? null
    },
    researchFactoryQualification: factoryQualification,
    league: {
      evidenceMode: league.evidenceMode,
      evidenceReports: league.evidenceReport,
      reasons: league.reasons,
      probabilityBacktestOverfitting: league.standing.probabilityBacktestOverfitting ?? null,
      trialLedger: deflatedSharpe.trialLedgerSummary,
      allocationUnavailableReason: league.allocationUnavailableReason ?? null,
      standing: league.standing.entries.map((entry) => ({
        id: entry.id,
        familyId: entry.familyId,
        rank: entry.rank ?? null,
        eligible: entry.eligible,
        leagueScore: entry.leagueScore ?? null,
        evidenceBreadth: entry.evidenceBreadth,
        deflatedSharpeProbability: entry.components.riskAdjusted ?? null,
        deflatedSharpeUnavailableReason: deflatedSharpe.unavailableReasons.get(entry.id) ?? null,
        regimeRobustness: entry.components.regimeRobustness ?? null,
        regimeRobustnessClass: entry.components.regimeRobustnessClass ?? null,
        reasons: entry.reasons
      })),
      researchAllocation: league.allocation == null ? null : league.allocation.entries.map((entry) => ({
        id: entry.id,
        familyId: entry.familyId,
        researchWeight: entry.researchWeight
      }))
    },
    warnings: result.warnings
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("research real-market run failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { buildParameterRobustnessRequest, buildResearchRunTimeline };