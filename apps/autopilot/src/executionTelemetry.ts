import { createHash } from "node:crypto";

export type AutopilotTelemetryAction = "ACTION" | "NO_ACTION";
export type AutopilotFailureClass =
  | "transient"
  | "deterministic"
  | "infrastructure"
  | "executor_unavailable"
  | "validation_failure"
  | "permission_auth"
  | "unsafe_ambiguous"
  | null;

export interface AutopilotExecutionTelemetry {
  readonly schemaVersion: 1;
  readonly telemetryId: string;
  readonly executionId: string;
  readonly timestampMs: number;
  readonly trigger: string;
  readonly decision: string;
  readonly action: AutopilotTelemetryAction;
  readonly selectedExecutor: string | null;
  readonly dedupeKey: string;
  readonly attempt: number;
  readonly retry: Readonly<{
    attempt: number;
    maxAttempts: number;
    backoffMs: number;
  }>;
  readonly recovery: Readonly<{
    action: string;
    reason: string | null;
  }>;
  readonly checkpoint: Readonly<{
    checkpointId: string | null;
    resumed: boolean;
  }>;
  readonly durationMs: number;
  readonly result: string;
  readonly validationResult: string;
  readonly ciResult: string;
  readonly failureClass: AutopilotFailureClass;
  readonly commitSha: string | null;
  readonly pullRequestNumber: number | null;
  readonly failureReason: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

export interface AutopilotExecutionTelemetryInput extends Omit<AutopilotExecutionTelemetry, "schemaVersion" | "telemetryId"> {}

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,256}$/;
const SAFE_TEXT = /^[\x20-\x7E]{1,256}$/;
const AUTHORITY = Object.freeze({ liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });

function safeText(value: unknown, pattern = SAFE_TEXT): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256 && pattern.test(value);
}

function safeTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function safePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function canonicalWithoutId(value: Omit<AutopilotExecutionTelemetry, "telemetryId">): string {
  return JSON.stringify(value);
}

export function createAutopilotExecutionTelemetry(input: AutopilotExecutionTelemetryInput): AutopilotExecutionTelemetry {
  const base = Object.freeze({ schemaVersion: 1 as const, ...input, ...AUTHORITY });
  const telemetryId = createHash("sha256").update(canonicalWithoutId(base)).digest("hex");
  return Object.freeze({ ...base, telemetryId });
}

export function validateAutopilotExecutionTelemetry(value: unknown): asserts value is AutopilotExecutionTelemetry {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTOPILOT_TELEMETRY_INVALID");
  const telemetry = value as Partial<AutopilotExecutionTelemetry>;
  if (telemetry.schemaVersion !== 1 || typeof telemetry.telemetryId !== "string" || !/^[a-f0-9]{64}$/i.test(telemetry.telemetryId)) throw new Error("AUTOPILOT_TELEMETRY_ID_INVALID");
  if (!safeText(telemetry.executionId, SAFE_ID) || !safeTimestamp(telemetry.timestampMs) || !safeText(telemetry.trigger) || !safeText(telemetry.decision) || (telemetry.action !== "ACTION" && telemetry.action !== "NO_ACTION")) throw new Error("AUTOPILOT_TELEMETRY_IDENTITY_INVALID");
  if (telemetry.selectedExecutor !== null && !safeText(telemetry.selectedExecutor)) throw new Error("AUTOPILOT_TELEMETRY_EXECUTOR_INVALID");
  if (!safeText(telemetry.dedupeKey, SAFE_ID) || !safePositiveInteger(telemetry.attempt)) throw new Error("AUTOPILOT_TELEMETRY_ATTEMPT_INVALID");
  const retry = telemetry.retry;
  if (!retry || !safePositiveInteger(retry.attempt) || !safePositiveInteger(retry.maxAttempts) || retry.attempt > retry.maxAttempts || !safeNonNegativeInteger(retry.backoffMs)) throw new Error("AUTOPILOT_TELEMETRY_RETRY_INVALID");
  const recovery = telemetry.recovery;
  if (!recovery || !safeText(recovery.action) || (recovery.reason !== null && !safeText(recovery.reason))) throw new Error("AUTOPILOT_TELEMETRY_RECOVERY_INVALID");
  const checkpoint = telemetry.checkpoint;
  if (!checkpoint || (checkpoint.checkpointId !== null && !safeText(checkpoint.checkpointId, SAFE_ID)) || typeof checkpoint.resumed !== "boolean") throw new Error("AUTOPILOT_TELEMETRY_CHECKPOINT_INVALID");
  if (!safeNonNegativeInteger(telemetry.durationMs) || !safeText(telemetry.result) || !safeText(telemetry.validationResult) || !safeText(telemetry.ciResult)) throw new Error("AUTOPILOT_TELEMETRY_RESULT_INVALID");
  if (telemetry.failureClass !== null && telemetry.failureClass !== "transient" && telemetry.failureClass !== "deterministic" && telemetry.failureClass !== "infrastructure" && telemetry.failureClass !== "executor_unavailable" && telemetry.failureClass !== "validation_failure" && telemetry.failureClass !== "permission_auth" && telemetry.failureClass !== "unsafe_ambiguous") throw new Error("AUTOPILOT_TELEMETRY_FAILURE_CLASS_INVALID");
  if (telemetry.commitSha !== null && (typeof telemetry.commitSha !== "string" || !SHA40.test(telemetry.commitSha) || telemetry.commitSha !== telemetry.commitSha.toLowerCase())) throw new Error("AUTOPILOT_TELEMETRY_COMMIT_INVALID");
  if (telemetry.pullRequestNumber !== null && !safePositiveInteger(telemetry.pullRequestNumber)) throw new Error("AUTOPILOT_TELEMETRY_PR_INVALID");
  if (telemetry.failureReason !== null && !safeText(telemetry.failureReason)) throw new Error("AUTOPILOT_TELEMETRY_FAILURE_INVALID");
  if (telemetry.liveAuthority !== "NONE" || telemetry.productionMutationAllowed !== false || telemetry.aiAuthority !== "ZERO_AUTHORITY") throw new Error("AUTOPILOT_TELEMETRY_AUTHORITY_INVALID");
  const normalized = { ...telemetry, telemetryId: undefined } as unknown as Omit<AutopilotExecutionTelemetry, "telemetryId">;
  delete (normalized as { telemetryId?: unknown }).telemetryId;
  if (createHash("sha256").update(canonicalWithoutId(normalized)).digest("hex") !== telemetry.telemetryId.toLowerCase()) throw new Error("AUTOPILOT_TELEMETRY_ID_MISMATCH");
}

export function classifyAutopilotFailure(reason: string | null): AutopilotFailureClass {
  if (!reason) return null;
  if (/auth|permission|unauthor/i.test(reason)) return "permission_auth";
  if (/unsafe|ambiguous|authority/i.test(reason)) return "unsafe_ambiguous";
  if (/validation|invalid|proposal/i.test(reason)) return "validation_failure";
  if (/unavailable|not-configured|interface-ready/i.test(reason)) return "executor_unavailable";
  if (/timeout|network|temporar|rate-limit|5\d\d/i.test(reason)) return "transient";
  if (/storage|coordinator|github/i.test(reason)) return "infrastructure";
  return "deterministic";
}
