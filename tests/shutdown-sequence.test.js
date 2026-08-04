const test = require("node:test");
const assert = require("node:assert/strict");

const { ShutdownSequence } = require("../dist/apps/desktop/src/shutdownSequence.js");

function dependencies(stopSignalIntake, calls) {
  return {
    runId: "run-1",
    observationIsRunning: () => false,
    currentSessionId: () => null,
    stopSignalIntake,
    unsubscribeMarket: () => calls.push("UNSUBSCRIBE_MARKET"),
    clearTimers: () => calls.push("CLEAR_TIMERS"),
    flushEvidence: async () => { calls.push("FLUSH_EVIDENCE"); },
    recordRecovery: () => calls.push("RECORD_RECOVERY"),
    beginShutdownRecord: () => calls.push("BEGIN_MARKER"),
    completeShutdownRecord: () => calls.push("COMPLETE_MARKER"),
    now: () => 1
  };
}

test("awaits an asynchronous signal stop before unsubscribing market data", async () => {
  const calls = [];
  let release;
  const sequence = new ShutdownSequence(dependencies(() => new Promise((resolve) => {
    calls.push("STOP_SIGNALS");
    release = () => { calls.push("STOPPED"); resolve(); };
  }), calls));

  const result = sequence.run();
  assert.deepEqual(calls, ["BEGIN_MARKER", "STOP_SIGNALS"]);
  release();
  await result;

  assert.deepEqual(calls, ["BEGIN_MARKER", "STOP_SIGNALS", "STOPPED", "UNSUBSCRIBE_MARKET", "CLEAR_TIMERS", "FLUSH_EVIDENCE", "RECORD_RECOVERY", "COMPLETE_MARKER"]);
});

test("a failed asynchronous signal stop leaves no clean shutdown marker", async () => {
  const calls = [];
  const sequence = new ShutdownSequence(dependencies(async () => {
    calls.push("STOP_SIGNALS");
    throw new Error("runtime shutdown failed");
  }, calls));

  const result = await sequence.run();
  assert.equal(result.phase, "FAILED");
  assert.equal(result.steps[0].status, "FAILED");
  assert.equal(calls.includes("COMPLETE_MARKER"), false);
});
