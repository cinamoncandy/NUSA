import { createHash } from "node:crypto";
import type { CodingRunnerRequest, CodingRunnerResult } from "./codingRunner";

export type CodingExecutionEvidence = Readonly<{
  schemaVersion: 1;
  evidenceId: string;
  recordedAtMs: number;
  request: Readonly<{
    repository: string;
    headSha: string;
    workflowRunId: number;
    executionId: string;
    dedupeKey: string;
  }>;
  outcome: Readonly<{
    status: string;
    reason: string | null;
    backend: string | null;
    checkpointId: string | null;
    workspaceVerified: boolean | null;
    proposalValidated: boolean | null;
    changedFiles: readonly string[];
    publisher: string | null;
    branch: string | null;
    commitSha: string | null;
    pullRequestNumber: number | null;
    pullRequestUrl: string | null;
  }>;
  liveAuthority: "NONE";
  productionMutationAllowed: false;
  aiAuthority: "ZERO_AUTHORITY";
}>;

export type CodingExecutionEvidenceDecision =
  | Readonly<{ status: "RECORDED"; evidence: CodingExecutionEvidence }>
  | Readonly<{ status: "REJECTED"; reason: string }>;

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const SAFE_TEXT = /^[A-Za-z0-9_.:/-]{1,256}$/;
const SAFE_PATH = /^apps\/autopilot\/[A-Za-z0-9._/-]+$/;
const SAFE_REASON = /^[A-Za-z0-9_.:-]{1,160}$/;
const AUTHORITY = Object.freeze({ liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });

function boundedText(value: unknown, pattern: RegExp, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= max && pattern.test(normalized) ? normalized : null;
}

function safeReason(value: unknown): string | null {
  return boundedText(value, SAFE_REASON, 160);
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function safeChangedFiles(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const paths = value
    .filter((entry): entry is string => typeof entry === "string" && SAFE_PATH.test(entry) && !entry.includes(".."))
    .slice(0, 12);
  return Object.freeze([...new Set(paths)].sort());
}

function canonicalEvidenceWithoutId(value: Omit<CodingExecutionEvidence, "evidenceId">): string {
  return JSON.stringify(value);
}

function expectedEvidenceId(value: Omit<CodingExecutionEvidence, "evidenceId">): string {
  return createHash("sha256").update(canonicalEvidenceWithoutId(value)).digest("hex");
}

export function createCodingExecutionEvidence(
  request: CodingRunnerRequest,
  result: CodingRunnerResult,
  recordedAtMs: number,
): CodingExecutionEvidenceDecision {
  if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) return { status: "REJECTED", reason: "RECORDED_AT_INVALID" };
  if (request.repository !== "cinamoncandy/NUSA" || !SHA40.test(request.headSha)) return { status: "REJECTED", reason: "REQUEST_IDENTITY_INVALID" };
  if (!Number.isSafeInteger(request.workflowRunId) || request.workflowRunId <= 0) return { status: "REJECTED", reason: "WORKFLOW_RUN_ID_INVALID" };
  if (!SAFE_ID.test(request.executionId) || !SAFE_ID.test(request.dedupeKey)) return { status: "REJECTED", reason: "LIFECYCLE_IDENTITY_INVALID" };
  if (request.liveAuthority !== "NONE" || request.productionMutationAllowed !== false || request.aiAuthority !== "ZERO_AUTHORITY") {
    return { status: "REJECTED", reason: "AUTHORITY_INVALID" };
  }
  const status = boundedText(result.status, SAFE_TEXT, 64);
  if (!status) return { status: "REJECTED", reason: "RESULT_STATUS_INVALID" };
  const backend = boundedText(result.backend, SAFE_TEXT, 256);
  const checkpointId = boundedText(result.checkpointId, SAFE_ID, 256);
  const publisher = boundedText(result.publisher, SAFE_TEXT, 256);
  const branch = boundedText(result.branch, SAFE_TEXT, 256);
  const commitSha = typeof result.commitSha === "string" && SHA40.test(result.commitSha) ? result.commitSha.toLowerCase() : null;
  const pullRequestNumber = Number.isSafeInteger(result.pullRequestNumber) && Number(result.pullRequestNumber) > 0 ? Number(result.pullRequestNumber) : null;
  const pullRequestUrl = safeUrl(result.pullRequestUrl);
  const outcome = Object.freeze({
    status,
    reason: safeReason(result.reason),
    backend,
    checkpointId,
    workspaceVerified: typeof result.workspaceVerified === "boolean" ? result.workspaceVerified : null,
    proposalValidated: typeof result.proposalValidated === "boolean" ? result.proposalValidated : null,
    changedFiles: safeChangedFiles(result.changedFiles),
    publisher,
    branch,
    commitSha,
    pullRequestNumber,
    pullRequestUrl,
  });
  const base = Object.freeze({
    schemaVersion: 1 as const,
    recordedAtMs,
    request: Object.freeze({
      repository: request.repository,
      headSha: request.headSha.toLowerCase(),
      workflowRunId: request.workflowRunId,
      executionId: request.executionId,
      dedupeKey: request.dedupeKey,
    }),
    outcome,
    ...AUTHORITY,
  });
  const evidenceId = expectedEvidenceId(base);
  return { status: "RECORDED", evidence: Object.freeze({ ...base, evidenceId }) as CodingExecutionEvidence };
}

export function validatePersistedCodingExecutionEvidence(value: unknown): asserts value is CodingExecutionEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CODING_EVIDENCE_INVALID");
  const evidence = value as Partial<CodingExecutionEvidence>;
  if (evidence.schemaVersion !== 1 || typeof evidence.evidenceId !== "string" || !/^[a-f0-9]{64}$/i.test(evidence.evidenceId)) throw new Error("CODING_EVIDENCE_ID_INVALID");
  if (!Number.isSafeInteger(evidence.recordedAtMs) || Number(evidence.recordedAtMs) < 0) throw new Error("CODING_EVIDENCE_TIMESTAMP_INVALID");
  if (evidence.liveAuthority !== "NONE" || evidence.productionMutationAllowed !== false || evidence.aiAuthority !== "ZERO_AUTHORITY") throw new Error("CODING_EVIDENCE_AUTHORITY_INVALID");
  const request = evidence.request;
  if (!request || request.repository !== "cinamoncandy/NUSA" || typeof request.headSha !== "string" || !SHA40.test(request.headSha) || !Number.isSafeInteger(request.workflowRunId) || request.workflowRunId <= 0 || typeof request.executionId !== "string" || !SAFE_ID.test(request.executionId) || typeof request.dedupeKey !== "string" || !SAFE_ID.test(request.dedupeKey)) throw new Error("CODING_EVIDENCE_REQUEST_INVALID");
  const outcome = evidence.outcome;
  if (!outcome || typeof outcome.status !== "string" || !SAFE_TEXT.test(outcome.status) || (outcome.reason !== null && (typeof outcome.reason !== "string" || !SAFE_REASON.test(outcome.reason))) || (outcome.backend !== null && (typeof outcome.backend !== "string" || !SAFE_TEXT.test(outcome.backend))) || (outcome.checkpointId !== null && (typeof outcome.checkpointId !== "string" || !SAFE_ID.test(outcome.checkpointId))) || (outcome.publisher !== null && (typeof outcome.publisher !== "string" || !SAFE_TEXT.test(outcome.publisher))) || (outcome.branch !== null && (typeof outcome.branch !== "string" || !SAFE_TEXT.test(outcome.branch))) || (outcome.commitSha !== null && (typeof outcome.commitSha !== "string" || !SHA40.test(outcome.commitSha))) || (outcome.pullRequestNumber !== null && (!Number.isSafeInteger(outcome.pullRequestNumber) || outcome.pullRequestNumber <= 0)) || (outcome.pullRequestUrl !== null && safeUrl(outcome.pullRequestUrl) === null) || !Array.isArray(outcome.changedFiles) || outcome.changedFiles.length > 12 || !outcome.changedFiles.every((path) => typeof path === "string" && SAFE_PATH.test(path) && !path.includes("..")) || !outcome.changedFiles.every((_, index, paths) => index === 0 || paths[index - 1]! < paths[index]!)) throw new Error("CODING_EVIDENCE_OUTCOME_INVALID");
  if (outcome.workspaceVerified !== null && typeof outcome.workspaceVerified !== "boolean") throw new Error("CODING_EVIDENCE_OUTCOME_INVALID");
  if (outcome.proposalValidated !== null && typeof outcome.proposalValidated !== "boolean") throw new Error("CODING_EVIDENCE_OUTCOME_INVALID");
  if (evidence.request.headSha !== evidence.request.headSha.toLowerCase()) throw new Error("CODING_EVIDENCE_REQUEST_INVALID");
  if (outcome.commitSha !== null && outcome.commitSha !== outcome.commitSha.toLowerCase()) throw new Error("CODING_EVIDENCE_OUTCOME_INVALID");
  const safeOutcome = outcome as CodingExecutionEvidence["outcome"];
  const safeRequest = evidence.request as CodingExecutionEvidence["request"];
  const withoutId: Omit<CodingExecutionEvidence, "evidenceId"> = {
    schemaVersion: 1,
    recordedAtMs: evidence.recordedAtMs as number,
    request: safeRequest,
    outcome: safeOutcome,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
  if (expectedEvidenceId(withoutId) !== evidence.evidenceId.toLowerCase()) throw new Error("CODING_EVIDENCE_ID_MISMATCH");
}
