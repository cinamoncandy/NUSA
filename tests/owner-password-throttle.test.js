"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BASE_DELAY_MS,
  DECAY_MS,
  FREE_ATTEMPTS,
  MAXIMUM_DELAY_MS,
  NO_ATTEMPTS,
  mayAttempt,
  recordFailure,
  recordSuccess,
  retryAfterMs
} = require("../dist/apps/cloud/src/ownerCredential/ownerPasswordThrottle.js");

/**
 * scrypt makes one guess slow; only this makes a million guesses impossible. The properties below
 * are the ones an attacker would look for a way around, and the last two are the ones that keep the
 * owner -- who has no administrator to call -- from being the person locked out.
 */

const NOW = 1_700_000_000_000;

// All failures land on the same instant unless a test says otherwise: advancing the clock per
// failure would shift every lock by a few milliseconds and make the expected delays wrong.
const failTimes = (count, atMs = NOW) => {
  let record;
  for (let index = 0; index < count; index += 1) record = recordFailure(record, atMs);
  return record;
};

test("ordinary mistyping is not punished", () => {
  let record;
  for (let attempt = 1; attempt <= FREE_ATTEMPTS; attempt += 1) {
    record = recordFailure(record, NOW);
    assert.equal(mayAttempt(record, NOW).allowed, true, `attempt ${attempt} was throttled`);
  }
});

test("the delay begins after the free attempts and doubles", () => {
  const first = mayAttempt(failTimes(FREE_ATTEMPTS + 1), NOW);
  assert.equal(first.allowed, false);
  assert.equal(first.retryAfterMs, BASE_DELAY_MS);

  const second = mayAttempt(failTimes(FREE_ATTEMPTS + 2), NOW);
  assert.equal(second.retryAfterMs, BASE_DELAY_MS * 2);

  const third = mayAttempt(failTimes(FREE_ATTEMPTS + 3), NOW);
  assert.equal(third.retryAfterMs, BASE_DELAY_MS * 4);
});

test("the delay is capped, and does not overflow into nonsense", () => {
  const many = failTimes(FREE_ATTEMPTS + 200);
  const decision = mayAttempt(many, NOW);
  assert.equal(decision.allowed, false);
  assert.equal(decision.retryAfterMs, MAXIMUM_DELAY_MS, "doubling two hundred times must clamp, not wrap");
  assert.ok(Number.isSafeInteger(many.lockedUntilMs));
});

test("a locked account is refused without the password being consulted", () => {
  // The caller must not be able to distinguish a wrong password from a locked account by waiting:
  // mayAttempt answers before verification runs, and the route is required to honour it.
  const locked = failTimes(FREE_ATTEMPTS + 1);
  assert.equal(mayAttempt(locked, NOW).allowed, false);
  assert.equal(mayAttempt(locked, NOW + BASE_DELAY_MS - 1).allowed, false);
  assert.equal(mayAttempt(locked, NOW + BASE_DELAY_MS).allowed, true);
});

test("success clears the penalty", () => {
  assert.deepEqual(recordSuccess(), NO_ATTEMPTS);
  assert.equal(mayAttempt(recordSuccess(), NOW).allowed, true);
});

test("a quiet day resets the counter, so yesterday's typo is not evidence", () => {
  const yesterday = failTimes(FREE_ATTEMPTS + 3, NOW);
  const today = recordFailure(yesterday, NOW + DECAY_MS);
  assert.equal(today.failures, 1, "the counter did not decay");
  assert.equal(mayAttempt(today, NOW + DECAY_MS).allowed, true);

  // Just under the window, the history still counts.
  const soon = recordFailure(yesterday, NOW + DECAY_MS - 1);
  assert.equal(soon.failures, FREE_ATTEMPTS + 4);
});

test("a tampered or absurd lock cannot exceed the cap", () => {
  // The owner has no administrator to call, so a corrupted row must never become a permanent lock.
  const forever = Object.freeze({ failures: 99, lockedUntilMs: NOW + 365 * 24 * 60 * 60 * 1000, lastFailureAtMs: NOW });
  assert.equal(mayAttempt(forever, NOW).retryAfterMs, MAXIMUM_DELAY_MS);
});

test("malformed records fail closed rather than granting an attempt", () => {
  for (const record of [
    { failures: 1, lockedUntilMs: Number.NaN, lastFailureAtMs: NOW },
    { failures: 1, lockedUntilMs: -1, lastFailureAtMs: NOW },
    { failures: 1, lockedUntilMs: 1.5, lastFailureAtMs: NOW }
  ]) {
    assert.equal(mayAttempt(record, NOW).allowed, false, `${JSON.stringify(record)} granted an attempt`);
  }
  assert.equal(mayAttempt(NO_ATTEMPTS, Number.NaN).allowed, false, "an unusable clock must not grant attempts");
});

test("no record at all is a first attempt, not a refusal", () => {
  assert.equal(mayAttempt(undefined, NOW).allowed, true);
  assert.equal(retryAfterMs(undefined, NOW), 0);
});

test("the throttle stores counts and times only, never anything about the guess", () => {
  const record = recordFailure(undefined, NOW);
  assert.deepEqual(Object.keys(record).sort(), ["failures", "lastFailureAtMs", "lockedUntilMs"]);
  for (const value of Object.values(record)) {
    assert.ok(value === null || typeof value === "number", "a non-numeric field could carry the password");
  }
});

test("sustained guessing is bounded to a rate a person could not tell from broken", () => {
  // Six hours of an attacker doing nothing but waiting out each lock.
  let record;
  let clock = NOW;
  let attempts = 0;
  const deadline = NOW + 6 * 60 * 60 * 1000;
  while (clock < deadline) {
    const decision = mayAttempt(record, clock);
    if (decision.allowed) {
      record = recordFailure(record, clock);
      attempts += 1;
      clock += 1;
    } else {
      clock += decision.retryAfterMs;
    }
  }
  assert.ok(attempts < 40, `${attempts} guesses in six hours is not a throttle`);
});
