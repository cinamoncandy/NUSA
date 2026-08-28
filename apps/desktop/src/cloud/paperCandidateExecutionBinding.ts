import { createHash } from "node:crypto";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { PersistedPaperCandidateProvenance } from "./persistedPaperPeriodStore";

export interface PaperCandidateExecutionBindingReceipt {
  readonly schemaVersion: 1;
  readonly status: "BOUND_UNVERIFIED";
  readonly authority: "PAPER_RESEARCH_ONLY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly candidateId: string;
  readonly datasetId: string;
  readonly datasetContentSha256: string;
  readonly advisoryGeneratedAt: number;
  readonly periodStartAt: number;
  readonly advisoryFingerprintSha256: string;
  readonly bindingFingerprintSha256: string;
}

export class PaperCandidateExecutionBindingError extends Error {
  public constructor(readonly code: string, message: string, readonly candidateId?: string) {
    super(message);
    this.name = "PaperCandidateExecutionBindingError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PaperCandidateExecutionBindingError("NON_FINITE_BINDING_VALUE", "candidate execution binding contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  throw new PaperCandidateExecutionBindingError("UNSUPPORTED_BINDING_VALUE", "candidate execution binding contains an unsupported value");
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function safeTimestamp(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new PaperCandidateExecutionBindingError("INVALID_BINDING_TIMESTAMP", `${field} must be a non-negative safe integer`);
  return value;
}

/**
 * Bind one actual League advisory entry to the exact #885 candidate/dataset provenance that may
 * later be carried to the canonical PAPER execution boundary.
 *
 * This receipt is deliberately BOUND_UNVERIFIED. It proves deterministic identity/provenance
 * binding only; it does not prove that the candidate caused a fill, does not unlock PAPER forward
 * evidence admission, and grants no LIVE or production mutation authority.
 */
export function bindPaperCandidateForExecution(
  advisory: LeagueCapitalAllocationAdvisory,
  candidateProvenance: readonly PersistedPaperCandidateProvenance[],
  candidateId: string,
  periodStartAt: number,
): PaperCandidateExecutionBindingReceipt {
  const normalizedCandidateId = candidateId.trim();
  if (!normalizedCandidateId) throw new PaperCandidateExecutionBindingError("INVALID_CANDIDATE_ID", "candidateId is required");
  if (advisory.schemaVersion !== 1) throw new PaperCandidateExecutionBindingError("UNSUPPORTED_ADVISORY_SCHEMA", "League allocation advisory schema is unsupported", normalizedCandidateId);

  const advisoryGeneratedAt = Date.parse(advisory.generatedAt);
  if (!Number.isSafeInteger(advisoryGeneratedAt) || advisoryGeneratedAt < 0) {
    throw new PaperCandidateExecutionBindingError("INVALID_ADVISORY_TIMESTAMP", "League allocation advisory generatedAt is invalid", normalizedCandidateId);
  }
  const startAt = safeTimestamp(periodStartAt, "periodStartAt");
  if (advisoryGeneratedAt >= startAt) {
    throw new PaperCandidateExecutionBindingError("LOOKAHEAD_CANDIDATE_BINDING", "League allocation advisory must predate the PAPER period", normalizedCandidateId);
  }

  const duplicateAdvisoryIds = advisory.entries.filter((entry) => entry.id === normalizedCandidateId);
  if (duplicateAdvisoryIds.length !== 1) {
    throw new PaperCandidateExecutionBindingError(
      duplicateAdvisoryIds.length === 0 ? "CANDIDATE_NOT_IN_ADVISORY" : "DUPLICATE_CANDIDATE_IN_ADVISORY",
      "candidate identity must resolve to exactly one League allocation entry",
      normalizedCandidateId,
    );
  }
  const entry = duplicateAdvisoryIds[0]!;
  if (!Number.isFinite(entry.researchWeight) || entry.researchWeight <= 0 || entry.researchWeight > 1) {
    throw new PaperCandidateExecutionBindingError("INVALID_RESEARCH_WEIGHT", "candidate research weight is invalid", normalizedCandidateId);
  }

  const provenanceMatches = candidateProvenance.filter((item) => item.candidateId === normalizedCandidateId);
  if (provenanceMatches.length !== 1) {
    throw new PaperCandidateExecutionBindingError(
      provenanceMatches.length === 0 ? "MISSING_CANDIDATE_PROVENANCE" : "DUPLICATE_CANDIDATE_PROVENANCE",
      "candidate must resolve to exactly one persisted dataset provenance record",
      normalizedCandidateId,
    );
  }
  const provenance = provenanceMatches[0]!;
  if (!provenance.datasetId.trim() || !SHA256.test(provenance.datasetContentSha256)) {
    throw new PaperCandidateExecutionBindingError("INVALID_DATASET_PROVENANCE", "candidate dataset provenance is incomplete", normalizedCandidateId);
  }
  if (!entry.sourceDatasetIds.includes(provenance.datasetId)) {
    throw new PaperCandidateExecutionBindingError("DATASET_PROVENANCE_MISMATCH", "candidate persisted dataset is not present in its League advisory provenance", normalizedCandidateId);
  }
  if (!advisory.provenance.sourceDatasetIds.includes(provenance.datasetId)) {
    throw new PaperCandidateExecutionBindingError("ADVISORY_PROVENANCE_MISMATCH", "candidate persisted dataset is not present in advisory-level provenance", normalizedCandidateId);
  }

  const advisoryFingerprintSha256 = digest(advisory);
  const bound = {
    schemaVersion: 1 as const,
    status: "BOUND_UNVERIFIED" as const,
    authority: "PAPER_RESEARCH_ONLY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
    candidateId: normalizedCandidateId,
    datasetId: provenance.datasetId,
    datasetContentSha256: provenance.datasetContentSha256,
    advisoryGeneratedAt,
    periodStartAt: startAt,
    advisoryFingerprintSha256,
  };
  return freeze({ ...bound, bindingFingerprintSha256: digest(bound) });
}
