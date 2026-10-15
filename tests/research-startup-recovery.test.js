"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdtempSync, rmSync } = require("node:fs");
const storage = require("../dist/packages/storage/src/index.js");
const { ResearchRecoveryCoordinator } = require("../dist/apps/cloud/src/researchRecoveryCoordinator.js");
const { composeResearchExperiments } = require("../dist/apps/cloud/src/researchExperimentComposition.js");
const { SqliteCloudPaperAccountRepository, paperAccountIdForCapital } = require("../dist/apps/cloud/src/paperTradingExecutionLoop.js");
const runtime = require("../dist/apps/cloud/src/runtime.js");
const { startClosedLearningProductionRuntime } = require("../dist/apps/cloud/src/closedLearningProductionRuntime.js");
const env = {
  NUSA_CLOUD_RESEARCH_EXPERIMENTS: "1", NUSA_SOURCE_COMMIT: "b".repeat(40),
  NUSA_RESEARCH_INTERVAL_MINUTES: "1,15,60", NUSA_RESEARCH_BACKFILL: "DISABLED",
  NUSA_CLOUD_DASHBOARD_PORT: "41731", NUSA_CLOUD_DASHBOARD_TOKEN: "synthetic-test-only-not-a-credential".repeat(2),
  NUSA_CLOUD_STATE_DB_PATH: join(tmpdir(), "nusa-synthetic-startup-no-write", "state.sqlite"),
  NUSA_CLOUD_PAPER_INITIAL_CAPITAL_KRW: "10000000",
};

test("preparation never pauses running sessions; writer-held recovery still does", () => {
  const db = new storage.SqliteDatabase(":memory:");
  const composition = composeResearchExperiments({ env, database: db });
  const sessions = new storage.SqliteResearchSessionRepository(db);
  try {
    composition.orchestrator.recover();
    composition.tickOnce();
    const before = sessions.list();
    assert.ok(before.some((session) => session.state === "RUNNING"));
    composition.prepareRecovery();
    assert.deepEqual(sessions.list(), before);
    composition.orchestrator.recover();
    assert.ok(sessions.list().every((session) => session.state === "PAUSED"));
  } finally { composition.stop(); db.close(); }
});

test("external connection mutation invalidates prepared evidence rather than reusing READY", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nusa-startup-data-version-"));
  const db = new storage.SqliteDatabase(join(directory, "state.sqlite"));
  const other = new storage.SqliteDatabase(join(directory, "state.sqlite"));
  const original = ResearchRecoveryCoordinator.prototype.recover;
  let validations = 0;
  t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () {
    validations++;
    return validations === 1 ? original.call(this) : { status: "FAIL_CLOSED", snapshot: null, reasons: ["SYNTHETIC_CHANGED_EVIDENCE"] };
  });
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    other.connection.exec("CREATE TABLE synthetic_external_change (id INTEGER)");
    assert.equal(composition.orchestrator.recover().status, "FAIL_CLOSED");
    assert.equal(validations, 2);
    assert.equal(composition.orchestrator.tick().status, "RECOVERY_NOT_READY");
  } finally { composition.stop(); other.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("prepared read-only validation is shared only during startup; actual per-variant recovery still runs", (t) => {
  const db = new storage.SqliteDatabase(":memory:");
  const original = ResearchRecoveryCoordinator.prototype.recover;
  let validations = 0;
  t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () { validations++; return original.call(this); });
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    assert.equal(validations, 1);
    for (const orchestrator of composition.orchestrators) assert.equal(orchestrator.recover().status, "READY");
    assert.equal(validations, 1, "do not replay the same evidence for all thirty variants");
    composition.finishPreparedRecovery();
    assert.equal(composition.orchestrator.recover().status, "READY");
    assert.equal(validations, 11, "ordinary recovery revalidates all ten first-interval variants");
  } finally { composition.stop(); db.close(); }
});

test("failed prepared evidence remains fail-closed through real orchestrator and tick gates", (t) => {
  const db = new storage.SqliteDatabase(":memory:");
  const failure = Object.freeze({ status: "FAIL_CLOSED", snapshot: null, reasons: ["SYNTHETIC_CORRUPTION"] });
  let validations = 0;
  t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", () => { validations++; return failure; });
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    for (const orchestrator of composition.orchestrators) {
      assert.equal(orchestrator.recover(), failure);
      assert.equal(orchestrator.tick().status, "RECOVERY_NOT_READY");
    }
    assert.equal(validations, 1);
    composition.finishPreparedRecovery();
    assert.equal(composition.orchestrator.recover(), failure);
    assert.equal(validations, 2);
  } finally { composition.stop(); db.close(); }
});

for (const duringPreparation of [false, true]) {
  test(`same-connection corrupted champion invalidates READY (during preparation=${duringPreparation})`, (t) => {
    const db = new storage.SqliteDatabase(":memory:");
    const corrupt = () => db.connection.prepare("INSERT INTO research_champion_pointer (id, candidate_id, updated_at) VALUES (1, ?, ?)").run("synthetic-missing-champion", 1000);
    const original = ResearchRecoveryCoordinator.prototype.recover;
    let calls = 0;
    t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () {
      const result = original.call(this);
      if (++calls === 1 && duringPreparation) corrupt();
      return result;
    });
    const composition = composeResearchExperiments({ env, database: db });
    try {
      composition.prepareRecovery();
      if (!duringPreparation) corrupt();
      const result = composition.orchestrator.recover();
      assert.equal(result.status, "FAIL_CLOSED");
      assert.ok(result.reasons.includes("CHAMPION_POINTER_LIFECYCLE_MISMATCH"));
      assert.equal(composition.orchestrator.tick().status, "RECOVERY_NOT_READY");
      assert.equal(calls, 2);
    } finally { composition.stop(); db.close(); }
  });
}

test("start disposes prepared evidence before recurring recovery", (t) => {
  const db = new storage.SqliteDatabase(":memory:");
  const original = ResearchRecoveryCoordinator.prototype.recover;
  let calls = 0;
  t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () { calls++; return original.call(this); });
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    composition.orchestrator.recover();
    composition.start();
    assert.equal(calls, 1);
    composition.orchestrator.recover();
    assert.equal(calls, 11);
  } finally { composition.stop(); db.close(); }
});

for (const competingOwner of [false, true]) {
  test(`production validates before acquiring writer lease, without starting runtime (competing=${competingOwner})`, (t) => {
    const db = new storage.SqliteDatabase(":memory:");
    const accountId = paperAccountIdForCapital(10000000);
    let now = 1000000;
    t.mock.method(Date, "now", () => now);
    const owner = competingOwner ? new SqliteCloudPaperAccountRepository(db, { accountId, ownerId: "owner-a", now: () => now }) : undefined;
    const sessions = new storage.SqliteResearchSessionRepository(db);
    const setupResearch = composeResearchExperiments({ env, database: db, now: () => now });
    setupResearch.orchestrator.recover();
    setupResearch.tickOnce();
    const sessionsBefore = sessions.list();
    setupResearch.stop();
    const before = db.connection.prepare("SELECT * FROM cloud_paper_writer_leases").all();
    const original = ResearchRecoveryCoordinator.prototype.recover;
    let validations = 0;
    t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () {
      validations++;
      assert.deepEqual(db.connection.prepare("SELECT * FROM cloud_paper_writer_leases").all(), before);
      if (!competingOwner) now += 30001;
      return original.call(this);
    });
    t.mock.method(storage, "SqliteDatabase", function () { return db; });
    const boundary = new Error("SYNTHETIC_RUNTIME_BOUNDARY");
    let repository;
    t.mock.method(runtime, "startCloudRuntime", (...args) => {
      repository = args[5];
      repository.verifyWriterLease();
      assert.equal(args[9].recover().status, "READY");
      repository.verifyWriterLease();
      assert.equal(validations, 1, "legitimate writer/session writes must not replay evidence validation under the lease");
      throw boundary; // No listener, timers, market connection, or autonomous execution.
    });
    try {
      if (competingOwner) {
        assert.throws(() => startClosedLearningProductionRuntime(env), /PAPER_WRITER_ALREADY_ACTIVE/);
        assert.deepEqual(db.connection.prepare("SELECT * FROM cloud_paper_writer_leases").all(), before);
        assert.deepEqual(sessions.list(), sessionsBefore, "read-only preparation cannot disturb the current owner's sessions");
        assert.equal(repository, undefined);
      } else {
        assert.throws(() => startClosedLearningProductionRuntime(env), (error) => error === boundary);
        assert.equal(validations, 1);
        repository.verifyWriterLease();
      }
    } finally { repository?.close(); owner?.close(); db.close(); }
  });
}

for (const table of ["research_evaluation_ledger", "research_promotion_audit", "research_promotion_commands", "research_candidates"]) {
  test(`same-connection corruption of ${table} invalidates prepared evidence`, () => {
    const db = new storage.SqliteDatabase(":memory:");
    const composition = composeResearchExperiments({ env, database: db });
    try {
      composition.prepareRecovery();
      if (table === "research_evaluation_ledger") db.connection.exec("INSERT INTO research_evaluation_ledger VALUES (1, 'synthetic', 'bad', '{', 'bad')");
      else if (table === "research_promotion_audit") db.connection.exec("INSERT INTO research_promotion_audit VALUES (1, 'synthetic', 'bad', '{', 'bad')");
      else if (table === "research_candidates") db.connection.exec("INSERT INTO research_candidates VALUES ('synthetic', '{', 'DRAFT', 1, 'bad')");
      else db.connection.exec("INSERT INTO research_promotion_commands VALUES ('synthetic', 'bad', '{', 1)");
      assert.equal(composition.orchestrator.recover().status, "FAIL_CLOSED");
      assert.equal(composition.orchestrator.tick().status, "RECOVERY_NOT_READY");
    } finally { composition.stop(); db.close(); }
  });
}

for (const table of ["research_candidates", "research_promotion_commands"]) {
test(`NULL primary key in ${table} cannot evade SQLite change tracking`, () => {
  const db = new storage.SqliteDatabase(":memory:");
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    if (table === "research_candidates") db.connection.exec("INSERT INTO research_candidates VALUES (NULL, '{', 'DRAFT', 1, 'bad')");
    else db.connection.exec("INSERT INTO research_promotion_commands VALUES (NULL, 'bad', '{', 1)");
    assert.equal(composition.orchestrator.recover().status, "FAIL_CLOSED");
    assert.equal(composition.orchestrator.tick().status, "RECOVERY_NOT_READY");
  } finally { composition.stop(); db.close(); }
});

}

test("schema changes force fresh evidence validation", (t) => {
  const db = new storage.SqliteDatabase(":memory:");
  const original = ResearchRecoveryCoordinator.prototype.recover;
  let calls = 0;
  t.mock.method(ResearchRecoveryCoordinator.prototype, "recover", function () { calls++; return original.call(this); });
  const composition = composeResearchExperiments({ env, database: db });
  try {
    composition.prepareRecovery();
    db.connection.exec("CREATE TABLE synthetic_unrelated_schema (id INTEGER PRIMARY KEY)");
    assert.equal(composition.orchestrator.recover().status, "READY");
    assert.equal(calls, 2);
  } finally { composition.stop(); db.close(); }
});
