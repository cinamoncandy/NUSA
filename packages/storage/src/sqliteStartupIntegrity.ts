import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

declare const sqliteStartupIntegrityBrand: unique symbol;

/** Opaque proof issued only after a real full-file startup quick_check. */
export interface SqliteStartupIntegrityAttestation {
  readonly [sqliteStartupIntegrityBrand]: true;
}

const verifiedDatabaseIdentity = new WeakMap<object, string>();

const TRUSTED_INTEGRITY_PROBE = String.raw`
const { statSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const filename = process.argv[1];
const tables = JSON.parse(process.argv[2]);
const expectedIdentity = process.argv[3] || null;
function identity() {
  const stats = statSync(filename, { bigint: true });
  return String(stats.dev) + ":" + String(stats.ino);
}
function check(connection, sql) {
  const row = connection.prepare(sql).get();
  if (row == null || !Object.values(row).includes("ok")) throw new Error("quick_check failed");
}
const before = identity();
const connection = new DatabaseSync(filename, { readOnly: true });
try {
  const reuse = expectedIdentity != null && before === expectedIdentity;
  if (!reuse) check(connection, "PRAGMA quick_check");
  else for (const table of tables) check(connection, "PRAGMA quick_check('" + table + "')");
  const after = identity();
  if (before !== after) throw new Error("database identity changed during integrity check");
  process.stdout.write(JSON.stringify({ identity: after, reuse }));
} finally {
  connection.close();
}
`;

function shareableFilename(filename: string): boolean {
  return filename !== ":memory:" && !filename.startsWith("file:");
}

function trustedFileIntegrityCheck(
  filename: string,
  tables: readonly string[],
  errorMessage: string,
  expectedIdentity?: string,
): { identity: string; reused: boolean } {
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/i.test(table)) throw new Error("invalid sqlite integrity table name");
  }
  const result = spawnSync(process.execPath, ["-e", TRUSTED_INTEGRITY_PROBE, filename, JSON.stringify(tables), expectedIdentity ?? ""], {
    encoding: "utf8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "" },
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error != null || result.status !== 0) throw new Error(errorMessage);
  try {
    const parsed = JSON.parse(result.stdout) as { identity?: unknown; reuse?: unknown };
    if (typeof parsed.identity !== "string" || parsed.identity.length === 0 || typeof parsed.reuse !== "boolean") {
      throw new Error("invalid integrity result");
    }
    return { identity: parsed.identity, reused: parsed.reuse };
  } catch {
    throw new Error(errorMessage);
  }
}

function localQuickCheckOk(connection: DatabaseSync, sql: string): boolean {
  const check = connection.prepare(sql).get() as Record<string, unknown> | undefined;
  return check != null && Object.values(check).includes("ok");
}

/**
 * Performs the canonical full-file startup integrity scan and returns an opaque proof. File-backed
 * databases are checked in a fresh Node process so a caller that replaced DatabaseSync.prototype
 * before this module loaded cannot forge the scan or its file identity. In-memory databases remain
 * non-shareable and use the local connection only for their own startup check.
 */
export function verifyAndIssueSqliteStartupIntegrity(
  connection: DatabaseSync,
  filename: string,
  errorMessage: string,
): SqliteStartupIntegrityAttestation {
  const proof = Object.freeze({}) as SqliteStartupIntegrityAttestation;
  if (shareableFilename(filename)) {
    const result = trustedFileIntegrityCheck(filename, [], errorMessage);
    verifiedDatabaseIdentity.set(proof as object, result.identity);
    return proof;
  }
  if (!localQuickCheckOk(connection, "PRAGMA quick_check")) throw new Error(errorMessage);
  return proof;
}

/**
 * Default callers retain a full-file quick_check. A production composition may reuse an opaque
 * proof from the exact canonical database's already-completed startup scan; file-backed checks run
 * in a fresh process, outside the mutable DatabaseSync prototype of the application realm.
 */
export function assertSqliteStartupIntegrity(
  connection: DatabaseSync,
  filename: string,
  attestation: SqliteStartupIntegrityAttestation | undefined,
  storeTables: readonly string[],
  errorMessage: string,
): void {
  if (shareableFilename(filename)) {
    const expected = attestation != null && (typeof attestation === "object" || typeof attestation === "function")
      ? verifiedDatabaseIdentity.get(attestation as object)
      : undefined;
    const result = trustedFileIntegrityCheck(filename, storeTables, errorMessage, expected);
    if (expected != null && result.reused && result.identity === expected) return;
    // No attestation or a different file: the trusted probe already performed the full scan.
    return;
  }

  if (attestation != null) {
    // In-memory / URI databases deliberately never register a reusable identity.
  }
  if (!localQuickCheckOk(connection, "PRAGMA quick_check")) throw new Error(errorMessage);
}
