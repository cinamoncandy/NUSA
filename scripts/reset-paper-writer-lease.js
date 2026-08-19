const { existsSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

/**
 * Clears an abandoned PAPER writer lease.
 *
 * The writer lease exists so two processes can never mutate the same PAPER account. A clean
 * shutdown removes the row; a crash or a force-kill leaves it behind. `acquireLease` will take
 * over a recently expired lease, but refuses one whose heartbeat is older than four lease
 * periods, because from a single row it cannot tell "the writer died long ago" apart from "the
 * writer is alive and this machine's clock jumped forward". Refusing is the right default -- but
 * with no way to clear the row, any downtime beyond two minutes left the PAPER database
 * permanently unstartable. That is a missing recovery path, not a safety property.
 *
 * This is the recovery path, and it is deliberately explicit rather than automatic: it refuses to
 * act while a runtime is answering on the dashboard endpoint, and it never touches account state
 * -- only the lease row.
 */

const DEFAULT_STATE_DB_PATH = path.join(os.homedir(), ".nusa", "cloud", "state.sqlite");
const ACCOUNT_ID = "paper-default";

function resolveStateDbPath(env = process.env) {
  const configured = env.NUSA_CLOUD_STATE_DB_PATH;
  return configured && configured.trim() ? configured.trim() : DEFAULT_STATE_DB_PATH;
}

function resolveEndpoint(env = process.env) {
  const host = (env.NUSA_CLOUD_DASHBOARD_HOST || "127.0.0.1").trim();
  const port = (env.NUSA_CLOUD_DASHBOARD_PORT || "41731").trim();
  return `http://${host}:${port}`;
}

/** A runtime that answers /health is still serving, so its lease is live and must not be cleared. */
async function runtimeIsResponding(endpoint, fetchFn = fetch) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
      const response = await fetchFn(`${endpoint}/health`, { signal: controller.signal });
      return response.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

function readLease(databasePath, openDatabase = (file) => new DatabaseSync(file)) {
  if (!existsSync(databasePath)) return null;
  const db = openDatabase(databasePath);
  try {
    return db.prepare("SELECT owner_id, lease_until_ms, heartbeat_at_ms FROM cloud_paper_writer_leases WHERE account_id = ?").get(ACCOUNT_ID) ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function deleteLease(databasePath, openDatabase = (file) => new DatabaseSync(file)) {
  const db = openDatabase(databasePath);
  try {
    return Number(db.prepare("DELETE FROM cloud_paper_writer_leases WHERE account_id = ?").run(ACCOUNT_ID).changes);
  } finally {
    db.close();
  }
}

async function resetPaperWriterLease(options = {}) {
  const env = options.env ?? process.env;
  const databasePath = options.databasePath ?? resolveStateDbPath(env);
  const endpoint = options.endpoint ?? resolveEndpoint(env);
  const now = options.now ?? Date.now();
  const write = options.write ?? ((text) => process.stdout.write(`${text}\n`));

  const lease = readLease(databasePath, options.openDatabase);
  if (lease == null) {
    write("No PAPER writer lease is held. Nothing to reset.");
    return { status: "NO_LEASE" };
  }

  if (await runtimeIsResponding(endpoint, options.fetchFn)) {
    write(`A NUSA runtime is still answering on ${endpoint}. Stop it before resetting the lease.`);
    return { status: "RUNTIME_ACTIVE" };
  }

  const leaseUntil = Number(lease.lease_until_ms);
  if (Number.isFinite(leaseUntil) && leaseUntil > now) {
    const secondsLeft = Math.ceil((leaseUntil - now) / 1000);
    write(`The lease is still valid for ${secondsLeft}s. Wait for it to expire, or stop the writer that holds it.`);
    return { status: "LEASE_STILL_VALID", secondsLeft };
  }

  const removed = deleteLease(databasePath, options.openDatabase);
  const staleSeconds = Math.round((now - Number(lease.heartbeat_at_ms)) / 1000);
  write(`Cleared an abandoned PAPER writer lease (last heartbeat ${staleSeconds}s ago). PAPER account state was not modified.`);
  return { status: "CLEARED", removed, staleSeconds };
}

if (require.main === module) {
  resetPaperWriterLease()
    .then((result) => { process.exitCode = result.status === "CLEARED" || result.status === "NO_LEASE" ? 0 : 1; })
    .catch((error) => {
      process.stderr.write(`failed to reset the PAPER writer lease: ${error instanceof Error ? error.message : "unknown error"}\n`);
      process.exitCode = 1;
    });
}

module.exports = { DEFAULT_STATE_DB_PATH, readLease, resetPaperWriterLease, resolveEndpoint, resolveStateDbPath, runtimeIsResponding };
