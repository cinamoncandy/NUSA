import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceResourceController, AiInferenceResourceSnapshot } from "../../../../packages/contracts/src/aiInferenceResources";
import type {
  AiAttributionBenchmarkMetrics,
  AiAttributionEvaluationResources,
  AiAttributionNetBenefitInput,
  AiAttributionNetBenefitPolicy,
  AiAttributionNetBenefitResult,
  AiAttributionReplayProjection,
  AiAttributionReplayResult,
  AiAttributionRequest,
  AiAttributionSignals
} from "../../../../packages/contracts/src/aiOutcomeAttribution";
import { GovernedOutcomeAttributionEngine, assertSingleAttributionSignalAblation } from "./outcomeAttributionLearning";

export type AiAttributionReplayVariantKind = "BASELINE" | "ABLATION";

export interface AiAttributionReplayVariant {
  readonly experimentId: string;
  readonly kind: AiAttributionReplayVariantKind;
  readonly request: AiAttributionRequest;
  readonly expectedSignals: AiAttributionSignals;
}

export interface AiAttributionReplayRunner {
  runVariant(variant: AiAttributionReplayVariant, resources: AiInferenceResourceController): Promise<AiAttributionSignals>;
}

export interface GovernedAttributionReplayEvaluatorOptions {
  readonly now?: () => number;
}

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const unitInterval = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be within [0,1]`);
  return value;
};

const finiteNonNegative = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be finite and non-negative`);
  return value;
};

function historicalIdentity(request: AiAttributionRequest): string {
  return aiSha256({
    prediction: request.prediction,
    outcome: request.outcome,
    observedEvidence: request.observedEvidence,
    lineage: request.lineage,
    scope: request.scope,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt ?? null,
    supersedesEpisodeId: request.supersedesEpisodeId ?? null
  });
}

function projection(episode: ReturnType<GovernedOutcomeAttributionEngine["analyze"]>): AiAttributionReplayProjection {
  return Object.freeze({
    strength: episode.strength,
    primaryCause: episode.primaryCause,
    candidateCauses: Object.freeze(episode.candidates.map((candidate) => candidate.cause)),
    reasonCodes: episode.reasonCodes,
    realizedLearningCreditAllowed: false
  });
}

function result(
  experimentId: string,
  status: AiAttributionReplayResult["status"],
  changedDimension: string | null,
  baseline: AiAttributionReplayProjection | null,
  ablation: AiAttributionReplayProjection | null,
  resourceBefore: AiInferenceResourceSnapshot,
  resourceAfter: AiInferenceResourceSnapshot,
  reasonCodes: readonly string[]
): AiAttributionReplayResult {
  return Object.freeze({
    schemaVersion: 1,
    experimentId,
    status,
    changedDimension,
    baseline,
    ablation,
    resourceBefore,
    resourceAfter,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    liveAuthority: "NONE",
    realOrderAuthority: false,
    realTransferAuthority: false,
    productionMutationAllowed: false
  });
}

/**
 * Runs one baseline plus one exactly-one-dimension ablation under an externally owned
 * WO-AI-006 resource controller. This class never instantiates a nested inference budget.
 * Replay output is diagnostic-only and cannot be appended as realized-market learning credit.
 */
export class GovernedAttributionReplayEvaluator {
  private readonly now: () => number;

  public constructor(
    private readonly engine: GovernedOutcomeAttributionEngine,
    private readonly runner: AiAttributionReplayRunner,
    options: GovernedAttributionReplayEvaluatorOptions = {}
  ) {
    this.now = options.now ?? Date.now;
  }

  public async run(
    experimentIdValue: string,
    request: AiAttributionRequest,
    ablatedSignals: AiAttributionSignals,
    resources: AiInferenceResourceController
  ): Promise<AiAttributionReplayResult> {
    const experimentId = requiredText(experimentIdValue, "attribution replay experimentId");
    const historicalHash = historicalIdentity(request);
    const resourceBefore = resources.snapshot(this.now());
    let changedDimension: string;
    try {
      changedDimension = assertSingleAttributionSignalAblation(request.signals, ablatedSignals);
    } catch {
      const after = resources.snapshot(this.now());
      return result(experimentId, "UNVERIFIED", null, null, null, resourceBefore, after, ["INVALID_ABLATION_DIMENSION_COUNT"]);
    }
    if (resourceBefore.health !== "HEALTHY") {
      return result(experimentId, "RESOURCE_BLOCKED", changedDimension, null, null, resourceBefore, resourceBefore, ["RESOURCE_NOT_HEALTHY_BEFORE_REPLAY"]);
    }

    let baselineSignals: AiAttributionSignals;
    try {
      baselineSignals = await this.runner.runVariant(Object.freeze({
        experimentId,
        kind: "BASELINE",
        request: Object.freeze({ ...request, episodeId: `${experimentId}:baseline`, signals: request.signals }),
        expectedSignals: request.signals
      }), resources);
    } catch {
      const after = resources.snapshot(this.now());
      return result(
        experimentId,
        after.health === "HEALTHY" ? "FAILED" : "RESOURCE_BLOCKED",
        changedDimension,
        null,
        null,
        resourceBefore,
        after,
        [after.health === "HEALTHY" ? "BASELINE_REPLAY_FAILED" : "BASELINE_REPLAY_RESOURCE_BLOCKED"]
      );
    }
    if (historicalIdentity(request) !== historicalHash || aiSha256(baselineSignals) !== aiSha256(request.signals)) {
      const after = resources.snapshot(this.now());
      return result(experimentId, "UNVERIFIED", changedDimension, null, null, resourceBefore, after, ["BASELINE_REPLAY_MUTATED_IMMUTABLE_HISTORY"]);
    }
    const baselineEpisode = this.engine.analyze(Object.freeze({ ...request, episodeId: `${experimentId}:baseline`, signals: baselineSignals }));
    const afterBaseline = resources.snapshot(this.now());
    if (afterBaseline.health !== "HEALTHY") {
      return result(experimentId, "RESOURCE_BLOCKED", changedDimension, projection(baselineEpisode), null, resourceBefore, afterBaseline, ["RESOURCE_EXHAUSTED_BEFORE_ABLATION"]);
    }

    let replayedAblatedSignals: AiAttributionSignals;
    try {
      replayedAblatedSignals = await this.runner.runVariant(Object.freeze({
        experimentId,
        kind: "ABLATION",
        request: Object.freeze({ ...request, episodeId: `${experimentId}:ablation`, signals: ablatedSignals }),
        expectedSignals: ablatedSignals
      }), resources);
    } catch {
      const after = resources.snapshot(this.now());
      return result(
        experimentId,
        after.health === "HEALTHY" ? "FAILED" : "RESOURCE_BLOCKED",
        changedDimension,
        projection(baselineEpisode),
        null,
        resourceBefore,
        after,
        [after.health === "HEALTHY" ? "ABLATION_REPLAY_FAILED" : "ABLATION_REPLAY_RESOURCE_BLOCKED"]
      );
    }
    if (historicalIdentity(request) !== historicalHash || aiSha256(replayedAblatedSignals) !== aiSha256(ablatedSignals)) {
      const after = resources.snapshot(this.now());
      return result(experimentId, "UNVERIFIED", changedDimension, projection(baselineEpisode), null, resourceBefore, after, ["ABLATION_REPLAY_MUTATED_IMMUTABLE_HISTORY"]);
    }
    const ablatedEpisode = this.engine.analyze(Object.freeze({ ...request, episodeId: `${experimentId}:ablation`, signals: replayedAblatedSignals }));
    const resourceAfter = resources.snapshot(this.now());
    if (resourceAfter.health !== "HEALTHY") {
      return result(experimentId, "RESOURCE_BLOCKED", changedDimension, projection(baselineEpisode), projection(ablatedEpisode), resourceBefore, resourceAfter, ["RESOURCE_NOT_HEALTHY_AFTER_REPLAY"]);
    }
    return result(experimentId, "COMPLETED", changedDimension, projection(baselineEpisode), projection(ablatedEpisode), resourceBefore, resourceAfter, ["ONE_DIMENSION_ABLATION_COMPLETED"]);
  }
}

function normalizeResources(value: AiAttributionEvaluationResources, field: string): AiAttributionEvaluationResources {
  return Object.freeze({
    providerCalls: nonNegativeInteger(value.providerCalls, `${field}.providerCalls`),
    attempts: nonNegativeInteger(value.attempts, `${field}.attempts`),
    totalTokens: nonNegativeInteger(value.totalTokens, `${field}.totalTokens`),
    latencyMs: finiteNonNegative(value.latencyMs, `${field}.latencyMs`),
    failureRate: unitInterval(value.failureRate, `${field}.failureRate`)
  });
}

export function normalizeAiAttributionNetBenefitPolicy(value: AiAttributionNetBenefitPolicy): AiAttributionNetBenefitPolicy {
  if (value.schemaVersion !== 1) throw new Error("AI attribution net-benefit policy schemaVersion is unsupported");
  return Object.freeze({
    schemaVersion: 1,
    policyId: requiredText(value.policyId, "netBenefit.policyId"),
    policyVersion: requiredText(value.policyVersion, "netBenefit.policyVersion"),
    requireQualityImprovement: value.requireQualityImprovement === true,
    maxProviderCallIncrease: nonNegativeInteger(value.maxProviderCallIncrease, "netBenefit.maxProviderCallIncrease"),
    maxAttemptIncrease: nonNegativeInteger(value.maxAttemptIncrease, "netBenefit.maxAttemptIncrease"),
    maxTokenIncrease: nonNegativeInteger(value.maxTokenIncrease, "netBenefit.maxTokenIncrease"),
    maxLatencyIncreaseMs: finiteNonNegative(value.maxLatencyIncreaseMs, "netBenefit.maxLatencyIncreaseMs"),
    maxFailureRateIncrease: unitInterval(value.maxFailureRateIncrease, "netBenefit.maxFailureRateIncrease")
  });
}

function metricDelta(before: number | null, after: number | null): number | null {
  return before == null || after == null ? null : after - before;
}

function compareOptionalQuality(
  name: string,
  before: number | null,
  after: number | null,
  reasonCodes: Set<string>
): { readonly regression: boolean; readonly improvement: boolean } {
  if (before != null && after == null) {
    reasonCodes.add(`${name}_MISSING_AFTER`);
    return { regression: true, improvement: false };
  }
  if (before == null && after != null) return { regression: false, improvement: true };
  if (before == null || after == null) return { regression: false, improvement: false };
  if (after < before) {
    reasonCodes.add(`${name}_REGRESSION`);
    return { regression: true, improvement: false };
  }
  return { regression: false, improvement: after > before };
}

/**
 * Deterministic net-benefit gate. Quality gains never compensate for safety/resource regressions.
 */
export function evaluateAiAttributionNetBenefit(
  policyValue: AiAttributionNetBenefitPolicy,
  input: AiAttributionNetBenefitInput
): AiAttributionNetBenefitResult {
  const policy = normalizeAiAttributionNetBenefitPolicy(policyValue);
  const before = normalizeResources(input.beforeResources, "beforeResources");
  const after = normalizeResources(input.afterResources, "afterResources");
  const safetyRegressionCount = nonNegativeInteger(input.safetyRegressionCount, "safetyRegressionCount");
  const reasonCodes = new Set<string>();

  const known = compareOptionalQuality("KNOWN_CAUSE_ACCURACY", input.beforeQuality.knownCauseAccuracy, input.afterQuality.knownCauseAccuracy, reasonCodes);
  const ambiguity = compareOptionalQuality("AMBIGUITY_ABSTENTION_ACCURACY", input.beforeQuality.ambiguityAbstentionAccuracy, input.afterQuality.ambiguityAbstentionAccuracy, reasonCodes);
  let qualityImprovement = known.improvement || ambiguity.improvement;
  let qualityRegression = known.regression || ambiguity.regression;

  const falseAttributionRateDelta = input.afterQuality.falseAttributionRate - input.beforeQuality.falseAttributionRate;
  if (falseAttributionRateDelta > 0) {
    reasonCodes.add("FALSE_ATTRIBUTION_RATE_REGRESSION");
    qualityRegression = true;
  } else if (falseAttributionRateDelta < 0) qualityImprovement = true;

  const providerCallDelta = after.providerCalls - before.providerCalls;
  const attemptDelta = after.attempts - before.attempts;
  const tokenDelta = after.totalTokens - before.totalTokens;
  const latencyDeltaMs = after.latencyMs - before.latencyMs;
  const failureRateDelta = after.failureRate - before.failureRate;
  if (providerCallDelta > policy.maxProviderCallIncrease) reasonCodes.add("PROVIDER_CALL_REGRESSION");
  if (attemptDelta > policy.maxAttemptIncrease) reasonCodes.add("ATTEMPT_REGRESSION");
  if (tokenDelta > policy.maxTokenIncrease) reasonCodes.add("TOKEN_REGRESSION");
  if (latencyDeltaMs > policy.maxLatencyIncreaseMs) reasonCodes.add("LATENCY_REGRESSION");
  if (failureRateDelta > policy.maxFailureRateIncrease) reasonCodes.add("FAILURE_RATE_REGRESSION");
  if (safetyRegressionCount > 0) reasonCodes.add("SAFETY_REGRESSION");
  if (policy.requireQualityImprovement && !qualityImprovement) reasonCodes.add("NO_MEASURED_QUALITY_IMPROVEMENT");
  if (!qualityRegression && reasonCodes.size === 0) reasonCodes.add("NET_BENEFIT_VERIFIED");

  const failureReasons = [...reasonCodes].filter((code) => code !== "NET_BENEFIT_VERIFIED");
  return Object.freeze({
    schemaVersion: 1,
    status: qualityRegression || failureReasons.length > 0 ? "FAIL" : "PASS",
    knownCauseAccuracyDelta: metricDelta(input.beforeQuality.knownCauseAccuracy, input.afterQuality.knownCauseAccuracy),
    ambiguityAbstentionAccuracyDelta: metricDelta(input.beforeQuality.ambiguityAbstentionAccuracy, input.afterQuality.ambiguityAbstentionAccuracy),
    falseAttributionRateDelta,
    unresolvedRateDelta: input.afterQuality.unresolvedRate - input.beforeQuality.unresolvedRate,
    providerCallDelta,
    attemptDelta,
    tokenDelta,
    latencyDeltaMs,
    failureRateDelta,
    safetyRegressionCount,
    reasonCodes: Object.freeze([...reasonCodes].sort())
  });
}

/** Helper for evaluation harnesses that want explicit zero-provider resource accounting. */
export function zeroAiAttributionEvaluationResources(latencyMs = 0): AiAttributionEvaluationResources {
  return Object.freeze({ providerCalls: 0, attempts: 0, totalTokens: 0, latencyMs: finiteNonNegative(latencyMs, "latencyMs"), failureRate: 0 });
}

/** Captures truthful provider accounting from an existing WO-AI-006 snapshot. */
export function aiAttributionEvaluationResourcesFromSnapshot(snapshot: AiInferenceResourceSnapshot): AiAttributionEvaluationResources {
  const failures = snapshot.attemptsEvidence.filter((attempt) => attempt.result === "FAILED").length;
  return Object.freeze({
    providerCalls: snapshot.modelCalls,
    attempts: snapshot.attempts,
    totalTokens: snapshot.actualTotalTokens ?? 0,
    latencyMs: snapshot.elapsedMs,
    failureRate: snapshot.attempts === 0 ? 0 : failures / snapshot.attempts
  });
}
