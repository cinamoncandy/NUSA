"use strict";

/**
 * Projects the existing execution-cost stress engine's evidence into the compact JSON shape
 * emitted by the canonical real-market research run. It performs no stress calculation and
 * grants no ranking, capital, broker, or LIVE authority.
 */
function projectExecutionCostStress(stress) {
  if (stress == null || typeof stress !== "object") {
    throw new Error("cost stress evidence is required");
  }
  if (stress.identity == null || typeof stress.identity.id !== "string" || stress.identity.id.length === 0) {
    throw new Error("cost stress identity is required");
  }
  if (!Array.isArray(stress.scenarios) || !Array.isArray(stress.degradation) || !Array.isArray(stress.warnings)) {
    throw new Error("cost stress evidence is incomplete");
  }

  const projectScenario = (scenarioResult) => {
    if (
      scenarioResult == null
      || scenarioResult.scenario == null
      || typeof scenarioResult.scenario.id !== "string"
      || typeof scenarioResult.selectionMode !== "string"
    ) {
      throw new Error("cost stress scenario evidence is malformed");
    }
    return {
      scenario: scenarioResult.scenario,
      selectionMode: scenarioResult.selectionMode,
      markedTotalReturn: scenarioResult.markedTotalReturn,
      markedMaximumDrawdown: scenarioResult.markedMaximumDrawdown,
      closedTradeNetProfit: scenarioResult.closedTradeNetProfit,
      closedTradeExpectancy: scenarioResult.closedTradeExpectancy ?? null,
      closedTradeProfitFactor: scenarioResult.closedTradeProfitFactor ?? null,
      totalTradingCost: scenarioResult.totalTradingCost,
      benchmarkOutperformance: scenarioResult.benchmarkOutperformance,
      warnings: scenarioResult.warnings
    };
  };

  return {
    selectionMode: stress.selectionMode,
    identity: stress.identity,
    baseline: projectScenario(stress.baseline),
    scenarios: stress.scenarios.map(projectScenario),
    degradation: stress.degradation,
    breakEvenEstimate: stress.breakEvenEstimate,
    robustnessScore: stress.robustnessScore,
    warnings: stress.warnings
  };
}

module.exports = { projectExecutionCostStress };
