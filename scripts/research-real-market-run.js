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
const { createResearchHypothesis } = require("../dist/packages/contracts/src/researchHypothesisContract.js");
const { buildResearchRunTimeline } = require("../dist/apps/desktop/src/cloud/researchRunTimeline.js");
const { buildResearchRunProvenancePlan } = require("../dist/apps/desktop/src/cloud/researchRunFactory.js");

const STRATEGY_FAMILY_ID = "sma-crossover";
const MARKET = "KRW-BTC";
const RESEARCH_MARKET_SET_VERSION = "upbit-public-daily-2000-v2";
// Availability-only cohort: each predeclared market had at least 2000 completed public
// daily candles at v2 declaration time. This identity is never selected from returns.
const RESEARCH_MARKETS = Object.freeze(["KRW-BTC", "KRW-ETH", "KRW-XRP", "KRW-ADA", "KRW-DOGE"]);
const DEFAULT_CANDLE_COUNT = 2000;
const DAY_MS = 86_400_000;
const REQUEST_THROTTLE_MS = 150;

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

// Precommitted before each dataset is observed. The fast crossover cells are not a
// relaxed qualification path: they remain subject to the exact same OOS, DSR, PBO,
// regime, cost-stress and League gates. They only widen the already-existing SMA
// hypothesis to include higher-turnover cells capable of producing non-zero OOS
// return variance and enough closed-trade observations for those gates to evaluate.
const SMA_PARAMETER_NEIGHBORHOOD = Object.freeze([
  Object.freeze({ shortPeriod: 2, longPeriod: 8 }),
  Object.freeze({ shortPeriod: 3, longPeriod: 10 }),
  Object.freeze({ shortPeriod: 4, longPeriod: 10 }),
  Object.freeze({ shortPeriod: 3, longPeriod: 15 }),
  Object.freeze({ shortPeriod: 5, longPeriod: 15 }),
  Object.freeze({ shortPeriod: 5, longPeriod: 20 }),
  Object.freeze({ shortPeriod: 5, longPeriod: 25 }),
  Object.freeze({ shortPeriod: 8, longPeriod: 20 }),
  Object.freeze({ shortPeriod: 10, longPeriod: 30 })
]);

const PBO_EVIDENCE_UNAVAILABLE_CODES = Object.freeze([
  "ZERO_RETURN_VARIANCE",
  "INSUFFICIENT_CANDIDATES",
  "INSUFFICIENT_OOS_EQUITY_POINTS",
  "INSUFFICIENT_OOS_RETURN_POINTS",
  "NO_SYMMETRIC_CSCV_PARTITION"
]);

function isResearchRunPboEvidenceUnavailable(error) {
  return typeof error?.code === "string" && PBO_EVIDENCE_UNAVAILABLE_CODES.includes(error.code);
}

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
      { source: "PRODUCTION_DEFAULT", shortWindow: 5, longWindow: 20 },
      { source: "MANUAL_RESEARCH_REFERENCE", shortWindow: 2, longWindow: 8 }
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
  const response = await fetch(`https://api.upbit.com${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Upbit request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body) || body.length === 0) throw new Error("Upbit returned no candles");
  return body;
}

function researchCandleCount(value = process.env.NUSA_RESEARCH_CANDLE_COUNT) {
  if (value === undefined) return DEFAULT_CANDLE_COUNT;
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(Number(value)) || Number(value) < 200 || Number(value) > 2000) {
    throw new Error("NUSA_RESEARCH_CANDLE_COUNT must be an integer from 200 to 2000");
  }
  return Number(value);
}

async function fetchResearchCandles({ market = MARKET, dataAsOf, count = DEFAULT_CANDLE_COUNT, fetchPage = fetchDayCandlePage, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  count = researchCandleCount(count);
  if (!RESEARCH_MARKETS.includes(market)) throw new Error(`unsupported research market: ${market}`);
  if (!Number.isFinite(dataAsOf)) throw new Error("research dataAsOf must be finite");
  // Upbit's `to` is exclusive. Anchor every request to completed UTC days,
  // including the first page, so an in-flight day cannot change the dataset.
  let before = Math.floor(dataAsOf / DAY_MS) * DAY_MS;
  const candles = [];
  const sourceRequests = [];
  for (let page = 0; page < Math.ceil(count / 200); page += 1) {
    const pageSize = Math.min(200, count - candles.length);
    const requestPath = `/v1/candles/days?market=${market}&count=${pageSize}&to=${encodeURIComponent(new Date(before).toISOString())}`;
    if (page > 0) await pause(REQUEST_THROTTLE_MS);
    const raw = await fetchPage(requestPath);
    if (!Array.isArray(raw) || raw.length !== pageSize) throw new Error("Upbit research history is incomplete");
    const mapped = mapUpbitDayCandlesToResearchCandles(raw, { completedBy: dataAsOf });
    if (mapped.length !== pageSize) throw new Error("Upbit research page contains incomplete candles");
    for (let index = 0; index < mapped.length; index += 1) {
      const candle = mapped[index];
      const expectedOpenTime = before - (mapped.length - index) * DAY_MS;
      if (candle.market !== market || candle.openTime !== expectedOpenTime) {
        throw new Error("Upbit research history has a market, gap, duplicate, or cursor mismatch");
      }
    }
    sourceRequests.push(`GET ${requestPath}`);
    candles.unshift(...mapped);
    before = mapped[0].openTime;
  }
  return { candles, sourceRequests };
}

function createMarketDataset({ market, dataAsOf, candles, sourceRequests }) {
  const freshness = evaluateUpbitDailyCandleFreshness(candles, dataAsOf);
  if (!freshness.fresh) {
    throw new Error(`${market} completed daily candle source is stale by ${freshness.lagDays} UTC day(s)`);
  }
  const manifest = createHistoricalDatasetManifest(candles, {
    source: "upbit-public-api",
    sourceRequest: sourceRequests.join(" | "),
    createdAt: new Date(dataAsOf).toISOString()
  });
  return Object.freeze({ market, candles, sourceRequests, freshness, manifest });
}

async function main() {
  const dataAsOf = Date.now();
  const timeline = buildResearchRunTimeline(dataAsOf);
  const candleCount = researchCandleCount();
  const marketDatasets = [];
  for (let index = 0; index < RESEARCH_MARKETS.length; index += 1) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, REQUEST_THROTTLE_MS));
    const market = RESEARCH_MARKETS[index];
    const history = await fetchResearchCandles({ market, dataAsOf, count: candleCount });
    marketDatasets.push(createMarketDataset({ market, dataAsOf, ...history }));
  }
  const primaryDataset = marketDatasets.find((entry) => entry.market === MARKET);
  if (primaryDataset == null) throw new Error(`primary research market ${MARKET} was not loaded`);
  const { candles, manifest, freshness } = primaryDataset;
  const regimeInputs = marketDatasets.map((entry) => ({ manifest: entry.manifest, candles: entry.candles }));

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
    costModelVersion,
    canonicalHypothesis: createResearchHypothesis({
      hypothesisId: `${hypothesis.hypothesisId}:${shortPeriod}-${longPeriod}`,
      candidateId: `sma-${shortPeriod}-${longPeriod}`,
      family: "MOMENTUM",
      rationale: hypothesis.thesis,
      mechanism: "A moving-average crossover represents a precommitted persistence hypothesis whose directional signal is evaluated only on later candles.",
      targetMarket: manifest.market,
      expectedRegime: "UNKNOWN",
      invalidationCondition: "The cost-adjusted out-of-sample edge is not reproducible across the declared walk-forward windows.",
      holdingPeriodMs: 86_400_000,
      capacityAssumptions: { maxNotional: BACKTEST_CONFIG.initialCash, maxParticipationRate: 0.05 },
      transactionCostSensitivity: 1,
      provenance: {
        author: "nusa-real-market-research",
        sourceReferences: [
          `market-set:${RESEARCH_MARKET_SET_VERSION}`,
          ...marketDatasets.map((entry) => `dataset:${entry.manifest.datasetId}`)
        ]
      },
      createdAt: timeline.hypothesisGeneratedAt
    })
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
    parameters: candidate.parameters,
    canonicalHypothesis: candidate.canonicalHypothesis
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
      regimeInputs,
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
    if (!isResearchRunPboEvidenceUnavailable(error)) throw error;
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
    researchMarketSet: {
      version: RESEARCH_MARKET_SET_VERSION,
      selectionPolicy: "PREDECLARED_PUBLIC_HISTORY_AVAILABILITY_ONLY_NO_PERFORMANCE_SELECTION",
      markets: RESEARCH_MARKETS
    },
    hypothesis: league.hypothesis ?? hypothesis,
    dataset: {
      datasetId: manifest.datasetId,
      market: manifest.market,
      interval: manifest.interval,
      candleCount: manifest.candleCount,
      startOpenTime: new Date(manifest.startOpenTime).toISOString(),
      endCloseTime: new Date(manifest.endCloseTime).toISOString(),
      contentSha256: manifest.contentSha256,
      sourceRequest: manifest.sourceRequest,
      completedBy: new Date(dataAsOf).toISOString(),
      freshness: {
        status: "FRESH",
        expectedLatestCloseTime: new Date(freshness.expectedLatestCloseTime).toISOString(),
        actualLatestCloseTime: new Date(freshness.actualLatestCloseTime).toISOString(),
        lagDays: freshness.lagDays
      }
    },
    evidenceDatasets: marketDatasets.map((entry) => ({
      datasetId: entry.manifest.datasetId,
      market: entry.manifest.market,
      interval: entry.manifest.interval,
      candleCount: entry.manifest.candleCount,
      startOpenTime: new Date(entry.manifest.startOpenTime).toISOString(),
      endCloseTime: new Date(entry.manifest.endCloseTime).toISOString(),
      contentSha256: entry.manifest.contentSha256,
      sourceRequest: entry.manifest.sourceRequest,
      freshnessLagDays: entry.freshness.lagDays
    })),
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
    researchRunProvenance: league.provenance,
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

module.exports = {
  RESEARCH_MARKET_SET_VERSION,
  RESEARCH_MARKETS,
  SMA_PARAMETER_NEIGHBORHOOD,
  fetchResearchCandles,
  researchCandleCount,
  buildParameterRobustnessRequest,
  buildResearchRunTimeline,
  isResearchRunPboEvidenceUnavailable
};
