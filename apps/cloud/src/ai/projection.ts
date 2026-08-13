import type { AiCalibrationDurabilityHealth } from "../../../../packages/contracts/src/aiCalibrationDurability";
import type { AiCalibrationProfile, AiReadOnlyProjection } from "../../../../packages/contracts/src/aiInference";
import type { AiInferenceResourceSnapshot } from "../../../../packages/contracts/src/aiInferenceResources";
import type { AiProviderComparisonResult } from "../../../../packages/contracts/src/aiProviderDiversity";
import { evaluateExplanationFaithfulness, extractNumericFacts } from "./explanationFaithfulnessEvaluator";
import type { AiOrchestrationResult } from "./multiAgentOrchestrator";

type CalibrationBoundResult = AiOrchestrationResult & {
  readonly calibrationProfile?: AiCalibrationProfile | null;
  readonly calibrationDurabilityHealth?: AiCalibrationDurabilityHealth;
  readonly providerComparison?: AiProviderComparisonResult;
};

type DurabilityProjection = Pick<
  AiReadOnlyProjection,
  "calibrationDurabilityStatus" | "calibrationRecoveredPredictionCount" | "calibrationRecoveredOutcomeCount" | "calibrationRecoveredPendingCount" | "calibrationExpiredPendingCount"
>;

type ResourceProjection = Pick<
  AiReadOnlyProjection,
  "inferenceResourceHealth" | "inferenceResourceFailureCode" | "inferenceResourcePolicyId" | "inferenceResourcePolicyVersion" | "inferenceModelCalls" | "inferenceAttempts" | "inferenceReservedOutputTokens" | "inferenceInputBytes" | "inferenceUsageAccountingStatus" | "inferenceActualInputTokens" | "inferenceActualOutputTokens" | "inferenceActualTotalTokens" | "inferenceElapsedMs"
>;

type ProviderProjection = Pick<
  AiReadOnlyProjection,
  "providerComparisonState" | "providerTrustDisposition" | "providerIndependentGroupCount" | "providerCompletedGroupCount" | "providerDisagreementCodes" | "providerComparisonIdentity" | "providerComparisonResourceHealth" | "providerComparisonModelCalls" | "providerComparisonAttempts"
>;

const rawProbabilityFrom = (result: AiOrchestrationResult): number | null => {
  const proposer = result.structuredOutputs.find((output) => output.role === "STRATEGY_PROPOSER");
  const value = proposer?.payload.rawProbability;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
};

const calibrationFields = (result: AiOrchestrationResult, profile: AiCalibrationProfile | null | undefined): Pick<AiReadOnlyProjection, "confidence" | "calibrationStatus" | "rawProbability" | "calibratedProbability" | "effectiveConfidence" | "calibrationSampleCount" | "calibrationExpectedError" | "calibrationBrierScore" | "calibrationCohort"> => {
  const rawProbability = rawProbabilityFrom(result);
  if (rawProbability == null) return Object.freeze({ confidence: 0, calibrationStatus: "UNKNOWN", rawProbability: null, calibratedProbability: null, effectiveConfidence: 0, calibrationSampleCount: 0, calibrationExpectedError: null, calibrationBrierScore: null, calibrationCohort: null });
  if (profile == null) return Object.freeze({ confidence: 0, calibrationStatus: "UNVERIFIED", rawProbability, calibratedProbability: null, effectiveConfidence: 0, calibrationSampleCount: 0, calibrationExpectedError: null, calibrationBrierScore: null, calibrationCohort: null });
  const proposerRun = result.runs.find((run) => run.agentId === "ai-strategy-proposer");
  const proposerAgent = result.agents.find((agent) => agent.agentId === "ai-strategy-proposer");
  const identityMatches = profile.rawProbability === rawProbability
    && proposerRun != null
    && proposerAgent != null
    && proposerAgent.correlatedGroupId === `model:${profile.cohort.providerId}:${proposerRun.modelVersionId}`
    && profile.cohort.modelVersionId === proposerRun.modelVersionId
    && profile.cohort.promptArtifactId === proposerAgent.promptArtifactId
    && profile.cohort.promptArtifactVersion === proposerAgent.definitionVersion
    && profile.cohort.promptArtifactDigest === proposerRun.promptArtifactDigest;
  if (!identityMatches) return Object.freeze({ confidence: 0, calibrationStatus: "UNVERIFIED", rawProbability, calibratedProbability: null, effectiveConfidence: 0, calibrationSampleCount: 0, calibrationExpectedError: null, calibrationBrierScore: null, calibrationCohort: null });
  const effectiveConfidence = profile.status === "CALIBRATED" ? Math.min(rawProbability, Math.max(0, profile.effectiveConfidence)) : 0;
  return Object.freeze({ confidence: effectiveConfidence, calibrationStatus: profile.status, rawProbability, calibratedProbability: profile.status === "CALIBRATED" ? profile.calibratedProbability : null, effectiveConfidence, calibrationSampleCount: profile.sampleCount, calibrationExpectedError: profile.expectedCalibrationError, calibrationBrierScore: profile.brierScore, calibrationCohort: profile.cohort });
};

const durabilityFields = (health: AiCalibrationDurabilityHealth | undefined): DurabilityProjection => Object.freeze({
  calibrationDurabilityStatus: health?.status ?? "DISABLED",
  calibrationRecoveredPredictionCount: health?.recoveredPredictionCount ?? 0,
  calibrationRecoveredOutcomeCount: health?.recoveredOutcomeCount ?? 0,
  calibrationRecoveredPendingCount: health?.recoveredPendingCount ?? 0,
  calibrationExpiredPendingCount: health?.expiredPendingCount ?? 0
});

const resourceFields = (snapshot: AiInferenceResourceSnapshot | undefined): ResourceProjection => Object.freeze({
  inferenceResourceHealth: snapshot?.health ?? "UNVERIFIED",
  inferenceResourceFailureCode: snapshot?.failureCode ?? null,
  inferenceResourcePolicyId: snapshot?.policy.policyId ?? null,
  inferenceResourcePolicyVersion: snapshot?.policy.policyVersion ?? null,
  inferenceModelCalls: snapshot?.modelCalls ?? 0,
  inferenceAttempts: snapshot?.attempts ?? 0,
  inferenceReservedOutputTokens: snapshot?.reservedOutputTokens ?? 0,
  inferenceInputBytes: snapshot?.inputBytes ?? 0,
  inferenceUsageAccountingStatus: snapshot?.usageAccountingStatus ?? "UNAVAILABLE",
  inferenceActualInputTokens: snapshot?.actualInputTokens ?? null,
  inferenceActualOutputTokens: snapshot?.actualOutputTokens ?? null,
  inferenceActualTotalTokens: snapshot?.actualTotalTokens ?? null,
  inferenceElapsedMs: snapshot?.elapsedMs ?? 0
});

const providerFields = (comparison: AiProviderComparisonResult): ProviderProjection => Object.freeze({
  providerComparisonState: comparison.comparisonState,
  providerTrustDisposition: comparison.trustDisposition,
  providerIndependentGroupCount: comparison.independentGroupCount,
  providerCompletedGroupCount: comparison.completedGroupCount,
  providerDisagreementCodes: comparison.metrics.disagreementCodes,
  providerComparisonIdentity: comparison.comparisonIdentity,
  providerComparisonResourceHealth: comparison.inferenceResources.health,
  providerComparisonModelCalls: comparison.inferenceResources.modelCalls,
  providerComparisonAttempts: comparison.inferenceResources.attempts
});

const emptyCalibration = Object.freeze({ confidence: 0, calibrationStatus: "UNKNOWN" as const, rawProbability: null, calibratedProbability: null, effectiveConfidence: 0, calibrationSampleCount: 0, calibrationExpectedError: null, calibrationBrierScore: null, calibrationCohort: null });

function projectPrimaryAiReadOnly(
  result: AiOrchestrationResult | null,
  calibrationProfile?: AiCalibrationProfile | null,
  durabilityHealth?: AiCalibrationDurabilityHealth
): AiReadOnlyProjection {
  const boundResult = result as CalibrationBoundResult | null;
  const boundDurability = durabilityHealth ?? boundResult?.calibrationDurabilityHealth;
  const durability = durabilityFields(boundDurability);
  const resources = resourceFields(result?.inferenceResources);
  if (result == null || result.status === "UNAVAILABLE") return Object.freeze({ status: "UNAVAILABLE", thesis: null, ...emptyCalibration, ...durability, ...resources, evidenceReferences: [], counterEvidence: [], uncertainty: null, criticSeverity: null, disagreements: [], lastModelRun: null, modelVersion: null, promptVersion: null, liveAuthority: "NONE", productionMutationAllowed: false });
  const boundProfile = calibrationProfile === undefined ? boundResult?.calibrationProfile : calibrationProfile;
  // Corrupt/unavailable durable history cannot remain a trusted calibration source. Raw model
  // probability remains visible, but all calibrated/effective confidence is forced to zero.
  const trustedProfile = boundDurability?.status === "UNHEALTHY" ? null : boundProfile;
  const calibration = calibrationFields(result, trustedProfile);
  if (result.inferenceResources != null && result.inferenceResources.health !== "HEALTHY") return Object.freeze({ status: "INCOMPLETE", thesis: null, ...calibration, ...durability, ...resources, confidence: 0, effectiveConfidence: 0, evidenceReferences: [], counterEvidence: [], uncertainty: "inference resource budget unavailable", criticSeverity: null, disagreements: result.independence?.reasonCodes ?? [], lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
  if (result.governanceDecision == null) return Object.freeze({ status: "INCOMPLETE", thesis: null, ...calibration, ...durability, ...resources, confidence: 0, effectiveConfidence: 0, evidenceReferences: [], counterEvidence: [], uncertainty: null, criticSeverity: null, disagreements: result.independence?.reasonCodes ?? [], lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
  const proposal = result.structuredOutputs.find((output) => output.role === "STRATEGY_PROPOSER");
  const critic = result.structuredOutputs.find((output) => output.role === "ADVERSARIAL_CRITIC");
  const proposalPayload = proposal?.payload as Record<string, unknown> | undefined;
  const criticPayload = critic?.payload as Record<string, unknown> | undefined;
  const claims = Array.isArray(proposalPayload?.rationaleClaims) ? proposalPayload.rationaleClaims : [];
  const disagreements = [...new Set([...result.governanceDecision.unresolvedDisagreements, ...result.governanceDecision.vetoReasons, ...(result.independence?.reasonCodes ?? [])])].sort();
  if (result.governanceDecision.result === "incomplete") return Object.freeze({ status: "INCOMPLETE", thesis: null, ...calibration, ...durability, ...resources, confidence: 0, effectiveConfidence: 0, evidenceReferences: proposal?.evidenceReferences ?? Object.freeze([]), counterEvidence: Array.isArray(criticPayload?.counterClaims) ? criticPayload.counterClaims as string[] : result.governanceDecision.vetoReasons, uncertainty: proposalPayload?.uncertainty == null ? "analysis incomplete" : String(proposalPayload.uncertainty), criticSeverity: criticPayload?.severity == null ? null : criticPayload.severity as AiReadOnlyProjection["criticSeverity"], disagreements, lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
  return Object.freeze({ status: "AVAILABLE", thesis: result.governanceDecision.result === "preview_candidate" ? String(claims[0] ?? "AI analysis candidate; deterministic gates still apply") : null, ...calibration, ...durability, ...resources, evidenceReferences: proposal?.evidenceReferences ?? Object.freeze([]), counterEvidence: Array.isArray(criticPayload?.counterClaims) ? criticPayload.counterClaims as string[] : result.governanceDecision.vetoReasons, uncertainty: proposalPayload?.uncertainty == null ? (result.governanceDecision.unresolvedDisagreements.length ? "unresolved disagreement" : null) : String(proposalPayload.uncertainty), criticSeverity: criticPayload?.severity == null ? null : criticPayload.severity as AiReadOnlyProjection["criticSeverity"], disagreements, lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
}

function applyProviderComparison(base: AiReadOnlyProjection, comparison: AiProviderComparisonResult | undefined): AiReadOnlyProjection {
  if (comparison == null) return base;
  const fields = providerFields(comparison);
  if (comparison.comparisonState === "CONSENSUS") {
    // Independent agreement is evidence, not confidence creation. Preserve the primary calibrated value exactly.
    return Object.freeze({ ...base, ...fields });
  }
  const comparisonCode = `PROVIDER_COMPARISON_${comparison.comparisonState}`;
  const disagreements = Object.freeze([...new Set([...base.disagreements, ...comparison.metrics.disagreementCodes, comparisonCode])].sort());
  return Object.freeze({
    ...base,
    ...fields,
    status: "INCOMPLETE" as const,
    thesis: null,
    confidence: 0,
    effectiveConfidence: 0,
    uncertainty: comparison.comparisonState === "DISAGREEMENT" ? "independent provider disagreement" : "independent provider comparison incomplete",
    disagreements
  });
}

/**
 * Scores the STRATEGY_PROPOSER's rationale (the actual explanation this projection surfaces as
 * `thesis`/`uncertainty`) for groundedness against the EVIDENCE_PRODUCER's own fact-typed
 * observations, and for completeness/consistency -- see ADR-0013 and
 * explanationFaithfulnessEvaluator.ts's module doc.
 *
 * Scoped deliberately to what this orchestration layer actually contains: STRATEGY_PROPOSER's
 * `decision` field is "candidate" | "no_action" | "insufficient_evidence", a research-candidate
 * verdict, not a BUY/SELL trade direction -- there is no live trade direction at this layer to
 * check consistency against, so `action` is passed as the neutral "HOLD" (which the evaluator
 * exempts from its direction-consistency check by design; see its test suite). Only
 * groundedness and completeness are meaningful here, and that's what this wiring exercises.
 */
function applyExplanationFaithfulness(base: AiReadOnlyProjection, result: AiOrchestrationResult | null): AiReadOnlyProjection {
  const proposal = result?.structuredOutputs.find((output) => output.role === "STRATEGY_PROPOSER");
  if (proposal == null) return base;
  const proposalPayload = proposal.payload as { rationaleClaims?: unknown; uncertainty?: unknown; rawProbability?: unknown };
  const rationaleClaims = Array.isArray(proposalPayload.rationaleClaims) ? proposalPayload.rationaleClaims.filter((claim): claim is string => typeof claim === "string") : [];
  const uncertainty = typeof proposalPayload.uncertainty === "string" ? proposalPayload.uncertainty : "";
  const explanationText = [...rationaleClaims, uncertainty].join(" ").trim();
  if (explanationText === "") return base;

  const evidenceOutput = result?.structuredOutputs.find((output) => output.role === "EVIDENCE_PRODUCER");
  const evidencePayload = evidenceOutput?.payload as { observations?: unknown } | undefined;
  const observations = Array.isArray(evidencePayload?.observations) ? evidencePayload.observations as ReadonlyArray<Record<string, unknown>> : [];
  const factualClaimsText = observations
    .filter((observation) => observation.claimType === "fact")
    .map((observation) => (typeof observation.claim === "string" ? observation.claim : ""))
    .join(" ");
  const numericFacts = extractNumericFacts(factualClaimsText);

  const rawProbability = typeof proposalPayload.rawProbability === "number" && Number.isFinite(proposalPayload.rawProbability)
    ? Math.min(1, Math.max(0, proposalPayload.rawProbability))
    : 0;
  const evaluatedAt = result?.runs.at(-1)?.completedAt ?? 0;

  const faithfulness = evaluateExplanationFaithfulness({
    schemaVersion: 1,
    explanationId: result?.orchestrationRunId ?? "unknown",
    explanationText,
    evidence: { numericFacts },
    decision: { action: "HOLD", confidence: rawProbability },
    evaluatedAt: Number.isSafeInteger(evaluatedAt) && evaluatedAt >= 0 ? evaluatedAt : 0
  });

  return Object.freeze({
    ...base,
    explanationFaithfulnessStrength: faithfulness.strength,
    explanationFaithfulnessReasonCodes: faithfulness.reasonCodes,
    explanationFaithfulnessUngroundedNumbers: faithfulness.ungroundedNumbers
  });
}

export function projectAiReadOnly(
  result: AiOrchestrationResult | null,
  calibrationProfile?: AiCalibrationProfile | null,
  durabilityHealth?: AiCalibrationDurabilityHealth
): AiReadOnlyProjection {
  const boundResult = result as CalibrationBoundResult | null;
  const withProviderComparison = applyProviderComparison(projectPrimaryAiReadOnly(result, calibrationProfile, durabilityHealth), boundResult?.providerComparison);
  return applyExplanationFaithfulness(withProviderComparison, result);
}
