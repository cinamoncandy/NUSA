import type {
  AiCalibrationCohortKey,
  AiCalibrationOutcome,
  AiCalibrationPrediction,
  AiCalibrationStatus
} from "./aiInference";
import type { AiInferenceResourceSnapshot } from "./aiInferenceResources";
import type { AiProviderComparisonState } from "./aiProviderDiversity";
import type { AiScenarioRobustnessState } from "./aiScenarioReasoning";

export type AiAttributionStrength = "IDENTIFIED" | "PARTIALLY_IDENTIFIED" | "UNRESOLVED" | "UNVERIFIED";
export type AiAttributionCause =
  | "EVIDENCE_GAP"
  | "DATA_QUALITY_FAILURE"
  | "MODEL_DISAGREEMENT"
  | "CALIBRATION_MISS"
  | "SCENARIO_SENSITIVITY_MISS"
  | "REGIME_SHIFT_CANDIDATE"
  | "UNRESOLVED";
export type AiAttributionPartition = "TRAIN" | "HOLDOUT";
export type AiAttributionReplayStatus = "COMPLETED" | "RESOURCE_BLOCKED" | "FAILED" | "UNVERIFIED";
export type AiAttributionNetBenefitStatus = "PASS" | "FAIL";

export interface AiObservedEvidenceIdentity {
  readonly evidenceId: string;
  readonly contentDigest: string;
  readonly provenance: "VERIFIED_RUNTIME" | "SYNTHETIC_TEST";
}

export interface AiAttributionScenarioLineage {
  readonly experimentId: string;
  readonly policyIdentity: string;
  readonly baselineIdentity: string;
  readonly resultIdentity: string;
  readonly robustnessState: AiScenarioRobustnessState;
  readonly provenance: "HYPOTHETICAL_ANALYSIS";
}

export interface AiAttributionLineageExpectation {
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactId: string;
  readonly promptArtifactVersion: string;
  readonly promptArtifactDigest: string;
  readonly calibrationCohortIdentity: string;
  readonly evidenceSnapshotIdentity: string;
  readonly scenario?: AiAttributionScenarioLineage;
}

export interface AiAttributionPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly allowedCauses: readonly AiAttributionCause[];
  readonly holdoutSalt: string;
  readonly holdoutPercent: number;
  readonly defaultEpisodeTtlMs: number;
}

export interface AiAttributionSignals {
  readonly evidenceGapEvidenceReferences: readonly string[];
  readonly dataQualityFailureEvidenceReferences: readonly string[];
  readonly providerComparisonState: AiProviderComparisonState | null;
  readonly calibrationStatus: AiCalibrationStatus;
  readonly scenarioRobustnessState: AiScenarioRobustnessState | null;
  readonly regimeShiftEvidenceReferences: readonly string[];
  readonly counterEvidenceReferences: readonly string[];
  /** Advisory-only model narrative. Runtime must never treat this field as causal proof. */
  readonly modelSelfReportedCause: AiAttributionCause | null;
  /** Advisory-only provider vote. Runtime must never treat this field as causal proof. */
  readonly providerMajorityCause: AiAttributionCause | null;
}

export interface AiAttributionRequest {
  readonly episodeId: string;
  readonly prediction: AiCalibrationPrediction;
  readonly outcome: AiCalibrationOutcome;
  readonly observedEvidence: readonly AiObservedEvidenceIdentity[];
  readonly lineage: AiAttributionLineageExpectation;
  readonly signals: AiAttributionSignals;
  readonly scope: string;
  readonly createdAt: number;
  readonly expiresAt?: number;
  readonly supersedesEpisodeId?: string;
}

export interface AiAttributionCandidate {
  readonly cause: AiAttributionCause;
  readonly supportingEvidenceReferences: readonly string[];
  readonly counterEvidenceReferences: readonly string[];
  readonly corroborationOnly: boolean;
}

export interface AiAttributionEpisode {
  readonly schemaVersion: 1;
  readonly episodeId: string;
  readonly policyIdentity: string;
  readonly replayIdentity: string;
  readonly predictionId: string;
  readonly predictionContentHash: string;
  readonly outcomeContentHash: string;
  readonly evidenceSnapshotIdentity: string;
  readonly calibrationCohortIdentity: string;
  readonly calibrationCohort: AiCalibrationCohortKey;
  readonly scenario: AiAttributionScenarioLineage | null;
  readonly strength: AiAttributionStrength;
  readonly primaryCause: AiAttributionCause | null;
  readonly candidates: readonly AiAttributionCandidate[];
  readonly reasonCodes: readonly string[];
  readonly scope: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly supersedesEpisodeId: string | null;
  readonly sourceProvenance: "VERIFIED_RUNTIME" | "SYNTHETIC_TEST";
  readonly realizedLearningCreditAllowed: boolean;
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
  readonly contentHash: string;
}

export interface AiLearningMemoryReplay {
  readonly schemaVersion: 1;
  readonly episodes: readonly AiAttributionEpisode[];
  readonly eventCount: number;
  readonly headHash: string;
}

export interface AiLessonProjection {
  readonly episodeId: string;
  readonly strength: AiAttributionStrength;
  readonly primaryCause: AiAttributionCause | null;
  readonly reasonCodes: readonly string[];
  readonly scope: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly realizedLearningCreditAllowed: boolean;
  readonly advisoryOnly: true;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface AiLearningMemoryStore {
  replay(): AiLearningMemoryReplay;
  appendEpisode(episode: AiAttributionEpisode): void;
  applicableLessons(scope: string, now: number): readonly AiLessonProjection[];
  close?(): void;
}

export interface AiAttributionBenchmarkObservation {
  readonly caseId: string;
  readonly expectedCause: AiAttributionCause | null;
  readonly expectedAmbiguous: boolean;
  readonly actualStrength: AiAttributionStrength;
  readonly actualCause: AiAttributionCause | null;
}

export interface AiAttributionBenchmarkMetrics {
  readonly caseCount: number;
  readonly knownCauseCount: number;
  readonly knownCauseCorrect: number;
  readonly knownCauseAccuracy: number | null;
  readonly ambiguousCaseCount: number;
  readonly ambiguousAbstentionCorrect: number;
  readonly ambiguityAbstentionAccuracy: number | null;
  readonly falseAttributionCount: number;
  readonly falseAttributionRate: number;
  readonly unresolvedCount: number;
  readonly unresolvedRate: number;
}

export interface AiAttributionReplayProjection {
  readonly strength: AiAttributionStrength;
  readonly primaryCause: AiAttributionCause | null;
  readonly candidateCauses: readonly AiAttributionCause[];
  readonly reasonCodes: readonly string[];
  /** Replay/ablation output is diagnostic-only and can never be durable realized-market learning credit. */
  readonly realizedLearningCreditAllowed: false;
}

export interface AiAttributionReplayResult {
  readonly schemaVersion: 1;
  readonly experimentId: string;
  readonly status: AiAttributionReplayStatus;
  readonly changedDimension: string | null;
  readonly baseline: AiAttributionReplayProjection | null;
  readonly ablation: AiAttributionReplayProjection | null;
  readonly resourceBefore: AiInferenceResourceSnapshot;
  readonly resourceAfter: AiInferenceResourceSnapshot;
  readonly reasonCodes: readonly string[];
  readonly liveAuthority: "NONE";
  readonly realOrderAuthority: false;
  readonly realTransferAuthority: false;
  readonly productionMutationAllowed: false;
}

export interface AiAttributionEvaluationResources {
  readonly providerCalls: number;
  readonly attempts: number;
  readonly totalTokens: number;
  readonly latencyMs: number;
  readonly failureRate: number;
}

export interface AiAttributionNetBenefitPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly requireQualityImprovement: boolean;
  readonly maxProviderCallIncrease: number;
  readonly maxAttemptIncrease: number;
  readonly maxTokenIncrease: number;
  readonly maxLatencyIncreaseMs: number;
  readonly maxFailureRateIncrease: number;
}

export interface AiAttributionNetBenefitInput {
  readonly beforeQuality: AiAttributionBenchmarkMetrics;
  readonly afterQuality: AiAttributionBenchmarkMetrics;
  readonly beforeResources: AiAttributionEvaluationResources;
  readonly afterResources: AiAttributionEvaluationResources;
  readonly safetyRegressionCount: number;
}

export interface AiAttributionNetBenefitResult {
  readonly schemaVersion: 1;
  readonly status: AiAttributionNetBenefitStatus;
  readonly knownCauseAccuracyDelta: number | null;
  readonly ambiguityAbstentionAccuracyDelta: number | null;
  readonly falseAttributionRateDelta: number;
  readonly unresolvedRateDelta: number;
  readonly providerCallDelta: number;
  readonly attemptDelta: number;
  readonly tokenDelta: number;
  readonly latencyDeltaMs: number;
  readonly failureRateDelta: number;
  readonly safetyRegressionCount: number;
  readonly reasonCodes: readonly string[];
}
