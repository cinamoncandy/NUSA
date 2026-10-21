import { DatabaseSync } from "node:sqlite";

declare const sqliteStartupIntegrityBrand: unique symbol;

/** Opaque proof issued only after a real connection completes a full-file startup quick_check. */
export interface SqliteStartupIntegrityAttestation {
  readonly [sqliteStartupIntegrityBrand]: true;
}

const verifiedDatabaseIdentity = new WeakMap<object, string>();

// Captured once at module load, before any caller can replace the prototype method. Resolving
// DatabaseSync.prototype.prepare on each call would still consult a mutable slot: DatabaseSync
// supplies writable and configurable prototype methods, so a caller could substitute a permissive
// method, mint a proof for a database that was never scanned, and restore the original afterwards.
const nativePrepare = DatabaseSync.prototype.prepare;

function prepareNative(connection: DatabaseSync, sql: string) {
  // Calling the native prototype method validates SQLite's internal receiver brand. Calling
  // connection.prepare directly would let a structural fake claim that quick_check passed.
  return nativePrepare.call(connection, sql);
}

function quickCheckOk(connection: DatabaseSync, sql: string): boolean {
  const check = prepareNative(connection, sql).get() as Record<string, unknown> | undefined;
  return check != null && Object.values(check).includes("ok");
}

function mainDatabaseIdentity(connection: DatabaseSync): string | null {
  const rows = prepareNative(connection, "PRAGMA database_list").all() as Array<Record<string, unknown>>;
  const main = rows.find((row) => row.name === "main");
  const file = main?.file;
  return typeof file === "string" && file.length > 0 ? file : null;
}

/**
 * Performs the canonical full-file startup integrity scan and returns an opaque proof bound to the
 * actual SQLite main database reported by this live connection. A caller cannot mint a reusable
 * proof merely by satisfying a structural TypeScript interface: issuance itself requires the real
 * full-file quick_check to pass. In-memory databases deliberately receive a non-shareable proof.
 */
export function verifyAndIssueSqliteStartupIntegrity(
  connection: DatabaseSync,
  errorMessage: string,
): SqliteStartupIntegrityAttestation {
  if (!quickCheckOk(connection, "PRAGMA quick_check")) throw new Error(errorMessage);
  const proof = Object.freeze({}) as SqliteStartupIntegrityAttestation;
  const identity = mainDatabaseIdentity(connection);
  if (identity != null) verifiedDatabaseIdentity.set(proof as object, identity);
  return proof;
}

function attestsToConnection(
  connection: DatabaseSync,
  attestation: SqliteStartupIntegrityAttestation | undefined,
): boolean {
  if (attestation == null || (typeof attestation !== "object" && typeof attestation !== "function")) return false;
  const expected = verifiedDatabaseIdentity.get(attestation as object);
  if (expected == null) return false;
  return mainDatabaseIdentity(connection) === expected;
}

/**
 * Default callers retain a full-file quick_check. A production composition may reuse an opaque
 * proof from the exact canonical database's already-completed startup scan; the store then checks
 * each of its own b-trees and keeps any logical hash-chain replay performed by the store itself.
 */
export function assertSqliteStartupIntegrity(
  connection: DatabaseSync,
  attestation: SqliteStartupIntegrityAttestation | undefined,
  storeTables: readonly string[],
  errorMessage: string,
): void {
  if (attestsToConnection(connection, attestation)) {
    for (const table of storeTables) {
      if (!/^[a-z0-9_]+$/i.test(table)) throw new Error("invalid sqlite integrity table name");
      if (!quickCheckOk(connection, `PRAGMA quick_check('${table}')`)) throw new Error(errorMessage);
    }
    return;
  }
  if (!quickCheckOk(connection, "PRAGMA quick_check")) throw new Error(errorMessage);
}
