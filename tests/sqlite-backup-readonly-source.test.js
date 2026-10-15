const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const script = path.resolve(__dirname, "..", "scripts", "sqlite-backup.js");

// Reproduces the production failure deterministically on any platform:
// opening the database succeeds, but WAL checkpoint throws SQLITE_READONLY
// ("attempt to write a readonly database"), exactly as observed when the
// backup process lacks write access to the source database files.
const FAULT_HOOK = `
const { DatabaseSync } = require("node:sqlite");
const originalExec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql, ...args) {
  if (/wal_checkpoint/i.test(String(sql))) {
    const error = new Error("attempt to write a readonly database");
    error.code = "ERR_SQLITE_ERROR";
    throw error;
  }
  return Reflect.apply(originalExec, this, [sql, ...args]);
};
`;

function makeSource(root) {
  const source = path.join(root, "cloud-state.db");
  const setup = new DatabaseSync(source);
  try {
    setup.exec("CREATE TABLE ledger(id INTEGER PRIMARY KEY, amount INTEGER)");
    setup.exec("INSERT INTO ledger(amount) VALUES (100), (200)");
    setup.exec("PRAGMA journal_mode=WAL");
    setup.exec("INSERT INTO ledger(amount) VALUES (300)");
  } finally {
    setup.close();
  }
  return source;
}

function runBackup(source, destination, hook) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NUSA_DB: source,
      NUSA_BACKUP_DIR: destination,
      ...(hook ? { NODE_OPTIONS: `--require ${hook}` } : {}),
    },
  });
}

test("sqlite backup succeeds when WAL checkpoint cannot write (read-only source)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-sqlite-backup-"));
  const hook = path.join(root, "fault-hook.cjs");
  fs.writeFileSync(hook, FAULT_HOOK);
  const source = makeSource(root);
  const destination = path.join(root, "backups");
  const result = runBackup(source, destination, hook);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "PASS");
  assert.match(payload.sha256, /^[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(payload.output));
  const check = new DatabaseSync(payload.output, { readOnly: true });
  try {
    const rows = check.prepare("SELECT SUM(amount) AS total FROM ledger").get();
    assert.equal(rows.total, 600);
  } finally {
    check.close();
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("sqlite backup still succeeds without injected faults", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-sqlite-backup-clean-"));
  const source = makeSource(root);
  const destination = path.join(root, "backups");
  const result = runBackup(source, destination, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
  fs.rmSync(root, { recursive: true, force: true });
});
