import type { DatabaseSync } from "node:sqlite";

// Internal integrity registry for the exact SqliteDatabase instance/connection pair that
// completed the canonical full-file quick_check. This module is intentionally not re-exported
// from the storage package barrel: shared-store trust must not traverse caller-mutable barrel
// exports. The public storage barrel eagerly loads both shared-store consumers before returning
// to application code, so each captures this genuine module-local resolver before the barrel's
// CommonJS cache entry can be replaced.
const fullyCheckedSqliteDatabaseConnections = new WeakMap<object, DatabaseSync>();

export function registerFullyCheckedSqliteDatabaseConnection(database: object, connection: DatabaseSync): void {
  fullyCheckedSqliteDatabaseConnections.set(database, connection);
}

export function sharedConnectionFromCheckedSqliteDatabase(database: unknown): DatabaseSync | null {
  if (database == null || (typeof database !== "object" && typeof database !== "function")) return null;
  const checkedConnection = fullyCheckedSqliteDatabaseConnections.get(database as object);
  if (checkedConnection == null || (database as { connection?: unknown }).connection !== checkedConnection) return null;
  return checkedConnection;
}
