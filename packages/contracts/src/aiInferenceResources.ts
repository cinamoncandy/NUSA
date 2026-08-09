import type { ModelRequest, ModelResponse } from "./aiInference";

export type AiInferenceResourceHealth = "HEALTHY" | "EXHAUSTED" | "UNVERIFIED";
export type AiInferenceUsageAccountingStatus = "VERIFIED" | "PARTIAL" | "UNAVAILABLE";
export type AiInferenceResourceFailureCode =
  | "CALL_BUDGET_EXHAUSTED"
  | "ATTEMPT_BUDGET_EXHAUSTED"
  | "OUTPUT_TOKEN_BUDGET_EXHAUSTED"
  | "INPUT_BYTE_BUDGET_EXHAUSTED"
  | "WALL_CLOCK_BUDGET_EXHAUSTED"
  | "USAGE_UNVERIFIED"
  | "INVALID_USAGE"
  | "CLOCK_REGRESSION"
  | "RESOURCE_REPLAY_CONFLICT";

export interface AiInferenceBudgetPolicy {
  readonly schemaVersion: 1;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly maxModelCalls: number;
  readonly maxTotalAttempts: number;
  readonly maxCumulativeOutputTokens: number;
  readonly maxInputBytes: number;
  readonly maxWallClockMs: number;
  readonly requireUsageAccounting: boolean;
}

export interface AiInferenceAttemptUsage {
  readonly requestId: string;
  readonly attempt: number;
  readonly inputBytes: number;
  readonly reservedOutputTokens: number;
  readonly actualInputTokens: number | null;
  readonly actualOutputTokens: number | null;
  readonly actualTotalTokens: number | null;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly durationMs: number | null;
  readonly result: "RESERVED" | "COMPLETED" | "FAILED";
}

export interface AiInferenceResourceSnapshot {
  readonly schemaVersion: 1;
  readonly health: AiInferenceResourceHealth;
  readonly policy: AiInferenceBudgetPolicy;
  readonly modelCalls: number;
  readonly attempts: number;
  readonly reservedOutputTokens: number;
  readonly inputBytes: number;
  readonly usageAccountingStatus: AiInferenceUsageAccountingStatus;
  readonly actualInputTokens: number | null;
  readonly actualOutputTokens: number | null;
  readonly actualTotalTokens: number | null;
  readonly elapsedMs: number;
  readonly attemptsEvidence: readonly AiInferenceAttemptUsage[];
  readonly failureCode?: AiInferenceResourceFailureCode;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface AiInferenceResourceController {
  reserveCall(callId: string, at: number): boolean;
  /** Returns true only when a NEW attempt is admitted. Exact duplicate replay is state-idempotent but is not re-authorized. */
  reserveAttempt(request: ModelRequest, at: number): boolean;
  completeAttempt(request: ModelRequest, response: ModelResponse, at: number): boolean;
  failAttempt(request: ModelRequest, at: number): void;
  snapshot(at: number): AiInferenceResourceSnapshot;
}

declare module "./aiInference" {
  interface AiReadOnlyProjection {
    readonly inferenceResourceHealth?: AiInferenceResourceHealth;
    readonly inferenceResourceFailureCode?: AiInferenceResourceFailureCode | null;
    readonly inferenceResourcePolicyId?: string | null;
    readonly inferenceResourcePolicyVersion?: string | null;
    readonly inferenceModelCalls?: number;
    readonly inferenceAttempts?: number;
    readonly inferenceReservedOutputTokens?: number;
    readonly inferenceInputBytes?: number;
    readonly inferenceUsageAccountingStatus?: AiInferenceUsageAccountingStatus;
    readonly inferenceActualInputTokens?: number | null;
    readonly inferenceActualOutputTokens?: number | null;
    readonly inferenceActualTotalTokens?: number | null;
    readonly inferenceElapsedMs?: number;
  }
}
