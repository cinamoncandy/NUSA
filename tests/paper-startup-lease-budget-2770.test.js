const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync, StatementSync } = require("node:sqlite");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { SqliteAiCalibrationDurableStore } = require("../dist/packages/storage/src/aiCalibrationDurability.js");
const { SqliteAiOutcomeAttributionMemory } = require("../dist/packages/storage/src/aiOutcomeAttributionMemory.js");
const { CloudPaperCanonicalRiskGateway, CLOUD_PAPER_RISK_LIMITS } = require("../dist/apps/cloud/src/cloudPaperCanonicalRiskGateway.js");

// #2770 startup lease budget. Two defects shared one mechanism: work that re-reads the whole
// database while the renewable PAPER writer lease is held, starving its heartbeat, and work that
// repeated a full integrity scan on every risk evaluation. These pin the ordering and prove the
// hot path no longer performs a full-file scan -- while the canonical scan at open is retained.

const root = path.resolve(__dirname, "..");
const runtimeSource = fs.readFileSync(path.join(root, "apps", "cloud", "src", "closedLearningProductionRuntime.ts"), "utf8");
const storageSource = fs.readFileSync(path.join(root, "packages", "storage", "src", "index.ts"), "utf8");
const aiCalibrationSource = fs.readFileSync(path.join(root, "packages", "storage", "src", "aiCalibrationDurability.ts"), "utf8");
const aiAttributionSource = fs.readFileSync(path.join(root, "packages", "storage", "src", "aiOutcomeAttributionMemory.ts"), "utf8");
const riskGatewaySource = fs.readFileSync(path.join(root, "apps", "cloud", "src", "cloudPaperCanonicalRiskGateway.ts"), "utf8");
const readinessSource = fs.readFileSync(path.join(root, "scripts", "oracle-readiness-check.js"), "utf8");

const NOW = Date.parse("2026-10-01T12:00:00Z");

const REQUIRED_RISK_TABLES = ["risk_paper_approvals", "risk_daily_loss_state", "risk_idempotency_records", "risk_order_state"];

/** Counts every statement the module prepares while `body` runs, without changing any behaviour. */
function countPreparedStatements(body) {
  const counts = { quickCheck: 0, fullQuickCheck: 0, statements: [] };
  // Observe executed statements, not DatabaseSync.prototype.prepare. The startup integrity issuer
  // deliberately keeps calling the native prepare it captured at module load, so a prepare-level
  // counter would sit on the mutable slot that security fix stopped consulting and report zero
  // scans for exactly the paths this file must prove. StatementSync exposes the original SQL, so
  // every count below still attributes to the real PRAGMA SQLite ran.
  const record = (statement) => {
    const sql = String(statement.sourceSQL ?? "");
    counts.statements.push(sql);
    if (/quick_check/i.test(sql)) counts.quickCheck += 1;
    if (/^\s*PRAGMA\s+quick_check\s*$/i.test(sql)) counts.fullQuickCheck += 1;
  };
  const originalGet = StatementSync.prototype.get;
  const originalAll = StatementSync.prototype.all;
  StatementSync.prototype.get = function countedGet(...args) {
    record(this);
    return originalGet.apply(this, args);
  };
  StatementSync.prototype.all = function countedAll(...args) {
    record(this);
    return originalAll.apply(this, args);
  };
  try {
    body();
  } finally {
    StatementSync.prototype.get = originalGet;
    StatementSync.prototype.all = originalAll;
  }
  return counts;
}

function baseState() {
  return {
    version: 1,
    initialCapital: 100_000,
    cash: 99_997,
    equity: 99_997,
    realizedPnL: -3,
    unrealizedPnL: 0,
    positions: [],
    orders: [],
    fills: [],
    processedIdempotencyKeys: [],
    updatedAt: NOW,
  };
}

function request(state) {
  return {
    path: "STRATEGY",
    commandId: "next",
    signalId: "next",
    clientOrderId: "next",
    strategyId: "bound-candidate",
    market: "KRW-BTC",
    side: "BUY",
    quantity: 1,
    price: 100,
    now: NOW,
    observedAt: NOW,
    maximumMarketAgeMs: 30_000,
    killSwitchActive: false,
    openP0: false,
    overallHealth: "HEALTHY",
    state,
  };
}

function gatewayFor(database) {
  return new CloudPaperCanonicalRiskGateway({
    database,
    initialCapital: 100_000,
    sourceCommitSha: "a".repeat(40),
    limits: { ...CLOUD_PAPER_RISK_LIMITS, maxOrdersPerMinute: 1_000, maxOrdersPerSecond: 1_000 },
  });
}

// ---- startup ordering ------------------------------------------------------------------------

// Cloud AI durability before the lease is asserted by tests/paper-writer-lease-liveness.test.js
// (merged #2779), which also pins the runtime composition argument. What that test does not cover
// is the third link in the same chain: the closed-learning scheduler must not start ticking until
// the runtime it schedules against is up behind the lease.
test("the listener and the scheduler both start only after the writer lease is held", () => {
  const lease = runtimeSource.indexOf("new SqliteCloudPaperAccountRepository(");
  const listener = runtimeSource.indexOf("startCloudRuntime(");
  const scheduler = runtimeSource.indexOf("rolloverTimer = setInterval(scheduleTick,");
  assert.ok(lease > 0 && listener > lease, "the runtime/listener must not come up before the lease is owned");
  assert.ok(scheduler > listener, "the closed-learning scheduler must start after the runtime it is scheduled against");
});

// ---- risk hot path ---------------------------------------------------------------------------

test("a PAPER risk evaluation prepares no full-file integrity scan", () => {
  const database = new SqliteDatabase(":memory:");
  try {
    // The gateway is constructed outside the counter: only the per-evaluation path is under test.
    const gateway = gatewayFor(database);
    gateway.evaluate(request(baseState()));
    const counts = countPreparedStatements(() => {
      gateway.evaluate(request(baseState()));
    });
    assert.equal(counts.quickCheck, 0, "PRAGMA quick_check must not run on the per-evaluation hot path");
    assert.ok(counts.statements.length > 0, "the evaluation must still probe the connection and required tables");
  } finally {
    database.close();
  }
});

test("the risk hot path still fails closed when a required Risk table is missing", () => {
  const database = new SqliteDatabase(":memory:");
  try {
    assert.deepEqual(REQUIRED_RISK_TABLES.filter((table) => database.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) == null), [], "fixture must start with every required Risk table");
    database.connection.exec("DROP TABLE risk_order_state");
    const result = gatewayFor(database).evaluate(request(baseState()));
    assert.notEqual(result.status, "ALLOW", "an incomplete Risk store must never approve an order");
    assert.equal(result.status, "HALT");
  } finally {
    database.close();
  }
});

test("the risk hot path fails closed when the canonical connection is unusable", () => {
  const database = new SqliteDatabase(":memory:");
  const gateway = gatewayFor(database);
  database.close();
  let result;
  try {
    result = gateway.evaluate(request(baseState()));
  } catch (error) {
    assert.fail(`a broken connection must return a halt, not throw: ${error instanceof Error ? error.message : "unknown"}`);
  }
  assert.notEqual(result.status, "ALLOW", "an unreadable store must never approve an order");
  assert.ok(result.reasonCodes.includes("PERSISTENCE_UNHEALTHY"), `expected a persistence reason, got ${JSON.stringify(result.reasonCodes)}`);
});

test("the canonical database open still performs the full integrity scan", () => {
  const counts = countPreparedStatements(() => {
    const database = new SqliteDatabase(":memory:");
    database.close();
  });
  assert.ok(counts.quickCheck >= 1, "the once-per-open full PRAGMA quick_check is a safety property and must remain");
  assert.match(storageSource, /prepare\("PRAGMA quick_check"\)/);
  assert.match(riskGatewaySource, /SELECT 1 AS ready/);
  assert.ok(!/prepare\("PRAGMA quick_check"\)/.test(riskGatewaySource.split("function databaseHealthy")[1] ?? ""), "databaseHealthy must not reintroduce a full scan");
});



test("production AI stores share the one canonical full-scan connection and keep four scoped checks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-shared-"));
  const filename = path.join(dir, "state.sqlite");
  let database;
  let calibration;
  let attribution;
  try {
    const counts = countPreparedStatements(() => {
      database = new SqliteDatabase(filename);
      calibration = new SqliteAiCalibrationDurableStore(filename, database.connection);
      attribution = new SqliteAiOutcomeAttributionMemory(filename, database.connection);
    });
    assert.equal(counts.fullQuickCheck, 1, `expected exactly one canonical full scan, got ${JSON.stringify(counts.statements)}`);
    assert.equal(counts.quickCheck, 5, `expected one full plus four store-scoped checks, got ${JSON.stringify(counts.statements)}`);
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_calibration_durability_meta'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_calibration_durability_events'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_outcome_attribution_memory_meta'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_outcome_attribution_memory_events'\)/i.test(sql)));
    assert.match(runtimeSource, /verifiedSharedSqliteConnection:\s*database\.connection/);
    assert.doesNotMatch(runtimeSource, /startupIntegrityAttestation/);
  } finally {
    attribution?.close();
    calibration?.close();
    // Shared-store close must not close the canonical connection.
    if (database != null) {
      assert.equal(database.connection.prepare("SELECT 1 AS ready").get()?.ready, 1);
      database.close();
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pathname input cannot redirect a shared AI store away from the verified canonical connection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-path-replace-"));
  const filename = path.join(dir, "state.sqlite");
  const decoyPath = path.join(dir, "decoy.sqlite");
  const moved = path.join(dir, "verified.sqlite");
  let database;
  let replacement;
  let calibration;
  try {
    database = new SqliteDatabase(filename);

    // A caller-controlled filename is ignored when the exact verified connection is supplied.
    // This is platform-independent and directly pins the production composition contract.
    calibration = new SqliteAiCalibrationDurableStore(decoyPath, database.connection);
    assert.equal(fs.existsSync(decoyPath), false, "shared mode must not open or create the supplied pathname");
    assert.equal(
      database.connection.prepare(
        "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='ai_calibration_durability_events'"
      ).get()?.present,
      1,
      "shared store must initialize on the already-verified canonical connection",
    );
    calibration.close();
    calibration = undefined;

    if (process.platform === "win32") {
      // Windows does not permit renaming an open SQLite file. Prove the OS rejects the exact race
      // rather than treating that platform difference as a test failure. The decoy assertion above
      // still proves shared mode ignores caller-supplied paths on every platform.
      assert.throws(
        () => fs.renameSync(filename, moved),
        (error) => error != null && typeof error === "object" && ["EBUSY", "EPERM", "EACCES"].includes(error.code),
        "Windows must keep the opened canonical file from being replaced underneath the connection",
      );
      return;
    }

    // POSIX permits rename of an open file. Replace the old pathname and prove the shared store
    // still writes only through the already-open, already-verified canonical connection.
    fs.renameSync(filename, moved);
    replacement = new DatabaseSync(filename);
    replacement.exec("CREATE TABLE replacement_only(id INTEGER PRIMARY KEY)");
    calibration = new SqliteAiCalibrationDurableStore(filename, database.connection);

    const replacementHasAiTable = replacement.prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name='ai_calibration_durability_events'"
    ).get();
    assert.equal(replacementHasAiTable, undefined, "a new file at the old pathname must not receive shared-store writes or scoped integrity trust");
  } finally {
    calibration?.close();
    replacement?.close();
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("standalone AI durability stores retain their fail-closed full-file scans", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-standalone-"));
  try {
    const calibrationCounts = countPreparedStatements(() => {
      const store = new SqliteAiCalibrationDurableStore(path.join(dir, "calibration.sqlite"));
      store.close();
    });
    assert.equal(calibrationCounts.fullQuickCheck, 1);

    const attributionCounts = countPreparedStatements(() => {
      const store = new SqliteAiOutcomeAttributionMemory(path.join(dir, "attribution.sqlite"));
      store.close();
    });
    assert.equal(attributionCounts.fullQuickCheck, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the readiness probe the release gate depends on stays bounded", () => {
  // Same reasoning as the risk hot path: the readiness loop runs on a deadline and a full-file
  // scan would consume the startup budget it is supposed to measure.
  assert.match(readinessSource, /probeListener/);
  assert.match(readinessSource, /classifyStartupPhase/);
  assert.equal(readinessSource.split("Date.now() + startupWaitMs").length - 1, 1, "one absolute startup deadline only");
});
