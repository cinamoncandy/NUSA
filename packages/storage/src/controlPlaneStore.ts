import type { DatabaseSync } from "node:sqlite";
import type { ControlAuditEvent, ControlRuntimeSnapshot } from "../../contracts/src/controlPlane";
import type { ControlAuditRecord } from "../../../apps/cloud/src/controlAuditLedger";

export interface ControlPlaneDatabase {
  readonly connection: DatabaseSync;
  transaction<T>(fn: () => T): T;
}

export interface PersistedControlState {
  readonly runtime: ControlRuntimeSnapshot;
  readonly ledgerHash: string;
}

const GENESIS_HASH = "0".repeat(64);
const SHA256 = /^[a-f0-9]{64}$/;

const assertHash = (value: string, field: string): void => {
  if (!SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 hex string`);
};

const decodeEvent = (json: string): ControlAuditEvent => {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error("stored control audit event is invalid JSON"); }
  if (parsed == null || typeof parsed !== "object") throw new Error("stored control audit event is invalid");
  return Object.freeze({ ...(parsed as ControlAuditEvent) });
};

export class SqliteControlPlaneStore {
  public constructor(private readonly db: ControlPlaneDatabase) {
    this.db.connection.exec(`
      CREATE TABLE IF NOT EXISTS control_runtime_state (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        mode TEXT NOT NULL,
        kill_switch_active INTEGER NOT NULL,
        healthy INTEGER NOT NULL,
        last_accepted_command_at INTEGER,
        ledger_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS control_audit_records (
        sequence INTEGER PRIMARY KEY,
        previous_hash TEXT NOT NULL,
        event_json TEXT NOT NULL,
        hash TEXT NOT NULL UNIQUE
      );
    `);
  }

  public transaction<T>(fn: () => T): T { return this.db.transaction(fn); }

  public initialize(runtime: ControlRuntimeSnapshot): PersistedControlState {
    return this.db.transaction(() => {
      const existing = this.load();
      if (existing != null) return existing;
      this.db.connection.prepare(`
        INSERT INTO control_runtime_state
          (singleton_id, mode, kill_switch_active, healthy, last_accepted_command_at, ledger_hash)
        VALUES (1, ?, ?, ?, ?, ?)
      `).run(runtime.mode, runtime.killSwitchActive ? 1 : 0, runtime.healthy ? 1 : 0, runtime.lastAcceptedCommandAt ?? null, GENESIS_HASH);
      return this.load()!;
    });
  }

  public load(): PersistedControlState | undefined {
    const row = this.db.connection.prepare("SELECT * FROM control_runtime_state WHERE singleton_id = 1").get() as Record<string, unknown> | undefined;
    if (row == null) return undefined;
    const ledgerHash = String(row.ledger_hash);
    assertHash(ledgerHash, "ledgerHash");
    return Object.freeze({
      runtime: Object.freeze({
        mode: String(row.mode) as ControlRuntimeSnapshot["mode"],
        killSwitchActive: Number(row.kill_switch_active) === 1,
        healthy: Number(row.healthy) === 1,
        lastAcceptedCommandAt: row.last_accepted_command_at == null ? undefined : Number(row.last_accepted_command_at)
      }),
      ledgerHash
    });
  }

  public listAuditRecords(): readonly ControlAuditRecord[] {
    const rows = this.db.connection.prepare("SELECT * FROM control_audit_records ORDER BY sequence ASC").all() as Record<string, unknown>[];
    return Object.freeze(rows.map((row) => Object.freeze({
      sequence: Number(row.sequence),
      previousHash: String(row.previous_hash),
      event: decodeEvent(String(row.event_json)),
      hash: String(row.hash)
    })));
  }

  public appendAndSave(record: ControlAuditRecord, runtime: ControlRuntimeSnapshot): PersistedControlState {
    return this.db.transaction(() => {
      assertHash(record.previousHash, "record.previousHash");
      assertHash(record.hash, "record.hash");
      const current = this.load();
      if (current == null) throw new Error("control runtime state is not initialized");
      const expectedSequence = Number((this.db.connection.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM control_audit_records").get() as Record<string, unknown>).sequence) + 1;
      if (record.sequence !== expectedSequence) throw new Error("control audit sequence conflict");
      if (record.previousHash !== current.ledgerHash) throw new Error("control audit previous hash conflict");

      this.db.connection.prepare("INSERT INTO control_audit_records (sequence, previous_hash, event_json, hash) VALUES (?, ?, ?, ?)")
        .run(record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      this.db.connection.prepare(`
        UPDATE control_runtime_state
        SET mode = ?, kill_switch_active = ?, healthy = ?, last_accepted_command_at = ?, ledger_hash = ?
        WHERE singleton_id = 1
      `).run(runtime.mode, runtime.killSwitchActive ? 1 : 0, runtime.healthy ? 1 : 0, runtime.lastAcceptedCommandAt ?? null, record.hash);

      const stored = this.load();
      if (stored == null || stored.ledgerHash !== record.hash) throw new Error("control state write did not persist");
      return stored;
    });
  }
}
