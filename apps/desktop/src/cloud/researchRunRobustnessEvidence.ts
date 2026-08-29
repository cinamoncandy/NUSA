import type { CandidateSelectionMode } from "../strategy/executionCostStress";

export interface ResearchRunParameterRobustnessReference {
  readonly source: string;
  readonly shortWindow: number;
  readonly longWindow: number;
  readonly assessment: string;
}

export interface ResearchRunParameterRobustnessAggregate {
  readonly candidateCount: number;
  readonly validCandidateCount: number;
  readonly invalidCandidateCount: number;
  readonly positiveRatio: number;
  readonly medianReturn: number;
  readonly returnIqr: number;
  readonly worstReturn: number;
  readonly bestReturn: number;
  readonly costSurvivorCounts: Readonly<Record<string, number>>;
}

export interface ResearchRunParameterRobustnessEvidence {
  readonly schemaVersion: 1;
  readonly status: "VERIFIED";
  readonly requestId: string;
  readonly requestSha256: string;
  readonly datasetContentSha256: string;
  readonly candidateCount: number;
  readonly validCandidateCount: number;
  readonly invalidCandidateCount: number;
  readonly references: readonly ResearchRunParameterRobustnessReference[];
  readonly aggregate: ResearchRunParameterRobustnessAggregate;
  readonly warnings: readonly string[];
  readonly provenance: Readonly<{
    readonly datasetId: string;
    readonly sourceCommitSha: string;
    readonly costModelVersion: string;
  }>;
}

export interface ResearchRunCostStressEvidence {
  readonly schemaVersion: 1;
  readonly status: "VERIFIED";
  readonly identity: Readonly<{
    readonly id: string;
    readonly sourceExperimentSha: string;
    readonly datasetSha256: string;
    readonly stressGridSha256: string;
    readonly selectionMode: CandidateSelectionMode;
    readonly engineVersion: string;
  }>;
  readonly robustnessScore: number;
  readonly scenarioIds: readonly string[];
  readonly warnings: readonly string[];
}

export interface ResearchRunRobustnessEvidence {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly parameterRobustness: ResearchRunParameterRobustnessEvidence;
  readonly costStress: ResearchRunCostStressEvidence;
}

interface ParameterRobustnessResultInput {
  readonly status?: unknown;
  readonly requestId?: unknown;
  readonly hashes?: {
    readonly requestSha256?: unknown;
    readonly datasetContentSha256?: unknown;
  };
  readonly dataset?: {
    readonly datasetContentSha256?: unknown;
  };
  readonly references?: readonly {
    readonly source?: unknown;
    readonly shortWindow?: unknown;
    readonly longWindow?: unknown;
    readonly assessment?: unknown;
  }[];
  readonly aggregate?: {
    readonly candidateCount?: unknown;
    readonly validCandidateCount?: unknown;
    readonly invalidCandidateCount?: unknown;
    readonly positiveRatio?: unknown;
    readonly medianReturn?: unknown;
    readonly returnIqr?: unknown;
    readonly worstReturn?: unknown;
    readonly bestReturn?: unknown;
    readonly costSurvivorCounts?: unknown;
  };
  readonly warnings?: readonly unknown[];
  readonly verification?: { readonly status?: unknown };
  readonly provenance?: {
    readonly datasetId?: unknown;
    readonly sourceCommitSha?: unknown;
    readonly costModelVersion?: unknown;
    readonly datasetContentSha256?: unknown;
  };
}

interface CostStressProjectionInput {
  readonly identity?: {
    readonly id?: unknown;
    readonly sourceExperimentSha?: unknown;
    readonly datasetSha256?: unknown;
    readonly stressGridSha256?: unknown;
    readonly selectionMode?: unknown;
    readonly engineVersion?: unknown;
  };
  readonly selectionMode?: unknown;
  readonly scenarios?: readonly {
    readonly scenario?: { readonly id?: unknown };
  }[];
  readonly robustnessScore?: unknown;
  readonly warnings?: readonly unknown[];
}

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;
const SELECTION_MODES: readonly CandidateSelectionMode[] = ["RESELECT_PER_SCENARIO", "FIX_BASELINE_SELECTION"];
const REQUIRED_COST_SCENARIOS = ["BASE", "MODERATE", "SEVERE"] as const;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export class ResearchRunRobustnessEvidenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunRobustnessEvidenceError";
  }
}

function requiredText(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ResearchRunRobustnessEvidenceError(code, "robustness evidence text is required");
  }
  return value.trim();
}

function hash(value: unknown, code: string): string {
  const normalized = requiredText(value, code).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) {
    throw new ResearchRunRobustnessEvidenceError(code, "robustness evidence hash is invalid");
  }
  return normalized;
}

function commitSha(value: unknown): string {
  const normalized = requiredText(value, "ROBUSTNESS_SOURCE_COMMIT_INVALID").toLowerCase();
  if (!COMMIT_PATTERN.test(normalized)) {
    throw new ResearchRunRobustnessEvidenceError("ROBUSTNESS_SOURCE_COMMIT_INVALID", "robustness source commit is invalid");
  }
  return normalized;
}

function finite(value: unknown, code: string, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ResearchRunRobustnessEvidenceError(code, `${name} must be finite`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, code: string, name: string): number {
  const normalized = finite(value, code, name);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new ResearchRunRobustnessEvidenceError(code, `${name} must be a non-negative integer`);
  }
  return normalized;
}

function ratio(value: unknown, code: string, name: string): number {
  const normalized = finite(value, code, name);
  if (normalized < 0 || normalized > 1) {
    throw new ResearchRunRobustnessEvidenceError(code, `${name} must be between zero and one`);
  }
  return normalized;
}

function uniqueSorted(values: readonly string[], code: string): readonly string[] {
  if (values.some((value) => value.length === 0)) {
    throw new ResearchRunRobustnessEvidenceError(code, "robustness evidence contains an empty value");
  }
  const sorted = [...new Set(values)].sort();
  return Object.freeze(sorted);
}

function parseParameterRobustness(
  input: ParameterRobustnessResultInput,
  datasetId: string,
  datasetContentSha256: string,
): ResearchRunParameterRobustnessEvidence {
  if (input.status !== "PASS" || input.verification?.status !== "PASS") {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_NOT_VERIFIED", "parameter robustness must pass independent verification");
  }
  const requestId = requiredText(input.requestId, "PARAMETER_ROBUSTNESS_REQUEST_ID_MISSING");
  const requestSha256 = hash(input.hashes?.requestSha256, "PARAMETER_ROBUSTNESS_REQUEST_HASH_INVALID");
  const resultDatasetSha256 = hash(input.dataset?.datasetContentSha256, "PARAMETER_ROBUSTNESS_DATASET_HASH_INVALID");
  const provenanceDatasetSha256 = hash(input.provenance?.datasetContentSha256, "PARAMETER_ROBUSTNESS_PROVENANCE_HASH_INVALID");
  if (resultDatasetSha256 !== datasetContentSha256 || provenanceDatasetSha256 !== datasetContentSha256) {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_DATASET_MISMATCH", "parameter robustness is bound to a different dataset");
  }
  const provenanceId = requiredText(input.provenance?.datasetId, "PARAMETER_ROBUSTNESS_DATASET_ID_MISSING");
  if (provenanceId !== datasetId) {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_DATASET_ID_MISMATCH", "parameter robustness dataset id does not match the canonical run");
  }
  const referencesInput = input.references;
  if (!Array.isArray(referencesInput) || referencesInput.length === 0) {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_REFERENCES_MISSING", "parameter robustness references are required");
  }
  const references = referencesInput.map((reference) => ({
    source: requiredText(reference.source, "PARAMETER_ROBUSTNESS_REFERENCE_INVALID"),
    shortWindow: nonNegativeInteger(reference.shortWindow, "PARAMETER_ROBUSTNESS_REFERENCE_INVALID", "shortWindow"),
    longWindow: nonNegativeInteger(reference.longWindow, "PARAMETER_ROBUSTNESS_REFERENCE_INVALID", "longWindow"),
    assessment: requiredText(reference.assessment, "PARAMETER_ROBUSTNESS_REFERENCE_INVALID"),
  })).sort((left, right) => left.source.localeCompare(right.source) || left.shortWindow - right.shortWindow || left.longWindow - right.longWindow);
  const aggregateInput = input.aggregate;
  if (aggregateInput == null || typeof aggregateInput !== "object") {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_AGGREGATE_MISSING", "parameter robustness aggregate is required");
  }
  const costSurvivorCountsInput = aggregateInput.costSurvivorCounts;
  if (costSurvivorCountsInput == null || typeof costSurvivorCountsInput !== "object" || Array.isArray(costSurvivorCountsInput)) {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_COST_COUNTS_INVALID", "parameter robustness cost survivor counts are required");
  }
  const costSurvivorCounts: Record<string, number> = {};
  for (const scenario of REQUIRED_COST_SCENARIOS) {
    const count = nonNegativeInteger((costSurvivorCountsInput as Record<string, unknown>)[scenario], "PARAMETER_ROBUSTNESS_COST_COUNTS_INVALID", `costSurvivorCounts.${scenario}`);
    costSurvivorCounts[scenario] = count;
  }
  const warnings = uniqueSorted(
    (input.warnings ?? []).map((warning) => requiredText(warning, "PARAMETER_ROBUSTNESS_WARNING_INVALID")),
    "PARAMETER_ROBUSTNESS_WARNING_INVALID",
  );
  const output: ResearchRunParameterRobustnessEvidence = {
    schemaVersion: 1,
    status: "VERIFIED",
    requestId,
    requestSha256,
    datasetContentSha256,
    candidateCount: nonNegativeInteger(aggregateInput.candidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "candidateCount"),
    validCandidateCount: nonNegativeInteger(aggregateInput.validCandidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "validCandidateCount"),
    invalidCandidateCount: nonNegativeInteger(aggregateInput.invalidCandidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "invalidCandidateCount"),
    references: Object.freeze(references),
    aggregate: freeze({
      candidateCount: nonNegativeInteger(aggregateInput.candidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "candidateCount"),
      validCandidateCount: nonNegativeInteger(aggregateInput.validCandidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "validCandidateCount"),
      invalidCandidateCount: nonNegativeInteger(aggregateInput.invalidCandidateCount, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "invalidCandidateCount"),
      positiveRatio: ratio(aggregateInput.positiveRatio, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "positiveRatio"),
      medianReturn: finite(aggregateInput.medianReturn, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "medianReturn"),
      returnIqr: finite(aggregateInput.returnIqr, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "returnIqr"),
      worstReturn: finite(aggregateInput.worstReturn, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "worstReturn"),
      bestReturn: finite(aggregateInput.bestReturn, "PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "bestReturn"),
      costSurvivorCounts: freeze(costSurvivorCounts),
    }),
    warnings,
    provenance: freeze({
      datasetId,
      sourceCommitSha: commitSha(input.provenance?.sourceCommitSha),
      costModelVersion: requiredText(input.provenance?.costModelVersion, "PARAMETER_ROBUSTNESS_COST_MODEL_MISSING"),
    }),
  };
  if (output.validCandidateCount + output.invalidCandidateCount !== output.candidateCount) {
    throw new ResearchRunRobustnessEvidenceError("PARAMETER_ROBUSTNESS_AGGREGATE_INVALID", "candidate counts do not reconcile");
  }
  return freeze(output);
}

function parseCostStress(
  input: CostStressProjectionInput,
  datasetContentSha256: string,
): ResearchRunCostStressEvidence {
  const identity = input.identity;
  if (identity == null || typeof identity !== "object") {
    throw new ResearchRunRobustnessEvidenceError("COST_STRESS_IDENTITY_MISSING", "cost stress identity is required");
  }
  const identityDatasetSha256 = hash(identity.datasetSha256, "COST_STRESS_DATASET_HASH_INVALID");
  if (identityDatasetSha256 !== datasetContentSha256) {
    throw new ResearchRunRobustnessEvidenceError("COST_STRESS_DATASET_MISMATCH", "cost stress is bound to a different dataset");
  }
  const selectionMode = requiredText(identity.selectionMode ?? input.selectionMode, "COST_STRESS_SELECTION_MODE_MISSING") as CandidateSelectionMode;
  if (!SELECTION_MODES.includes(selectionMode)) {
    throw new ResearchRunRobustnessEvidenceError("COST_STRESS_SELECTION_MODE_INVALID", "cost stress selection mode is invalid");
  }
  const scenarioIds = uniqueSorted(
    (input.scenarios ?? []).map((scenario) => requiredText(scenario.scenario?.id, "COST_STRESS_SCENARIO_INVALID")),
    "COST_STRESS_SCENARIO_INVALID",
  );
  for (const requiredScenario of REQUIRED_COST_SCENARIOS) {
    if (!scenarioIds.includes(requiredScenario)) {
      throw new ResearchRunRobustnessEvidenceError("COST_STRESS_SCENARIO_MISSING", `cost stress scenario ${requiredScenario} is missing`);
    }
  }
  const output: ResearchRunCostStressEvidence = {
    schemaVersion: 1,
    status: "VERIFIED",
    identity: freeze({
      id: hash(identity.id, "COST_STRESS_IDENTITY_INVALID"),
      sourceExperimentSha: requiredText(identity.sourceExperimentSha, "COST_STRESS_SOURCE_EXPERIMENT_MISSING"),
      datasetSha256: identityDatasetSha256,
      stressGridSha256: hash(identity.stressGridSha256, "COST_STRESS_GRID_HASH_INVALID"),
      selectionMode,
      engineVersion: requiredText(identity.engineVersion, "COST_STRESS_ENGINE_VERSION_MISSING"),
    }),
    robustnessScore: finite(input.robustnessScore, "COST_STRESS_SCORE_INVALID", "robustnessScore"),
    scenarioIds,
    warnings: uniqueSorted(
      (input.warnings ?? []).map((warning) => requiredText(warning, "COST_STRESS_WARNING_INVALID")),
      "COST_STRESS_WARNING_INVALID",
    ),
  };
  if (output.robustnessScore < 0 || output.robustnessScore > 100) {
    throw new ResearchRunRobustnessEvidenceError("COST_STRESS_SCORE_INVALID", "robustnessScore must be between zero and one hundred");
  }
  return freeze(output);
}

export function buildResearchRunRobustnessEvidence(input: {
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly parameterRobustness: ParameterRobustnessResultInput;
  readonly costStress: CostStressProjectionInput;
}): ResearchRunRobustnessEvidence {
  const datasetId = requiredText(input.datasetId, "ROBUSTNESS_DATASET_ID_MISSING");
  const datasetContentSha256 = hash(input.datasetContentSha256, "ROBUSTNESS_DATASET_HASH_INVALID");
  return freeze({
    schemaVersion: 1,
    datasetId,
    datasetContentSha256,
    parameterRobustness: parseParameterRobustness(input.parameterRobustness, datasetId, datasetContentSha256),
    costStress: parseCostStress(input.costStress, datasetContentSha256),
  });
}

export function validateResearchRunRobustnessEvidence(evidence: ResearchRunRobustnessEvidence): void {
  if (evidence == null || evidence.schemaVersion !== 1) {
    throw new ResearchRunRobustnessEvidenceError("ROBUSTNESS_EVIDENCE_SCHEMA_INVALID", "robustness evidence schema is invalid");
  }
  const rebuilt = buildResearchRunRobustnessEvidence({
    datasetId: evidence.datasetId,
    datasetContentSha256: evidence.datasetContentSha256,
    parameterRobustness: {
      status: "PASS",
      requestId: evidence.parameterRobustness.requestId,
      hashes: { requestSha256: evidence.parameterRobustness.requestSha256, datasetContentSha256: evidence.parameterRobustness.datasetContentSha256 },
      dataset: { datasetContentSha256: evidence.parameterRobustness.datasetContentSha256 },
      references: evidence.parameterRobustness.references,
      aggregate: evidence.parameterRobustness.aggregate,
      warnings: evidence.parameterRobustness.warnings,
      verification: { status: "PASS" },
      provenance: {
        datasetId: evidence.parameterRobustness.provenance.datasetId,
        sourceCommitSha: evidence.parameterRobustness.provenance.sourceCommitSha,
        costModelVersion: evidence.parameterRobustness.provenance.costModelVersion,
        datasetContentSha256: evidence.parameterRobustness.datasetContentSha256,
      },
    },
    costStress: {
      identity: evidence.costStress.identity,
      scenarios: evidence.costStress.scenarioIds.map((id) => ({ scenario: { id } })),
      robustnessScore: evidence.costStress.robustnessScore,
      warnings: evidence.costStress.warnings,
      selectionMode: evidence.costStress.identity.selectionMode,
    },
  });
  if (JSON.stringify(rebuilt) !== JSON.stringify(evidence)) {
    throw new ResearchRunRobustnessEvidenceError("ROBUSTNESS_EVIDENCE_NOT_CANONICAL", "robustness evidence is not canonical");
  }
}
