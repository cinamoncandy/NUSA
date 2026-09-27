import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAiProviderFailure } from "../../cloud/src/ai/providerReliability";
import {
  admitProviderRequest,
  createProviderBackpressureState,
  recordProviderCompletion,
  recordProviderRateLimit,
  recordProviderSuccess,
  type ProviderBackpressurePolicy,
} from "./providerBackpressure";

const policy: ProviderBackpressurePolicy = Object.freeze({
  minConcurrency: 1,
  initialConcurrency: 4,
  maxConcurrency: 8,
  recoverySuccessThreshold: 2,
  maxRetries: 2,
  baseBackoffMs: 1_000,
  maxBackoffMs: 10_000,
  jitterBasisPoints: 2_500,
});

describe("provider backpressure", () => {
  it("admits up to provider-local concurrency and isolates providers", () => {
    let a = createProviderBackpressureState("provider-a", policy, 0);
    const b = createProviderBackpressureState("provider-b", policy, 0);
    for (let index = 0; index < 4; index += 1) {
      const result = admitProviderRequest(a, policy, "a-" + index, "AVAILABLE", 10 + index);
      assert.equal(result.decision, "ALLOW");
      a = result.state;
    }
    assert.equal(admitProviderRequest(a, policy, "a-5", "AVAILABLE", 20).decision, "WAIT_CONCURRENCY");
    assert.equal(admitProviderRequest(b, policy, "b-1", "AVAILABLE", 20).decision, "ALLOW");
  });

  it("coalesces an identical in-flight logical request without increasing in-flight", () => {
    const initial = createProviderBackpressureState("provider-a", policy, 0);
    const first = admitProviderRequest(initial, policy, "same-task", "AVAILABLE", 10);
    const duplicate = admitProviderRequest(first.state, policy, "same-task", "AVAILABLE", 11);
    assert.equal(duplicate.decision, "COALESCE");
    assert.equal(duplicate.state.inFlight, 1);
    assert.equal(duplicate.state.coalescedCount, 1);
  });

  it("honors Retry-After, contracts concurrency, and represents bounded wait as non-terminal", () => {
    const initial = createProviderBackpressureState("provider-a", policy, 0);
    const admitted = admitProviderRequest(initial, policy, "task-1", "AVAILABLE", 10);
    const failure = classifyAiProviderFailure({ statusCode: 429, retryAfterMs: 3_000 }, policy.maxBackoffMs);
    const limited = recordProviderRateLimit(admitted.state, policy, "task-1", failure, 20);
    assert.equal(limited.status, "WAITING_RATE_LIMIT");
    assert.equal(limited.blockedUntil, 3_020);
    assert.equal(limited.concurrencyLimit, 2);
    assert.equal(limited.inFlight, 0);
    const wait = admitProviderRequest(limited, policy, "task-2", "AVAILABLE", 21);
    assert.equal(wait.decision, "WAIT_RATE_LIMIT");
    assert.equal(wait.nextRetryAt, 3_020);
  });

  it("uses deterministic bounded exponential backoff+jitter when provider reset is absent", () => {
    const failure = classifyAiProviderFailure({ statusCode: 429 });
    const initial = createProviderBackpressureState("provider-a", policy, 0);
    const a = recordProviderRateLimit(initial, policy, "task-1", failure, 100);
    const b = recordProviderRateLimit(initial, policy, "task-1", failure, 100);
    assert.equal(a.blockedUntil, b.blockedUntil);
    assert.ok((a.blockedUntil ?? 0) > 1_100);
    assert.ok((a.blockedUntil ?? 0) <= 1_350);
  });

  it("repeated 429 exhausts bounded retries into BLOCKED_RATE_LIMIT with a future retry", () => {
    const failure = classifyAiProviderFailure({ statusCode: 429, retryAfterMs: 500 });
    let state = createProviderBackpressureState("provider-a", policy, 0);
    state = recordProviderRateLimit(state, policy, "task-1", failure, 100);
    assert.equal(state.status, "WAITING_RATE_LIMIT");
    state = recordProviderRateLimit(state, policy, "task-1", failure, 700);
    assert.equal(state.status, "WAITING_RATE_LIMIT");
    state = recordProviderRateLimit(state, policy, "task-1", failure, 1_300);
    assert.equal(state.status, "BLOCKED_RATE_LIMIT");
    assert.equal(state.retryCount, 3);
    assert.ok((state.blockedUntil ?? 0) > 1_300);
  });

  it("successful recovery expands concurrency gradually instead of jumping to max", () => {
    const failure = classifyAiProviderFailure({ statusCode: 429, retryAfterMs: 100 });
    let state = createProviderBackpressureState("provider-a", policy, 0);
    state = recordProviderRateLimit(state, policy, "task-1", failure, 10);
    assert.equal(state.concurrencyLimit, 2);

    const first = recordProviderSuccess(state, policy, "task-2", 200);
    assert.equal(first.concurrencyLimit, 2);
    assert.equal(first.successStreak, 1);

    const second = recordProviderSuccess(first, policy, "task-3", 201);
    assert.equal(second.concurrencyLimit, 3);
    assert.equal(second.successStreak, 0);

    const third = recordProviderSuccess(second, policy, "task-4", 202);
    const fourth = recordProviderSuccess(third, policy, "task-5", 203);
    assert.equal(fourth.concurrencyLimit, 4);
    assert.ok(fourth.concurrencyLimit < policy.maxConcurrency);
  });

  it("circuit-open/unavailable health blocks only that provider lane", () => {
    const state = createProviderBackpressureState("provider-a", policy, 0);
    assert.equal(admitProviderRequest(state, policy, "task-1", "CIRCUIT_OPEN", 10).decision, "WAIT_CIRCUIT");
    assert.equal(admitProviderRequest(state, policy, "task-1", "UNAVAILABLE", 10).decision, "WAIT_CIRCUIT");
    assert.equal(admitProviderRequest(state, policy, "task-1", "DEGRADED", 10).decision, "ALLOW");
  });

  it("completion releases a request key without fabricating a success", () => {
    const initial = createProviderBackpressureState("provider-a", policy, 0);
    const admitted = admitProviderRequest(initial, policy, "task-1", "AVAILABLE", 10);
    const completed = recordProviderCompletion(admitted.state, "task-1", 20);
    assert.equal(completed.inFlight, 0);
    assert.equal(completed.activeRequestKeys.length, 0);
    assert.equal(completed.successStreak, 0);
    assert.equal(completed.lastSuccessAt, null);
  });

  it("never exposes authority beyond ZERO_AUTHORITY", () => {
    const state = createProviderBackpressureState("provider-a", policy, 0);
    const admitted = admitProviderRequest(state, policy, "task-1", "AVAILABLE", 10);
    assert.equal(state.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(state.liveAuthority, "NONE");
    assert.equal(state.productionMutationAllowed, false);
    assert.equal(admitted.aiAuthority, "ZERO_AUTHORITY");
    assert.equal(admitted.liveAuthority, "NONE");
    assert.equal(admitted.productionMutationAllowed, false);
  });

  it("fails closed on invalid identities, policy and time regression", () => {
    assert.throws(() => createProviderBackpressureState("bad provider!", policy, 0), /PROVIDER_BACKPRESSURE_PROVIDER_ID_INVALID/);
    assert.throws(() => createProviderBackpressureState("provider-a", { ...policy, minConcurrency: 0 }, 0), /POLICY_CONCURRENCY_INVALID/);
    const state = createProviderBackpressureState("provider-a", policy, 10);
    assert.throws(() => admitProviderRequest(state, policy, "task-1", "AVAILABLE", 9), /TIME_REGRESSION/);
    assert.throws(() => admitProviderRequest(state, policy, "bad key!", "AVAILABLE", 11), /REQUEST_KEY_INVALID/);
  });
});
