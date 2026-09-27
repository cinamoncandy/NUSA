import type { AiAvailability, AiModelRegistryEntry } from "./modelRouter";

export type AiProviderFailureKind =
  | "TIMEOUT"
  | "AUTH_CONFIG"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "MALFORMED_OUTPUT"
  | "CONTEXT_OVERFLOW"
  | "BUDGET_EXHAUSTED"
  | "UNKNOWN";

export type AiProviderCircuitStateKind =
  | "CLOSED"
  | "OPEN"
  | "HALF_OPEN"
  | "BLOCKED";

export interface AiProviderFailureSignal {
  readonly statusCode?: number | null;
  readonly code?: string | null;
  readonly message?: string | null;
  readonly retryAfterMs?: number | null;
}

export interface AiProviderFailureClassification {
  readonly kind: AiProviderFailureKind;
  readonly retryable: boolean;
  readonly circuitRelevant: boolean;
  readonly manualResetRequired: boolean;
  readonly retryAfterMs: number | null;
  readonly reasonCode:
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_AUTH_CONFIG"
    | "PROVIDER_RATE_LIMITED"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_MALFORMED_OUTPUT"
    | "PROVIDER_CONTEXT_OVERFLOW"
    | "PROVIDER_BUDGET_EXHAUSTED"
    | "PROVIDER_UNKNOWN_FAILURE";
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

export interface AiProviderCircuitPolicy {
  readonly failureThreshold: number;
  readonly cooldownMs: number;
  readonly halfOpenSuccessThreshold: number;
  readonly maxRetryAfterMs: number;
}

export interface AiProviderCircuitState {
  readonly providerId: string;
  readonly state: AiProviderCircuitStateKind;
  readonly consecutiveFailures: number;
  readonly halfOpenSuccesses: number;
  readonly openedAt: number | null;
  readonly nextRetryAt: number | null;
  readonly lastFailureKind: AiProviderFailureKind | null;
  readonly updatedAt: number;
  readonly aiAuthority: "ZERO_AUTHORITY";
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}

const STATUS_AUTH = new Set([400, 401, 403]);
const STATUS_RATE_LIMIT = 429;
const STATUS_UNAVAILABLE = new Set([500, 502, 503, 504]);

const CODE_TIMEOUT = /(?:^|[\\s_:-])(?:TIMEOUT|TIMED_OUT|ETIMEDOUT)(?:$|[\\s_:-])/i;
const CODE_AUTH = /AUTH|UNAUTHORIZED|FORBIDDEN|INVALID[_-]?(?:KEY|TOKEN|CREDENTIAL|CONFIG)/i;
const CODE_RATE = /RATE[_-]?LIMIT|TOO[_-]?MANY[_-]?REQUESTS|QUOTA/i;
const CODE_UNAVAILABLE = /UNAVAILABLE|ECONN|NETWORK|CONNECTION|UPSTREAM|5\d\d/i;
const CODE_MALFORMED = /MALFORMED|PARSE|SCHEMA|INVALID[_-]?OUTPUT/i;
const CODE_CONTEXT = /CONTEXT[_-]?(?:OVERFLOW|LENGTH|LIMIT)|TOO[_-]?LONG|MAX[_-]?CONTEXT/i;
const CODE_BUDGET = /BUDGET[_-]?EXHAUST|CALL[_-]?BUDGET|TOKEN[_-]?BUDGET|DAILY[_-]?QUOTA/i;

function safeText(value: string | null | undefined): string {
  if (value == null) return "";
  return value.slice(0, 512);
}

function boundedRetryAfter(value: number | null | undefined, max: number): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(max, Math.floor(value));
}

function classification(
  kind: AiProviderFailureKind,
  retryable: boolean,
  circuitRelevant: boolean,
  manualResetRequired: boolean,
  retryAfterMs: number | null,
  reasonCode: AiProviderFailureClassification["reasonCode"],
): AiProviderFailureClassification {
  return Object.freeze({
    kind,
    retryable,
    circuitRelevant,
    manualResetRequired,
    retryAfterMs,
    reasonCode,
    aiAuthority: "ZERO_AUTHORITY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
  });
}

export function classifyAiProviderFailure(
  signal: AiProviderFailureSignal,
  maxRetryAfterMs = 60_000,
): AiProviderFailureClassification {
  if (!Number.isSafeInteger(maxRetryAfterMs) || maxRetryAfterMs < 0) {
    throw new Error("AI_PROVIDER_MAX_RETRY_AFTER_INVALID");
  }
  const status = signal.statusCode ?? null;
  const code = safeText(signal.code);
  const message = safeText(signal.message);
  const text = code + " " + message;
  const retryAfterMs = boundedRetryAfter(signal.retryAfterMs, maxRetryAfterMs);

  if (
    CODE_CONTEXT.test(text)
    || /context window|maximum context|input too (?:large|long)/i.test(message)
  ) {
    return classification("CONTEXT_OVERFLOW", false, false, false, null, "PROVIDER_CONTEXT_OVERFLOW");
  }

  if (
    CODE_BUDGET.test(text)
    || /used up your daily free allocation|budget exhausted|quota exhausted/i.test(message)
  ) {
    return classification(
      "BUDGET_EXHAUSTED",
      false,
      true,
      retryAfterMs == null,
      retryAfterMs,
      "PROVIDER_BUDGET_EXHAUSTED",
    );
  }

  if (status === STATUS_RATE_LIMIT || CODE_RATE.test(text) || /too many requests/i.test(message)) {
    return classification("RATE_LIMITED", true, true, false, retryAfterMs, "PROVIDER_RATE_LIMITED");
  }

  if (
    (typeof status === "number" && STATUS_AUTH.has(status))
    || CODE_AUTH.test(text)
    || /invalid api key|invalid credential/i.test(message)
  ) {
    return classification("AUTH_CONFIG", false, true, true, null, "PROVIDER_AUTH_CONFIG");
  }

  if (CODE_TIMEOUT.test(text) || /timed out|timeout/i.test(message)) {
    return classification("TIMEOUT", true, true, false, retryAfterMs, "PROVIDER_TIMEOUT");
  }

  if (
    (typeof status === "number" && STATUS_UNAVAILABLE.has(status))
    || CODE_UNAVAILABLE.test(text)
    || /temporar(?:y|ily) unavailable|fetch failed|network error/i.test(message)
  ) {
    return classification("UNAVAILABLE", true, true, false, retryAfterMs, "PROVIDER_UNAVAILABLE");
  }

  if (CODE_MALFORMED.test(text) || /malformed response|invalid json|schema violation/i.test(message)) {
    return classification("MALFORMED_OUTPUT", false, false, false, null, "PROVIDER_MALFORMED_OUTPUT");
  }

  return classification("UNKNOWN", false, false, false, null, "PROVIDER_UNKNOWN_FAILURE");
}

function validatePolicy(policy: AiProviderCircuitPolicy): void {
  if (!Number.isSafeInteger(policy.failureThreshold) || policy.failureThreshold < 1 || policy.failureThreshold > 100) {
    throw new Error("AI_PROVIDER_CIRCUIT_THRESHOLD_INVALID");
  }
  if (!Number.isSafeInteger(policy.cooldownMs) || policy.cooldownMs < 0 || policy.cooldownMs > 86_400_000) {
    throw new Error("AI_PROVIDER_CIRCUIT_COOLDOWN_INVALID");
  }
  if (
    !Number.isSafeInteger(policy.halfOpenSuccessThreshold)
    || policy.halfOpenSuccessThreshold < 1
    || policy.halfOpenSuccessThreshold > 100
  ) {
    throw new Error("AI_PROVIDER_HALF_OPEN_THRESHOLD_INVALID");
  }
  if (
    !Number.isSafeInteger(policy.maxRetryAfterMs)
    || policy.maxRetryAfterMs < 0
    || policy.maxRetryAfterMs > 86_400_000
  ) {
    throw new Error("AI_PROVIDER_MAX_RETRY_AFTER_INVALID");
  }
}

function validateTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("AI_PROVIDER_" + field + "_INVALID");
}

function providerId(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(normalized)) throw new Error("AI_PROVIDER_ID_INVALID");
  return normalized;
}

export function createAiProviderCircuitState(
  rawProviderId: string,
  now: number,
): AiProviderCircuitState {
  validateTimestamp(now, "TIMESTAMP");
  return Object.freeze({
    providerId: providerId(rawProviderId),
    state: "CLOSED",
    consecutiveFailures: 0,
    halfOpenSuccesses: 0,
    openedAt: null,
    nextRetryAt: null,
    lastFailureKind: null,
    updatedAt: now,
    aiAuthority: "ZERO_AUTHORITY",
    liveAuthority: "NONE",
    productionMutationAllowed: false,
  });
}

export function advanceAiProviderCircuit(
  state: AiProviderCircuitState,
  policy: AiProviderCircuitPolicy,
  now: number,
): AiProviderCircuitState {
  validatePolicy(policy);
  validateTimestamp(now, "TIMESTAMP");
  if (now < state.updatedAt) throw new Error("AI_PROVIDER_TIME_REGRESSION");
  if (state.state !== "OPEN" || state.nextRetryAt == null || now < state.nextRetryAt) {
    return state;
  }
  return Object.freeze({
    ...state,
    state: "HALF_OPEN" as const,
    halfOpenSuccesses: 0,
    updatedAt: now,
  });
}

export function recordAiProviderFailure(
  state: AiProviderCircuitState,
  failure: AiProviderFailureClassification,
  policy: AiProviderCircuitPolicy,
  now: number,
): AiProviderCircuitState {
  validatePolicy(policy);
  validateTimestamp(now, "TIMESTAMP");
  if (now < state.updatedAt) throw new Error("AI_PROVIDER_TIME_REGRESSION");

  if (!failure.circuitRelevant) {
    return Object.freeze({
      ...state,
      lastFailureKind: failure.kind,
      updatedAt: now,
    });
  }

  if (failure.manualResetRequired) {
    return Object.freeze({
      ...state,
      state: "BLOCKED" as const,
      consecutiveFailures: state.consecutiveFailures + 1,
      halfOpenSuccesses: 0,
      openedAt: now,
      nextRetryAt: null,
      lastFailureKind: failure.kind,
      updatedAt: now,
    });
  }

  const consecutiveFailures = state.consecutiveFailures + 1;
  const shouldOpen =
    failure.kind === "RATE_LIMITED"
    || failure.kind === "BUDGET_EXHAUSTED"
    || state.state === "HALF_OPEN"
    || consecutiveFailures >= policy.failureThreshold;

  if (!shouldOpen) {
    return Object.freeze({
      ...state,
      state: "CLOSED" as const,
      consecutiveFailures,
      halfOpenSuccesses: 0,
      lastFailureKind: failure.kind,
      updatedAt: now,
    });
  }

  const wait = Math.min(failure.retryAfterMs ?? policy.cooldownMs, policy.maxRetryAfterMs);
  return Object.freeze({
    ...state,
    state: "OPEN" as const,
    consecutiveFailures,
    halfOpenSuccesses: 0,
    openedAt: now,
    nextRetryAt: now + wait,
    lastFailureKind: failure.kind,
    updatedAt: now,
  });
}

export function recordAiProviderSuccess(
  state: AiProviderCircuitState,
  policy: AiProviderCircuitPolicy,
  now: number,
): AiProviderCircuitState {
  validatePolicy(policy);
  validateTimestamp(now, "TIMESTAMP");
  if (now < state.updatedAt) throw new Error("AI_PROVIDER_TIME_REGRESSION");

  if (state.state === "BLOCKED") return state;
  if (state.state === "OPEN") return state;

  if (state.state === "HALF_OPEN") {
    const halfOpenSuccesses = state.halfOpenSuccesses + 1;
    if (halfOpenSuccesses < policy.halfOpenSuccessThreshold) {
      return Object.freeze({
        ...state,
        halfOpenSuccesses,
        updatedAt: now,
      });
    }
  }

  return Object.freeze({
    ...state,
    state: "CLOSED" as const,
    consecutiveFailures: 0,
    halfOpenSuccesses: 0,
    openedAt: null,
    nextRetryAt: null,
    lastFailureKind: null,
    updatedAt: now,
  });
}

export function resetAiProviderCircuit(
  state: AiProviderCircuitState,
  now: number,
): AiProviderCircuitState {
  validateTimestamp(now, "TIMESTAMP");
  if (now < state.updatedAt) throw new Error("AI_PROVIDER_TIME_REGRESSION");
  return createAiProviderCircuitState(state.providerId, now);
}

export function aiAvailabilityFromProviderCircuit(
  state: AiProviderCircuitState,
): AiAvailability {
  if (state.state === "BLOCKED") return "UNAVAILABLE";
  if (state.state === "OPEN") return "CIRCUIT_OPEN";
  if (state.state === "HALF_OPEN") return "DEGRADED";
  return state.consecutiveFailures > 0 ? "DEGRADED" : "AVAILABLE";
}

export function applyProviderCircuitToRegistry(
  registry: readonly AiModelRegistryEntry[],
  states: readonly AiProviderCircuitState[],
): readonly AiModelRegistryEntry[] {
  const byProvider = new Map(states.map((state) => [state.providerId, state] as const));
  return Object.freeze(
    registry.map((entry) => {
      const state = byProvider.get(entry.providerId);
      return state == null
        ? entry
        : Object.freeze({
            ...entry,
            availability: aiAvailabilityFromProviderCircuit(state),
          });
    }),
  );
}
