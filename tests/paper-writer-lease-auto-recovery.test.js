const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { recoverAbandonedWriterLease, start } = require("../scripts/start-cloud-runtime.js");
const { readLease, resolveAccountId } = require("../scripts/reset-paper-writer-lease.js");

// #2770: the supervised launcher used to print the manual recovery command and exit, so every
// restart met the same stale row until the restart budget was spent. These tests pin the
// automatic path -- and, more importantly, that it inherits every guard the explicit script has.

const ACCOUNT_ID = resolveAccountId({});
const CLOCK_ANOMALY = "Error: PAPER_WRITER_CLOCK_ANOMALY\n  at acquireLease\n";
const ALREADY_ACTIVE = "Error: PAPER_WRITER_ALREADY_ACTIVE\n  at acquireLease\n";
const neverResponds = async () => { throw new Error("connection refused"); };
const responds = async () => ({ ok: true });

function fixture({ leaseUntilMs, heartbeatAtMs, withAccountRow = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nusa-auto-lease-"));
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

async function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

test("a stale-row startup failure clears the abandoned lease so the next start can take over", async () => {
  const now = 2_000_000;
  // Older than four lease periods: exactly what acquireLease refuses to take over.
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const out = capture();
  try {
    const result = await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      recoveryWrite: out.write,
      leaseRecovery: { databasePath, now, accountId: ACCOUNT_ID, fetchFn: neverResponds, endpoint: "http://127.0.0.1:41731" },
    });
    assert.equal(result.status, "CLEARED");
    assert.equal(result.removed, 1);
    assert.equal(readLease(databasePath), null, "the stale row must be gone before the restart");
    assert.match(out.lines.join("\n"), /Cleared an abandoned PAPER writer lease/);
  } finally {
    cleanup(directory);
  }
});

test("an ordinary runtime failure never reaches the lease", async () => {
  const { directory, databasePath } = fixture({ leaseUntilMs: 1_000, heartbeatAtMs: 1_000 });
  try {
    const result = await recoverAbandonedWriterLease("Error: something unrelated", {
      leaseRecovery: { databasePath, now: 2_000_000, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    assert.equal(result.status, "SKIPPED");
    assert.ok(readLease(databasePath), "an unrelated failure must leave the lease untouched");
  } finally {
    cleanup(directory);
  }
});

test("a live writer reported as ALREADY_ACTIVE is never disturbed automatically", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  try {
    // The row looks abandoned and nothing answers, but the child said another writer holds it.
    const result = await recoverAbandonedWriterLease(ALREADY_ACTIVE, {
      leaseRecovery: { databasePath, now, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    assert.equal(result.status, "SKIPPED");
    assert.ok(readLease(databasePath), "the other writer's lease must survive");
  } finally {
    cleanup(directory);
  }
});

test("the automatic path still refuses while a runtime answers the dashboard endpoint", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const out = capture();
  try {
    const result = await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      recoveryWrite: out.write,
      leaseRecovery: { databasePath, now, accountId: ACCOUNT_ID, fetchFn: responds, endpoint: "http://127.0.0.1:41731" },
    });
    assert.equal(result.status, "RUNTIME_ACTIVE");
    assert.ok(readLease(databasePath), "a serving runtime's lease must survive automatic recovery");
    assert.match(out.lines.join("\n"), /still answering/);
  } finally {
    cleanup(directory);
  }
});

test("the automatic path still refuses an unexpired lease", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now + 12_000, heartbeatAtMs: now - 18_000 });
  try {
    const result = await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      leaseRecovery: { databasePath, now, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    assert.equal(result.status, "LEASE_STILL_VALID");
    assert.ok(readLease(databasePath));
  } finally {
    cleanup(directory);
  }
});

test("recovery with no lease present is a no-op, not a failure", async () => {
  const { directory, databasePath } = fixture({});
  try {
    const result = await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      leaseRecovery: { databasePath, now: 2_000_000, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    assert.equal(result.status, "NO_LEASE");
  } finally {
    cleanup(directory);
  }
});

test("recovery fails closed instead of throwing out of the launcher exit handler", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const out = capture();
  try {
    // Read the row, then fail the delete: the launcher must still reach its exit code.
    let opens = 0;
    const result = await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      recoveryWrite: out.write,
      leaseRecovery: {
        databasePath,
        now,
        accountId: ACCOUNT_ID,
        fetchFn: neverResponds,
        openDatabase: () => {
          opens += 1;
          if (opens > 1) throw new Error("disk failure");
          return new DatabaseSync(databasePath);
        },
      },
    });
    assert.equal(result.status, "ERROR");
    assert.ok(readLease(databasePath), "a failed clear must leave the row in place");
  } finally {
    cleanup(directory);
  }
});

test("recovery and PAPER account state survive the automatic path together", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  try {
    await recoverAbandonedWriterLease(CLOCK_ANOMALY, {
      leaseRecovery: { databasePath, now, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    const db = new DatabaseSync(databasePath);
    const account = db.prepare("SELECT state_json FROM cloud_paper_accounts WHERE account_id = ?").get(ACCOUNT_ID);
    db.close();
    assert.equal(account.state_json, '{"cash":9990925}', "cash, positions, and fills must survive");
  } finally {
    cleanup(directory);
  }
});

test("the supervised launcher runs the recovery when its child exits on CLOCK_ANOMALY", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};
  const output = [];
  const savedExitCode = process.exitCode;
  const listeners = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  process.exitCode = null;
  try {
    start({
      env: { NUSA_CLOUD_DASHBOARD_TOKEN: "t".repeat(40), NUSA_CLOUD_STATE_DB_PATH: databasePath },
      resolveToken: () => { throw new Error("protected token must be used"); },
      spawn: () => child,
      write: (text) => output.push(text),
      leaseRecovery: { now, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    child.stderr.emit("data", Buffer.from(CLOCK_ANOMALY));
    child.emit("exit", 1, null);

    assert.ok(await waitFor(() => typeof process.exitCode === "number"), "the exit handler must finish");
    const printed = output.join("\n");
    assert.match(printed, /reset-paper-writer-lease\.js/, "the manual command stays documented");
    assert.match(printed, /Recovered automatically/, "the launcher must say what it did");
    assert.equal(readLease(databasePath), null, "the row must be cleared for the supervisor's restart");
    assert.equal(process.exitCode, 1, "the exit code still reports the child's failure");
  } finally {
    process.exitCode = savedExitCode;
    for (const [signal, before] of listeners) {
      for (const listener of process.listeners(signal)) if (!before.has(listener)) process.removeListener(signal, listener);
    }
    cleanup(directory);
  }
});

test("the supervised launcher leaves the lease alone when its child exits on ALREADY_ACTIVE", async () => {
  const now = 2_000_000;
  const { directory, databasePath } = fixture({ leaseUntilMs: now - 1_600_000, heartbeatAtMs: now - 1_630_000 });
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.kill = () => {};
  const output = [];
  const savedExitCode = process.exitCode;
  const listeners = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  process.exitCode = null;
  try {
    start({
      env: { NUSA_CLOUD_DASHBOARD_TOKEN: "t".repeat(40), NUSA_CLOUD_STATE_DB_PATH: databasePath },
      resolveToken: () => { throw new Error("protected token must be used"); },
      spawn: () => child,
      write: (text) => output.push(text),
      leaseRecovery: { now, accountId: ACCOUNT_ID, fetchFn: neverResponds },
    });
    child.stderr.emit("data", Buffer.from(ALREADY_ACTIVE));
    child.emit("exit", 1, null);

    assert.ok(await waitFor(() => typeof process.exitCode === "number"), "the exit handler must finish");
    assert.ok(readLease(databasePath), "a live writer's lease must not be cleared automatically");
    assert.equal(output.join("\n").includes("Recovered automatically"), false);
    assert.equal(process.exitCode, 75, "a lease conflict keeps its dedicated exit code");
  } finally {
    process.exitCode = savedExitCode;
    for (const [signal, before] of listeners) {
      for (const listener of process.listeners(signal)) if (!before.has(listener)) process.removeListener(signal, listener);
    }
    cleanup(directory);
  }
});
