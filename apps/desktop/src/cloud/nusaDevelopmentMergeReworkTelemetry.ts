import type { NusaExactHeadMergeEvidence } from "./nusaDevelopmentMergeTrain";

export const NUSA_DEVELOPMENT_MERGE_REWORK_TELEMETRY_AUTHORITY = Object.freeze({
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
});

export type NusaMergeReworkClassification =
  | "EXACT_HEAD_READY"
  | "STALE_HEAD_REVALIDATION_REQUIRED"
  | "UNKNOWN";

export interface NusaGithubMergeReworkObservation {
  readonly observationId: string;
  readonly workItemId: string;
  readonly pullRequestNumber: number;
  readonly currentHeadSha: string;
  readonly validatedHeadSha: string;
  readonly workflowRunId: number;
  readonly workflowHeadSha: string;
  readonly sourceFingerprint: string;
  readonly observedAt: number;
}

export interface NusaMergeReworkTelemetryEntry {
  readonly observationId: string;
  readonly workItemId: string;
  readonly pullRequestNumber: number;
  readonly classification: NusaMergeReworkClassification;
  readonly currentHeadSha: string;
  readonly validatedHeadSha: string;
  readonly workflowRunId: number;
  readonly observedAt: number;
}

export interface NusaMergeReworkTelemetrySnapshot {
  readonly schemaVersion: 1;
  readonly observations: readonly NusaMergeReworkTelemetryEntry[];
  readonly totals: Readonly<{
    total: number;
    exactHeadReady: number;
    staleHeadRevalidationRequired: number;
    unknown: number;
  }>;
}

export class NusaMergeReworkTelemetryError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "NusaMergeReworkTelemetryError";
  }
}

const COMMIT_SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OBSERVATION_ID = /^[A-Za-z0-9._:-]{1,160}$/;
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

function assertObservation(observation: NusaGithubMergeReworkObservation): void {
  if (!OBSERVATION_ID.test(observation.observationId)) {
    throw new NusaMergeReworkTelemetryError("INVALID_OBSERVATION_ID", "observationId must be a bounded canonical identifier");
  }
  if (!observation.workItemId.trim()) {
    throw new NusaMergeReworkTelemetryError("WORK_ITEM_ID_REQUIRED", "workItemId is required");
  }
  if (!Number.isSafeInteger(observation.pullRequestNumber) || observation.pullRequestNumber <= 0) {
    throw new NusaMergeReworkTelemetryError("INVALID_PULL_REQUEST_NUMBER", "pullRequestNumber must be a positive safe integer");
  }
  for (const [label, sha] of [
    ["currentHeadSha", observation.currentHeadSha],
    ["validatedHeadSha", observation.validatedHeadSha],
    ["workflowHeadSha", observation.workflowHeadSha],
  ] as const) {
    if (!COMMIT_SHA.test(sha)) {
      throw new NusaMergeReworkTelemetryError("INVALID_COMMIT_SHA", `${label} must be a lowercase 40-character Git SHA-1`);
    }
  }
  if (!Number.isSafeInteger(observation.workflowRunId) || observation.workflowRunId <= 0) {
    throw new NusaMergeReworkTelemetryError("INVALID_WORKFLOW_RUN_ID", "workflowRunId must be a positive safe integer");
  }
  if (!SHA256.test(observation.sourceFingerprint)) {
    throw new NusaMergeReworkTelemetryError("INVALID_SOURCE_FINGERPRINT", "sourceFingerprint must be a lowercase SHA-256");
  }
  if (!Number.isSafeInteger(observation.observedAt) || observation.observedAt < 0) {
    throw new NusaMergeReworkTelemetryError("INVALID_OBSERVED_AT", "observedAt must be a non-negative safe integer");
  }
}

function fingerprintPayload(observation: NusaGithubMergeReworkObservation): string {
  return [
    observation.workItemId,
    observation.pullRequestNumber,
    observation.currentHeadSha,
    observation.validatedHeadSha,
    observation.workflowRunId,
    observation.workflowHeadSha,
    observation.sourceFingerprint,
    observation.observedAt,
  ].join("|");
}

export function classifyNusaMergeReworkObservation(
  observation: NusaGithubMergeReworkObservation,
): NusaMergeReworkClassification {
  assertObservation(observation);
  if (observation.workflowHeadSha !== observation.validatedHeadSha) return "UNKNOWN";
  if (observation.currentHeadSha !== observation.validatedHeadSha) return "STALE_HEAD_REVALIDATION_REQUIRED";
  return "EXACT_HEAD_READY";
}

/**
 * Builds deterministic, provenance-bound telemetry from independently captured GitHub receipts.
 * This intentionally does not infer "avoided rework" from absence of a mismatch. A workflow receipt
 * that is not bound to the validated head is UNKNOWN rather than being repaired or reinterpreted.
 */
export function buildNusaMergeReworkTelemetry(
  observations: readonly NusaGithubMergeReworkObservation[],
): NusaMergeReworkTelemetrySnapshot {
  const seen = new Map<string, string>();
  const entries: NusaMergeReworkTelemetryEntry[] = [];

  for (const observation of observations) {
    assertObservation(observation);
    const payload = fingerprintPayload(observation);
    const previous = seen.get(observation.observationId);
    if (previous != null) {
      if (previous !== payload) {
        throw new NusaMergeReworkTelemetryError(
          "OBSERVATION_ID_CONFLICT",
          `observationId ${observation.observationId} was reused with a different payload`,
        );
      }
      continue;
    }
    seen.set(observation.observationId, payload);
    entries.push(freeze({
      observationId: observation.observationId,
      workItemId: observation.workItemId,
      pullRequestNumber: observation.pullRequestNumber,
      classification: classifyNusaMergeReworkObservation(observation),
      currentHeadSha: observation.currentHeadSha,
      validatedHeadSha: observation.validatedHeadSha,
      workflowRunId: observation.workflowRunId,
      observedAt: observation.observedAt,
    }));
  }

  entries.sort((left, right) => left.observedAt - right.observedAt || left.observationId.localeCompare(right.observationId));
  const totals = freeze({
    total: entries.length,
    exactHeadReady: entries.filter((entry) => entry.classification === "EXACT_HEAD_READY").length,
    staleHeadRevalidationRequired: entries.filter((entry) => entry.classification === "STALE_HEAD_REVALIDATION_REQUIRED").length,
    unknown: entries.filter((entry) => entry.classification === "UNKNOWN").length,
  });
  return freeze({ schemaVersion: 1 as const, observations: freeze(entries), totals });
}

/**
 * Adapter for the canonical merge-train evidence. A caller must still provide the independently
 * captured GitHub workflow provenance; this function never invents a run id or fingerprint.
 */
export function bindNusaMergeEvidenceToGithubObservation(
  evidence: NusaExactHeadMergeEvidence,
  provenance: Readonly<{
    observationId: string;
    pullRequestNumber: number;
    workflowRunId: number;
    workflowHeadSha: string;
    sourceFingerprint: string;
  }>,
): NusaGithubMergeReworkObservation {
  return freeze({
    observationId: provenance.observationId,
    workItemId: evidence.workItemId,
    pullRequestNumber: provenance.pullRequestNumber,
    currentHeadSha: evidence.headSha,
    validatedHeadSha: evidence.validatedHeadSha,
    workflowRunId: provenance.workflowRunId,
    workflowHeadSha: provenance.workflowHeadSha,
    sourceFingerprint: provenance.sourceFingerprint,
    observedAt: evidence.observedAt,
  });
}
