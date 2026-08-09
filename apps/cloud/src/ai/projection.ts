import type { AiCalibrationProfile, AiReadOnlyProjection } from "../../../../packages/contracts/src/aiInference";
import type { AiOrchestrationResult } from "./multiAgentOrchestrator";

type CalibrationBoundResult = AiOrchestrationResult & { readonly calibrationProfile?: AiCalibrationProfile | null };

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

const emptyCalibration = Object.freeze({ confidence: 0, calibrationStatus: "UNKNOWN" as const, rawProbability: null, calibratedProbability: null, effectiveConfidence: 0, calibrationSampleCount: 0, calibrationExpectedError: null, calibrationBrierScore: null, calibrationCohort: null });

export function projectAiReadOnly(result: AiOrchestrationResult | null, calibrationProfile?: AiCalibrationProfile | null): AiReadOnlyProjection {
  if (result == null || result.status === "UNAVAILABLE") return Object.freeze({ status: "UNAVAILABLE", thesis: null, ...emptyCalibration, evidenceReferences: [], counterEvidence: [], uncertainty: null, criticSeverity: null, disagreements: [], lastModelRun: null, modelVersion: null, promptVersion: null, liveAuthority: "NONE", productionMutationAllowed: false });
  const boundProfile = calibrationProfile === undefined ? (result as CalibrationBoundResult).calibrationProfile : calibrationProfile;
  const calibration = calibrationFields(result, boundProfile);
  if (result.governanceDecision == null) return Object.freeze({ status: "INCOMPLETE", thesis: null, ...calibration, confidence: 0, effectiveConfidence: 0, evidenceReferences: [], counterEvidence: [], uncertainty: null, criticSeverity: null, disagreements: result.independence?.reasonCodes ?? [], lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
  const proposal = result.structuredOutputs.find((output) => output.role === "STRATEGY_PROPOSER");
  const critic = result.structuredOutputs.find((output) => output.role === "ADVERSARIAL_CRITIC");
  const proposalPayload = proposal?.payload as Record<string, unknown> | undefined;
  const criticPayload = critic?.payload as Record<string, unknown> | undefined;
  const claims = Array.isArray(proposalPayload?.rationaleClaims) ? proposalPayload.rationaleClaims : [];
  const disagreements = [...new Set([...result.governanceDecision.unresolvedDisagreements, ...result.governanceDecision.vetoReasons, ...(result.independence?.reasonCodes ?? [])])].sort();
  if (result.governanceDecision.result === "incomplete") return Object.freeze({ status: "INCOMPLETE", thesis: null, ...calibration, confidence: 0, effectiveConfidence: 0, evidenceReferences: proposal?.evidenceReferences ?? Object.freeze([]), counterEvidence: Array.isArray(criticPayload?.counterClaims) ? criticPayload.counterClaims as string[] : result.governanceDecision.vetoReasons, uncertainty: proposalPayload?.uncertainty == null ? "analysis incomplete" : String(proposalPayload.uncertainty), criticSeverity: criticPayload?.severity == null ? null : criticPayload.severity as AiReadOnlyProjection["criticSeverity"], disagreements, lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
  return Object.freeze({ status: "AVAILABLE", thesis: result.governanceDecision.result === "preview_candidate" ? String(claims[0] ?? "AI analysis candidate; deterministic gates still apply") : null, ...calibration, evidenceReferences: proposal?.evidenceReferences ?? Object.freeze([]), counterEvidence: Array.isArray(criticPayload?.counterClaims) ? criticPayload.counterClaims as string[] : result.governanceDecision.vetoReasons, uncertainty: proposalPayload?.uncertainty == null ? (result.governanceDecision.unresolvedDisagreements.length ? "unresolved disagreement" : null) : String(proposalPayload.uncertainty), criticSeverity: criticPayload?.severity == null ? null : criticPayload.severity as AiReadOnlyProjection["criticSeverity"], disagreements, lastModelRun: result.runs.at(-1)?.completedAt ?? null, modelVersion: result.agents[0]?.modelVersionId ?? null, promptVersion: result.agents[0]?.definitionVersion ?? null, liveAuthority: "NONE", productionMutationAllowed: false });
}
