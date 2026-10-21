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


test("sqlite backup retention keeps one snapshot per UTC day/week bucket", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-sqlite-backup-retention-"));
  const source = makeSource(root);
  const destination = path.join(root, "backups");
  fs.mkdirSync(destination, { recursive: true });

  const stamp = (date, hour) => {
    const copy = new Date(date);
    copy.setUTCHours(hour, 0, 0, 0);
    return copy.toISOString().replaceAll(/[:.]/g, "-");
  };
  const startOfUtcDay = new Date();
  startOfUtcDay.setUTCHours(0, 0, 0, 0);
  const writePair = (prefix, date, hour) => {
    const name = `${prefix}${stamp(date, hour)}.db`;
    fs.writeFileSync(path.join(destination, name), "fixture");
    fs.writeFileSync(path.join(destination, `${name}.sha256`), "fixture\n");
    return name;
  };

  // Nine distinct days, with two snapshots in one historical day. Final retention must
  // contain the latest snapshot from at most seven distinct UTC days, not seven releases.
  for (let daysAgo = 1; daysAgo <= 9; daysAgo += 1) {
    const d = new Date(startOfUtcDay);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    writePair("daily-cloud-state-", d, 1);
    if (daysAgo === 2) writePair("daily-cloud-state-", d, 20);
  }

  // Five distinct UTC weeks, each with two Sunday snapshots. Only the latest snapshot per
  // week may survive, and only four distinct weeks are retained.
  const mostRecentSunday = new Date(startOfUtcDay);
  mostRecentSunday.setUTCDate(mostRecentSunday.getUTCDate() - mostRecentSunday.getUTCDay());
  for (let weeksAgo = 0; weeksAgo < 5; weeksAgo += 1) {
    const d = new Date(mostRecentSunday);
    d.setUTCDate(d.getUTCDate() - (weeksAgo * 7));
    writePair("weekly-cloud-state-", d, 1);
    writePair("weekly-cloud-state-", d, 20);
  }

  const result = runBackup(source, destination, null);
  assert.equal(result.status, 0, result.stderr);

  const names = fs.readdirSync(destination);
  const dailyFiles = names.filter((name) => name.startsWith("daily-cloud-state-") && name.endsWith(".db"));
  const weeklyFiles = names.filter((name) => name.startsWith("weekly-cloud-state-") && name.endsWith(".db"));
  const dailyKeys = dailyFiles.map((name) => name.slice("daily-cloud-state-".length, "daily-cloud-state-YYYY-MM-DD".length));
  const weeklyKey = (name) => {
    const day = name.slice("weekly-cloud-state-".length, "weekly-cloud-state-YYYY-MM-DD".length);
    const d = new Date(`${day}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  };

  assert.equal(dailyFiles.length, 7);
  assert.equal(new Set(dailyKeys).size, dailyFiles.length, "daily retention must deduplicate same-day releases");
  assert.equal(weeklyFiles.length, 4);
  assert.equal(new Set(weeklyFiles.map(weeklyKey)).size, weeklyFiles.length, "weekly retention must deduplicate same-week releases");
  for (const sidecar of names.filter((name) => name.endsWith(".db.sha256"))) {
    assert.ok(fs.existsSync(path.join(destination, sidecar.slice(0, -".sha256".length))), `orphan sidecar: ${sidecar}`);
  }

  fs.rmSync(root, { recursive: true, force: true });
});
