import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canAttemptCircuitRecovery,
  recordCircuitFailure,
  resetCircuitBreaker,
  validateCircuitBreakerPolicy,
  validateCircuitBreakerState,
  validateCircuitBreakerTimestamp,
} from "./evolveCircuitBreaker";

const POLICY = { maxFailures: 2, cooldownSeconds: 60 } as const;
const NOW = "2026-08-29T00:00:00.000Z";

test("circuit policy, state, and timestamp validators accept only bounded runtime values", () => {
  assert.deepEqual(validateCircuitBreakerPolicy(POLICY), POLICY);
  assert.deepEqual(validateCircuitBreakerState(resetCircuitBreaker()), resetCircuitBreaker());
  assert.equal(validateCircuitBreakerTimestamp(NOW), NOW);

  for (const policy of [
    null,
    { maxFailures: 0, cooldownSeconds: 60 },
    { maxFailures: 2, cooldownSeconds: 0 },
    { maxFailures: "2", cooldownSeconds: 60 },
    { maxFailures: Number.NaN, cooldownSeconds: 60 },
  ]) {
    assert.throws(() => validateCircuitBreakerPolicy(policy as never));
  }

  for (const state of [
    null,
    { state: "CLOSED", consecutiveFailures: "0" },
    { state: "UNKNOWN", consecutiveFailures: 0 },
    { state: "OPEN", consecutiveFailures: 0, openedAt: NOW },
    { state: "OPEN", consecutiveFailures: 1 },
    { state: "OPEN", consecutiveFailures: 1, openedAt: "not-a-date" },
  ]) {
    assert.throws(() => validateCircuitBreakerState(state as never));
  }

  assert.throws(() => validateCircuitBreakerTimestamp("not-a-date"));
  assert.throws(() => validateCircuitBreakerTimestamp(""));
});

test("recordCircuitFailure opens at the threshold and preserves an already-open circuit", () => {
  const first = recordCircuitFailure(resetCircuitBreaker(), POLICY, NOW);
  assert.deepEqual(first, { state: "CLOSED", consecutiveFailures: 1 });

  const opened = recordCircuitFailure(first, POLICY, "2026-08-29T00:01:00.000Z");
  assert.deepEqual(opened, {
    state: "OPEN",
    consecutiveFailures: 2,
    openedAt: "2026-08-29T00:01:00.000Z",
  });

  const stillOpen = recordCircuitFailure(opened, POLICY, "2026-08-29T00:02:00.000Z");
  assert.deepEqual(stillOpen, {
    state: "OPEN",
    consecutiveFailures: 3,
    openedAt: "2026-08-29T00:01:00.000Z",
  });
  assert.equal(Object.isFrozen(stillOpen), true);
});

test("circuit recovery is closed until cooldown and rejects malformed input", () => {
  assert.equal(canAttemptCircuitRecovery(resetCircuitBreaker(), POLICY, NOW), true);
  const opened = { state: "OPEN", consecutiveFailures: 2, openedAt: NOW } as const;
  assert.equal(canAttemptCircuitRecovery(opened, POLICY, "2026-08-29T00:00:59.999Z"), false);
  assert.equal(canAttemptCircuitRecovery(opened, POLICY, "2026-08-29T00:01:00.000Z"), true);
  assert.throws(() => canAttemptCircuitRecovery({ ...opened, consecutiveFailures: "2" } as never, POLICY, NOW));
  assert.throws(() => canAttemptCircuitRecovery(opened, POLICY, "not-a-date"));
});

test("failure count overflow fails closed instead of producing an unsafe number", () => {
  assert.throws(() => recordCircuitFailure(
    { state: "CLOSED", consecutiveFailures: Number.MAX_SAFE_INTEGER } as never,
    POLICY,
    NOW,
  ));
});
