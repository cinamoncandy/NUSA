"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdtempSync, rmSync } = require("node:fs");
const storage = require("../dist/packages/storage/src/index.js");
const runtime = require("../dist/apps/cloud/src/runtime.js");
const { SqliteCloudPaperAccountRepository } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const { startClosedLearningProductionRuntime } = require("../dist/apps/cloud/src/closedLearningProductionRuntime.js");

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

function harness(t, orderPath) {
  const directory = mkdtempSync(join(tmpdir(), "nusa-daemon-order-path-"));
  const db = new storage.SqliteDatabase(":memory:");
  const state = { verifyCalls: 0, leaseStarts: 0, repositoryHandedToRuntime: undefined, runtimeStopped: 0 };
  const realVerify = SqliteCloudPaperAccountRepository.prototype.verifyWriterLease;
  const realStart = SqliteCloudPaperAccountRepository.prototype.startWriterLease;
  t.mock.method(storage, "SqliteDatabase", function () { return db; });
  t.mock.method(SqliteCloudPaperAccountRepository.prototype, "verifyWriterLease", function () { state.verifyCalls++; return realVerify.call(this); });
  t.mock.method(SqliteCloudPaperAccountRepository.prototype, "startWriterLease", function () { state.leaseStarts++; return realStart.call(this); });
  t.mock.method(runtime, "startCloudRuntimeFromOptions", (options) => {
    state.repositoryHandedToRuntime = options.paperAccountRepository;
    return {
      startPaperRuntime: () => {
        if (!runtime.isPaperOrderPathEnabled({ ...baseEnv, ...(orderPath === undefined ? {} : { NUSA_PAPER_ORDER_PATH: orderPath }) })) return;
        options.paperAccountRepository?.startWriterLease();
      },
      recoverResearch: () => {},
      stop: async () => { state.runtimeStopped++; },
      listPaperRealizedPeriods: () => [],
      nextPaperRealizedPeriodIndex: () => 0,
    };
  });
  const env = { ...baseEnv, NUSA_CLOUD_STATE_DB_PATH: join(directory, "state.sqlite"), ...(orderPath === undefined ? {} : { NUSA_PAPER_ORDER_PATH: orderPath }) };
  return { env, db, state, directory, cleanup: () => { state.repositoryHandedToRuntime?.close?.(); db.close(); rmSync(directory, { recursive: true, force: true }); } };
}

for (const value of ["OFF", "off", "false", "0", ""]) {
  test(`daemon entry starts without a writer lease when NUSA_PAPER_ORDER_PATH=${JSON.stringify(value)}`, async (t) => {
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

test("OFF does not schedule the closed-learning tick (no timer fires)", async (t) => {
  const h = harness(t, "OFF");
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const composition = startClosedLearningProductionRuntime(h.env);
    t.mock.timers.tick(10 * 60 * 1000);
    assert.equal(h.state.verifyCalls, 0, "a scheduled tick would have verified the lease");
    await composition.handle.stop();
  } finally { h.cleanup(); }
});

for (const value of [undefined, "ON"]) {
  test(`control: the order path ${value === undefined ? "unset" : "ON"} still acquires and verifies the writer lease`, async (t) => {
    const h = harness(t, value);
    try {
      const composition = startClosedLearningProductionRuntime(h.env);
      assert.ok(h.state.repositoryHandedToRuntime, "the PAPER repository is handed to the runtime");
      assert.equal(h.state.leaseStarts, 1, "the writer lease is started exactly once");
      assert.ok(h.state.verifyCalls >= 5, "the startup renewals still run");
      assert.ok(h.db.connection.prepare("SELECT account_id FROM cloud_paper_writer_leases").get(), "the lease row exists");
      await composition.handle.stop();
    } finally { h.cleanup(); }
  });
}

test("the switch rule is one function shared by both entry points", () => {
  assert.equal(runtime.isPaperOrderPathEnabled({}), true);
  assert.equal(runtime.isPaperOrderPathEnabled({ NUSA_PAPER_ORDER_PATH: "ON" }), true);
  for (const v of ["OFF", "off", "On", "true", "1", "", " ON", "ON "]) assert.equal(runtime.isPaperOrderPathEnabled({ NUSA_PAPER_ORDER_PATH: v }), false, JSON.stringify(v));
});
