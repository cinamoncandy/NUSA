import { createHash } from "node:crypto";
import { canonicalResearchJson } from "./researchRuntime";

export const RESEARCH_HARDENING_SCHEMA_VERSION = 1 as const;

export interface ResearchCostEvidence {
  readonly schemaVersion: 1;
  readonly evaluationId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly turnoverRate: number;
  readonly grossReturn: number;
  readonly netReturn: number;
  readonly costModelVersion: string;
  readonly observedAt: number;
}

export interface ResearchProvenance {
  readonly researchRunId: string;
  readonly sessionId: string;
  readonly experimentId: string;
  readonly evaluationId: string;
  readonly hypothesisId?: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly datasetManifestSchemaVersion: number;
  readonly market: string;
  readonly interval: string;
  readonly startEventTime: number;
  readonly endEventTime: number;
  readonly featurePipelineVersion: string;
  readonly featurePipelineHash: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly strategyArtifactHash: string;
  readonly strategyConfigHash: string;
  readonly sourceCommitSha: string;
  readonly evaluatorVersion: string;
  readonly modelVersion: string;
  readonly fillModelVersion: string;
  readonly feeModelVersion: string;
  readonly slippageModelVersion: string;
  readonly randomSeed: string;
  readonly splitIdentity: string;
  readonly splitHash: string;
  readonly walkForwardConfigHash: string;
  readonly experimentFamilyId: string;
  readonly attempt: number;
  readonly hypothesisLineage: string;
  readonly trainingWindowHash: string;
  readonly validationWindowHash: string;
  readonly finalHoldoutWindowHash: string;
  readonly canonicalInputHash: string;
  readonly finalHoldoutUntouched: boolean;
  readonly windowId: string;
  readonly windowRole: "TRAIN" | "VALIDATION" | "HOLDOUT";
}

export interface ResearchExperimentManifest {
  readonly schemaVersion: typeof RESEARCH_HARDENING_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly researchRunId: string;
  readonly sessionId: string;
  readonly hypothesisId?: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly splitIdentity: string;
  readonly splitHash: string;
  readonly windowId: string;
  readonly windowRole: "TRAIN" | "VALIDATION" | "HOLDOUT";
  readonly startEventTime: number;
  readonly endEventTime: number;
  readonly featurePipelineHash: string;
  readonly strategyArtifactHash: string;
  readonly strategyConfigHash: string;
  readonly sourceCommitSha: string;
  readonly evaluatorVersion: string;
  readonly modelVersion: string;
  readonly fillModelVersion: string;
  readonly feeModelVersion: string;
  readonly slippageModelVersion: string;
  readonly randomSeed: string;
  readonly walkForwardConfigHash: string;
  readonly canonicalHash: string;
}

export interface ResearchExperimentMetrics {
  readonly netReturn: number;
  readonly costAdjustedReturn: number;
  readonly maximumDrawdown: number;
  readonly sharpeRatio: number;
  readonly profitFactor?: number;
  readonly executionQuality: number;
  readonly unresolvedFaultCount: number;
  readonly dataQualityFailures: number;
  readonly tradeCount: number;
}

export interface ResearchExperimentResult {
  readonly schemaVersion: typeof RESEARCH_HARDENING_SCHEMA_VERSION;
  readonly experimentId: string;
  readonly evaluationId: string;
  readonly result: "CHAMPION_BETTER" | "CHALLENGER_BETTER" | "EQUIVALENT" | "INCONCLUSIVE";
  readonly champion: ResearchExperimentMetrics;
  readonly challenger: ResearchExperimentMetrics;
  readonly inconclusiveRate: number;
  readonly statisticalConfidence: number;
  readonly superiorityMargin: number;
  readonly provenanceHash: string;
  readonly canonicalHash: string;
}

export type CandidateEligibilityStatus = "ELIGIBLE" | "NOT_ELIGIBLE";

export interface ResearchCandidateGateDecision {
  readonly status: CandidateEligibilityStatus;
  readonly reasons: readonly string[];
  readonly candidateAuthority: "PAPER_ONLY";
  readonly automaticPromotion: false;
  readonly evidenceHash: string;
}

const isSha256 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const isSha1 = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function researchHardeningHash(value: unknown): string {
  return createHash("sha256").update(canonicalResearchJson(value), "utf8").digest("hex");
}

export function validateResearchProvenance(value: ResearchProvenance): readonly string[] {
  const missing: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === "hypothesisId") continue;
    if (typeof item === "string" && !text(item)) missing.push(`MISSING_${key.toUpperCase()}`);
    if (item === undefined || item === null) missing.push(`MISSING_${key.toUpperCase()}`);
  }
  if (!isSha256(value.datasetContentSha256)) missing.push("INVALID_DATASET_HASH");
  if (!isSha256(value.featurePipelineHash)) missing.push("INVALID_FEATURE_HASH");
  if (!isSha256(value.strategyArtifactHash)) missing.push("INVALID_STRATEGY_ARTIFACT_HASH");
  if (!isSha256(value.strategyConfigHash)) missing.push("INVALID_STRATEGY_CONFIG_HASH");
  if (!isSha256(value.splitHash)) missing.push("INVALID_SPLIT_HASH");
  if (!isSha256(value.walkForwardConfigHash)) missing.push("INVALID_WALK_FORWARD_HASH");
  if (!text(value.experimentFamilyId) || !text(value.hypothesisLineage)) missing.push("MISSING_EXPERIMENT_LINEAGE");
  if (!Number.isSafeInteger(value.attempt) || value.attempt <= 0) missing.push("INVALID_ATTEMPT");
  if (!isSha256(value.trainingWindowHash) || !isSha256(value.validationWindowHash) || !isSha256(value.finalHoldoutWindowHash)) missing.push("INVALID_WINDOW_HASH");
  if (!isSha256(value.canonicalInputHash)) missing.push("INVALID_CANONICAL_INPUT_HASH");
  if (!isSha1(value.sourceCommitSha)) missing.push("INVALID_SOURCE_COMMIT");
  if (!Number.isSafeInteger(value.datasetManifestSchemaVersion) || value.datasetManifestSchemaVersion <= 0) missing.push("INVALID_DATASET_SCHEMA");
  if (!Number.isSafeInteger(value.startEventTime) || !Number.isSafeInteger(value.endEventTime) || value.startEventTime > value.endEventTime) missing.push("INVALID_EVENT_RANGE");
  if (value.windowRole === "HOLDOUT" && value.finalHoldoutUntouched !== true) missing.push("HOLDOUT_CONTAMINATED");
  if (!['TRAIN', 'VALIDATION', 'HOLDOUT'].includes(value.windowRole)) missing.push("INVALID_WINDOW_ROLE");
  return Object.freeze([...new Set(missing)].sort());
}

export function validateResearchTemporalIntegrity(values: readonly ResearchProvenance[]): readonly string[] {
  const errors: string[] = [];
  for (const value of values) {
    if (value.startEventTime > value.endEventTime) errors.push("INVALID_EVENT_RANGE");
  }
  for (let left = 0; left < values.length; left += 1) for (let right = left + 1; right < values.length; right += 1) {
    const first = values[left]!;
    const second = values[right]!;
    if (first.windowRole !== second.windowRole && first.startEventTime <= second.endEventTime && second.startEventTime <= first.endEventTime) errors.push("TEMPORAL_WINDOW_OVERLAP");
  }
  return Object.freeze([...new Set(errors)].sort());
}

export function createResearchExperimentManifest(input: Omit<ResearchExperimentManifest, "canonicalHash" | "schemaVersion">): ResearchExperimentManifest {
  const unsigned = { ...input, schemaVersion: RESEARCH_HARDENING_SCHEMA_VERSION } as const;
  const candidate = { ...unsigned, canonicalHash: researchHardeningHash(unsigned) } as ResearchExperimentManifest;
  const errors = validateResearchManifest(candidate);
  if (errors.length) throw new Error(`research manifest invalid: ${errors.join(",")}`);
  return Object.freeze(candidate);
}

export function validateResearchManifest(value: ResearchExperimentManifest): readonly string[] {
  const errors: string[] = [];
  if (value.schemaVersion !== RESEARCH_HARDENING_SCHEMA_VERSION) errors.push("UNSUPPORTED_MANIFEST_SCHEMA");
  for (const key of ["experimentId", "researchRunId", "sessionId", "datasetId", "splitIdentity", "splitHash", "windowId", "featurePipelineHash", "strategyArtifactHash", "strategyConfigHash", "sourceCommitSha", "randomSeed", "walkForwardConfigHash", "evaluatorVersion", "modelVersion", "fillModelVersion", "feeModelVersion", "slippageModelVersion"] as const) if (!text(value[key])) errors.push(`MISSING_${key.toUpperCase()}`);
  if (!isSha256(value.datasetContentSha256) || !isSha256(value.splitHash) || !isSha256(value.featurePipelineHash) || !isSha256(value.strategyArtifactHash) || !isSha256(value.strategyConfigHash) || !isSha256(value.walkForwardConfigHash)) errors.push("INVALID_MANIFEST_HASH");
  if (!isSha1(value.sourceCommitSha)) errors.push("INVALID_SOURCE_COMMIT");
  if (!Number.isSafeInteger(value.startEventTime) || !Number.isSafeInteger(value.endEventTime) || value.startEventTime > value.endEventTime) errors.push("INVALID_MANIFEST_RANGE");
  if (value.windowRole === "HOLDOUT" && value.windowId.trim() === "") errors.push("INVALID_HOLDOUT");
  const { canonicalHash, ...unsigned } = value;
  if (canonicalHash !== researchHardeningHash(unsigned)) errors.push("MANIFEST_HASH_MISMATCH");
  return Object.freeze([...new Set(errors)].sort());
}

export const validateResearchExperimentManifest = validateResearchManifest;

export function validateResearchExperimentResult(value: ResearchExperimentResult): readonly string[] {
  const errors: string[] = [];
  if (value.schemaVersion !== RESEARCH_HARDENING_SCHEMA_VERSION) errors.push("UNSUPPORTED_RESULT_SCHEMA");
  if (!text(value.experimentId) || !text(value.evaluationId)) errors.push("MISSING_RESULT_IDENTITY");
  if (!isSha256(value.provenanceHash) || !isSha256(value.canonicalHash)) errors.push("INVALID_RESULT_HASH");
  if (!(value.inconclusiveRate >= 0 && value.inconclusiveRate <= 1) || !(value.statisticalConfidence >= 0 && value.statisticalConfidence <= 1)) errors.push("INVALID_STATISTICS");
  for (const metrics of [value.champion, value.challenger]) for (const [key, item] of Object.entries(metrics)) if (typeof item !== "number" || !Number.isFinite(item)) errors.push(`INVALID_METRIC_${key.toUpperCase()}`);
  return Object.freeze([...new Set(errors)].sort());
}

export function createResearchExperimentResult(input: Omit<ResearchExperimentResult, "canonicalHash" | "schemaVersion">): ResearchExperimentResult {
  const unsigned = { ...input, schemaVersion: RESEARCH_HARDENING_SCHEMA_VERSION } as const;
  const value = Object.freeze({ ...unsigned, canonicalHash: researchHardeningHash(unsigned) }) as ResearchExperimentResult;
  const errors = validateResearchExperimentResult(value);
  if (errors.length) throw new Error(`research result invalid: ${errors.join(",")}`);
  return value;
}

export function reproduceResearchExperiment<T extends ResearchExperimentResult>(manifest: ResearchExperimentManifest, run: () => T): T {
  if (validateResearchManifest(manifest).length) throw new Error("research manifest is invalid");
  const first = run();
  const second = run();
  if (researchHardeningHash(first) !== researchHardeningHash(second)) throw new Error("research experiment reproduction is non-deterministic");
  return first;
}
