"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createResearchBenchmarkScorecard } = require("../dist/apps/desktop/src/cloud/researchBenchmarkScorecard.js");

const ROOT = join(__dirname, "..");

/**
 * Two things in this repository are called QUALIFIED_FOR_LEAGUE, and they do not mean the same
 * thing.
 *
 * `classifyCandidateOutcome` in nusaLeague.ts returns it whenever the benchmark scorecard says
 * `eligible`, which asks only for two walk-forward windows, twenty out-of-sample points, one
 * closed trade, drawdown inside 35%, churn under 0.75, and beating the benchmark in at least half
 * the windows. That last one is the only clause a strategy without an edge could fail, and "at
 * least half" includes the tie -- so a coin flip clears it more often than not. Measured below.
 *
 * `qualifyResearchFactoryRun` returns the same string only after deflated-Sharpe evidence that
 * passes, PBO evidence, regime robustness, a trial ledger, a pre-committed hypothesis, parameter
 * and cost stress, and out-of-sample provenance. That is the gate that rejects luck, and it is the
 * one `paperChallengerDeploymentRuntime` consumes -- the cloud worker client reads
 * `item.qualification.candidates`, not the league standing.
 *
 * So the weak label is safe today because nothing acts on it. These tests exist to keep that true:
 * the measurement says what the first gate is worth on its own, and the wiring check says the
 * deployment path must keep reading the strict one.
 */

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** A walk-forward run where each window beat the benchmark, or did not, by a coin flip. */
function coinFlipExperiment(outcomes) {
  const windows = outcomes.map((won) => {
    const benchmarkReturn = 0.01;
    const totalReturn = won ? 0.02 : 0.005;
    const outperformance = totalReturn - benchmarkReturn;
    return {
      testResult: {
        metrics: { totalReturn, benchmarkReturn, excessReturn: outperformance, outperformance },
        benchmark: { strategyReturn: totalReturn, buyAndHoldReturn: benchmarkReturn, outperformance }
      }
    };
  });
  const beaten = outcomes.filter(Boolean).length;
  const averageOutperformance = windows.reduce((sum, w) => sum + w.testResult.benchmark.outperformance, 0) / windows.length;
  return {
    manifest: {
      schemaVersion: 1, datasetId: "dataset-noise", source: "test", market: "KRW-BTC", interval: "1d",
      candleCount: 200, startOpenTime: 0, endCloseTime: 172_800_000, timezone: "UTC",
      ordering: "OPEN_TIME_ASC", missingCandlePolicy: "REJECT", missingCandleCount: 0,
      createdAt: "1970-01-01T00:00:00.000Z", contentSha256: "a".repeat(64)
    },
    experimentConfig: { walkForward: {}, candidates: [], executionCosts: { feeRate: 0.0005, spreadBps: 5, slippageBps: 5 } },
    generatedAt: "1970-01-01T00:00:00.000Z", warnings: [],
    walkForwardResult: {
      windows, candidateSelectionCounts: {}, warnings: [],
      stabilityDiagnostics: { candidates: [], selectionChurn: 0, selectionChurnRatio: 0.1 },
      combinedOutOfSampleMetrics: {
        windowCount: outcomes.length, totalOosPoints: 20, totalOosClosedTrades: 2,
        totalReturn: 0, maximumDrawdown: 0.1, turnover: 1, totalTradingCost: 100,
        profitableWindowRatio: beaten / outcomes.length,
        benchmarkOutperformanceWindowRatio: beaten / outcomes.length,
        equalWeight: { averageBenchmarkReturn: 0.01, averageOutperformance: averageOutperformance },
        sequentialCompounded: { initialEquity: 10_000 }
      }
    }
  };
}

const eligibleRate = (windowCount, trials, seed) => {
  const random = rng(seed);
  let eligible = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const outcomes = Array.from({ length: windowCount }, () => random() < 0.5);
    const card = createResearchBenchmarkScorecard([{ id: "candidate", experiment: coinFlipExperiment(outcomes) }]);
    if (card.slices[0].eligible) eligible += 1;
  }
  return eligible / trials;
};

test("the benchmark gate alone does not reject a coin flip", () => {
  // Not a defect on its own -- it is a plausibility filter, and the statistical filter is behind it.
  // It is written down so nobody mistakes benchmark eligibility for evidence of edge.
  const atMinimum = eligibleRate(2, 4_000, 42);
  assert.ok(atMinimum > 0.6, `expected a coin flip to clear the two-window minimum often; got ${(atMinimum * 100).toFixed(1)}%`);

  // More windows help, and do not converge to 50%, because "at least half" counts the tie.
  const atTwenty = eligibleRate(20, 4_000, 99);
  assert.ok(atTwenty > 0.5, `got ${(atTwenty * 100).toFixed(1)}%`);
  assert.ok(atTwenty < atMinimum, "more walk-forward windows must make luck harder, not easier");
});

test("deployment reads the gate that requires deflated Sharpe and PBO, not the league label", () => {
  const client = readFileSync(join(ROOT, "apps/cloud/src/closedLearningResearchWorkerClient.ts"), "utf8");
  // If this ever reads the league standing's outcome instead, a coin flip becomes deployable.
  assert.match(client, /item\.qualification/);
  assert.match(client, /qualification\.candidates/);

  const factory = readFileSync(join(ROOT, "apps/desktop/src/cloud/researchFactoryQualification.ts"), "utf8");
  for (const required of [
    "DEFLATED_SHARPE_EVIDENCE_MISSING",
    "PBO_EVIDENCE_MISSING",
    "REGIME_ROBUSTNESS_EVIDENCE_MISSING",
    "TRIAL_LEDGER_EVIDENCE_MISSING"
  ]) {
    assert.ok(factory.includes(required), `${required} is no longer required for qualification`);
  }
  assert.match(factory, /PRECOMMITTED_HYPOTHESIS_REQUIRED/);
  assert.match(factory, /OOS_OBSERVATION_PROVENANCE_REQUIRED/);
  // A failing deflated Sharpe must reject outright rather than merely lower a score.
  assert.match(factory, /REJECTION_REASONS[\s\S]{0,120}DEFLATED_SHARPE_BELOW_CONFIDENCE_THRESHOLD/);
});

test("absent statistical evidence is missing evidence, not silent consent", () => {
  // nusaLeague only objects to a deflated Sharpe that fails; absence raises no objection there.
  // What stops absence from passing is the factory's missing-evidence list, so that pairing is the
  // thing to keep intact.
  const league = readFileSync(join(ROOT, "apps/desktop/src/cloud/nusaLeague.ts"), "utf8");
  assert.match(league, /candidate\.deflatedSharpe != null && !candidate\.deflatedSharpe\.passes/);
  const factory = readFileSync(join(ROOT, "apps/desktop/src/cloud/researchFactoryQualification.ts"), "utf8");
  assert.match(factory, /missingEvidence\.includes\(required\)/);
});
