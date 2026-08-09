import type { AiCalibrationPrediction } from "../../../../packages/contracts/src/aiInference";
import type { AiOrchestrationResult } from "./multiAgentOrchestrator";
import { createCalibrationPrediction } from "./outcomeCalibration";

export interface CalibrationPredictionBridgeOptions {
  readonly providerId: string;
  readonly outcomeDefinitionId: string;
  readonly outcomeDefinitionVersion: string;
  readonly horizonMs: number;
  readonly targetId: string;
  readonly anchorValue: number;
  readonly anchorObservedAt: number;
  readonly anchorEvidenceReference: string;
}

const requiredText = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
};

const positiveSafeInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const nonNegativeSafeInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const finiteNumber = (value: number, field: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
  return value;
};

const boundedProbability = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw new Error("rawProbability must be finite and within [0,1]");
  return value;
};

export function createVerifiedRuntimeCalibrationPrediction(
  result: AiOrchestrationResult,
  options: CalibrationPredictionBridgeOptions
): AiCalibrationPrediction {
  if (result.status !== "COMPLETED") throw new Error("completed orchestration is required for calibration prediction");
  const output = result.structuredOutputs.find((candidate) => candidate.role === "STRATEGY_PROPOSER");
  const run = result.runs.find((candidate) => candidate.agentId === "ai-strategy-proposer");
  const agent = result.agents.find((candidate) => candidate.agentId === "ai-strategy-proposer");
  if (output == null || run == null || agent == null || run.completedAt == null || run.status !== "completed") throw new Error("verified strategy proposer run is required for calibration prediction");
  if (agent.modelVersionId !== run.modelVersionId || agent.promptArtifactDigest !== run.promptArtifactDigest) throw new Error("strategy proposer identity mismatch");
  const rawProbability = boundedProbability(output.payload.rawProbability);
  const outcomeDefinitionId = requiredText(options.outcomeDefinitionId, "outcomeDefinitionId");
  const outcomeDefinitionVersion = requiredText(options.outcomeDefinitionVersion, "outcomeDefinitionVersion");
  const providerId = requiredText(options.providerId, "providerId");
  if (agent.correlatedGroupId !== `model:${providerId}:${run.modelVersionId}`) throw new Error("strategy proposer provider identity mismatch");
  const horizonMs = positiveSafeInteger(options.horizonMs, "horizonMs");
  const targetId = requiredText(options.targetId, "targetId");
  const anchorValue = finiteNumber(options.anchorValue, "anchorValue");
  const anchorObservedAt = nonNegativeSafeInteger(options.anchorObservedAt, "anchorObservedAt");
  const anchorEvidenceReference = requiredText(options.anchorEvidenceReference, "anchorEvidenceReference");
  if (anchorObservedAt > run.completedAt) throw new Error("calibration anchor cannot postdate proposer completion");
  if (!output.evidenceReferences.includes(anchorEvidenceReference)) throw new Error("calibration anchor must be referenced by proposer output");
  const proposalId = `${run.agentRunId}:proposal`;
  const predictionId = `${proposalId}:${outcomeDefinitionId}@${outcomeDefinitionVersion}`;

  return createCalibrationPrediction({
    predictionId,
    orchestrationRunId: result.orchestrationRunId,
    proposalId,
    agentId: run.agentId,
    role: "STRATEGY_PROPOSER",
    providerId,
    modelVersionId: run.modelVersionId,
    promptArtifactId: requiredText(agent.promptArtifactId, "promptArtifactId"),
    promptArtifactVersion: requiredText(agent.definitionVersion, "promptArtifactVersion"),
    promptArtifactDigest: run.promptArtifactDigest,
    outcomeDefinitionId,
    outcomeDefinitionVersion,
    targetId,
    anchorValue,
    anchorObservedAt,
    anchorEvidenceReference,
    rawProbability,
    predictedAt: run.completedAt,
    horizonMs,
    provenance: "VERIFIED_RUNTIME"
  });
}
