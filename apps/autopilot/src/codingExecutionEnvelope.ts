import type { CodingRunnerRequest } from "./codingRunner";

export type ExecutionOrigin = "AUTO_BACKGROUND" | "USER_TRIGGERED";

export interface CodingExecutionEnvelope {
  readonly cycleId: string;
  readonly workItemId: string;
  readonly executionId: string;
  readonly dedupeKey: string;
  readonly origin: ExecutionOrigin;
  readonly repository: string;
  readonly baseSha: string;
  readonly workflowRunId: number;
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly allowedScope: readonly string[];
  readonly forbiddenScope: readonly string[];
  readonly maxChangedFiles: number;
  readonly mutationAllowed: false;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const SHA40 = /^[0-9a-f]{40}$/i;
const NONEMPTY = /\S/;
const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";

const nonEmpty = (value: unknown): value is string => typeof value === "string" && NONEMPTY.test(value);
const nonEmptyList = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.every(nonEmpty);

export function validateCodingExecutionEnvelope(
  value: unknown,
  allowedRepository = DEFAULT_REPOSITORY,
): CodingExecutionEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODING_EXECUTION_ENVELOPE_INVALID");
  const envelope = value as Record<string, unknown>;

  for (const key of ["cycleId", "workItemId", "executionId", "dedupeKey", "objective"] as const) {
    if (!nonEmpty(envelope[key])) throw new Error(`CODING_EXECUTION_${key.toUpperCase()}_REQUIRED`);
  }

  if (envelope.origin !== "AUTO_BACKGROUND" && envelope.origin !== "USER_TRIGGERED") throw new Error("CODING_EXECUTION_ORIGIN_INVALID");
  if (envelope.repository !== allowedRepository) throw new Error("CODING_EXECUTION_REPOSITORY_INVALID");
  if (!nonEmpty(envelope.baseSha) || !SHA40.test(envelope.baseSha)) throw new Error("CODING_EXECUTION_BASE_SHA_INVALID");
  if (!Number.isSafeInteger(envelope.workflowRunId) || Number(envelope.workflowRunId) <= 0) throw new Error("CODING_EXECUTION_WORKFLOW_RUN_ID_INVALID");
  if (!nonEmptyList(envelope.acceptanceCriteria)) throw new Error("CODING_EXECUTION_ACCEPTANCE_REQUIRED");
  if (!nonEmptyList(envelope.evidenceRefs)) throw new Error("CODING_EXECUTION_EVIDENCE_REQUIRED");
  if (!nonEmptyList(envelope.allowedScope)) throw new Error("CODING_EXECUTION_ALLOWED_SCOPE_REQUIRED");
  if (!Array.isArray(envelope.forbiddenScope) || !envelope.forbiddenScope.every(nonEmpty)) throw new Error("CODING_EXECUTION_FORBIDDEN_SCOPE_INVALID");
  if (!Number.isSafeInteger(envelope.maxChangedFiles) || Number(envelope.maxChangedFiles) <= 0) throw new Error("CODING_EXECUTION_CHANGE_BUDGET_INVALID");
  if (envelope.liveAuthority !== "NONE") throw new Error("CODING_EXECUTION_LIVE_AUTHORITY_FORBIDDEN");
  if (envelope.productionMutationAllowed !== false || envelope.mutationAllowed !== false) throw new Error("CODING_EXECUTION_PRODUCTION_MUTATION_FORBIDDEN");
  if (envelope.aiAuthority !== "ZERO_AUTHORITY") throw new Error("CODING_EXECUTION_AI_AUTHORITY_INVALID");

  return Object.freeze(envelope as unknown as CodingExecutionEnvelope);
}

export function toCodingRunnerRequest(envelope: CodingExecutionEnvelope): CodingRunnerRequest {
  return Object.freeze({
    kind: "REPOSITORY_AUTOPILOT",
    repository: envelope.repository,
    headSha: envelope.baseSha,
    workflowRunId: envelope.workflowRunId,
    reason: `work:${envelope.workItemId};execution:${envelope.executionId};origin:${envelope.origin};dedupe:${envelope.dedupeKey}`,
    executionId: envelope.executionId,
    dedupeKey: envelope.dedupeKey,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}
