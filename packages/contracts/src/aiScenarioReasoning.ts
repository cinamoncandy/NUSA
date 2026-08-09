import type { AiEvidenceMaterialization } from "./aiInference";
import type { AiInferenceBudgetPolicy, AiInferenceResourceSnapshot } from "./aiInferenceResources";
import type { AiProviderStrategyProjection } from "./aiProviderDiversity";
import type { AgentEvidence } from "./multiAgentGovernance";

export type AiScenarioKind = "BASELINE" | "HYPOTHETICAL";
export type AiScenarioRobustnessState = "ROBUST" | "SENSITIVE" | "CONTRADICTORY" | "INCOMPLETE" | "UNVERIFIED";

export interface AiScenarioIntervention {
  readonly dimension: string;
  readonly value: string | number | boolean;
  readonly horizonMs: number;
}

export interface AiScenarioDefinition {
  readonly scenarioId: string;
  readonly kind: AiScenarioKind;
  readonly interventions: readonly AiScenarioIntervention[];
}

export interface AiScenarioPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly allowedDimensions: readonly string[];
  readonly maxScenarioCount: number;
  readonly maxProbabilityDeltaForRobust: number;
  readonly inferenceBudget: AiInferenceBudgetPolicy;
}

export interface AiScenarioBaseline {
  readonly decisionId: string;
  readonly evaluatedAt: number;
  readonly evidence: readonly AgentEvidence[];
  readonly evidenceMaterializations: readonly AiEvidenceMaterialization[];
  readonly derivedInputs: Readonly<Record<string, string | number | boolean>>;
}

export interface AiScenarioMaterialization {
  readonly scenarioId: string;
  readonly kind: AiScenarioKind;
  readonly baselineIdentity: string;
  readonly scenarioIdentity: string;
  readonly derivedInputs: Readonly<Record<string, string | number | boolean>>;
  readonly interventions: readonly AiScenarioIntervention[];
  readonly provenance: "OBSERVED_BASELINE" | "HYPOTHETICAL";
}

export interface AiScenarioEvaluation {
  readonly scenarioId: string;
  readonly scenarioIdentity: string;
  readonly kind: AiScenarioKind;
  readonly status: "COMPLETED" | "FAILED" | "RESOURCE_BLOCKED" | "UNVERIFIED";
  readonly projection: AiProviderStrategyProjection | null;
  readonly failureCode: string | null;
}

export interface AiScenarioSensitivityMetrics {
  readonly evaluatedScenarioCount: number;
  readonly completedScenarioCount: number;
  readonly duplicateScenarioCount: number;
  readonly changedDecisionCount: number;
  readonly maxProbabilityDelta: number | null;
  readonly changedUncertaintyCount: number;
  readonly reasonCodes: readonly string[];
}

export interface AiScenarioReasoningResult {
  readonly schemaVersion: 1;
  readonly experimentId: string;
  readonly policyIdentity: string;
  readonly baselineIdentity: string;
  readonly robustnessState: AiScenarioRobustnessState;
  readonly trustDisposition: "NO_UPLIFT" | "REDUCE" | "ABSTAIN";
  readonly evaluations: readonly AiScenarioEvaluation[];
  readonly metrics: AiScenarioSensitivityMetrics;
  readonly inferenceResources: AiInferenceResourceSnapshot;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
  readonly calibrationCreditAllowed: false;
  readonly realizedEvidenceAllowed: false;
  readonly learningCreditAllowed: false;
}
