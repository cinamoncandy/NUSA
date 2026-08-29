import { createHash } from "node:crypto";

export type AiAgentRole = "EVIDENCE_PRODUCER" | "STRATEGY_PROPOSER" | "ADVERSARIAL_CRITIC" | "RISK_VERIFIER";
export type AiOrchestrationStatus = "COMPLETED" | "UNAVAILABLE" | "INCOMPLETE" | "INVALID";
export type ModelFailureCode = "PROVIDER_UNAVAILABLE" | "TIMEOUT" | "OUTPUT_TOO_LARGE" | "MALFORMED_OUTPUT" | "SCHEMA_VIOLATION" | "PROMPT_DIGEST_MISMATCH" | "CONTEXT_INVALID" | "EVIDENCE_MISSING" | "EVIDENCE_DIGEST_MISMATCH" | "SENSITIVE_EVIDENCE" | "REPLAY_CONFLICT" | "UNKNOWN";
export type AiCalibrationStatus = "UNKNOWN" | "UNVERIFIED" | "INSUFFICIENT_DATA" | "CALIBRATED" | "DEGRADED";
export type AiCalibrationProvenance = "VERIFIED_RUNTIME" | "SYNTHETIC_TEST";
export type AiLearningProvenance = "AUTO_BACKGROUND" | "USER_TRIGGERED" | "UNKNOWN";

export interface ModelUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface AiEvidenceMaterialization {
  readonly evidenceId: string;
  readonly contentDigest: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  readonly requestId: string;
  readonly role: AiAgentRole;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactId: string;
  readonly promptArtifactVersion: string;
  readonly promptArtifactDigest: string;
  /** Exact immutable instructions covered by promptArtifactDigest. */
  readonly instructions: string;
  readonly contextHash: string;
  readonly inputHash: string;
  /** Evidence-only input. Raw application state and credentials are prohibited. */
  readonly input: Readonly<Record<string, unknown>>;
  readonly maxOutputBytes: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly attempt: number;
}

export interface ModelResponse {
  readonly requestId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactDigest: string;
  readonly contextHash: string;
  readonly inputHash: string;
  readonly structuredOutput: unknown;
  readonly outputHash: string;
  readonly usage?: ModelUsage;
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface ModelFailure {
  readonly requestId: string;
  readonly code: ModelFailureCode;
  readonly retryable: boolean;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly occurredAt: number;
}

export interface StructuredAgentOutput {
  readonly schemaVersion: 1;
  readonly role: AiAgentRole;
  readonly evidenceReferences: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface AiCalibrationCohortKey {
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly promptArtifactId: string;
  readonly promptArtifactVersion: string;
  readonly promptArtifactDigest: string;
  readonly outcomeDefinitionId: string;
  readonly outcomeDefinitionVersion: string;
}

export interface AiCalibrationPrediction extends AiCalibrationCohortKey {
  readonly predictionId: string;
  readonly orchestrationRunId: string;
  readonly proposalId: string;
  readonly agentId: string;
  readonly role: AiAgentRole;
  /** Exact target being forecast, for example KRW-BTC. */
  readonly targetId: string;
  /** Verified value observed before inference and used as the objective outcome baseline. */
  readonly anchorValue: number;
  readonly anchorObservedAt: number;
  readonly anchorEvidenceReference: string;
  readonly rawProbability: number;
  readonly predictedAt: number;
  readonly horizonMs: number;
  readonly provenance: AiCalibrationProvenance;
  readonly contentHash: string;
}

export interface AiCalibrationOutcome {
  readonly predictionId: string;
  /** Exact immutable prediction content this outcome resolves. */
  readonly predictionContentHash: string;
  readonly outcomeDefinitionId: string;
  readonly outcomeDefinitionVersion: string;
  readonly outcome: boolean;
  /** Verified observed value used to deterministically resolve the boolean outcome. */
  readonly resolvedValue: number;
  readonly resolvedAt: number;
  readonly evidenceReferences: readonly string[];
  readonly provenance: AiCalibrationProvenance;
  readonly contentHash: string;
}

export interface AiCalibrationReliabilityBucket {
  readonly lowerBound: number;
  readonly upperBound: number;
  readonly count: number;
  readonly meanPredicted: number | null;
  readonly observedRate: number | null;
  readonly absoluteGap: number | null;
}

export interface AiCalibrationProfile {
  readonly cohort: AiCalibrationCohortKey;
  readonly status: AiCalibrationStatus;
  readonly sampleCount: number;
  readonly expectedCalibrationError: number | null;
  readonly brierScore: number | null;
  readonly rawProbability: number;
  readonly calibratedProbability: number | null;
  readonly effectiveConfidence: number;
  readonly reliabilityBuckets: readonly AiCalibrationReliabilityBucket[];
  readonly provenance: "VERIFIED_RUNTIME_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface AiReadOnlyProjection {
  readonly status: "AVAILABLE" | "UNAVAILABLE" | "INCOMPLETE";
  readonly thesis: string | null;
  /** Trusted effective confidence only. It remains zero unless calibration is verified and CALIBRATED. */
  readonly confidence: number;
  readonly evidenceReferences: readonly string[];
  readonly counterEvidence: readonly string[];
  readonly uncertainty: string | null;
  readonly criticSeverity: "none" | "low" | "medium" | "high" | "critical" | null;
  readonly disagreements: readonly string[];
  readonly lastModelRun: number | null;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  readonly calibrationStatus: AiCalibrationStatus;
  /** Raw model probability is uncalibrated model output, not a verified success probability or performance guarantee. */
  readonly rawProbability?: number | null;
  readonly calibratedProbability?: number | null;
  readonly effectiveConfidence?: number;
  readonly calibrationSampleCount?: number;
  readonly calibrationExpectedError?: number | null;
  readonly calibrationBrierScore?: number | null;
  readonly calibrationCohort?: AiCalibrationCohortKey | null;
  /** Durability is a separate trust dimension from statistical calibration. */
  readonly calibrationDurabilityStatus?: "DISABLED" | "HEALTHY" | "UNHEALTHY";
  readonly calibrationRecoveredPredictionCount?: number;
  readonly calibrationRecoveredOutcomeCount?: number;
  readonly calibrationRecoveredPendingCount?: number;
  readonly calibrationExpiredPendingCount?: number;
  /** "NOT_EVALUATED" means no completed decision has been through WO-AI-010 verification yet. */
  readonly explanationVerdict?: "PASS" | "ABSTAIN" | "NOT_EVALUATED";
  readonly explanationReasonCodes?: readonly string[];
  /** Prior structural lessons (WO-AI-009 learning memory) actually fed into this decision's evidence. */
  readonly recentLessonCount?: number;
  /** Proven only from explicit run/evidence origin. Missing or ambiguous origin is UNKNOWN. */
  readonly learningProvenance?: AiLearningProvenance;
  /** WO-AI-008 opt-in scenario robustness check against the same evidence, when enabled. */
  readonly scenarioRobustnessState?: "ROBUST" | "SENSITIVE" | "CONTRADICTORY" | "INCOMPLETE" | "UNVERIFIED" | "NOT_EVALUATED";
  readonly scenarioTrustDisposition?: "NO_UPLIFT" | "REDUCE" | "ABSTAIN";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface ModelProvider {
  readonly providerId: string;
  readonly modelVersionId: string;
  infer(request: ModelRequest): Promise<ModelResponse>;
}

export const canonicalAiJson = (value: unknown): string => {
  const normalize = (item: unknown): unknown => {
    if (item === undefined) throw new Error("unsupported AI value");
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item === "object") {
      const record = item as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => [key, normalize(record[key])]));
    }
    throw new Error("unsupported AI value");
  };
  return JSON.stringify(normalize(value));
};

export const aiSha256 = (value: unknown): string => createHash("sha256").update(canonicalAiJson(value), "utf8").digest("hex");

export const isAiSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);