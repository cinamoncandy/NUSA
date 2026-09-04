import { createHash } from "node:crypto";

export interface SqliteMigration {
  readonly id: string;
  readonly sql: string;
}

export interface SqliteMigrationDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): unknown;
  };
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly currentVersion: string | undefined;
}

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL,
  checksum TEXT
);
`;

const migrationChecksum = (migration: SqliteMigration): string => createHash("sha256")
  .update(`${migration.id}\\n${migration.sql}`, "utf8")
  .digest("hex");

function assertMigrationPlan(migrations: readonly SqliteMigration[]): void {
  const seen = new Set<string>();
  let previous = "";

  for (const migration of migrations) {
    if (!/^[0-9]{3}_[a-z0-9_]+$/.test(migration.id)) {
      throw new Error(`invalid migration id: ${migration.id}`);
    }
    if (seen.has(migration.id)) {
      throw new Error(`duplicate migration id: ${migration.id}`);
    }
    if (previous !== "" && migration.id <= previous) {
      throw new Error(`migrations must be strictly ordered: ${migration.id}`);
    }
    if (migration.sql.trim() === "") {
      throw new Error(`migration SQL is empty: ${migration.id}`);
    }
    seen.add(migration.id);
    previous = migration.id;
  }
}

function ensureMigrationTable(db: SqliteMigrationDatabase): void {
  db.exec(MIGRATION_TABLE_SQL);
  const migrationColumns = db.prepare("PRAGMA table_info(schema_migrations)").all() as Array<{ name: unknown }>;
  if (!migrationColumns.some((column) => String(column.name) === "checksum")) {
    db.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
  }
}

function applyMigration(
  db: SqliteMigrationDatabase,
  migration: SqliteMigration,
  now: () => Date,
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (id, applied_at, checksum) VALUES (?, ?, ?)").run(
      migration.id,
      now().toISOString(),
      migrationChecksum(migration),
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original migration error. The caller must fail closed.
    }
    throw new Error(`migration failed: ${migration.id}`, { cause: error });
  }
}

export function runMigrations(
  db: SqliteMigrationDatabase,
  migrations: readonly SqliteMigration[],
  now: () => Date = () => new Date()
): MigrationResult {
  assertMigrationPlan(migrations);
  ensureMigrationTable(db);

  const appliedRows = db.prepare("SELECT id, checksum FROM schema_migrations ORDER BY id ASC").all() as Array<{ id: unknown; checksum: unknown }>;
  const appliedIds = new Set(appliedRows.map((row) => String(row.id)));
  const knownIds = new Set(migrations.map((migration) => migration.id));

  for (const appliedId of appliedIds) {
    if (!knownIds.has(appliedId)) {
      throw new Error(`database contains unknown migration: ${appliedId}`);
    }
  }

  for (const row of appliedRows) {
    const id = String(row.id);
    const migration = migrations.find((item) => item.id === id)!;
    const expected = migrationChecksum(migration);
    if (row.checksum == null) db.prepare("UPDATE schema_migrations SET checksum = ? WHERE id = ?").run(expected, id);
    else if (String(row.checksum) !== expected) throw new Error(`database migration checksum mismatch: ${id}`);
  }

  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  const appliedNow: string[] = [];

  for (const migration of pending) {
    applyMigration(db, migration, now);
    appliedNow.push(migration.id);
  }

  const currentVersion = migrations.length === 0 ? undefined : migrations[migrations.length - 1]?.id;
  return Object.freeze({ applied: Object.freeze(appliedNow), currentVersion });
}

/**
 * Applies a strictly ordered extension migration plan after a primary migration plan has already
 * been verified by `runMigrations` (for example by `SqliteDatabase` construction). Existing base
 * migration ids are intentionally tolerated, but an extension can never be inserted behind the
 * durable migration head and any already-applied extension checksum must match exactly.
 */
export function runExtensionMigrations(
  db: SqliteMigrationDatabase,
  migrations: readonly SqliteMigration[],
  now: () => Date = () => new Date(),
): MigrationResult {
  assertMigrationPlan(migrations);
  ensureMigrationTable(db);
  const appliedRows = db.prepare("SELECT id, checksum FROM schema_migrations ORDER BY id ASC").all() as Array<{ id: unknown; checksum: unknown }>;
  const appliedIds = new Set(appliedRows.map((row) => String(row.id)));
  const extensionById = new Map(migrations.map((migration) => [migration.id, migration] as const));

  for (const row of appliedRows) {
    const id = String(row.id);
    const migration = extensionById.get(id);
    if (migration == null) continue;
    const expected = migrationChecksum(migration);
    if (row.checksum == null) db.prepare("UPDATE schema_migrations SET checksum = ? WHERE id = ?").run(expected, id);
    else if (String(row.checksum) !== expected) throw new Error(`database migration checksum mismatch: ${id}`);
  }

  const durableHead = appliedRows.length === 0 ? undefined : String(appliedRows[appliedRows.length - 1]!.id);
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  if (durableHead != null && pending.some((migration) => migration.id <= durableHead)) {
    throw new Error(`extension migration would regress durable migration head: ${durableHead}`);
  }

  const appliedNow: string[] = [];
  for (const migration of pending) {
    applyMigration(db, migration, now);
    appliedNow.push(migration.id);
  }
  const currentVersion = migrations.length === 0 ? durableHead : migrations[migrations.length - 1]?.id;
  return Object.freeze({ applied: Object.freeze(appliedNow), currentVersion });
}
