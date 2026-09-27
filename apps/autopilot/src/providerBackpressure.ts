import type { AiAvailability } from "../../cloud/src/ai/modelRouter";
import type { AiProviderFailureClassification } from "../../cloud/src/ai/providerReliability";

export type ProviderAdmissionDecision =
  | "ALLOW"
  | "COALESCE"
  | "WAIT_CONCURRENCY"
  | "WAIT_RATE_LIMIT"
  | "WAIT_CIRCUIT";

export type ProviderBackpressureStatus =
  | "READY"
  | "WAITING_RATE_LIMIT"
  | "BLOCKED_RATE_LIMIT";

export interface ProviderBackpressurePolicy {
  readonly minConcurrency: number;
  readonly initialConcurrency: number;
  readonly maxConcurrency: number;
  readonly recoverySuccessThreshold: number;
  readonly maxRetries: number;
  readonly baseBackoffMs: number;
  readonly maxBackoffMs: number;
  readonly jitterBasisPoints: number;
}

export interface ProviderBackpressureState {
  readonly providerId: string;
  readonly status: ProviderBackpressureStatus;
  readonly concurrencyLimit: number;
  readonly inFlight: number;
  readonly activeRequestKeys: readonly string[];
  readonly rateLimitCount: number;
  readonly retryCount: number;
  readonly successStreak: number;
  readonly coalescedCount: number;
  readonly blockedUntil: number | null;
  readonly lastRateLimitAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly updatedAt: number;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface ProviderAdmissionResult {
  readonly decision: ProviderAdmissionDecision;
  readonly state: ProviderBackpressureState;
  readonly nextRetryAt: number | null;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

const REQUEST_KEY = /^[A-Za-z0-9_.:-]{1,192}$/;
const PROVIDER_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

function validateTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("PROVIDER_BACKPRESSURE_TIME_INVALID");
}

function validatePolicy(policy: ProviderBackpressurePolicy): void {
  for (const [name, value] of [
    ["minConcurrency", policy.minConcurrency],
    ["initialConcurrency", policy.initialConcurrency],
    ["maxConcurrency", policy.maxConcurrency],
    ["recoverySuccessThreshold", policy.recoverySuccessThreshold],
    ["maxRetries", policy.maxRetries],
    ["baseBackoffMs", policy.baseBackoffMs],
    ["maxBackoffMs", policy.maxBackoffMs],
    ["jitterBasisPoints", policy.jitterBasisPoints],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("PROVIDER_BACKPRESSURE_POLICY_" + name.toUpperCase() + "_INVALID");
    }
  }
  if (policy.minConcurrency < 1
    || policy.initialConcurrency < policy.minConcurrency
    || policy.maxConcurrency < policy.initialConcurrency
    || policy.maxConcurrency > 1024) {
    throw new Error("PROVIDER_BACKPRESSURE_POLICY_CONCURRENCY_INVALID");
  }
  if (policy.recoverySuccessThreshold < 1 || policy.recoverySuccessThreshold > 10_000) {
    throw new Error("PROVIDER_BACKPRESSURE_POLICY_RECOVERY_INVALID");
  }
  if (policy.maxRetries > 20) throw new Error("PROVIDER_BACKPRESSURE_POLICY_RETRIES_INVALID");
  if (policy.baseBackoffMs < 1 || policy.maxBackoffMs < policy.baseBackoffMs || policy.maxBackoffMs > 86_400_000) {
    throw new Error("PROVIDER_BACKPRESSURE_POLICY_BACKOFF_INVALID");
  }
  if (policy.jitterBasisPoints > 5_000) throw new Error("PROVIDER_BACKPRESSURE_POLICY_JITTER_INVALID");
}

function identity(value: string, regex: RegExp, code: string): string {
  const normalized = value.trim();
  if (!regex.test(normalized)) throw new Error(code);
  return normalized;
}

function authority<T extends object>(value: T): T & {
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
} {
  return Object.freeze({
    ...value,
    aiAuthority: "ZERO_AUTHORITY" as const,
    liveAuthority: "NONE" as const,
    productionMutationAllowed: false as const,
  });
}

function stableJitter(requestKey: string, attempt: number, basisPoints: number): number {
  if (basisPoints === 0) return 0;
  let hash = 2166136261;
  const input = requestKey + ":" + String(attempt);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const fraction = (hash >>> 0) / 0xffffffff;
  return Math.floor(fraction * basisPoints);
}

function retryDelay(
  policy: ProviderBackpressurePolicy,
  requestKey: string,
  retryCount: number,
  retryAfterMs: number | null,
): number {
  if (retryAfterMs != null) return Math.min(policy.maxBackoffMs, retryAfterMs);
  const exponent = Math.min(retryCount, 20);
  const base = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * (2 ** exponent));
  const jitterBp = stableJitter(requestKey, retryCount, policy.jitterBasisPoints);
  return Math.min(policy.maxBackoffMs, base + Math.floor((base * jitterBp) / 10_000));
}

function normalizedState(
  state: ProviderBackpressureState,
  now: number,
): ProviderBackpressureState {
  if (state.blockedUntil == null || now < state.blockedUntil) return state;
  return authority({
    ...state,
    status: "READY" as const,
    blockedUntil: null,
    updatedAt: now,
  });
}

export function createProviderBackpressureState(
  rawProviderId: string,
  policy: ProviderBackpressurePolicy,
  now: number,
): ProviderBackpressureState {
  validatePolicy(policy);
  validateTimestamp(now);
  return authority({
    providerId: identity(rawProviderId, PROVIDER_ID, "PROVIDER_BACKPRESSURE_PROVIDER_ID_INVALID"),
    status: "READY" as const,
    concurrencyLimit: policy.initialConcurrency,
    inFlight: 0,
    activeRequestKeys: Object.freeze([] as string[]),
    rateLimitCount: 0,
    retryCount: 0,
    successStreak: 0,
    coalescedCount: 0,
    blockedUntil: null,
    lastRateLimitAt: null,
    lastSuccessAt: null,
    updatedAt: now,
  });
}

export function admitProviderRequest(
  original: ProviderBackpressureState,
  policy: ProviderBackpressurePolicy,
  rawRequestKey: string,
  availability: AiAvailability,
  now: number,
): ProviderAdmissionResult {
  validatePolicy(policy);
  validateTimestamp(now);
  if (now < original.updatedAt) throw new Error("PROVIDER_BACKPRESSURE_TIME_REGRESSION");
  const requestKey = identity(rawRequestKey, REQUEST_KEY, "PROVIDER_BACKPRESSURE_REQUEST_KEY_INVALID");
  const state = normalizedState(original, now);

  if (state.activeRequestKeys.includes(requestKey)) {
    return authority({
      decision: "COALESCE" as const,
      state: authority({ ...state, coalescedCount: state.coalescedCount + 1, updatedAt: now }),
      nextRetryAt: state.blockedUntil,
    });
  }
  if (availability === "UNAVAILABLE" || availability === "CIRCUIT_OPEN") {
    return authority({ decision: "WAIT_CIRCUIT" as const, state, nextRetryAt: state.blockedUntil });
  }
  if (state.blockedUntil != null && now < state.blockedUntil) {
    return authority({ decision: "WAIT_RATE_LIMIT" as const, state, nextRetryAt: state.blockedUntil });
  }
  if (state.inFlight >= state.concurrencyLimit) {
    return authority({ decision: "WAIT_CONCURRENCY" as const, state, nextRetryAt: null });
  }

  return authority({
    decision: "ALLOW" as const,
    state: authority({
      ...state,
      status: "READY" as const,
      inFlight: state.inFlight + 1,
      activeRequestKeys: Object.freeze([...state.activeRequestKeys, requestKey]),
      updatedAt: now,
    }),
    nextRetryAt: null,
  });
}

function removeActive(state: ProviderBackpressureState, requestKey: string): Pick<ProviderBackpressureState, "inFlight" | "activeRequestKeys"> {
  const active = state.activeRequestKeys.includes(requestKey);
  return {
    inFlight: active ? Math.max(0, state.inFlight - 1) : state.inFlight,
    activeRequestKeys: Object.freeze(state.activeRequestKeys.filter((key) => key !== requestKey)),
  };
}

export function recordProviderRateLimit(
  original: ProviderBackpressureState,
  policy: ProviderBackpressurePolicy,
  rawRequestKey: string,
  failure: AiProviderFailureClassification,
  now: number,
): ProviderBackpressureState {
  validatePolicy(policy);
  validateTimestamp(now);
  if (now < original.updatedAt) throw new Error("PROVIDER_BACKPRESSURE_TIME_REGRESSION");
  if (failure.kind !== "RATE_LIMITED") throw new Error("PROVIDER_BACKPRESSURE_RATE_LIMIT_REQUIRED");
  const requestKey = identity(rawRequestKey, REQUEST_KEY, "PROVIDER_BACKPRESSURE_REQUEST_KEY_INVALID");
  const base = normalizedState(original, now);
  if (!base.activeRequestKeys.includes(requestKey)) return base;
  const retryCount = base.retryCount + 1;
  const delay = retryDelay(policy, requestKey, retryCount - 1, failure.retryAfterMs);
  const blockedUntil = now + delay;
  const exhausted = retryCount > policy.maxRetries;
  const active = removeActive(base, requestKey);
  return authority({
    ...base,
    ...active,
    status: exhausted ? "BLOCKED_RATE_LIMIT" as const : "WAITING_RATE_LIMIT" as const,
    concurrencyLimit: Math.max(policy.minConcurrency, Math.floor(base.concurrencyLimit / 2)),
    rateLimitCount: base.rateLimitCount + 1,
    retryCount,
    successStreak: 0,
    blockedUntil,
    lastRateLimitAt: now,
    updatedAt: now,
  });
}

export function recordProviderCompletion(
  original: ProviderBackpressureState,
  rawRequestKey: string,
  now: number,
): ProviderBackpressureState {
  validateTimestamp(now);
  if (now < original.updatedAt) throw new Error("PROVIDER_BACKPRESSURE_TIME_REGRESSION");
  const requestKey = identity(rawRequestKey, REQUEST_KEY, "PROVIDER_BACKPRESSURE_REQUEST_KEY_INVALID");
  const base = normalizedState(original, now);
  return authority({
    ...base,
    ...removeActive(base, requestKey),
    updatedAt: now,
  });
}

export function recordProviderSuccess(
  original: ProviderBackpressureState,
  policy: ProviderBackpressurePolicy,
  rawRequestKey: string,
  now: number,
): ProviderBackpressureState {
  validatePolicy(policy);
  validateTimestamp(now);
  if (now < original.updatedAt) throw new Error("PROVIDER_BACKPRESSURE_TIME_REGRESSION");
  const requestKey = identity(rawRequestKey, REQUEST_KEY, "PROVIDER_BACKPRESSURE_REQUEST_KEY_INVALID");
  const base = normalizedState(original, now);
  if (!base.activeRequestKeys.includes(requestKey)) return base;
  const active = removeActive(base, requestKey);
  if (base.blockedUntil != null && now < base.blockedUntil) {
    return authority({
      ...base,
      ...active,
      lastSuccessAt: now,
      updatedAt: now,
    });
  }
  const successStreak = base.successStreak + 1;
  const expand = successStreak >= policy.recoverySuccessThreshold && base.concurrencyLimit < policy.maxConcurrency;
  return authority({
    ...base,
    ...active,
    status: "READY" as const,
    concurrencyLimit: expand ? base.concurrencyLimit + 1 : base.concurrencyLimit,
    retryCount: 0,
    successStreak: expand ? 0 : successStreak,
    blockedUntil: null,
    lastSuccessAt: now,
    updatedAt: now,
  });
}
