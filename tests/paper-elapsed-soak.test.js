const assert = require("node:assert/strict");
const test = require("node:test");
const { validateSoakObservations } = require("../scripts/paper-elapsed-soak.js");

function observation(at, monotonicElapsedMs, eventCount, decisionCount, overrides = {}) {
  return { observedAt: at, monotonicElapsedMs, runtimeState: "RUNNING", schedulerRunning: true, eventCount, decisionCount, liveAuthority: "NONE", productionMutationAllowed: false, ...overrides };
}

test("accepts only genuinely elapsed wall and monotonic PAPER observations with progress", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 0, 1, 1),
    observation("2026-08-31T01:00:00.000Z", 60 * 60 * 1000, 20, 10),
  ], 60 * 60 * 1000);
  assert.equal(result.accepted, true);
  assert.equal(result.elapsedMs, 60 * 60 * 1000);
  assert.equal(result.monotonicElapsedMs, 60 * 60 * 1000);
  assert.deepEqual(result.reasons, []);
});

test("fails closed when wall or monotonic elapsed time is insufficient", () => {
  const wallShort = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 0, 1, 1),
    observation("2026-08-31T00:10:00.000Z", 60 * 60 * 1000, 4, 3),
  ], 60 * 60 * 1000);
  assert.ok(wallShort.reasons.includes("INSUFFICIENT_REAL_ELAPSED_TIME"));

  const monotonicShort = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 0, 1, 1),
    observation("2026-08-31T01:00:00.000Z", 10 * 60 * 1000, 4, 3),
  ], 60 * 60 * 1000);
  assert.ok(monotonicShort.reasons.includes("INSUFFICIENT_MONOTONIC_ELAPSED_TIME"));
});

test("fails closed on chronology, counters, progress, runtime and authority violations", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T01:00:00.000Z", 10, 10, 8),
    observation("2026-08-31T00:59:00.000Z", 9, 9, 7, { runtimeState: "HALTED", schedulerRunning: false, liveAuthority: "LIVE", productionMutationAllowed: true }),
  ], 1);
  for (const reason of ["NON_MONOTONIC_WALL_CLOCK", "MONOTONIC_CLOCK_REGRESSION", "EVENT_COUNT_REGRESSION", "DECISION_COUNT_REGRESSION", "PAPER_RUNTIME_NOT_ACTIVE", "AUTHORITY_INVARIANT_VIOLATION", "NO_EVENT_PROGRESS", "NO_DECISION_PROGRESS"]) assert.ok(result.reasons.includes(reason));
});
