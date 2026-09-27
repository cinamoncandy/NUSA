import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AiModelRegistryEntry } from "./modelRouter";
import {
  advanceAiProviderCircuit,
  aiAvailabilityFromProviderCircuit,
  applyProviderCircuitToRegistry,
  classifyAiProviderFailure,
  createAiProviderCircuitState,
  recordAiProviderFailure,
  recordAiProviderSuccess,
  resetAiProviderCircuit,
  type AiProviderCircuitPolicy,
} from "./providerReliability";

const policy: AiProviderCircuitPolicy = Object.freeze({
  failureThreshold: 2,
  cooldownMs: 1_000,
  halfOpenSuccessThreshold: 2,
  maxRetryAfterMs: 10_000,
});

describe("provider-neutral AI reliability", () => {
  it("classifies timeout, auth/config, rate limit, unavailable, malformed, context, budget and unknown", () => {
    const cases = [
      [{ code: "ETIMEDOUT" }, "TIMEOUT", true],
      [{ statusCode: 401 }, "AUTH_CONFIG", false],
      [{ statusCode: 429, retryAfterMs: 2_500 }, "RATE_LIMITED", true],
      [{ statusCode: 503 }, "UNAVAILABLE", true],
      [{ code: "MALFORMED_OUTPUT" }, "MALFORMED_OUTPUT", false],
      [{ message: "maximum context length exceeded" }, "CONTEXT_OVERFLOW", false],
      [{ code: "DAILY_QUOTA_EXHAUSTED", retryAfterMs: 9_000 }, "BUDGET_EXHAUSTED", false],
      [{ statusCode: 418, message: "teapot" }, "UNKNOWN", false],
    ] as const;
    for (const [signal, kind, retryable] of cases) {
      const result = classifyAiProviderFailure(signal);
      assert.equal(result.kind, kind);
      assert.equal(result.retryable, retryable);
      assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
      assert.equal(result.liveAuthority, "NONE");
      assert.equal(result.productionMutationAllowed, false);
    }
  });

  it("bounds retry-after metadata and never echoes provider messages into classification", () => {
    const result = classifyAiProviderFailure({
      statusCode: 429,
      retryAfterMs: 999_999,
      message: "Too many requests credential-material-should-not-escape",
    }, 5_000);
    assert.equal(result.kind, "RATE_LIMITED");
    assert.equal(result.retryAfterMs, 5_000);
    assert.equal("message" in result, false);
  });

  it("opens only after the configured threshold for transient timeout/unavailable failures", () => {
    const failure = classifyAiProviderFailure({ code: "ETIMEDOUT" });
    const initial = createAiProviderCircuitState("provider-a", 100);
    const first = recordAiProviderFailure(initial, failure, policy, 200);
    assert.equal(first.state, "CLOSED");
    assert.equal(first.consecutiveFailures, 1);
    assert.equal(aiAvailabilityFromProviderCircuit(first), "DEGRADED");

    const second = recordAiProviderFailure(first, failure, policy, 300);
    assert.equal(second.state, "OPEN");
    assert.equal(second.nextRetryAt, 1_300);
    assert.equal(aiAvailabilityFromProviderCircuit(second), "CIRCUIT_OPEN");
  });

  it("opens rate-limit immediately and honors bounded provider retry metadata", () => {
    const failure = classifyAiProviderFailure({ statusCode: 429, retryAfterMs: 750 }, policy.maxRetryAfterMs);
    const initial = createAiProviderCircuitState("provider-a", 100);
    const next = recordAiProviderFailure(initial, failure, policy, 200);
    assert.equal(next.state, "OPEN");
    assert.equal(next.nextRetryAt, 950);
  });

  it("budget exhaustion without a reset hint requires explicit reset", () => {
    const failure = classifyAiProviderFailure({ code: "CALL_BUDGET_EXHAUSTED" });
    assert.equal(failure.manualResetRequired, true);
    const blocked = recordAiProviderFailure(createAiProviderCircuitState("provider-a", 100), failure, policy, 200);
    assert.equal(blocked.state, "BLOCKED");
    assert.equal(blocked.nextRetryAt, null);
    assert.equal(aiAvailabilityFromProviderCircuit(blocked), "UNAVAILABLE");
    assert.equal(recordAiProviderSuccess(blocked, policy, 300), blocked);

    const reset = resetAiProviderCircuit(blocked, 400);
    assert.equal(reset.state, "CLOSED");
    assert.equal(reset.consecutiveFailures, 0);
  });

  it("auth/config failure blocks immediately and cannot auto-recover", () => {
    const failure = classifyAiProviderFailure({ statusCode: 403 });
    const blocked = recordAiProviderFailure(createAiProviderCircuitState("provider-a", 100), failure, policy, 200);
    assert.equal(blocked.state, "BLOCKED");
    assert.equal(blocked.nextRetryAt, null);
    assert.equal(advanceAiProviderCircuit(blocked, policy, 10_000), blocked);
  });

  it("context and malformed output are request-local and do not poison provider health", () => {
    for (const signal of [
      { code: "CONTEXT_OVERFLOW" },
      { code: "MALFORMED_OUTPUT" },
      { code: "UNKNOWN_FAILURE" },
    ]) {
      const initial = createAiProviderCircuitState("provider-a", 100);
      const next = recordAiProviderFailure(initial, classifyAiProviderFailure(signal), policy, 200);
      assert.equal(next.state, "CLOSED");
      assert.equal(next.consecutiveFailures, 0);
    }
  });

  it("moves open circuit to half-open only after nextRetryAt and closes after bounded successes", () => {
    const failure = classifyAiProviderFailure({ statusCode: 503 });
    const initial = createAiProviderCircuitState("provider-a", 100);
    const first = recordAiProviderFailure(initial, failure, policy, 200);
    const opened = recordAiProviderFailure(first, failure, policy, 300);
    assert.equal(advanceAiProviderCircuit(opened, policy, 1_299), opened);

    const halfOpen = advanceAiProviderCircuit(opened, policy, 1_300);
    assert.equal(halfOpen.state, "HALF_OPEN");
    assert.equal(aiAvailabilityFromProviderCircuit(halfOpen), "DEGRADED");

    const oneSuccess = recordAiProviderSuccess(halfOpen, policy, 1_400);
    assert.equal(oneSuccess.state, "HALF_OPEN");
    assert.equal(oneSuccess.halfOpenSuccesses, 1);

    const recovered = recordAiProviderSuccess(oneSuccess, policy, 1_500);
    assert.equal(recovered.state, "CLOSED");
    assert.equal(recovered.consecutiveFailures, 0);
    assert.equal(aiAvailabilityFromProviderCircuit(recovered), "AVAILABLE");
  });

  it("a failure during half-open reopens the circuit", () => {
    const failure = classifyAiProviderFailure({ statusCode: 503 });
    const initial = createAiProviderCircuitState("provider-a", 100);
    const opened = recordAiProviderFailure(
      recordAiProviderFailure(initial, failure, policy, 200),
      failure,
      policy,
      300,
    );
    const halfOpen = advanceAiProviderCircuit(opened, policy, 1_300);
    const reopened = recordAiProviderFailure(halfOpen, failure, policy, 1_400);
    assert.equal(reopened.state, "OPEN");
    assert.equal(reopened.nextRetryAt, 2_400);
  });

  it("projects provider circuit health into the canonical model registry without mutating input", () => {
    const registry: readonly AiModelRegistryEntry[] = Object.freeze([
      Object.freeze({
        modelId: "LUNA" as const,
        providerId: "provider-a",
        capabilities: Object.freeze(["classify" as const]),
        maxContextBytes: 1_000,
        costClass: "LOW" as const,
        latencyClass: "LOW" as const,
        availability: "AVAILABLE" as const,
        enabled: true,
        stability: "STABLE" as const,
      }),
      Object.freeze({
        modelId: "TERRA" as const,
        providerId: "provider-b",
        capabilities: Object.freeze(["classify" as const]),
        maxContextBytes: 1_000,
        costClass: "MEDIUM" as const,
        latencyClass: "MEDIUM" as const,
        availability: "AVAILABLE" as const,
        enabled: true,
        stability: "STABLE" as const,
      }),
    ]);
    const failure = classifyAiProviderFailure({ statusCode: 429, retryAfterMs: 500 });
    const state = recordAiProviderFailure(
      createAiProviderCircuitState("provider-a", 100),
      failure,
      policy,
      200,
    );
    const projected = applyProviderCircuitToRegistry(registry, [state]);
    assert.equal(projected[0]?.availability, "CIRCUIT_OPEN");
    assert.equal(projected[1]?.availability, "AVAILABLE");
    assert.equal(registry[0]?.availability, "AVAILABLE");
  });

  it("fails closed on invalid policy, provider id and timestamp regression", () => {
    assert.throws(() => createAiProviderCircuitState("bad provider id!", 0), /AI_PROVIDER_ID_INVALID/);
    const state = createAiProviderCircuitState("provider-a", 100);
    const failure = classifyAiProviderFailure({ statusCode: 503 });
    assert.throws(
      () => recordAiProviderFailure(state, failure, { ...policy, failureThreshold: 0 }, 200),
      /AI_PROVIDER_CIRCUIT_THRESHOLD_INVALID/,
    );
    assert.throws(
      () => recordAiProviderFailure(state, failure, policy, 99),
      /AI_PROVIDER_TIME_REGRESSION/,
    );
  });
});
