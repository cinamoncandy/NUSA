const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync, StatementSync } = require("node:sqlite");
const storage = require("../dist/packages/storage/src/index.js");
const { SqliteDatabase } = storage;
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
  assert.match(storageSource, /prepareSqliteIntegrityStatement\(this\.connection, "PRAGMA quick_check"\)/);
  assert.match(storageSource, /const nativeDatabasePrepare = DatabaseSync\.prototype\.prepare/);
  assert.match(riskGatewaySource, /SELECT 1 AS ready/);
  assert.ok(!/prepare\("PRAGMA quick_check"\)/.test(riskGatewaySource.split("function databaseHealthy")[1] ?? ""), "databaseHealthy must not reintroduce a full scan");
});

test("a fabricated quick_check ok cannot register a corrupt canonical connection", () => {
  // Complements the prototype-replacement regression above, which proves the forged slot is never
  // consulted: this proves the genuine captured-native scan's verdict actually gates registration.
  // Corrupting the final page leaves the startup migration read intact (it only touches early
  // pages) while the canonical full-file scan reads every page and must fail closed -- even while
  // the writable DatabaseSync.prototype.prepare slot is promising `ok`. AGENTS.md: fail closed when
  // persistence is uncertain.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-corrupt-"));
  const filename = path.join(dir, "state.sqlite");
  const originalPrepare = DatabaseSync.prototype.prepare;
  let canonicalSlotConsulted = 0;
  let database;
  let leaked;
  try {
    database = new SqliteDatabase(filename);
    database.close();
    database = null;

    const size = fs.statSync(filename).size;
    assert.ok(size >= 8192, `fixture must be large enough to corrupt a non-migration page, got ${size} bytes`);
    const fd = fs.openSync(filename, "r+");
    fs.writeSync(fd, Buffer.alloc(4096, 0xaa), 0, 4096, size - 4096);
    fs.closeSync(fd);

    DatabaseSync.prototype.prepare = function forgedPrepare(sql, ...rest) {
      if (String(sql).trim() === "PRAGMA quick_check") {
        canonicalSlotConsulted += 1;
        return { get: () => ({ quick_check: "ok" }) };
      }
      return originalPrepare.call(this, sql, ...rest);
    };

    assert.throws(
      () => {
        // Captured so a wrongly successful open is still closed and never masks the assertion.
        leaked = new SqliteDatabase(filename);
      },
      /quick_check failed|malformed|not a database|corrupt/i,
      "a corrupt canonical file must fail closed even while the writable prepare slot fabricates ok",
    );
    assert.equal(
      canonicalSlotConsulted,
      0,
      "the corrupt file must be rejected by the genuine captured-native scan, not by consulting the writable slot",
    );
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
    try {
      leaked?.close();
    } catch {
      /* a connection that never opened is already closed */
    }
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});



test("production AI stores share the one checked canonical connection and keep four scoped checks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-shared-"));
  const filename = path.join(dir, "state.sqlite");
  let database;
  let calibration;
  let attribution;
  try {
    const counts = countPreparedStatements(() => {
      database = new SqliteDatabase(filename);
      calibration = new SqliteAiCalibrationDurableStore(filename, database);
      attribution = new SqliteAiOutcomeAttributionMemory(filename, database);
    });
    assert.equal(counts.fullQuickCheck, 1, `expected exactly one canonical full scan, got ${JSON.stringify(counts.statements)}`);
    assert.equal(counts.quickCheck, 5, `expected one full plus four store-scoped checks, got ${JSON.stringify(counts.statements)}`);
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_calibration_durability_meta'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_calibration_durability_events'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_outcome_attribution_memory_meta'\)/i.test(sql)));
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_outcome_attribution_memory_events'\)/i.test(sql)));
    assert.match(runtimeSource, /verifiedSharedSqliteDatabase:\s*database/);
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

    // A caller-controlled filename is ignored when the checked SqliteDatabase is supplied.
    // This is platform-independent and directly pins the production composition contract.
    calibration = new SqliteAiCalibrationDurableStore(decoyPath, database);
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
    calibration = new SqliteAiCalibrationDurableStore(filename, database);

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

test("shared AI stores reject caller-supplied SQLite connections without canonical full-file verification", () => {
  const rawConnection = new DatabaseSync(":memory:");
  const verifiedDatabase = new SqliteDatabase(":memory:");
  const originalConnection = verifiedDatabase.connection;
  const replacedDatabase = Object.create(Object.getPrototypeOf(verifiedDatabase));
  Object.defineProperty(replacedDatabase, "connection", { value: rawConnection });
  Object.defineProperty(verifiedDatabase, "connection", { value: rawConnection });
  try {
    assert.throws(
      () => new SqliteAiCalibrationDurableStore(":memory:", rawConnection),
      /shared AI calibration database has not passed canonical full-file quick_check/,
    );
    assert.throws(
      () => new SqliteAiOutcomeAttributionMemory(":memory:", rawConnection),
      /shared AI attribution database has not passed canonical full-file quick_check/,
    );
    assert.throws(
      () => new SqliteAiCalibrationDurableStore(":memory:", replacedDatabase),
      /shared AI calibration database has not passed canonical full-file quick_check/,
    );
    assert.throws(
      () => new SqliteAiOutcomeAttributionMemory(":memory:", verifiedDatabase),
      /shared AI attribution database has not passed canonical full-file quick_check/,
      "replacing the connection after canonical verification must not retain shared-store trust",
    );
  } finally {
    rawConnection.close();
    originalConnection.close();
  }
});

test("shared verification trust survives wholesale CommonJS barrel export replacement", () => {
  // Reproduce the exact fresh-review attack in a clean process: load the public storage barrel,
  // replace require.cache[indexPath].exports wholesale, then require both AI-store module paths.
  // Genuine constructors resolve trust in their shared lexical scope, so neither can capture
  // the forged replacement resolver.
  const script = `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const { DatabaseSync } = require("node:sqlite");
    const root = ${JSON.stringify(root)};
    const indexPath = require.resolve(path.join(root, "dist", "packages", "storage", "src", "index.js"));
    const calibrationPath = require.resolve(path.join(root, "dist", "packages", "storage", "src", "aiCalibrationDurability.js"));
    const attributionPath = require.resolve(path.join(root, "dist", "packages", "storage", "src", "aiOutcomeAttributionMemory.js"));
    const genuineStorage = require(indexPath);

    const rawConnection = new DatabaseSync(":memory:");
    const checkedDatabase = new genuineStorage.SqliteDatabase(":memory:");
    const originalExports = require.cache[indexPath].exports;
    require.cache[indexPath].exports = {
      ...originalExports,
      sharedConnectionFromCheckedSqliteDatabase: () => rawConnection,
    };

    const { SqliteAiCalibrationDurableStore } = require(calibrationPath);
    const { SqliteAiOutcomeAttributionMemory } = require(attributionPath);
    let calibration;
    let attribution;
    try {
      assert.throws(
        () => new SqliteAiCalibrationDurableStore(":memory:", {}),
        /shared AI calibration database has not passed canonical full-file quick_check/,
      );
      assert.throws(
        () => new SqliteAiOutcomeAttributionMemory(":memory:", {}),
        /shared AI attribution database has not passed canonical full-file quick_check/,
      );
      calibration = new SqliteAiCalibrationDurableStore(":memory:", checkedDatabase);
      attribution = new SqliteAiOutcomeAttributionMemory(":memory:", checkedDatabase);
    } finally {
      calibration?.close();
      attribution?.close();
      checkedDatabase.close();
      rawConnection.close();
      require.cache[indexPath].exports = originalExports;
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `CommonJS barrel replacement exploit must fail closed:\n${result.stdout}\n${result.stderr}`);
});

test("canonical shared admission uses the captured native prepare after prototype replacement", () => {
  // Load the genuine storage module first, then poison the writable node:sqlite prototype
  // before SqliteDatabase construction. The registered shared trust must come from the native
  // full-file check captured at module initialization, never from this forged "ok" result.
  const script = `
    const assert = require("node:assert/strict");
    const { DatabaseSync, StatementSync } = require("node:sqlite");
    const root = ${JSON.stringify(root)};
    const storage = require(root + "/dist/packages/storage/src/index.js");
    const nativePrepare = DatabaseSync.prototype.prepare;
    const nativeGet = StatementSync.prototype.get;
    const counts = { forgedFull: 0, full: 0, scoped: 0 };
    StatementSync.prototype.get = function(...args) {
      const sql = String(this.sourceSQL ?? "");
      if (/^\\s*PRAGMA\\s+quick_check\\s*$/i.test(sql)) counts.full++;
      else if (/quick_check/i.test(sql)) counts.scoped++;
      return nativeGet.apply(this, args);
    };
    DatabaseSync.prototype.prepare = function(sql, ...args) {
      if (/^\\s*PRAGMA\\s+quick_check\\s*$/i.test(String(sql))) {
        counts.forgedFull++;
        return { get() { return { quick_check: "ok" }; } };
      }
      return nativePrepare.call(this, sql, ...args);
    };
    const database = new storage.SqliteDatabase(":memory:");
    const calibration = new storage.SqliteAiCalibrationDurableStore(":memory:", database);
    const attribution = new storage.SqliteAiOutcomeAttributionMemory(":memory:", database);
    try {
      assert.deepEqual(counts, { forgedFull: 0, full: 1, scoped: 4 });
    } finally {
      attribution.close(); calibration.close(); database.close();
      DatabaseSync.prototype.prepare = nativePrepare;
      StatementSync.prototype.get = nativeGet;
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `prototype replacement must not forge canonical integrity trust:\n${result.stdout}\n${result.stderr}`);
});

test("internal verifier cache replacement before bootstrap cannot admit unchecked shared connections", () => {
  const script = `
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const { DatabaseSync } = require("node:sqlite");
    const base = path.join(${JSON.stringify(root)}, "dist", "packages", "storage", "src");
    const internalPath = path.join(base, "sqliteVerifiedSharedConnection.js");
    const raw = new DatabaseSync(":memory:");
    // Reproduce preloading/replacing the former internal boundary, even on a clean
    // build where it no longer exists. Genuine constructors must ignore this entry.
    let previous;
    try { require(internalPath); previous = require.cache[internalPath]; }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
    require.cache[internalPath] = { id: internalPath, filename: internalPath, loaded: true, exports: {
      registerFullyCheckedSqliteDatabaseConnection: () => {},
      sharedConnectionFromCheckedSqliteDatabase: () => raw,
    }};
    const { SqliteDatabase } = require(path.join(base, "index.js"));
    const { SqliteAiCalibrationDurableStore } = require(path.join(base, "aiCalibrationDurability.js"));
    const { SqliteAiOutcomeAttributionMemory } = require(path.join(base, "aiOutcomeAttributionMemory.js"));
    const genuine = new SqliteDatabase(":memory:");
    try {
      for (const Store of [SqliteAiCalibrationDurableStore, SqliteAiOutcomeAttributionMemory]) {
        for (const forged of [{}, raw, { connection: raw }]) {
          assert.throws(() => new Store(":memory:", forged), /has not passed canonical full-file quick_check/);
        }
        const store = new Store(":memory:", genuine);
        store.close();
        assert.equal(genuine.connection.prepare("SELECT 1 AS ok").get().ok, 1);
      }
    } finally {
      genuine.close(); raw.close();
      if (previous) require.cache[internalPath] = previous;
      else delete require.cache[internalPath];
    }
  `;
  const result = spawnSync(process.execPath, ["-e", script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `internal module replacement must fail closed:\n${result.stdout}\n${result.stderr}`);
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
