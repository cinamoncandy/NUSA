import type { ResearchExperimentResult } from "./researchDataset";
import { buildMarketStateFrame, type MarketStateInput } from "./marketStateFrame";
import { assessRegimeHealth } from "./regimeHealth";
import { evaluateStrategyByRegime, type RegimeAwareEvaluationPolicy, type RegimeAwareStrategyEvaluation, type RegimeWindowEvidence } from "./regimeAwareStrategyEvaluation";

/**
 * Builds point-in-time regime evidence for an already-produced walk-forward experiment.
 * Every frame is truncated strictly before the first OOS timestamp, so the first test candle
 * itself cannot leak into the regime label used to evaluate that OOS window.
 */
export function buildResearchRunRegimeEvaluation(
  experiment: ResearchExperimentResult,
  marketInputs: readonly MarketStateInput[],
  options: { readonly lookbackPeriods?: number; readonly policy?: RegimeAwareEvaluationPolicy } = {},
): RegimeAwareStrategyEvaluation {
  const evidence: RegimeWindowEvidence[] = experiment.walkForwardResult.windows.map((window) => {
    const firstOosTimestamp = window.window.testPoints[0]?.timestamp;
    if (firstOosTimestamp == null) throw new Error(`window ${window.window.index} has no OOS points`);
    const frame = buildMarketStateFrame(marketInputs, {
      lookbackPeriods: options.lookbackPeriods ?? 20,
      generatedAt: experiment.generatedAt,
      asOf: firstOosTimestamp - 1,
    });
    return Object.freeze({ windowIndex: window.window.index, regime: assessRegimeHealth(frame) });
  });
  return evaluateStrategyByRegime(experiment, Object.freeze(evidence), options.policy);
}
