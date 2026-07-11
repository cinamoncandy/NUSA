const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { runMigrations } = require("../dist/packages/storage/src/migrationRunner.js");

function migration(id, sql) {
  return Object.freeze({ id, sql });
}

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

    const second = runMigrations(db, plan);
    assert.deepEqual(second.applied, []);

    const rows = db.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id ASC").all();
    assert.deepEqual(rows, [
      { id: "001_alpha", applied_at: "2026-01-01T00:00:00.000Z" },
      { id: "002_beta", applied_at: "2026-01-01T00:00:00.000Z" }
    ]);
  } finally {
    db.close();
  }
});

test("migration runner rolls back a failed migration", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => runMigrations(db, [migration("001_broken", "CREATE TABLE partial_state (id TEXT); THIS IS NOT SQL;")]),
      /migration failed: 001_broken/
    );

    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_state'").get();
    assert.equal(table, undefined);
    const recorded = db.prepare("SELECT id FROM schema_migrations WHERE id = ?").get("001_broken");
    assert.equal(recorded, undefined);
  } finally {
    db.close();
  }
});

test("migration runner rejects unknown applied versions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("999_unknown", new Date().toISOString());

    assert.throws(
      () => runMigrations(db, [migration("001_alpha", "CREATE TABLE alpha (id TEXT);")]),
      /database contains unknown migration: 999_unknown/
    );
  } finally {
    db.close();
  }
});

test("migration runner rejects duplicate or unordered migration plans", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => runMigrations(db, [migration("001_alpha", "SELECT 1;"), migration("001_alpha", "SELECT 1;")]),
      /duplicate migration id/
    );
    assert.throws(
      () => runMigrations(db, [migration("002_beta", "SELECT 1;"), migration("001_alpha", "SELECT 1;")]),
      /strictly ordered/
    );
  } finally {
    db.close();
  }
});
