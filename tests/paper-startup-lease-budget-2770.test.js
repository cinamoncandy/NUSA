const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");
const { verifyAndIssueSqliteStartupIntegrity } = require("../dist/packages/storage/src/sqliteStartupIntegrity.js");
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
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function countedPrepare(sql) {
    counts.statements.push(String(sql));
    if (/quick_check/i.test(String(sql))) counts.quickCheck += 1;
    if (/^\s*PRAGMA\s+quick_check\s*$/i.test(String(sql))) counts.fullQuickCheck += 1;
    return originalPrepare.call(this, sql);
  };
  try {
    body();
  } finally {
    DatabaseSync.prototype.prepare = originalPrepare;
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



test("shared production AI stores reuse one canonical full-file startup scan and keep store checks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-integrity-"));
  const filename = path.join(dir, "state.sqlite");
  let database;
  let calibration;
  let attribution;
  try {
    const counts = countPreparedStatements(() => {
      database = new SqliteDatabase(filename);
      calibration = new SqliteAiCalibrationDurableStore(filename, database.startupIntegrityAttestation);
      attribution = new SqliteAiOutcomeAttributionMemory(filename, database.startupIntegrityAttestation);
    });
    assert.equal(counts.fullQuickCheck, 1, `expected exactly one full-file startup scan, got ${JSON.stringify(counts.statements)}`);
    assert.equal(counts.quickCheck, 5, `expected one full plus four store-scoped checks, got ${JSON.stringify(counts.statements)}`);
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_calibration_durability_events'\)/i.test(sql)), "calibration event b-tree must still be checked");
    assert.ok(counts.statements.some((sql) => /quick_check\('ai_outcome_attribution_memory_events'\)/i.test(sql)), "attribution event b-tree must still be checked");
    assert.match(aiCalibrationSource, /assertSqliteStartupIntegrity/);
    assert.match(aiAttributionSource, /assertSqliteStartupIntegrity/);
  } finally {
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
  try {
    database = new SqliteDatabase(canonicalPath);
    const counts = countPreparedStatements(() => {
      const store = new SqliteAiCalibrationDurableStore(otherPath, database.startupIntegrityAttestation);
      store.close();
    });
    assert.equal(counts.fullQuickCheck, 1, "a different SQLite file must perform its own full-file quick_check");
  } finally {
    database?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a forged structural attestation cannot suppress the full-file scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-forged-"));
  const filename = path.join(dir, "forged.sqlite");
  try {
    const forged = { hasVerifiedFullIntegrityFor: () => true };
    const counts = countPreparedStatements(() => {
      const store = new SqliteAiCalibrationDurableStore(filename, forged);
      store.close();
    });
    assert.equal(counts.fullQuickCheck, 1, "a caller-forged structural object must fall back to a real full-file quick_check");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a forged structural SQLite connection cannot mint an integrity attestation", () => {
  const fake = {
    prepare(sql) {
      return {
        get() { return { quick_check: "ok" }; },
        all() { return [{ name: "main", file: "/tmp/unverified-state.sqlite" }]; },
      };
    },
  };
  assert.throws(
    () => verifyAndIssueSqliteStartupIntegrity(fake, "sqlite quick_check failed"),
    undefined,
    "the SQLite native receiver check must reject a structural fake before issuing proof",
  );
});

test("standalone AI durability stores retain their fail-closed full-file scan", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-2770-standalone-"));
  try {
    const calibrationPath = path.join(dir, "calibration.sqlite");
    const calibrationCounts = countPreparedStatements(() => {
      const store = new SqliteAiCalibrationDurableStore(calibrationPath);
      store.close();
    });
    assert.equal(calibrationCounts.fullQuickCheck, 1);

    const attributionPath = path.join(dir, "attribution.sqlite");
    const attributionCounts = countPreparedStatements(() => {
      const store = new SqliteAiOutcomeAttributionMemory(attributionPath);
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
