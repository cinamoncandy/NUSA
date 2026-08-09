import { aiSha256, canonicalAiJson, type ModelRequest, type ModelResponse, type ModelUsage } from "../../../../packages/contracts/src/aiInference";
import type {
  AiInferenceAttemptUsage,
  AiInferenceBudgetPolicy,
  AiInferenceResourceController,
  AiInferenceResourceFailureCode,
  AiInferenceResourceHealth,
  AiInferenceResourceSnapshot
} from "../../../../packages/contracts/src/aiInferenceResources";

export const DEFAULT_AI_INFERENCE_BUDGET_POLICY: AiInferenceBudgetPolicy = Object.freeze({
  schemaVersion: 1,
  policyId: "NUSA_AI_INFERENCE_RESOURCE_BUDGET",
  policyVersion: "1.0.0",
  maxModelCalls: 4,
  maxTotalAttempts: 8,
  maxCumulativeOutputTokens: 16_384,
  maxInputBytes: 4 * 1024 * 1024,
  maxWallClockMs: 90_000,
  requireUsageAccounting: false
});

interface MutableAttempt {
  readonly requestId: string;
  readonly attempt: number;
  readonly identityHash: string;
  readonly inputBytes: number;
  readonly reservedOutputTokens: number;
  readonly startedAt: number;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualTotalTokens: number | null;
  completedAt: number | null;
  durationMs: number | null;
  result: AiInferenceAttemptUsage["result"];
}

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const positiveSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`);
  return value;
};

const nonNegativeSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const safeAdd = (left: number, right: number, field: string): number => {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} overflow`);
  return value;
};

export function normalizeAiInferenceBudgetPolicy(value: AiInferenceBudgetPolicy | undefined): AiInferenceBudgetPolicy {
  const policy = value ?? DEFAULT_AI_INFERENCE_BUDGET_POLICY;
  if (policy.schemaVersion !== 1) throw new Error("AI inference budget schemaVersion is unsupported");
  return Object.freeze({
    schemaVersion: 1,
    policyId: requiredText(policy.policyId, "AI inference budget policyId"),
    policyVersion: requiredText(policy.policyVersion, "AI inference budget policyVersion"),
    maxModelCalls: positiveSafeInteger(policy.maxModelCalls, "AI inference maxModelCalls"),
    maxTotalAttempts: positiveSafeInteger(policy.maxTotalAttempts, "AI inference maxTotalAttempts"),
    maxCumulativeOutputTokens: positiveSafeInteger(policy.maxCumulativeOutputTokens, "AI inference maxCumulativeOutputTokens"),
    maxInputBytes: positiveSafeInteger(policy.maxInputBytes, "AI inference maxInputBytes"),
    maxWallClockMs: positiveSafeInteger(policy.maxWallClockMs, "AI inference maxWallClockMs"),
    requireUsageAccounting: policy.requireUsageAccounting === true
  });
}

export function aiInferenceBudgetIdentity(policy: AiInferenceBudgetPolicy): Readonly<Record<string, unknown>> {
  const normalized = normalizeAiInferenceBudgetPolicy(policy);
  return Object.freeze({
    schemaVersion: normalized.schemaVersion,
    policyId: normalized.policyId,
    policyVersion: normalized.policyVersion,
    maxModelCalls: normalized.maxModelCalls,
    maxTotalAttempts: normalized.maxTotalAttempts,
    maxCumulativeOutputTokens: normalized.maxCumulativeOutputTokens,
    maxInputBytes: normalized.maxInputBytes,
    maxWallClockMs: normalized.maxWallClockMs,
    requireUsageAccounting: normalized.requireUsageAccounting
  });
}

function requestInputBytes(request: ModelRequest): number {
  return Buffer.byteLength(canonicalAiJson({ instructions: request.instructions, input: request.input }), "utf8");
}

function requestIdentity(request: ModelRequest): string {
  return aiSha256({
    requestId: request.requestId,
    attempt: request.attempt,
    role: request.role,
    providerId: request.providerId,
    modelVersionId: request.modelVersionId,
    promptArtifactId: request.promptArtifactId,
    promptArtifactVersion: request.promptArtifactVersion,
    promptArtifactDigest: request.promptArtifactDigest,
    contextHash: request.contextHash,
    inputHash: request.inputHash,
    maxOutputBytes: request.maxOutputBytes,
    maxTokens: request.maxTokens,
    timeoutMs: request.timeoutMs
  });
}

function parseUsage(usage: ModelUsage | undefined, required: boolean): { input: number | null; output: number | null; total: number | null } | null {
  if (usage == null) return required ? null : { input: null, output: null, total: null };
  const input = usage.inputTokens == null ? null : nonNegativeSafeInteger(usage.inputTokens, "model usage inputTokens");
  const output = usage.outputTokens == null ? null : nonNegativeSafeInteger(usage.outputTokens, "model usage outputTokens");
  const total = usage.totalTokens == null ? null : nonNegativeSafeInteger(usage.totalTokens, "model usage totalTokens");
  if (required && (input == null || output == null || total == null)) return null;
  if (total != null && input != null && output != null && total < safeAdd(input, output, "model usage token sum")) throw new Error("model usage totalTokens is internally inconsistent");
  return { input, output, total: total ?? (input != null && output != null ? safeAdd(input, output, "model usage token sum") : null) };
}

export class InferenceResourceLedger implements AiInferenceResourceController {
  private healthValue: AiInferenceResourceHealth = "HEALTHY";
  private failureCodeValue: AiInferenceResourceFailureCode | undefined;
  private readonly callIds = new Set<string>();
  private readonly attemptsByKey = new Map<string, MutableAttempt>();
  private attemptsCount = 0;
  private reservedOutputTokensCount = 0;
  private inputBytesCount = 0;
  private actualInputTokensCount = 0;
  private actualOutputTokensCount = 0;
  private actualTotalTokensCount = 0;
  private lastEventAt: number;

  public readonly policy: AiInferenceBudgetPolicy;

  public constructor(policy: AiInferenceBudgetPolicy | undefined, private readonly startedAt: number) {
    this.policy = normalizeAiInferenceBudgetPolicy(policy);
    nonNegativeSafeInteger(startedAt, "AI inference resource startedAt");
    this.lastEventAt = startedAt;
  }

  public reserveCall(callIdValue: string, at: number): boolean {
    const callId = requiredText(callIdValue, "AI inference callId");
    if (!this.guardTime(at)) return false;
    if (this.healthValue !== "HEALTHY") return false;
    if (this.callIds.has(callId)) return true;
    if (this.callIds.size >= this.policy.maxModelCalls) return this.fail("CALL_BUDGET_EXHAUSTED", "EXHAUSTED");
    this.callIds.add(callId);
    this.lastEventAt = at;
    return true;
  }

  public reserveAttempt(request: ModelRequest, at: number): boolean {
    if (!this.guardTime(at)) return false;
    if (this.healthValue !== "HEALTHY") return false;
    let inputBytes: number;
    let maxTokens: number;
    let attempt: number;
    try {
      inputBytes = requestInputBytes(request);
      maxTokens = positiveSafeInteger(request.maxTokens, "model request maxTokens");
      attempt = nonNegativeSafeInteger(request.attempt, "model request attempt");
    } catch {
      return this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
    }
    const key = `${request.requestId}:${attempt}`;
    const identityHash = requestIdentity(request);
    const prior = this.attemptsByKey.get(key);
    if (prior != null) return prior.identityHash === identityHash || this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
    if (this.attemptsCount >= this.policy.maxTotalAttempts) return this.fail("ATTEMPT_BUDGET_EXHAUSTED", "EXHAUSTED");
    let nextReserved: number;
    let nextInputBytes: number;
    try {
      nextReserved = safeAdd(this.reservedOutputTokensCount, maxTokens, "AI inference reserved output tokens");
      nextInputBytes = safeAdd(this.inputBytesCount, inputBytes, "AI inference input bytes");
    } catch {
      return this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
    }
    if (nextReserved > this.policy.maxCumulativeOutputTokens) return this.fail("OUTPUT_TOKEN_BUDGET_EXHAUSTED", "EXHAUSTED");
    if (nextInputBytes > this.policy.maxInputBytes) return this.fail("INPUT_BYTE_BUDGET_EXHAUSTED", "EXHAUSTED");
    this.attemptsCount += 1;
    this.reservedOutputTokensCount = nextReserved;
    this.inputBytesCount = nextInputBytes;
    this.attemptsByKey.set(key, {
      requestId: request.requestId,
      attempt,
      identityHash,
      inputBytes,
      reservedOutputTokens: maxTokens,
      startedAt: at,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualTotalTokens: null,
      completedAt: null,
      durationMs: null,
      result: "RESERVED"
    });
    this.lastEventAt = at;
    return true;
  }

  public completeAttempt(request: ModelRequest, response: ModelResponse, at: number): boolean {
    if (!this.guardTime(at)) return false;
    if (this.healthValue !== "HEALTHY") return false;
    const key = `${request.requestId}:${request.attempt}`;
    const item = this.attemptsByKey.get(key);
    if (item == null || item.identityHash !== requestIdentity(request)) return this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
    if (item.result === "COMPLETED") return true;
    if (item.result !== "RESERVED") return this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
    let usage: { input: number | null; output: number | null; total: number | null } | null;
    try { usage = parseUsage(response.usage, this.policy.requireUsageAccounting); }
    catch { return this.fail("INVALID_USAGE", "UNVERIFIED"); }
    if (usage == null) return this.fail("USAGE_UNVERIFIED", "UNVERIFIED");
    if (usage.output != null && usage.output > item.reservedOutputTokens) return this.fail("INVALID_USAGE", "UNVERIFIED");
    try {
      if (usage.input != null) this.actualInputTokensCount = safeAdd(this.actualInputTokensCount, usage.input, "AI inference actual input tokens");
      if (usage.output != null) this.actualOutputTokensCount = safeAdd(this.actualOutputTokensCount, usage.output, "AI inference actual output tokens");
      if (usage.total != null) this.actualTotalTokensCount = safeAdd(this.actualTotalTokensCount, usage.total, "AI inference actual total tokens");
    } catch { return this.fail("INVALID_USAGE", "UNVERIFIED"); }
    item.actualInputTokens = usage.input;
    item.actualOutputTokens = usage.output;
    item.actualTotalTokens = usage.total;
    item.completedAt = at;
    item.durationMs = at - item.startedAt;
    item.result = "COMPLETED";
    this.lastEventAt = at;
    return this.enforceWallClock(at);
  }

  public failAttempt(request: ModelRequest, at: number): void {
    if (!this.guardTime(at)) return;
    const key = `${request.requestId}:${request.attempt}`;
    const item = this.attemptsByKey.get(key);
    if (item == null || item.identityHash !== requestIdentity(request)) {
      this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
      return;
    }
    if (item.result === "FAILED") return;
    if (item.result !== "RESERVED") {
      this.fail("RESOURCE_REPLAY_CONFLICT", "UNVERIFIED");
      return;
    }
    item.completedAt = at;
    item.durationMs = at - item.startedAt;
    item.result = "FAILED";
    this.lastEventAt = at;
    this.enforceWallClock(at);
  }

  public snapshot(at: number): AiInferenceResourceSnapshot {
    this.guardTime(at);
    const elapsedMs = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, at - this.startedAt));
    const attemptsEvidence = [...this.attemptsByKey.values()]
      .sort((left, right) => left.startedAt - right.startedAt || left.requestId.localeCompare(right.requestId) || left.attempt - right.attempt)
      .map((item): AiInferenceAttemptUsage => Object.freeze({
        requestId: item.requestId,
        attempt: item.attempt,
        inputBytes: item.inputBytes,
        reservedOutputTokens: item.reservedOutputTokens,
        actualInputTokens: item.actualInputTokens,
        actualOutputTokens: item.actualOutputTokens,
        actualTotalTokens: item.actualTotalTokens,
        startedAt: item.startedAt,
        completedAt: item.completedAt,
        durationMs: item.durationMs,
        result: item.result
      }));
    return Object.freeze({
      schemaVersion: 1,
      health: this.healthValue,
      policy: this.policy,
      modelCalls: this.callIds.size,
      attempts: this.attemptsCount,
      reservedOutputTokens: this.reservedOutputTokensCount,
      inputBytes: this.inputBytesCount,
      actualInputTokens: this.actualInputTokensCount,
      actualOutputTokens: this.actualOutputTokensCount,
      actualTotalTokens: this.actualTotalTokensCount,
      elapsedMs,
      attemptsEvidence: Object.freeze(attemptsEvidence),
      ...(this.failureCodeValue == null ? {} : { failureCode: this.failureCodeValue }),
      liveAuthority: "NONE",
      productionMutationAllowed: false
    });
  }

  private guardTime(at: number): boolean {
    try { nonNegativeSafeInteger(at, "AI inference resource timestamp"); }
    catch { return this.fail("CLOCK_REGRESSION", "UNVERIFIED"); }
    if (at < this.startedAt || at < this.lastEventAt) return this.fail("CLOCK_REGRESSION", "UNVERIFIED");
    return this.enforceWallClock(at);
  }

  private enforceWallClock(at: number): boolean {
    if (this.healthValue !== "HEALTHY") return false;
    if (at - this.startedAt > this.policy.maxWallClockMs) return this.fail("WALL_CLOCK_BUDGET_EXHAUSTED", "EXHAUSTED");
    return true;
  }

  private fail(code: AiInferenceResourceFailureCode, health: Exclude<AiInferenceResourceHealth, "HEALTHY">): false {
    if (this.healthValue === "HEALTHY") {
      this.healthValue = health;
      this.failureCodeValue = code;
    }
    return false;
  }
}
