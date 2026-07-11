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
  applied_at TEXT NOT NULL
);
`;

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

export function runMigrations(
  db: SqliteMigrationDatabase,
  migrations: readonly SqliteMigration[],
  now: () => Date = () => new Date()
): MigrationResult {
  assertMigrationPlan(migrations);
  db.exec(MIGRATION_TABLE_SQL);

  const appliedRows = db.prepare("SELECT id FROM schema_migrations ORDER BY id ASC").all() as Array<{ id: unknown }>;
  const appliedIds = new Set(appliedRows.map((row) => String(row.id)));
  const knownIds = new Set(migrations.map((migration) => migration.id));

  for (const appliedId of appliedIds) {
    if (!knownIds.has(appliedId)) {
      throw new Error(`database contains unknown migration: ${appliedId}`);
    }
  }

  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));
  const appliedNow: string[] = [];

  for (const migration of pending) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
        migration.id,
        now().toISOString()
      );
      db.exec("COMMIT");
      appliedNow.push(migration.id);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original migration error. The caller must fail closed.
      }
      throw new Error(`migration failed: ${migration.id}`, { cause: error });
    }
  }

  const currentVersion = migrations.length === 0 ? undefined : migrations[migrations.length - 1]?.id;
  return Object.freeze({ applied: Object.freeze(appliedNow), currentVersion });
}
