import type { ComplianceLedgerEvent, ComplianceLedgerRecord } from "../../contracts/src/compliance";
import { appendComplianceEvent, replayComplianceLedger } from "../../../apps/cloud/src/complianceControlPlane";

export interface ComplianceDatabase { readonly connection: { exec(sql: string): unknown; prepare(sql: string): { all(...args: unknown[]): unknown[]; get(...args: unknown[]): unknown; run(...args: unknown[]): unknown; }; }; transaction<T>(fn: () => T): T; }

export class SqliteComplianceControlPlaneStore {
  public constructor(private readonly db: ComplianceDatabase) {}
  public list(): readonly ComplianceLedgerRecord[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, event_json, hash FROM compliance_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    return Object.freeze(rows.map(row => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), event: JSON.parse(String(row.event_json)) as ComplianceLedgerEvent, hash: String(row.hash) })));
  }
  public append(event: ComplianceLedgerEvent): ComplianceLedgerRecord {
    return this.db.transaction(() => {
      const record = appendComplianceEvent(this.list(), event).at(-1)!;
      this.db.connection.prepare("INSERT INTO compliance_events(sequence, previous_hash, event_json, hash) VALUES(?,?,?,?)").run(record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      const replay = replayComplianceLedger(this.list());
      this.db.connection.prepare("INSERT INTO compliance_state(id, ledger_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET ledger_hash=excluded.ledger_hash").run(replay.hash);
      return record;
    });
  }
  public verify(): void {
    const records = this.list(); const replay = replayComplianceLedger(records);
    const row = this.db.connection.prepare("SELECT ledger_hash FROM compliance_state WHERE id=1").get() as { ledger_hash: unknown } | undefined;
    if (row == null) { if (records.length === 0) return; throw new Error("compliance snapshot missing"); }
    if (String(row.ledger_hash) !== replay.hash) throw new Error("compliance snapshot mismatch");
  }
}
