"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdtempSync, rmSync } = require("node:fs");
const retirement = require("../dist/apps/cloud/src/paperAccountRetirement.js");
const storage = require("../dist/packages/storage/src/index.js");
const runtime = require("../dist/apps/cloud/src/runtime.js");
const { SqliteCloudPaperAccountRepository } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { startClosedLearningProductionRuntime, CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS } = require("../dist/apps/cloud/src/closedLearningProductionRuntime.js");

// Regression for the failed release of 2026-11-15 (9a3e165c): with NUSA_PAPER_ORDER_PATH=OFF the cloud runtime creates no
// PAPER writer lease, but the real daemon entry (startClosedLearningProductionRuntime) still verified one at startup and
// crash-looped on PAPER_WRITER_LEASE_NOT_STARTED. tests/cloud-runtime-order-path-switch*.test.js never went through this
// entry, so they could not see it. This test does.
//
// Only the heavy runtime composition is replaced by a stand-in that behaves exactly like startCloudRuntime under the
// switch (startPaperRuntime starts the lease only when the order path is enabled, by the same exported rule). The daemon
// code under test (repository creation, lease verification, tick scheduling) is real.
const baseEnv = {
  NUSA_CLOUD_RESEARCH_EXPERIMENTS: "0", NUSA_SOURCE_COMMIT: "b".repeat(40),
  NUSA_RESEARCH_BACKFILL: "DISABLED", NUSA_CLOUD_DASHBOARD_PORT: "41731",
  NUSA_CLOUD_DASHBOARD_TOKEN: "synthetic-test-only-not-a-credential".repeat(2),
  NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
};

function harness(t, orderPath, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), "nusa-daemon-order-path-"));
  const db = new storage.SqliteDatabase(":memory:");
  const state = { verifyCalls: 0, leaseStarts: 0, repositoryHandedToRuntime: undefined, runtimeStopped: 0, timers: [] };
  // Record every timer the daemon registers (nothing really fires): the closed-learning tick is the 0 ms timeout plus the
  // interval with the rollover poll period.
  const fakeHandle = () => ({ unref() { return this; }, ref() { return this; }, hasRef() { return false; } });
  t.mock.method(globalThis, "setTimeout", (fn, ms) => { state.timers.push({ api: "setTimeout", ms: ms ?? 0, fn }); return fakeHandle(); });
  t.mock.method(globalThis, "setInterval", (fn, ms) => { state.timers.push({ api: "setInterval", ms, fn }); return fakeHandle(); });
  t.mock.method(globalThis, "clearTimeout", () => {});
  t.mock.method(globalThis, "clearInterval", () => {});
  const realVerify = SqliteCloudPaperAccountRepository.prototype.verifyWriterLease;
  const realStart = SqliteCloudPaperAccountRepository.prototype.startWriterLease;
  t.mock.method(storage, "SqliteDatabase", function () { return db; });
  t.mock.method(SqliteCloudPaperAccountRepository.prototype, "verifyWriterLease", function () { state.verifyCalls++; return realVerify.call(this); });
  t.mock.method(SqliteCloudPaperAccountRepository.prototype, "startWriterLease", function () { state.leaseStarts++; return realStart.call(this); });
  t.mock.method(runtime, "startCloudRuntimeFromOptions", (options) => {
    state.repositoryHandedToRuntime = options.paperAccountRepository;
    return {
      startPaperRuntime: () => {
        if (orderPath !== "ON") return; // the documented rule; the last test pins runtime.isPaperOrderPathEnabled to it
        options.paperAccountRepository?.startWriterLease();
      },
      recoverResearch: () => {},
      stop: async () => { state.runtimeStopped++; },
      listPaperRealizedPeriods: () => [],
      nextPaperRealizedPeriodIndex: () => 0,
    };
  });
  const env = { ...baseEnv, NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"), ...(orderPath === undefined ? {} : { NUSA_PAPER_ORDER_PATH: orderPath }), ...extraEnv };
  return { env, db, state, directory, cleanup: () => { state.repositoryHandedToRuntime?.close?.(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

for (const value of [undefined, "OFF", "off", "false", "0", ""]) {
  test(`daemon entry starts without a writer lease when NUSA_PAPER_ORDER_PATH=${value === undefined ? "UNSET (fail closed)" : JSON.stringify(value)}`, async (t) => {
    const h = harness(t, value);
    try {
      const composition = startClosedLearningProductionRuntime(h.env);
      assert.equal(h.state.repositoryHandedToRuntime, undefined, "no PAPER repository is handed to the runtime");
      assert.equal(h.state.leaseStarts, 0, "no writer lease is started");
      assert.equal(h.state.verifyCalls, 0, "no writer lease is verified (this is what crashed the 2026-11-15 release)");
      assert.equal(h.db.connection.prepare("SELECT account_id FROM cloud_paper_writer_leases").get(), undefined, "no lease row exists");
      await composition.handle.stop();
      assert.equal(h.state.runtimeStopped, 1);
    } finally { h.cleanup(); }
  });
}

const tickTimers = (state) => state.timers.filter((x) => (x.api === "setTimeout" && x.ms === 0) || (x.api === "setInterval" && x.ms === CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS));

test("OFF does not schedule the closed-learning tick (neither the 0 ms timeout nor the rollover interval)", async (t) => {
  const h = harness(t, "OFF");
  try {
    const composition = startClosedLearningProductionRuntime(h.env);
    assert.deepEqual(tickTimers(h.state).map((x) => [x.api, x.ms]), [], "no closed-learning timer is registered");
    assert.equal(h.state.verifyCalls, 0);
    await composition.handle.stop();
  } finally { h.cleanup(); }
});

// Baseline MEASURED on the pre-fix daemon entry (origin/main, 9a3e165c) with this same harness: 7 lease verifications during
// startup (3 inside the lease start, 4 between the runtime phases; same number as tests/research-startup-recovery.test.js).
// The fixed entry must produce exactly the same number when the order path is ON or unset.
const EXPECTED_VERIFY_CALLS_ON = 7;
for (const value of ["ON"]) {
  test(`control: the order path ON still acquires and verifies the writer lease, and schedules both timers`, async (t) => {
    const h = harness(t, value);
    try {
      const composition = startClosedLearningProductionRuntime(h.env);
      assert.ok(h.state.repositoryHandedToRuntime, "the PAPER repository is handed to the runtime");
      assert.equal(h.state.leaseStarts, 1, "the writer lease is started exactly once");
      assert.equal(h.state.verifyCalls, EXPECTED_VERIFY_CALLS_ON, "exactly the pre-fix number of lease verifications during startup");
      assert.ok(h.db.connection.prepare("SELECT account_id FROM cloud_paper_writer_leases").get(), "the lease row exists");
      assert.deepEqual(tickTimers(h.state).map((x) => [x.api, x.ms]), [["setTimeout", 0], ["setInterval", CLOSED_LEARNING_ROLLOVER_POLL_INTERVAL_MS]], "exactly the two pre-fix closed-learning timers are registered");
      const before = h.state.verifyCalls;
      tickTimers(h.state)[0].fn();
      assert.ok(h.state.verifyCalls > before, "the registered initial timer starts a tick, which verifies the lease first");
      await composition.handle.stop();
    } finally { h.cleanup(); }
  });
}

test("OFF performs no PAPER account mutation: the legacy account retirement is skipped, the control still runs it", async (t) => {
  const retiredEnv = { NUSA_PAPER_RETIRED_ACCOUNT_IDS: "paper-legacy" };
  const off = harness(t, "OFF", retiredEnv);
  // The real table already exists (created by the storage migrations); put a row for the retired account in it.
  off.db.connection.prepare("INSERT INTO cloud_paper_accounts (account_id, schema_version, updated_at, state_json, checksum, status) VALUES (?, 1, 1, '{}', 'x', 'VALID')").run("paper-legacy");
  const retireCalls = [];
  const realRetire = retirement.retirePaperAccounts;
  t.mock.method(retirement, "retirePaperAccounts", (...args) => { retireCalls.push(args[1]); return realRetire(...args); });
  try {
    const composition = startClosedLearningProductionRuntime(off.env);
    assert.deepEqual(retireCalls, [], "OFF never calls retirePaperAccounts");
    assert.equal(off.db.connection.prepare("SELECT COUNT(*) AS n FROM cloud_paper_accounts WHERE account_id = 'paper-legacy'").get().n, 1, "the legacy account row is untouched");
    await composition.handle.stop();
  } finally { off.cleanup(); }
});

test("control: with the order path ON the legacy account retirement still runs", async (t) => {
  const on = harness(t, "ON", { NUSA_PAPER_RETIRED_ACCOUNT_IDS: "paper-legacy" });
  const retireCalls = [];
  t.mock.method(retirement, "retirePaperAccounts", (...args) => { retireCalls.push(args[1]); return []; });
  try {
    const composition = startClosedLearningProductionRuntime(on.env);
    assert.deepEqual(retireCalls, [["paper-legacy"]], "ON retires exactly the listed account, as before");
    await composition.handle.stop();
  } finally { on.cleanup(); }
});

test("OFF: the exposed closed-learning functions refuse to run (they cannot mutate PAPER or ledger state)", async (t) => {
  const h = harness(t, "OFF");
  try {
    const c = startClosedLearningProductionRuntime(h.env);
    for (const name of ["runClosedLearningCycle", "runClosedLearningBootstrap", "runClosedLearningRollover"]) {
      assert.throws(() => c[name]({}), /PAPER_ORDER_PATH_OFF/, name);
    }
    for (const name of ["runClosedLearningCycleAsync", "runClosedLearningBootstrapAsync", "runClosedLearningRolloverAsync"]) {
      await assert.rejects(() => c[name]({}), /PAPER_ORDER_PATH_OFF/, name);
    }
    assert.throws(() => c.evaluatePaperGovernanceFeedback({ periodId: "p", now: 1, identity: {}, votes: [] }), /PAPER_ORDER_PATH_OFF/);
    assert.throws(() => c.readPaperPerformanceEvidence("p"), /PAPER_PERFORMANCE_DURABLE_HISTORY_UNAVAILABLE/);
    assert.equal(c.readCanonicalPaperAccount(), undefined);
    await c.handle.stop();
  } finally { h.cleanup(); }
});

test("the switch rule is one function shared by both entry points", () => {
  assert.equal(runtime.isPaperOrderPathEnabled({}), false, "unset fails closed");
  assert.equal(runtime.isPaperOrderPathEnabled({ NUSA_PAPER_ORDER_PATH: "ON" }), true);
  assert.equal(runtime.effectiveRunMode({}), "COLLECT_ONLY");
  assert.equal(runtime.effectiveRunMode({ NUSA_PAPER_ORDER_PATH: "ON" }), "PAPER_ORDERS");
  for (const v of ["OFF", "off", "On", "true", "1", "", " ON", "ON "]) assert.equal(runtime.isPaperOrderPathEnabled({ NUSA_PAPER_ORDER_PATH: v }), false, JSON.stringify(v));
});
