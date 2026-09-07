import { createHash } from "node:crypto";
import type { LeagueCapitalAllocationAdvisory } from "./leagueCapitalAllocation";
import type { PersistedPaperCandidateProvenance } from "./persistedPaperPeriod";

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
  /**
   * Immutable strategy semantics copied from the validated Research candidate specification.
   * Legacy receipts may omit this field, but a production challenger deployment must provide it.
   */
  readonly candidateStrategy?: PaperCandidateStrategySpec;
}

export interface PaperCandidateStrategySpec {
  readonly candidateId: string;
  readonly familyId: string;
  readonly lineageId: string;
  readonly specificationHash: string;
  readonly codeSha: string;
  readonly costModelVersion: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
}

export class PaperCandidateExecutionBindingError extends Error {
  public constructor(readonly code: string, message: string, readonly candidateId?: string) {
    super(message);
    this.name = "PaperCandidateExecutionBindingError";
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;
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

export function normalizePaperCandidateStrategy(
  value: PaperCandidateStrategySpec,
  candidateId: string,
): PaperCandidateStrategySpec {
  if (value == null || typeof value !== "object" || value.candidateId !== candidateId) {
    throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_IDENTITY_INVALID", "candidate strategy identity does not match the binding", candidateId);
  }
  const text = (input: unknown, field: string): string => {
    if (typeof input !== "string" || !input.trim() || input.trim().length > 240) {
      throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_FIELD_INVALID", `${field} is invalid`, candidateId);
    }
    return input.trim();
  };
  const familyId = text(value.familyId, "candidate strategy familyId");
  const lineageId = text(value.lineageId, "candidate strategy lineageId");
  const specificationHash = text(value.specificationHash, "candidate strategy specificationHash").toLowerCase();
  const codeSha = text(value.codeSha, "candidate strategy codeSha").toLowerCase();
  const costModelVersion = text(value.costModelVersion, "candidate strategy costModelVersion");
  if (!SHA256.test(specificationHash) || !SHA40.test(codeSha)) {
    throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_HASH_INVALID", "candidate strategy hashes are invalid", candidateId);
  }
  if (value.parameters == null || typeof value.parameters !== "object" || Array.isArray(value.parameters)) {
    throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_PARAMETERS_INVALID", "candidate strategy parameters are invalid", candidateId);
  }
  const parameters: Record<string, string | number | boolean> = {};
  for (const [name, parameter] of Object.entries(value.parameters)) {
    if (!name.trim() || !["string", "number", "boolean"].includes(typeof parameter) || (typeof parameter === "number" && !Number.isFinite(parameter))) {
      throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_PARAMETERS_INVALID", "candidate strategy parameters are invalid", candidateId);
    }
    parameters[name.trim()] = parameter;
  }
  if (Object.keys(parameters).length === 0) {
    throw new PaperCandidateExecutionBindingError("CANDIDATE_STRATEGY_PARAMETERS_INVALID", "candidate strategy parameters are empty", candidateId);
  }
  return freeze({ candidateId, familyId, lineageId, specificationHash, codeSha, costModelVersion, parameters: freeze(Object.fromEntries(Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)))) });
}

/**
 * Canonical shared boundary that binds one existing NUSA League advisory entry to the exact
 * persisted candidate/dataset provenance that may later be carried by autonomous PAPER execution.
 *
 * The receipt remains BOUND_UNVERIFIED: identity binding is not fill evidence, grants no LIVE
 * authority, and cannot mutate a production champion.
 */
export function bindPaperCandidateForExecution(
  advisory: LeagueCapitalAllocationAdvisory,
  candidateProvenance: readonly PersistedPaperCandidateProvenance[],
  candidateId: string,
  periodStartAt: number,
  candidateStrategy?: PaperCandidateStrategySpec,
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
    ...(candidateStrategy == null ? {} : { candidateStrategy: normalizePaperCandidateStrategy(candidateStrategy, normalizedCandidateId) }),
  };
  return freeze({ ...bound, bindingFingerprintSha256: digest(bound) });
}
