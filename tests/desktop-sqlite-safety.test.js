const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { DesktopPersistenceStore } = require("../dist/apps/desktop/src/persistence/desktopPersistenceStore.js");

function withTempDirectory(operation) {
  const directory = mkdtempSync(path.join(tmpdir(), "nusa-desktop-sqlite-"));
  try { return operation(directory); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("desktop persistence applies and verifies required SQLite safety pragmas", () => {
  withTempDirectory((directory) => {
    const filename = path.join(directory, "nusa.db");
    const store = new DesktopPersistenceStore(filename);
    store.close();

    const db = new DatabaseSync(filename);
    try {
      assert.equal(String(db.prepare("PRAGMA journal_mode").get().journal_mode).toLowerCase(), "wal");
      assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
    } finally {
      db.close();
    }

    // Reopening exercises the connection-local foreign_keys, synchronous,
    // and busy_timeout assertions inside DesktopPersistenceStore again.
    const reopened = new DesktopPersistenceStore(filename);
    reopened.close();
  });
});

test("desktop persistence fails closed for a corrupt SQLite file", () => {
  withTempDirectory((directory) => {
    const filename = path.join(directory, "nusa.db");
    writeFileSync(filename, "not-a-sqlite-database", "utf8");
    assert.throws(() => new DesktopPersistenceStore(filename), /desktop persistence startup verification failed/);
  });
});
