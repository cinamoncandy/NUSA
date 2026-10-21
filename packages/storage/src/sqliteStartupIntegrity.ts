import type { DatabaseSync } from "node:sqlite";

export interface SqliteStartupIntegrityAttestation {
  hasVerifiedFullIntegrityFor(filename: string): boolean;
}

function quickCheckOk(connection: DatabaseSync, sql: string): boolean {
  const check = connection.prepare(sql).get() as Record<string, unknown> | undefined;
  return check != null && Object.values(check).includes("ok");
}

/**
 * Default callers retain a full-file quick_check. A production composition may reuse the exact
 * canonical database's already-completed startup scan, but only by supplying its live attestation;
 * the store then checks each of its own b-trees after CREATE IF NOT EXISTS and keeps any logical
 * hash-chain replay performed by the store itself.
 */
export function assertSqliteStartupIntegrity(
  connection: DatabaseSync,
  filename: string,
  attestation: SqliteStartupIntegrityAttestation | undefined,
  storeTables: readonly string[],
  errorMessage: string,
): void {
  if (attestation?.hasVerifiedFullIntegrityFor(filename) === true) {
    for (const table of storeTables) {
      if (!/^[a-z0-9_]+$/i.test(table)) throw new Error("invalid sqlite integrity table name");
      if (!quickCheckOk(connection, `PRAGMA quick_check('${table}')`)) throw new Error(errorMessage);
    }
    return;
  }
  if (!quickCheckOk(connection, "PRAGMA quick_check")) throw new Error(errorMessage);
}
