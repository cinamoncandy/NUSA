const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/desktopPersistenceStore.js");

function withTempDirectory(operation) {
  const directory = mkdtempSync(path.join(tmpdir(), "dokkaebi-desktop-sqlite-"));
  try { return operation(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("desktop persistence applies and verifies required SQLite safety pragmas", () => {
  withTempDirectory((directory) => {
    const filename = path.join(directory, "dokkaebi.db");
    const store = new DesktopPersistenceStore(filename);
    store.close();

    const db = new DatabaseSync(filename);
    try {
      assert.equal(Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys), 0, "foreign_keys is connection-local and must be re-enabled by each store connection");
      assert.equal(String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase(), "wal");
      assert.equal(Number(db.prepare("PRAGMA synchronous").get().synchronous), 2);
      assert.equal(Number(db.prepare("PRAGMA quick_check").get().quick_check === "ok"), 1);
    } finally {
      db.close();
    }

    const reopened = new DesktopPersistenceStore(filename);
    reopened.close();
  });
});

test("desktop persistence fails closed for a corrupt SQLite file", () => {
  withTempDirectory((directory) => {
    const filename = path.join(directory, "dokkaebi.db");
    writeFileSync(filename, "not-a-sqlite-database", "utf8");
    assert.throws(() => new DesktopPersistenceStore(filename), /desktop persistence startup verification failed/);
  });
});
