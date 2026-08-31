import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../../packages/contracts/src/researchRuntime";
import {
  validateResearchHypothesis,
  type ResearchHypothesis as CanonicalResearchHypothesis,
} from "../../../../packages/contracts/src/researchHypothesisContract";
import type { HistoricalDatasetManifest } from "./researchDataset";

export interface CanonicalResearchHypothesisBinding {
  readonly hypothesis: CanonicalResearchHypothesis;
  readonly hypothesisHash: string;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly market: string;
  readonly createdAt: string;
  readonly evaluationGeneratedAt: string;
}

export class ResearchHypothesisAdmissionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchHypothesisAdmissionError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/i;
const FORBIDDEN_FIELD = /password|secret|token|authorization|cookie|credential|private[-_]?key|access[-_]?key|api[-_]?key|nonce|signature/i;
const HYPOTHESIS_FIELDS = new Set([
  "schemaVersion",
  "hypothesisId",
  "candidateId",
  "family",
  "parentHypothesisId",
  "rationale",
  "mechanism",
  "targetMarket",
  "expectedRegime",
  "invalidationCondition",
  "holdingPeriodMs",
  "capacityAssumptions",
  "transactionCostSensitivity",
  "provenance",
  "createdAt",
]);
const CAPACITY_FIELDS = new Set(["maxNotional", "maxParticipationRate"]);
const PROVENANCE_FIELDS = new Set(["author", "modelVersionId", "promptArtifactDigest", "sourceReferences"]);

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function rejectForbiddenFields(value: unknown, allowed: ReadonlySet<string>, seen = new WeakSet<object>()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) throw new ResearchHypothesisAdmissionError("CYCLIC_HYPOTHESIS", "hypothesis contains cyclic data");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenFields(item, new Set(), seen);
    return;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELD.test(key)) {
      throw new ResearchHypothesisAdmissionError("FORBIDDEN_HYPOTHESIS_FIELD", "hypothesis contains a forbidden field");
    }
    if (!allowed.has(key)) {
      throw new ResearchHypothesisAdmissionError("UNKNOWN_HYPOTHESIS_FIELD", "hypothesis contains an unsupported field");
    }
    const child = (value as Record<string, unknown>)[key];
    if (key === "capacityAssumptions") rejectForbiddenFields(child, CAPACITY_FIELDS, seen);
    else if (key === "provenance") rejectForbiddenFields(child, PROVENANCE_FIELDS, seen);
    else if (key === "sourceReferences" && Array.isArray(child)) {
      for (const reference of child) {
        if (typeof reference !== "string") {
          throw new ResearchHypothesisAdmissionError("INVALID_HYPOTHESIS_REFERENCE", "hypothesis source reference is invalid");
        }
      }
    } else if (key !== "sourceReferences") {
      rejectForbiddenFields(child, new Set(), seen);
    }
  }
}

function immutableHypothesis(input: CanonicalResearchHypothesis): CanonicalResearchHypothesis {
  const createdAtMs = Date.parse(input.createdAt);
  const hypothesis = {
    ...input,
    createdAt: new Date(createdAtMs).toISOString(),
    capacityAssumptions: freeze({ ...input.capacityAssumptions }),
    provenance: freeze({
      ...input.provenance,
      sourceReferences: freeze([...input.provenance.sourceReferences].sort((left, right) => left.localeCompare(right))),
    }),
  };
  return freeze(hypothesis);
}

/**
 * Admits a rich hypothesis into the existing research-run factory. The adapter only validates and
 * binds evidence; OOS evaluation, robustness, ranking, and promotion remain in their canonical
 * modules. Dataset identity is supplied by the run manifest because it is deliberately not
 * duplicated inside the hypothesis contract.
 */
export function admitCanonicalResearchHypothesis(input: {
  readonly hypothesis: unknown;
  readonly candidateId: string;
  readonly manifest: Pick<HistoricalDatasetManifest, "datasetId" | "contentSha256" | "market">;
  readonly expectedCreatedAt: string;
  readonly evaluationGeneratedAt: string;
}): CanonicalResearchHypothesisBinding {
  rejectForbiddenFields(input.hypothesis, HYPOTHESIS_FIELDS);
  const decision = validateResearchHypothesis(input.hypothesis);
  if (!decision.valid) {
    throw new ResearchHypothesisAdmissionError(
      "INVALID_CANONICAL_HYPOTHESIS",
      `canonical hypothesis is invalid: ${decision.errors.join(",")}`,
    );
  }
  const hypothesis = immutableHypothesis(input.hypothesis as CanonicalResearchHypothesis);
  const expectedCreatedAtMs = Date.parse(input.expectedCreatedAt);
  const evaluationGeneratedAtMs = Date.parse(input.evaluationGeneratedAt);
  if (!Number.isFinite(expectedCreatedAtMs) || !Number.isFinite(evaluationGeneratedAtMs)) {
    throw new ResearchHypothesisAdmissionError("INVALID_HYPOTHESIS_TIMELINE", "hypothesis binding timestamps are invalid");
  }
  if (hypothesis.candidateId !== input.candidateId) {
    throw new ResearchHypothesisAdmissionError("HYPOTHESIS_CANDIDATE_MISMATCH", "hypothesis candidate does not match the run candidate");
  }
  if (hypothesis.targetMarket !== input.manifest.market) {
    throw new ResearchHypothesisAdmissionError("HYPOTHESIS_MARKET_MISMATCH", "hypothesis market does not match the dataset");
  }
  if (Date.parse(hypothesis.createdAt) !== expectedCreatedAtMs) {
    throw new ResearchHypothesisAdmissionError("HYPOTHESIS_PRECOMMITMENT_MISMATCH", "hypothesis was not created at the run precommit time");
  }
  if (Date.parse(hypothesis.createdAt) > evaluationGeneratedAtMs) {
    throw new ResearchHypothesisAdmissionError("HYPOTHESIS_AFTER_EVALUATION", "hypothesis was created after evaluation");
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(input.manifest.datasetId) || !SHA256.test(input.manifest.contentSha256)) {
    throw new ResearchHypothesisAdmissionError("INVALID_DATASET_BINDING", "hypothesis dataset binding is invalid");
  }
  const hypothesisHash = createHash("sha256").update(canonicalResearchJson(hypothesis), "utf8").digest("hex");
  return freeze({
    hypothesis,
    hypothesisHash,
    candidateId: input.candidateId,
    datasetId: input.manifest.datasetId,
    datasetContentSha256: input.manifest.contentSha256.toLowerCase(),
    market: input.manifest.market,
    createdAt: hypothesis.createdAt,
    evaluationGeneratedAt: input.evaluationGeneratedAt,
  });
}
