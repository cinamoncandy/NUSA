import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { migrations, SqliteDatabase } from "./index";
import { runMigrations } from "./migrationRunner";

const checksum = (payload: string): string => createHash("sha256").update(payload, "utf8").digest("hex");

function insertAccount(db: DatabaseSync, updatedAt: number, stateJson: string): void {
  db.prepare(`
    INSERT INTO cloud_paper_accounts (account_id, schema_version, updated_at, state_json, checksum, status)
    VALUES ('paper-default', 1, ?, ?, ?, 'VALID')
    ON CONFLICT(account_id) DO UPDATE SET updated_at=excluded.updated_at, state_json=excluded.state_json,
      checksum=excluded.checksum, schema_version=excluded.schema_version, status='VALID'
  `).run(updatedAt, stateJson, checksum(stateJson));
}

describe("canonical PAPER account history migration", () => {
  it("is installed automatically by SqliteDatabase initialization", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      assert.equal(db.migrationResult.currentVersion, "019_paper_public_market_observations");
      const triggerNames = (db.connection.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_cloud_paper_account_history_%' ORDER BY name
      `).all() as Array<{ name: string }>).map((row) => row.name);
      assert.deepEqual(triggerNames, ["trg_cloud_paper_account_history_insert", "trg_cloud_paper_account_history_update"]);

      insertAccount(db.connection, 100, JSON.stringify({ version: 1, updatedAt: 100, equity: 100 }));
      insertAccount(db.connection, 200, JSON.stringify({ version: 1, updatedAt: 200, equity: 101 }));
      const rows = db.connection.prepare("SELECT updated_at FROM cloud_paper_account_history ORDER BY updated_at").all() as Array<{ updated_at: number }>;
      assert.deepEqual(rows.map((row) => Number(row.updated_at)), [100, 200]);
    } finally {
      db.close();
    }
  });

  it("bootstraps an existing VALID canonical account when upgrading from migration 017", () => {
    const db = new DatabaseSync(":memory:");
    try {
      runMigrations(db, migrations.slice(0, -2), () => new Date("2026-08-29T00:00:00.000Z"));
      const stateJson = JSON.stringify({ version: 1, updatedAt: 777, equity: 123 });
      insertAccount(db, 777, stateJson);

      const result = runMigrations(db, migrations, () => new Date("2026-08-29T00:01:00.000Z"));
      assert.deepEqual(result.applied, ["018_cloud_paper_account_history", "019_paper_public_market_observations"]);
      const row = db.prepare("SELECT updated_at, state_json, checksum FROM cloud_paper_account_history WHERE account_id = 'paper-default'").get() as { updated_at: number; state_json: string; checksum: string };
      assert.equal(Number(row.updated_at), 777);
      assert.equal(row.state_json, stateJson);
      assert.equal(row.checksum, checksum(stateJson));
    } finally {
      db.close();
    }
  });

  it("fails closed when the same canonical timestamp is reused with different state", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      insertAccount(db.connection, 500, JSON.stringify({ version: 1, updatedAt: 500, equity: 100 }));
      assert.throws(
        () => insertAccount(db.connection, 500, JSON.stringify({ version: 1, updatedAt: 500, equity: 999 })),
        /PAPER_ACCOUNT_HISTORY_IDENTITY_CONFLICT/,
      );
      const row = db.connection.prepare("SELECT state_json FROM cloud_paper_account_history WHERE account_id = 'paper-default' AND updated_at = 500").get() as { state_json: string };
      assert.equal(JSON.parse(row.state_json).equity, 100);
    } finally {
      db.close();
    }
  });

  it("fails closed on non-monotonic canonical account chronology without rolling back current truth", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      insertAccount(db.connection, 500, JSON.stringify({ version: 1, updatedAt: 500, equity: 100 }));
      assert.throws(
        () => insertAccount(db.connection, 400, JSON.stringify({ version: 1, updatedAt: 400, equity: 90 })),
        /PAPER_ACCOUNT_HISTORY_CHRONOLOGY_REGRESSION/,
      );
      const current = db.connection.prepare("SELECT updated_at, state_json FROM cloud_paper_accounts WHERE account_id = 'paper-default'").get() as { updated_at: number; state_json: string };
      assert.equal(Number(current.updated_at), 500);
      assert.equal(JSON.parse(current.state_json).equity, 100);
      const rows = db.connection.prepare("SELECT updated_at FROM cloud_paper_account_history WHERE account_id = 'paper-default' ORDER BY updated_at").all() as Array<{ updated_at: number }>;
      assert.deepEqual(rows.map((row) => Number(row.updated_at)), [500]);
    } finally {
      db.close();
    }
  });

  it("keeps identical replay idempotent while preserving one historical receipt", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      const stateJson = JSON.stringify({ version: 1, updatedAt: 600, equity: 102 });
      insertAccount(db.connection, 600, stateJson);
      insertAccount(db.connection, 600, stateJson);
      const rows = db.connection.prepare("SELECT updated_at, state_json FROM cloud_paper_account_history WHERE account_id = 'paper-default'").all() as Array<{ updated_at: number; state_json: string }>;
      assert.equal(rows.length, 1);
      assert.equal(Number(rows[0]?.updated_at), 600);
      assert.equal(rows[0]?.state_json, stateJson);
    } finally {
      db.close();
    }
  });
});
