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

const { summarizeSnapshot } = require("../scripts/paper-elapsed-soak.js");

/**
 * #1855. A 330-minute soak produced 331 observations, exactly one of which was HALTED while
 * `schedulerRunning` stayed true. The receipt recorded `runtimeState` and nothing that could say
 * which fail-closed input asserted it, so the cause could not be proven from trusted evidence and
 * the whole interval had to be discarded. These assertions pin the attribution that was missing.
 */
function snapshot(operations) {
  return {
    generatedAt: 1_700_000_000_000,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    operations: { schedulerRunning: true, heartbeat: { eventCount: 5254, decisionCount: 5254 }, ...operations }
  };
}

test("a HALTED observation carries the fail-closed reason that asserted it", () => {
  const observed = summarizeSnapshot(snapshot({
    runtimeState: "HALTED",
    killSwitchActive: true,
    accountHalted: false,
    runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"]
  }), 11_583_038.693803);

  assert.equal(observed.runtimeState, "HALTED");
  assert.deepEqual(observed.runtimeHaltReasons, ["KILL_SWITCH_ACTIVE"]);
  assert.equal(observed.killSwitchActive, true);
  assert.equal(observed.accountHalted, false);
});

test("the two causes that accountHalted merges are told apart", () => {
  const faulted = summarizeSnapshot(snapshot({ runtimeState: "HALTED", accountHalted: true, runtimeHaltReasons: ["DASHBOARD_FAULTED"] }));
  const p0 = summarizeSnapshot(snapshot({ runtimeState: "HALTED", accountHalted: true, runtimeHaltReasons: ["AI_P0_UNVERIFIABLE"] }));

  // `accountHalted` reads identically for both, which is why it alone could not attribute #1855.
  assert.equal(faulted.accountHalted, p0.accountHalted);
  assert.notDeepEqual(faulted.runtimeHaltReasons, p0.runtimeHaltReasons);
  assert.deepEqual(faulted.runtimeHaltReasons, ["DASHBOARD_FAULTED"]);
  assert.deepEqual(p0.runtimeHaltReasons, ["AI_P0_UNVERIFIABLE"]);
});

test("a healthy observation records no halt reason rather than an empty one", () => {
  const observed = summarizeSnapshot(snapshot({ runtimeState: "RUNNING", killSwitchActive: false, accountHalted: false }));
  assert.equal(observed.runtimeState, "RUNNING");
  assert.equal(observed.runtimeHaltReasons, null);
  assert.equal(observed.killSwitchActive, false);
});

test("attribution does not soften the rule that one HALTED sample rejects the soak", () => {
  const result = validateSoakObservations([
    observation("2026-08-31T00:00:00.000Z", 0, 1, 1),
    observation("2026-08-31T00:30:00.000Z", 30 * 60 * 1000, 10, 10, {
      runtimeState: "HALTED",
      runtimeHaltReasons: ["KILL_SWITCH_ACTIVE"]
    }),
    observation("2026-08-31T01:00:00.000Z", 60 * 60 * 1000, 20, 20),
  ], 60 * 60 * 1000);

  assert.equal(result.accepted, false, "a recorded reason must not make a halt acceptable");
  assert.ok(result.reasons.includes("PAPER_RUNTIME_NOT_ACTIVE"), JSON.stringify(result.reasons));
});
