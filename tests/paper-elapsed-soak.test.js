const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSoakObservations } = require("../scripts/paper-elapsed-soak.js");

function observation(at, eventCount, decisionCount, overrides = {}) {
  return {
    observedAt: at,
    runtimeState: "RUNNING",
    schedulerRunning: true,
    eventCount,
    decisionCount,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    ...overrides,
  };
}

test("accepts only genuinely elapsed monotonic PAPER observations", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 1, 1),
    observation("2026-08-31T01:00:00.000Z", 20, 10),
  ], 60 * 60 * 1000);
  assert.equal(result.accepted, true);
  assert.equal(result.elapsedMs, 60 * 60 * 1000);
  assert.deepEqual(result.reasons, []);
});

test("fails closed when real elapsed time is insufficient", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 1, 1),
    observation("2026-08-31T00:10:00.000Z", 4, 3),
  ], 60 * 60 * 1000);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.includes("INSUFFICIENT_REAL_ELAPSED_TIME"));
});

test("fails closed on chronology, counter regression, runtime and authority violations", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T01:00:00.000Z", 10, 8),
    observation("2026-08-31T00:59:00.000Z", 9, 7, {
      runtimeState: "HALTED",
      schedulerRunning: false,
      liveAuthority: "LIVE",
      productionMutationAllowed: true,
    }),
  ], 1);
  assert.equal(result.accepted, false);
  for (const reason of [
    "NON_MONOTONIC_WALL_CLOCK",
    "EVENT_COUNT_REGRESSION",
    "DECISION_COUNT_REGRESSION",
    "PAPER_RUNTIME_NOT_ACTIVE",
    "AUTHORITY_INVARIANT_VIOLATION",
  ]) assert.ok(result.reasons.includes(reason));
});
