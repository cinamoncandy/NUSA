const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { runMigrations } = require("../dist/packages/storage/src/migrationRunner.js");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");

function migration(id, sql) { return Object.freeze({ id, sql }); }

test("migration runner applies pending migrations once and records versions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const plan = [
      migration("001_alpha", "CREATE TABLE alpha (id TEXT PRIMARY KEY);"),
      migration("002_beta", "CREATE TABLE beta (id TEXT PRIMARY KEY);")
    ];
    const first = runMigrations(db, plan, () => new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(first.applied, ["001_alpha", "002_beta"]);
    assert.equal(first.currentVersion, "002_beta");
    assert.deepEqual(runMigrations(db, plan).applied, []);
    const rows = db.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id ASC").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { id: "001_alpha", applied_at: "2026-01-01T00:00:00.000Z" },
      { id: "002_beta", applied_at: "2026-01-01T00:00:00.000Z" }
    ]);
  } finally { db.close(); }
});

test("migration runner rolls back a failed migration", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => runMigrations(db, [migration("001_broken", "CREATE TABLE partial_state (id TEXT); THIS IS NOT SQL;")]), /migration failed: 001_broken/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_state'").get(), undefined);
    assert.equal(db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001_broken"), undefined);
  } finally { db.close(); }
});

test("migration runner rejects unknown applied versions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("999_unknown", new Date().toISOString());
    assert.throws(() => runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT);")]), /database contains unknown migration: 999_unknown/);
  } finally { db.close(); }
});

test("migration runner rejects duplicate or unordered migration plans", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(() => runMigrations(db, [migration("001_alpha", "SELECT 1;"), migration("001_alpha", "SELECT 1;")]), /duplicate migration id/);
    assert.throws(() => runMigrations(db, [migration("002_beta", "SELECT 1;"), migration("001_alpha", "SELECT 1;")]), /strictly ordered/);
  } finally { db.close(); }
});


test("SqliteDatabase fresh file applies accounting schema and exposes all tables", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-storage-")), "positions.db");
  const db = new SqliteDatabase(filename);
  try {
    assert.deepEqual(db.migrationResult.applied, ["001_position_accounting", "002_research_memory", "003_governance_control", "004_compliance_control_plane", "005_resilience_control_plane", "006_rules_control_plane", "007_multi_agent_governance", "008_cloud_dashboard_snapshots", "009_cloud_paper_accounts", "010_risk_safety_integration", "011_research_evaluation_ledger", "012_candidate_promotion_runtime", "013_research_automation_sessions", "014_research_hypothesis_events", "015_cloud_paper_writer_lease", "016_improvement_candidate_memory"]);
    assert.equal(db.migrationResult.currentVersion, "016_improvement_candidate_memory");
    const names = db.connection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ORDER BY name"
    ).all("schema_migrations", "position_ledger_entries", "wallet_position_snapshots", "strategy_position_snapshots", "applied_ledger_markers", "research_hypotheses", "research_experiment_records", "strategy_governance_commands", "investment_committee_events", "compliance_events", "compliance_state", "improvement_candidate_memory", "rules_events", "rules_state", "multi_agent_governance_events", "multi_agent_governance_state", "cloud_dashboard_snapshots", "cloud_paper_accounts", "risk_paper_approvals", "risk_daily_loss_state", "risk_idempotency_records", "risk_order_state", "research_evaluation_ledger", "research_candidates", "research_champion_pointer", "research_promotion_commands", "research_promotion_audit", "research_sessions", "research_hypothesis_events")
      .map((row) => row.name);
    assert.deepEqual(names, [
      "applied_ledger_markers",
      "cloud_dashboard_snapshots",
      "cloud_paper_accounts",
      "compliance_events",
      "compliance_state",
      "improvement_candidate_memory",
      "investment_committee_events",
      "multi_agent_governance_events",
      "multi_agent_governance_state",
      "position_ledger_entries",
      "research_candidates",
      "research_champion_pointer",
      "research_evaluation_ledger",
      "research_experiment_records",
      "research_hypotheses",
      "research_hypothesis_events",
      "research_promotion_audit",
      "research_promotion_commands",
      "research_sessions",
      "risk_daily_loss_state",
      "risk_idempotency_records",
      "risk_order_state",
      "risk_paper_approvals",
      "rules_events",
      "rules_state",
      "schema_migrations",
      "strategy_governance_commands",
      "strategy_position_snapshots",
      "wallet_position_snapshots"
    ]);
    db.connection.prepare("INSERT INTO position_ledger_entries (id, wallet_id, strategy_id, symbol, side, base_qty_raw, quote_qty_raw, ts, created_at, source_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "persisted", "wallet", null, "KRW-BTC", "BUY", "1", "100", "2026-01-01", "2026-01-01", null
    );
  } finally { db.close(); }

  const reopened = new SqliteDatabase(filename);
  try {
    assert.deepEqual(reopened.migrationResult.applied, []);
    assert.equal(reopened.migrationResult.currentVersion, "016_improvement_candidate_memory");
    assert.equal(reopened.connection.prepare("SELECT id FROM position_ledger_entries WHERE id = ?").get("persisted").id, "persisted");
  } finally { reopened.close(); }
});

test("SqliteDatabase rejects an unknown applied migration on reopen", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-storage-")), "future.db");
  const raw = new DatabaseSync(filename);
  raw.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  raw.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("999_future", new Date().toISOString());
  raw.close();
  assert.throws(() => new SqliteDatabase(filename), /database contains unknown migration: 999_future/);
});


test("SqliteDatabase applies safety pragmas and passes quick_check", () => {
  const filename = join(mkdtempSync(join(tmpdir(), "nusa-pragmas-")), "safe.db");
  const db = new SqliteDatabase(filename);
  try {
    assert.equal(Object.values(db.connection.prepare("PRAGMA foreign_keys").get())[0], 1);
    assert.equal(Object.values(db.connection.prepare("PRAGMA busy_timeout").get())[0], 5000);
    assert.equal(String(Object.values(db.connection.prepare("PRAGMA journal_mode").get())[0]).toLowerCase(), "wal");
    assert.equal(Object.values(db.connection.prepare("PRAGMA synchronous").get())[0], 2);
    assert.equal(Object.values(db.connection.prepare("PRAGMA quick_check").get())[0], "ok");
  } finally { db.close(); }
});


test("migration runner persists checksums and rejects SQL drift", () => {
  const db = new DatabaseSync(":memory:");
  try {
    runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT);")]);
    const checksum = db.prepare("SELECT checksum FROM schema_migrations WHERE id = ?").get("001_alpha").checksum;
    assert.match(checksum, /^[a-f0-9]{64}$/);
    assert.throws(
      () => runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT, changed TEXT);")]),
      /migration checksum mismatch/
    );
  } finally { db.close(); }
});

test("migration runner backfills legacy rows once", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE alpha (id TEXT);");
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_alpha", new Date().toISOString());
    assert.deepEqual(runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT);")]).applied, []);
    assert.match(db.prepare("SELECT checksum FROM schema_migrations WHERE id = ?").get("001_alpha").checksum, /^[a-f0-9]{64}$/);
  } finally { db.close(); }
});

test("migration IDs are immutable and a rename fails closed without touching existing data", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const original = migration("001_alpha", "CREATE TABLE alpha (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    runMigrations(db, [original]);
    db.prepare("INSERT INTO alpha (id, value) VALUES (?, ?)").run("kept", "unchanged");
    const before = db.prepare("SELECT id, applied_at, checksum FROM schema_migrations WHERE id = ?").get("001_alpha");

    assert.throws(
      () => runMigrations(db, [migration("001_renamed_alpha", original.sql)]),
      /database contains unknown migration: 001_alpha/
    );

    assert.deepEqual({ ...db.prepare("SELECT id, value FROM alpha WHERE id = ?").get("kept") }, { id: "kept", value: "unchanged" });
    assert.deepEqual({ ...db.prepare("SELECT id, applied_at, checksum FROM schema_migrations WHERE id = ?").get("001_alpha") }, { ...before });
    assert.equal(db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001_renamed_alpha"), undefined);
  } finally { db.close(); }
});

test("legacy checksum backfill preserves applied timestamp and existing rows", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const appliedAt = "2025-01-02T03:04:05.000Z";
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE alpha (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_alpha", appliedAt);
    db.prepare("INSERT INTO alpha (id, value) VALUES (?, ?)").run("legacy", "preserved");

    assert.deepEqual(runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT PRIMARY KEY, value TEXT NOT NULL);")]).applied, []);
    const row = db.prepare("SELECT id, applied_at, checksum FROM schema_migrations WHERE id = ?").get("001_alpha");
    assert.equal(row.applied_at, appliedAt);
    assert.match(row.checksum, /^[a-f0-9]{64}$/);
    assert.deepEqual({ ...db.prepare("SELECT id, value FROM alpha WHERE id = ?").get("legacy") }, { id: "legacy", value: "preserved" });
  } finally { db.close(); }
});
