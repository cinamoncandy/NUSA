const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { readLease, resetPaperWriterLease, resolveEndpoint, resolveStateDbPath } = require("../scripts/reset-paper-writer-lease.js");

const ACCOUNT_ID = "paper-default";
const neverResponds = async () => { throw new Error("connection refused"); };
const responds = async () => ({ ok: true });

function fixture({ leaseUntilMs, heartbeatAtMs, withAccountRow = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-lease-recovery-"));
  const databasePath = path.join(directory, "state.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE cloud_paper_writer_leases (account_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, lease_until_ms INTEGER NOT NULL, heartbeat_at_ms INTEGER NOT NULL)");
  db.exec("CREATE TABLE cloud_paper_accounts (account_id TEXT PRIMARY KEY, state_json TEXT NOT NULL)");
  if (withAccountRow) db.prepare("INSERT INTO cloud_paper_accounts (account_id, state_json) VALUES (?, ?)").run(ACCOUNT_ID, '{"cash":9990925}');
  if (leaseUntilMs !== undefined) {
    db.prepare("INSERT INTO cloud_paper_writer_leases (account_id, owner_id, lease_until_ms, heartbeat_at_ms) VALUES (?, ?, ?, ?)")
      .run(ACCOUNT_ID, "writer-a", leaseUntilMs, heartbeatAtMs);
  }
  db.close();
  return { directory, databasePath };
}

const cleanup = (directory) => fs.rmSync(directory, { recursive: true, force: true });
const capture = () => { const lines = []; return { lines, write: (text) => lines.push(text) }; };

test("an abandoned lease is cleared so the runtime can start again", async () => {
  const now = 2_000_000;
  // Older than four lease periods, which is exactly the case acquireLease refuses to take over.
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const out = capture();
  try {
    const result = await resetPaperWriterLease({ databasePath, now, write: out.write, fetchFn: neverResponds, endpoint: "http://127.0.0.1:41731" });
    assert.equal(result.status, "CLEARED");
    assert.equal(result.removed, 1);
    assert.equal(readLease(databasePath), null, "the lease row must be gone");
    assert.match(out.lines.join("\n"), /Cleared an abandoned PAPER writer lease/);
  } finally {
    cleanup(directory);
  }
});

test("recovery never touches PAPER account state", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  try {
    await resetPaperWriterLease({ databasePath, now, write: () => {}, fetchFn: neverResponds });
    const db = new DatabaseSync(databasePath);
    const account = db.prepare("SELECT state_json FROM cloud_paper_accounts WHERE account_id = ?").get(ACCOUNT_ID);
    db.close();
    assert.equal(account.state_json, '{"cash":9990925}', "cash, positions, and fills must survive a lease reset");
  } finally {
    cleanup(directory);
  }
});

test("a lease held by a runtime that is still serving is refused", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const out = capture();
  try {
    // The row looks abandoned, but something is answering /health, so it is not ours to clear.
    const result = await resetPaperWriterLease({ databasePath, now, write: out.write, fetchFn: responds, endpoint: "http://127.0.0.1:41731" });
    assert.equal(result.status, "RUNTIME_ACTIVE");
    assert.ok(readLease(databasePath), "a live runtime's lease must survive");
    assert.match(out.lines.join("\n"), /still answering/);
  } finally {
    cleanup(directory);
  }
});

test("an unexpired lease is left alone even when nothing answers", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now + 12_000, heartbeatAtMs: now - 18_000 });
  const out = capture();
  try {
    const result = await resetPaperWriterLease({ databasePath, now, write: out.write, fetchFn: neverResponds });
    assert.equal(result.status, "LEASE_STILL_VALID");
    assert.equal(result.secondsLeft, 12);
    assert.ok(readLease(databasePath));
    assert.match(out.lines.join("\n"), /still valid for 12s/);
  } finally {
    cleanup(directory);
  }
});

test("resetting with no lease present is a no-op rather than an error", async () => {
  const { directory, databasePath } = fixture({});
  const out = capture();
  try {
    const result = await resetPaperWriterLease({ databasePath, now: 2_000_000, write: out.write, fetchFn: neverResponds });
    assert.equal(result.status, "NO_LEASE");
    assert.match(out.lines.join("\n"), /Nothing to reset/);
  } finally {
    cleanup(directory);
  }
});

test("a missing database is reported as nothing to reset, not as a crash", async () => {
  const out = capture();
  const result = await resetPaperWriterLease({ databasePath: path.join(os.tmpdir(), "nusa-absent", "state.sqlite"), now: 1, write: out.write, fetchFn: neverResponds });
  assert.equal(result.status, "NO_LEASE");
});

test("the target database and endpoint follow the same configuration the runtime uses", () => {
  assert.equal(resolveStateDbPath({ NUSA_CLOUD_STATE_DB_PATH: "/tmp/custom.sqlite" }), "/tmp/custom.sqlite");
  assert.equal(resolveStateDbPath({}), path.join(os.homedir(), ".nusa", "cloud", "state.sqlite"));
  // A blank value is configuration that was never set, not a request to use the empty path.
  assert.equal(resolveStateDbPath({ NUSA_CLOUD_STATE_DB_PATH: "   " }), path.join(os.homedir(), ".nusa", "cloud", "state.sqlite"));
  assert.equal(resolveEndpoint({ NUSA_CLOUD_DASHBOARD_HOST: "0.0.0.0", NUSA_CLOUD_DASHBOARD_PORT: "9999" }), "http://0.0.0.0:9999");
  assert.equal(resolveEndpoint({}), "http://127.0.0.1:41731");
});
