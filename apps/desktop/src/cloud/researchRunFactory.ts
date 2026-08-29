import type { HistoricalDatasetManifest } from "./researchDataset";
import {
  validateResearchCandidateSpecificationBinding,
  type ResearchCandidateSpecification,
} from "./researchCandidateSpecification";
import {
  validateResearchHypothesisBinding,
  type ResearchHypothesis,
} from "./researchHypothesis";
import type { ResearchRunTimeline } from "./researchRunTimeline";

export type ResearchCandidateParameter = string | number | boolean;

export interface ResearchCandidateSeed {
  readonly candidateId: string;
  readonly familyId: string;
  readonly lineageId: string;
  readonly parameters: Readonly<Record<string, ResearchCandidateParameter>>;
  readonly codeSha: string;
  readonly costModelVersion: string;
}

export interface ResearchRunCandidatePlan {
  readonly candidateId: string;
  readonly familyId: string;
  readonly parameters: Readonly<Record<string, ResearchCandidateParameter>>;
  readonly specification: ResearchCandidateSpecification;
}

export interface ResearchRunProvenancePlan {
  readonly schemaVersion: 1;
  readonly hypothesis: ResearchHypothesis;
  readonly dataset: Readonly<{
    datasetId: string;
    datasetContentSha256: string;
    market: string;
    interval: HistoricalDatasetManifest["interval"];
  }>;
  readonly candidates: readonly ResearchRunCandidatePlan[];
}

export class ResearchRunFactoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ResearchRunFactoryError";
  }
}

const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const FORBIDDEN_PARAMETER_NAME = /password|secret|token|authorization|cookie|credential|private[-_]?key|access[-_]?key|api[-_]?key/i;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function canonicalParameters(
  parameters: Readonly<Record<string, ResearchCandidateParameter>>,
): Readonly<Record<string, ResearchCandidateParameter>> {
  return freeze(Object.fromEntries(
    Object.entries(parameters)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, value]) => [name.trim(), value]),
  ));
}

function validateParameters(
  parameters: unknown,
  candidateId: string,
): asserts parameters is Readonly<Record<string, ResearchCandidateParameter>> {
  if (parameters == null || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new ResearchRunFactoryError(
      "INVALID_PARAMETERS",
      "candidate " + candidateId + " parameters must be a scalar record",
    );
  }
  const names = new Set<string>();
  for (const [name, value] of Object.entries(parameters)) {
    const normalizedName = name.trim();
    if (!normalizedName || FORBIDDEN_PARAMETER_NAME.test(normalizedName)) {
      throw new ResearchRunFactoryError(
        "FORBIDDEN_PARAMETER",
        "candidate " + candidateId + " parameters cannot contain credential-like fields",
      );
    }
    if (names.has(normalizedName)) {
      throw new ResearchRunFactoryError(
        "INVALID_PARAMETERS",
        "candidate " + candidateId + " parameters contain duplicate names",
      );
    }
    names.add(normalizedName);
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new ResearchRunFactoryError(
        "INVALID_PARAMETERS",
        "candidate " + candidateId + " parameters must contain named scalar values",
      );
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new ResearchRunFactoryError(
        "NON_FINITE_PARAMETER_VALUE",
        "candidate " + candidateId + " parameters must be finite",
      );
    }
  }
}
function validateManifest(manifest: HistoricalDatasetManifest): void {
  if (manifest == null || typeof manifest !== "object") {
    throw new ResearchRunFactoryError("INVALID_DATASET_MANIFEST", "research run requires a dataset manifest");
  }
  if (!nonEmpty(manifest.datasetId) || !nonEmpty(manifest.market)) {
    throw new ResearchRunFactoryError("INVALID_DATASET_MANIFEST", "dataset identity is required");
  }
  if (!SHA256.test(manifest.contentSha256)) {
    throw new ResearchRunFactoryError("INVALID_DATASET_MANIFEST", "dataset content hash is invalid");
  }
  if (!nonEmpty(manifest.interval)) {
    throw new ResearchRunFactoryError("INVALID_DATASET_MANIFEST", "dataset interval is required");
  }
}

function validateTimeline(timeline: ResearchRunTimeline): void {
  if (
    timeline == null
    || !Number.isSafeInteger(timeline.snapshotAt)
    || timeline.snapshotAt < 0
  ) {
    throw new ResearchRunFactoryError("INVALID_TIMELINE", "research run timeline must have a safe snapshot timestamp");
  }
  const timestamps = [
    ["hypothesisGeneratedAt", timeline.hypothesisGeneratedAt],
    ["specificationGeneratedAt", timeline.specificationGeneratedAt],
    ["evaluationStartedAt", timeline.evaluationStartedAt],
    ["evaluationEndedAt", timeline.evaluationEndedAt],
    ["generatedAt", timeline.generatedAt],
  ] as const;
  const parsed = timestamps.map(([name, value]) => {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new ResearchRunFactoryError("INVALID_TIMELINE", `timeline ${name} is invalid`);
    }
    return timestamp;
  });
  if (
    parsed[0] !== timeline.snapshotAt
    || parsed[1] !== timeline.snapshotAt + 1
    || parsed[2] !== timeline.snapshotAt + 2
    || parsed[3] !== timeline.snapshotAt + 3
    || parsed[4] !== timeline.snapshotAt + 4
  ) {
    throw new ResearchRunFactoryError(
      "NON_DETERMINISTIC_TIMELINE",
      "research run chronology must be derived from one snapshot",
    );
  }
}

export function buildResearchRunProvenancePlan(input: {
  readonly manifest: HistoricalDatasetManifest;
  readonly hypothesis: ResearchHypothesis;
  readonly timeline: ResearchRunTimeline;
  readonly sourceCommitSha: string;
  readonly candidates: readonly ResearchCandidateSeed[];
}): ResearchRunProvenancePlan {
  validateManifest(input.manifest);
  validateTimeline(input.timeline);
  if (!SHA40.test(input.sourceCommitSha)) {
    throw new ResearchRunFactoryError("INVALID_SOURCE_COMMIT_SHA", "research run source commit SHA is invalid");
  }
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new ResearchRunFactoryError("EMPTY_CANDIDATE_PLAN", "research run requires at least one candidate");
  }
  if (input.hypothesis == null || typeof input.hypothesis !== "object") {
    throw new ResearchRunFactoryError("INVALID_HYPOTHESIS", "research run requires a validated hypothesis");
  }

  const hypothesisDecision = validateResearchHypothesisBinding(input.hypothesis, {
    hypothesisId: input.hypothesis.hypothesisId,
    familyId: input.hypothesis.familyId,
    market: input.manifest.market,
    interval: input.manifest.interval,
    sourceDatasetId: input.manifest.datasetId,
    evaluationGeneratedAt: input.timeline.generatedAt,
  });
  if (hypothesisDecision.status !== "VERIFIED") {
    throw new ResearchRunFactoryError(
      "HYPOTHESIS_PROVENANCE_MISMATCH",
      `research hypothesis does not bind to the dataset: ${hypothesisDecision.reasons.join(",")}`,
    );
  }

  const ids = new Set<string>();
  const candidates = input.candidates.map((seed) => {
    if (seed == null || typeof seed !== "object") {
      throw new ResearchRunFactoryError("INVALID_CANDIDATE_IDENTITY", "candidate seed is required");
    }
    const candidateId = typeof seed.candidateId === "string" ? seed.candidateId.trim() : "";
    const familyId = typeof seed.familyId === "string" ? seed.familyId.trim() : "";
    const lineageId = typeof seed.lineageId === "string" ? seed.lineageId.trim() : "";
    if (!nonEmpty(candidateId) || !nonEmpty(familyId) || !nonEmpty(lineageId)) {
      throw new ResearchRunFactoryError(
        "INVALID_CANDIDATE_IDENTITY",
        "candidate id, family, and lineage are required",
      );
    }
    if (ids.has(candidateId)) {
      throw new ResearchRunFactoryError("DUPLICATE_CANDIDATE_ID", `duplicate candidate id: ${candidateId}`);
    }
    ids.add(candidateId);
    if (familyId !== input.hypothesis.familyId) {
      throw new ResearchRunFactoryError(
        "HYPOTHESIS_FAMILY_MISMATCH",
        `candidate ${candidateId} is outside the precommitted hypothesis family`,
      );
    }
    validateParameters(seed.parameters, candidateId);
    const parameters = canonicalParameters(seed.parameters);
    const codeSha = typeof seed.codeSha === "string" ? seed.codeSha.trim().toLowerCase() : "";
    const costModelVersion = typeof seed.costModelVersion === "string" ? seed.costModelVersion.trim() : "";
    const specification: ResearchCandidateSpecification = freeze({
      schemaVersion: 1,
      candidateId,
      familyId,
      lineageId,
      parameters,
      codeSha,
      datasetId: input.manifest.datasetId,
      datasetContentSha256: input.manifest.contentSha256.trim().toLowerCase(),
      costModelVersion: seed.costModelVersion.trim(),
      generatedAt: input.timeline.specificationGeneratedAt,
      evaluationStartedAt: input.timeline.evaluationStartedAt,
      evaluationEndedAt: input.timeline.evaluationEndedAt,
    });
    const decision = validateResearchCandidateSpecificationBinding(specification, {
      candidateId,
      familyId,
      datasetId: input.manifest.datasetId,
      datasetContentSha256: input.manifest.contentSha256,
      parameters,
      evaluationGeneratedAt: input.timeline.generatedAt,
    });
    if (decision.status !== "VERIFIED") {
      throw new ResearchRunFactoryError(
        "INVALID_CANDIDATE_SPECIFICATION",
        `candidate ${candidateId} specification is invalid: ${decision.reasons.join(",")}`,
      );
    }
    return freeze({
      candidateId,
      familyId,
      parameters,
      specification,
    });
  });

  return freeze({
    schemaVersion: 1,
    hypothesis: input.hypothesis,
    dataset: freeze({
      datasetId: input.manifest.datasetId,
      datasetContentSha256: input.manifest.contentSha256.toLowerCase(),
      market: input.manifest.market,
      interval: input.manifest.interval,
    }),
    candidates: freeze(candidates),
  }) as ResearchRunProvenancePlan;
}
