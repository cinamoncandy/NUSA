const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync, StatementSync } = require("node:sqlite");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { verifyAndIssueSqliteStartupIntegrity, assertSqliteStartupIntegrity } = require("../dist/packages/storage/src/sqliteStartupIntegrity.js");
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
const startupIntegritySource = fs.readFileSync(path.join(root, "packages", "storage", "src", "sqliteStartupIntegrity.ts"), "utf8");
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
  assert.match(storageSource, /verifyAndIssueSqliteStartupIntegrity/);
  assert.match(startupIntegritySource, /PRAGMA quick_check/);
  assert.match(riskGatewaySource, /SELECT 1 AS ready/);
  assert.ok(!/prepare\("PRAGMA quick_check"\)/.test(riskGatewaySource.split("function databaseHealthy")[1] ?? ""), "databaseHealthy must not reintroduce a full scan");
});



test("file-backed shared AI integrity checks do not trust the mutable application-realm prepare", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-integrity-"));
  const filename = path.join(dir, "state.sqlite");
  const nativePrepare = DatabaseSync.prototype.prepare;
  let database;
  let calibration;
  let attribution;
  try {
    DatabaseSync.prototype.prepare = function guardedPrepare(sql) {
      if (/quick_check|database_list/i.test(String(sql))) {
        throw new Error("application-realm prepare must not own file-backed integrity attestation");
      }
      return nativePrepare.call(this, sql);
    };
    database = new SqliteDatabase(filename);
    calibration = new SqliteAiCalibrationDurableStore(filename, database.startupIntegrityAttestation);
    attribution = new SqliteAiOutcomeAttributionMemory(filename, database.startupIntegrityAttestation);
    assert.match(startupIntegritySource, /spawnSync\(process\.execPath/);
    assert.match(startupIntegritySource, /readOnly: true/);
    assert.match(aiCalibrationSource, /assertSqliteStartupIntegrity/);
    assert.match(aiAttributionSource, /assertSqliteStartupIntegrity/);
  } finally {
    DatabaseSync.prototype.prepare = nativePrepare;
    attribution?.close();
    calibration?.close();
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a canonical integrity attestation never suppresses the full scan for a different file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-mismatch-"));
  const canonicalPath = path.join(dir, "canonical.sqlite");
  const otherPath = path.join(dir, "other.sqlite");
  let database;
  let other;
  try {
    database = new SqliteDatabase(canonicalPath);
    other = new DatabaseSync(otherPath);
    other.exec("CREATE TABLE unrelated_integrity_table(id INTEGER PRIMARY KEY)");
    assert.doesNotThrow(
      () => assertSqliteStartupIntegrity(
        other,
        otherPath,
        database.startupIntegrityAttestation,
        ["definitely_missing_attested_table"],
        "sqlite quick_check failed",
      ),
      "a different inode must ignore the scoped table list and perform a full-file fallback",
    );
  } finally {
    other?.close();
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a canonical integrity attestation never suppresses the full scan for a file swapped in at the same path", () => {
  // A pathname is not file identity. On POSIX the canonical database can be renamed away after the
  // startup scan and a different file placed at the original path before a store opens, and both
  // connections would then report the same database_list path while reading different files. The
  // proof has to follow the file that was actually scanned, not the address it was scanned through.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-swapped-"));
  const canonicalPath = path.join(dir, "canonical.sqlite");
  let database;
  let replacement;
  try {
    const seed = new DatabaseSync(canonicalPath);
    seed.exec("CREATE TABLE unrelated_integrity_table(id INTEGER PRIMARY KEY)");
    seed.close();

    database = new SqliteDatabase(canonicalPath);
    const attestation = database.startupIntegrityAttestation;
    database.close();
    database = undefined;

    fs.renameSync(canonicalPath, path.join(dir, "canonical.sqlite.scanned"));
    replacement = new DatabaseSync(canonicalPath);
    replacement.exec("CREATE TABLE unrelated_integrity_table(id INTEGER PRIMARY KEY)");
    assert.doesNotThrow(
      () => assertSqliteStartupIntegrity(
        replacement,
        canonicalPath,
        attestation,
        ["definitely_missing_attested_table"],
        "sqlite quick_check failed",
      ),
      "a file swapped in at the same path must ignore the scoped table list and run a full-file scan",
    );
  } finally {
    replacement?.close();
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a forged structural attestation cannot suppress the full-file scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-forged-"));
  const filename = path.join(dir, "forged.sqlite");
  const connection = new DatabaseSync(filename);
  try {
    connection.exec("CREATE TABLE unrelated_integrity_table(id INTEGER PRIMARY KEY)");
    const forged = { hasVerifiedFullIntegrityFor: () => true };
    assert.doesNotThrow(
      () => assertSqliteStartupIntegrity(
        connection,
        filename,
        forged,
        ["definitely_missing_attested_table"],
        "sqlite quick_check failed",
      ),
      "an unregistered proof must take the full-file path, not trusted scoped checks",
    );
  } finally {
    connection.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a forged structural SQLite connection cannot mint proof for an unverified file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-forged-issuer-"));
  const filename = path.join(dir, "not-sqlite.db");
  fs.writeFileSync(filename, "not a sqlite database");
  const fake = {
    prepare() {
      return {
        get() { return { quick_check: "ok" }; },
        all() { return [{ name: "main", file: filename }]; },
      };
    },
  };
  try {
    assert.throws(
      () => verifyAndIssueSqliteStartupIntegrity(fake, filename, "sqlite quick_check failed"),
      /sqlite quick_check failed/,
      "proof issuance must depend on the independently scanned file, not a structural connection",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a replaced application-realm prepare cannot forge file-backed attestation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-replaced-prepare-"));
  const filename = path.join(dir, "not-sqlite.db");
  fs.writeFileSync(filename, "not a sqlite database");
  const nativePrepare = DatabaseSync.prototype.prepare;
  try {
    DatabaseSync.prototype.prepare = function permissive(sql) {
      return /database_list/i.test(String(sql))
        ? { all: () => [{ seq: 0, name: "main", file: filename }] }
        : { get: () => ({ quick_check: "ok" }) };
    };
    assert.throws(
      () => verifyAndIssueSqliteStartupIntegrity({ prepare: () => ({}) }, filename, "sqlite quick_check failed"),
      /sqlite quick_check failed/,
      "the application realm cannot forge the independent file-backed integrity scan",
    );
  } finally {
    DatabaseSync.prototype.prepare = nativePrepare;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a conditional prepare replacement installed before module load cannot forge attestation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-conditional-load-"));
  const filename = path.join(dir, "not-sqlite.db");
  fs.writeFileSync(filename, "not a sqlite database");
  const modulePath = require.resolve("../dist/packages/storage/src/sqliteStartupIntegrity.js");
  const script = [
    'const { DatabaseSync } = require("node:sqlite");',
    'DatabaseSync.prototype.prepare = function conditional(sql) {',
    '  if (Object.getPrototypeOf(this) === null) throw new TypeError("Illegal invocation");',
    `  return /database_list/i.test(String(sql)) ? { all: () => [{ seq: 0, name: "main", file: ${JSON.stringify(filename)} }] } : { get: () => ({ quick_check: "ok" }) };`,
    '};',
    `const { verifyAndIssueSqliteStartupIntegrity } = require(${JSON.stringify(modulePath)});`,
    'let rejected = false;',
    `try { verifyAndIssueSqliteStartupIntegrity({}, ${JSON.stringify(filename)}, "sqlite quick_check failed"); } catch { rejected = true; }`,
    'if (!rejected) process.exit(17);',
  ].join("\n");
  try {
    const child = require("node:child_process").spawnSync(process.execPath, ["-e", script], {
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    assert.equal(child.status, 0, `conditional pre-load replacement forged an attestation: ${child.stderr || child.stdout}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("standalone file-backed AI stores retain fail-closed full-file scans outside mutable prepare", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-standalone-"));
  const nativePrepare = DatabaseSync.prototype.prepare;
  try {
    DatabaseSync.prototype.prepare = function guardedPrepare(sql) {
      if (/quick_check|database_list/i.test(String(sql))) {
        throw new Error("application-realm prepare must not own file-backed full scan");
      }
      return nativePrepare.call(this, sql);
    };
    const calibration = new SqliteAiCalibrationDurableStore(path.join(dir, "calibration.sqlite"));
    calibration.close();
    const attribution = new SqliteAiOutcomeAttributionMemory(path.join(dir, "attribution.sqlite"));
    attribution.close();
  } finally {
    DatabaseSync.prototype.prepare = nativePrepare;
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
