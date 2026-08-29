import { createHash } from "node:crypto";

export interface ResearchCandidateSpecification {
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly familyId: string;
  readonly lineageId: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly codeSha: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly costModelVersion: string;
  readonly generatedAt: string;
  readonly evaluationStartedAt: string;
  readonly evaluationEndedAt: string;
}

export interface ResearchCandidateSpecificationDecision {
  readonly status: "VERIFIED" | "REJECTED";
  readonly reasons: readonly string[];
  readonly specificationHash: string;
}

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonicalParameters(parameters: Readonly<Record<string, string | number | boolean>>): Record<string, string | number | boolean> {
  return Object.fromEntries(Object.entries(parameters).sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalSpecification(specification: ResearchCandidateSpecification): Record<string, unknown> {
  return {
    schemaVersion: specification.schemaVersion,
    candidateId: specification.candidateId,
    familyId: specification.familyId,
    lineageId: specification.lineageId,
    parameters: canonicalParameters(specification.parameters),
    codeSha: specification.codeSha.toLowerCase(),
    datasetId: specification.datasetId,
    datasetContentSha256: specification.datasetContentSha256.toLowerCase(),
    costModelVersion: specification.costModelVersion,
    generatedAt: specification.generatedAt,
    evaluationStartedAt: specification.evaluationStartedAt,
    evaluationEndedAt: specification.evaluationEndedAt,
  };
}

function hashSpecification(specification: ResearchCandidateSpecification): string {
  return createHash("sha256").update(JSON.stringify(canonicalSpecification(specification)), "utf8").digest("hex");
}

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateResearchCandidateSpecification(
  specification: ResearchCandidateSpecification,
  nowMs: number = Date.now(),
): ResearchCandidateSpecificationDecision {
  const reasons: string[] = [];
  if (specification.schemaVersion !== 1) reasons.push("UNSUPPORTED_SCHEMA_VERSION");
  if (!nonEmpty(specification.candidateId)) reasons.push("MISSING_CANDIDATE_ID");
  if (!nonEmpty(specification.familyId)) reasons.push("MISSING_FAMILY_ID");
  if (!nonEmpty(specification.lineageId)) reasons.push("MISSING_LINEAGE_ID");
  if (!SHA40.test(specification.codeSha)) reasons.push("INVALID_CODE_SHA");
  if (!nonEmpty(specification.datasetId)) reasons.push("MISSING_DATASET_ID");
  if (!SHA256.test(specification.datasetContentSha256)) reasons.push("INVALID_DATASET_CONTENT_SHA256");
  if (!nonEmpty(specification.costModelVersion)) reasons.push("MISSING_COST_MODEL_VERSION");
  if (!Number.isFinite(nowMs) || nowMs < 0) reasons.push("INVALID_CURRENT_TIME");

  for (const [name, value] of Object.entries(specification.parameters)) {
    if (!name.trim()) reasons.push("INVALID_PARAMETER_NAME");
    if (typeof value === "number" && !Number.isFinite(value)) reasons.push("NON_FINITE_PARAMETER_VALUE");
  }

  const generatedAtMs = Date.parse(specification.generatedAt);
  const evaluationStartedAtMs = Date.parse(specification.evaluationStartedAt);
  const evaluationEndedAtMs = Date.parse(specification.evaluationEndedAt);
  if (!Number.isFinite(generatedAtMs)) reasons.push("INVALID_GENERATED_AT");
  if (!Number.isFinite(evaluationStartedAtMs)) reasons.push("INVALID_EVALUATION_STARTED_AT");
  if (!Number.isFinite(evaluationEndedAtMs)) reasons.push("INVALID_EVALUATION_ENDED_AT");

  if (Number.isFinite(generatedAtMs) && Number.isFinite(evaluationStartedAtMs) && generatedAtMs > evaluationStartedAtMs) {
    reasons.push("SPECIFICATION_CREATED_AFTER_EVALUATION_START");
  }
  if (Number.isFinite(evaluationStartedAtMs) && Number.isFinite(evaluationEndedAtMs) && evaluationStartedAtMs > evaluationEndedAtMs) {
    reasons.push("INVALID_EVALUATION_CHRONOLOGY");
  }
  if (Number.isFinite(nowMs)) {
    if (Number.isFinite(generatedAtMs) && generatedAtMs > nowMs) reasons.push("FUTURE_GENERATED_AT");
    if (Number.isFinite(evaluationStartedAtMs) && evaluationStartedAtMs > nowMs) reasons.push("FUTURE_EVALUATION_START");
    if (Number.isFinite(evaluationEndedAtMs) && evaluationEndedAtMs > nowMs) reasons.push("FUTURE_EVALUATION_END");
  }

  const normalizedReasons = Object.freeze([...new Set(reasons)].sort());
  let specificationHash: string;
  try {
    specificationHash = hashSpecification(specification);
  } catch {
    specificationHash = createHash("sha256").update(JSON.stringify({ invalidCandidateSpecification: true, reasons: normalizedReasons }), "utf8").digest("hex");
  }
  return freeze({
    status: normalizedReasons.length === 0 ? "VERIFIED" : "REJECTED",
    reasons: normalizedReasons,
    specificationHash,
  });
}
