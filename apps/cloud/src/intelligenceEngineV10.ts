import type { MarketRegimeFeatures, MarketRegimeSnapshot } from "../../../packages/contracts/src/marketRegime";
import { fuseMarketIntelligence, type FusedIntelligence, type IntelligenceObservation } from "./marketIntelligenceFusion";
import { classifyMarketRegime, evaluateRegimeTransition, routeStrategiesForRegime } from "./marketRegimeEngine";

export interface IntelligenceEngineV10Input {
  readonly now: number;
  readonly observations: readonly IntelligenceObservation[];
  readonly regimeFeatures?: MarketRegimeFeatures;
  readonly previousRegime?: MarketRegimeSnapshot;
  readonly minimumFreshSignals?: number;
}

export interface IntelligenceEngineV10Output {
  readonly status: "READY" | "ABSTAIN";
  readonly fused: FusedIntelligence;
  readonly regime?: MarketRegimeSnapshot;
  readonly transition?: ReturnType<typeof evaluateRegimeTransition>;
  readonly strategyPolicy?: ReturnType<typeof routeStrategiesForRegime>;
  readonly reasons: readonly string[];
  readonly generatedAt: number;
}

export function runIntelligenceEngineV10(input: IntelligenceEngineV10Input): IntelligenceEngineV10Output {
  if (!Number.isSafeInteger(input.now) || input.now < 0) throw new Error("now must be a non-negative safe integer");
  const minimumFreshSignals = input.minimumFreshSignals ?? 1;
  if (!Number.isSafeInteger(minimumFreshSignals) || minimumFreshSignals < 1) throw new Error("minimumFreshSignals must be a positive safe integer");

  const fused = fuseMarketIntelligence(input.now, input.observations);
  const reasons: string[] = [];
  if (fused.signals.length < minimumFreshSignals) reasons.push("INSUFFICIENT_FRESH_INTELLIGENCE");

  if (input.regimeFeatures == null) {
    // Without regime features the three checks below cannot run, and the one that matters most is
    // `allowNewExposure`: it is the regime that grants exposure, so when the regime is unknown
    // nobody has granted it. Reporting READY here would make "no regime data" indistinguishable
    // from "the regime is fine", in a repository whose stated rule is to fail closed on
    // uncertainty (README.md, docs/PIPELINE_TO_CODE.md). Nothing in the tree produces a
    // MarketRegimeFeatures today, so this is the live path, not an edge case.
    reasons.push("REGIME_UNKNOWN");
    return Object.freeze({
      status: "ABSTAIN",
      fused,
      reasons: Object.freeze(reasons.sort()),
      generatedAt: input.now
    });
  }

  if (input.regimeFeatures.observedAt > input.now) throw new Error("regime features cannot come from the future");
  const regime = classifyMarketRegime(input.regimeFeatures);
  const transition = evaluateRegimeTransition(input.previousRegime, regime);
  const strategyPolicy = routeStrategiesForRegime(regime);

  if (!strategyPolicy.allowNewExposure) reasons.push("REGIME_BLOCKS_NEW_EXPOSURE");
  if (regime.confidence < 0.55) reasons.push("LOW_REGIME_CONFIDENCE");
  if (regime.stability < 0.5) reasons.push("LOW_REGIME_STABILITY");

  return Object.freeze({
    status: reasons.length === 0 ? "READY" : "ABSTAIN",
    fused,
    regime,
    transition,
    strategyPolicy,
    reasons: Object.freeze(reasons.sort()),
    generatedAt: input.now
  });
}
