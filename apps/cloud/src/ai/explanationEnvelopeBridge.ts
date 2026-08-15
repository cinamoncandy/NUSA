import { aiSha256 } from "../../../../packages/contracts/src/aiInference";
import type { AiCalibrationCohortKey } from "../../../../packages/contracts/src/aiInference";
import {
  explanationContentDigest,
  type AiExplanationClaim,
  type AiExplanationEnvelope,
  type AiExplanationEvidence,
  type AiExplanationPolicy
} from "../../../../packages/contracts/src/aiExplanationFaithfulness";
import type { AiInferenceBudgetPolicy } from "../../../../packages/contracts/src/aiInferenceResources";
import { aiInferenceBudgetIdentity } from "./inferenceResourceLedger";
import type { AiOrchestrationInput, AiOrchestrationResult } from "./multiAgentOrchestrator";

/**
 * Adapts an already-completed, already-governed {@link AiOrchestrationResult} into an
 * {@link AiExplanationEnvelope} so every AI decision can be checked against WO-AI-010's
 * claim/evidence faithfulness rules before it is projected read-only. This bridge only reuses
 * data the orchestrator already produced and verified (evidence content digests, structured
 * outputs, run/agent identity) — it never fabricates a claim, an evidence item, or a confidence
 * value that the governed pipeline did not already emit.
 */

export const NUSA_AI_EXPLANATION_POLICY_ID = "NUSA_AI_EXPLANATION_POLICY_V1";
/**
 * This runtime path performs no train/holdout partitioning of decisions (unlike the offline
 * research benchmark path in outcomeAttributionEvaluation.ts). The schema requires a non-empty
 * holdout-partition identity; this fixed sentinel documents that the field is structurally N/A
 * here rather than silently reusing an unrelated hash.
 */
export const NUSA_CLOUD_AI_NO_HOLDOUT_PARTITION_SENTINEL = "NUSA_CLOUD_AI_NO_HOLDOUT_PARTITION_V1";
const UNCALIBRATED_SENTINEL_DIGEST = aiSha256({ sentinel: "NUSA_CLOUD_AI_UNCALIBRATED_V1" });

export interface AiExplanationEnvelopeContext {
  readonly explanationId: string;
  readonly observedAt: number;
  readonly providerId: string;
  readonly resourcePolicy: AiInferenceBudgetPolicy;
  /** Present only once a durable, verified calibration prediction was recorded for this cycle. */
  readonly calibrationCohort?: AiCalibrationCohortKey | null;
  readonly providerDisagreement?: boolean;
  /** The same trusted effective confidence the read-only projection would show; 0 when unverified. */
  readonly confidence: number;
  readonly scenarioIdentity?: string | null;
}

const asStringArray = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/**
 * Returns null when the orchestration result has no completed, governed strategy proposal to
 * explain (UNAVAILABLE/INCOMPLETE runs, or a run whose governance decision never evaluated). The
 * caller must treat null as "nothing to verify yet," not as a verification failure.
 */
export function buildAiExplanationEnvelope(
  input: AiOrchestrationInput,
  result: AiOrchestrationResult,
  context: AiExplanationEnvelopeContext
): AiExplanationEnvelope | null {
  if (result.status !== "COMPLETED" || result.governanceDecision == null) return null;
  const proposal = result.structuredOutputs.find((output) => output.role === "STRATEGY_PROPOSER");
  const proposalRun = result.runs.find((run) => run.agentId === "ai-strategy-proposer");
  const proposalAgent = result.agents.find((agent) => agent.agentId === "ai-strategy-proposer");
  const riskOutput = result.structuredOutputs.find((output) => output.role === "RISK_VERIFIER");
  if (proposal == null || proposalRun == null || proposalAgent == null || proposalRun.completedAt == null) return null;

  const rationaleClaims = asStringArray(proposal.payload.rationaleClaims);
  const hardDenies = new Set(riskOutput == null ? [] : asStringArray(riskOutput.payload.hardDenies));
  const claimIds = rationaleClaims.map((_, index) => `${proposalRun.agentRunId}:claim:${index}`);
  // Whether the model itself chose to make a claim (STRATEGY_PROPOSER "decision" === "candidate")
  // is a separate question from whether governance granted "preview_candidate" trust (which also
  // requires independent, uncorrelated agents). A correlated single-provider run can still make a
  // real, evidence-cited claim; faithfulness only asks whether that claim is actually supported.
  const assertive = proposal.payload.decision === "candidate";

  const claims: AiExplanationClaim[] = rationaleClaims.map((text, index) => Object.freeze({
    claimId: claimIds[index]!,
    text,
    citedEvidenceIds: proposal.evidenceReferences,
    provenance: "OBSERVED" as const,
    assertive
  }));

  const evidence: AiExplanationEvidence[] = input.evidence.map((item) => {
    const denied = hardDenies.has(item.evidenceId);
    return Object.freeze({
      evidenceId: item.evidenceId,
      digest: item.contentDigest,
      provenance: "OBSERVED" as const,
      supportsClaimIds: denied ? [] : claimIds,
      contradictsClaimIds: denied ? claimIds : [],
      material: denied
    });
  });

  const policy: AiExplanationPolicy = Object.freeze({
    schemaVersion: 1,
    policyId: NUSA_AI_EXPLANATION_POLICY_ID,
    policyVersion: "1",
    maxClaims: 32,
    maxEvidencePerClaim: Math.max(1, input.evidence.length),
    materialCounterEvidenceIds: Object.freeze(evidence.filter((item) => item.material).map((item) => item.evidenceId)),
    minimumConfidenceForAssertiveLanguage: 0.5,
    resourcePolicyIdentity: aiSha256(aiInferenceBudgetIdentity(context.resourcePolicy))
  });

  const withoutDigest: Omit<AiExplanationEnvelope, "contentDigest"> = Object.freeze({
    schemaVersion: 1,
    explanationId: context.explanationId,
    policy,
    lineage: Object.freeze({
      decisionId: input.decisionId,
      decisionDigest: aiSha256(result.governanceDecision),
      providerId: context.providerId,
      modelVersionId: proposalRun.modelVersionId,
      promptArtifactDigest: proposalRun.promptArtifactDigest,
      schemaVersion: "1",
      calibrationIdentity: context.calibrationCohort == null ? UNCALIBRATED_SENTINEL_DIGEST : aiSha256(context.calibrationCohort),
      scenarioIdentity: context.scenarioIdentity ?? null,
      attributionIdentity: null,
      canonicalInputHash: aiSha256({ evidence: input.evidence, evidenceMaterializations: input.evidenceMaterializations ?? [] }),
      replayIdentity: result.orchestrationRunId,
      holdoutPartitionIdentity: NUSA_CLOUD_AI_NO_HOLDOUT_PARTITION_SENTINEL
    }),
    claims: Object.freeze(claims),
    evidence: Object.freeze(evidence),
    confidence: context.confidence,
    abstained: !assertive,
    providerDisagreement: context.providerDisagreement === true,
    attributionStrength: "UNRESOLVED",
    observedAt: context.observedAt
  });
  return Object.freeze({ ...withoutDigest, contentDigest: explanationContentDigest(withoutDigest) });
}
