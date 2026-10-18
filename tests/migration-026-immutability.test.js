"use strict";
// Migration 026_research_closed_candles is already applied to every deployed database.
// schema_migrations records a checksum of the migration, so editing an applied migration's SQL
// desynchronizes that record and the runtime refuses to start (fail-closed). That is exactly
// what blocked the Oracle PAPER release of 1524c15f on 2026-10-17 (run 39002973665): a `volume`
// column was added inside 026, the host DB still held the older checksum, and activation
// reported "database migration checksum mismatch: 026_research_closed_candles".
// Applied migrations are immutable. New columns belong in a NEW numbered migration.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { SqliteDatabase } = require("../dist/packages/storage/src/index.js");

const MIGRATION_ID = "026_research_closed_candles";

// Checksum of the 026 SQL as it stood when production applied it (commit a4661cc20 and earlier).
// Every deployed database recorded this value; never regenerate it to match edited SQL.
const HISTORICAL_026_CHECKSUM = "fd3ed8fe280f054d7f62bf8e1262f3cb37be2d0c2d56b0484016fc4fbf976cb4";

// The schema every deployed database already has for research_closed_candles: no volume column.
const DEPLOYED_026_SCHEMA = `
CREATE TABLE IF NOT EXISTS research_closed_candles (
  market TEXT NOT NULL,
  interval_ms INTEGER NOT NULL CHECK (interval_ms > 0),
  close_time_ms INTEGER NOT NULL CHECK (close_time_ms > 0),
  open REAL NOT NULL CHECK (open > 0),
  high REAL NOT NULL CHECK (high > 0),
  low REAL NOT NULL CHECK (low > 0),
  close REAL NOT NULL CHECK (close > 0),
  checksum TEXT NOT NULL,
  PRIMARY KEY (market, interval_ms, close_time_ms)
);
`;

// migrationRunner hashes `${id}\\n${sql}` where that "\\n" is a LITERAL backslash followed by "n",
// not a newline. It is almost certainly not what the original author meant, but it is baked into
// every checksum already written to every deployed database, so the formula must never be "fixed".
// The SQL text is hashed as the checkout presents it; git stores LF, so LF is the deployed form.
function checksumOf(sql) {
  return createHash("sha256").update(`${MIGRATION_ID}\\n${sql}`, "utf8").digest("hex");
}

const normalizeLf = (text) => text.replace(/\r\n/g, "\n");

// Extract a migration's SQL from a file. core.autocrlf can present CRLF on Windows checkouts even
// though git stores LF, so callers normalize when comparing against the deployed form.
function migrationSqlFrom(artifact, id) {
  const marker = `{ id: "${id}", sql: \``;
  const start = artifact.indexOf(marker);
  assert.notEqual(start, -1, `${id} must remain in the migration list`);
  const from = start + marker.length;
  return artifact.slice(from, artifact.indexOf("`", from));
}

function sourceOf(relative) {
  return readFileSync(join(__dirname, "..", ...relative), "utf8");
}

test("applied migration 026 keeps the exact SQL every deployed database already recorded", () => {
  const sql = migrationSqlFrom(normalizeLf(sourceOf(["packages", "storage", "src", "index.ts"])), MIGRATION_ID);
  assert.equal(
    checksumOf(sql),
    HISTORICAL_026_CHECKSUM,
    `${MIGRATION_ID} SQL changed. Applied migrations are immutable: a mismatch makes every existing ` +
      "database refuse to boot. Add a NEW numbered migration instead of editing this one."
  );
});

test("a database holding the deployed 026 schema still opens and gains volume through 031", () => {
  const runtimeSql = migrationSqlFrom(sourceOf(["dist", "packages", "storage", "src", "index.js"]), MIGRATION_ID);
  assert.equal(
    normalizeLf(runtimeSql),
    normalizeLf(DEPLOYED_026_SCHEMA),
    "026 must still describe exactly the deployed schema; the volume column belongs in 031"
  );

  const dir = mkdtempSync(join(tmpdir(), "nusa-migration-026-guard-"));
  const file = join(dir, "state.db");
  let db;
  try {
    const seed = new DatabaseSync(file);
    seed.exec(DEPLOYED_026_SCHEMA);
    seed.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)");
    // Record the checksum production holds for the deployed schema.
    seed
      .prepare("INSERT INTO schema_migrations (id, applied_at, checksum) VALUES (?, ?, ?)")
      .run(MIGRATION_ID, new Date().toISOString(), HISTORICAL_026_CHECKSUM);
    seed.close();

    // Must not throw "database migration checksum mismatch".
    db = new SqliteDatabase(file);
    assert.equal(db.migrationResult.currentVersion, "031_research_closed_candles_volume");

    const columns = db.connection.prepare("PRAGMA table_info(research_closed_candles)").all();
    assert.ok(
      columns.some((column) => column.name === "volume"),
      "031_research_closed_candles_volume must add the volume column to the existing table"
    );

    db.connection
      .prepare(
        "INSERT INTO research_closed_candles (market, interval_ms, close_time_ms, open, high, low, close, checksum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run("KRW-BTC", 60_000, 60_000, 100, 101, 99, 100, "legacy-row");
    assert.equal(
      db.connection.prepare("SELECT volume FROM research_closed_candles WHERE market = ?").get("KRW-BTC").volume,
      null,
      "rows written before the column existed keep a NULL volume, which the CHECK constraint allows"
    );
  } finally {
    if (db) db.connection.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
