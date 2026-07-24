import type { RulesLedgerEvent, RulesLedgerRecord } from "../../contracts/src/rules";
import { appendRulesEvent, replayRulesLedger } from "../../../apps/cloud/src/rulesControlPlane";

export interface RulesDatabase {
  readonly connection: {
    prepare(sql: string): {
      all(...args: unknown[]): unknown[];
      get(...args: unknown[]): unknown;
      run(...args: unknown[]): unknown;
    };
  };
  transaction<T>(fn: () => T): T;
}

/** Durable projection of the append-only rules ledger. It never evaluates rules. */
export class SqliteRulesControlPlaneStore {
  public constructor(private readonly db: RulesDatabase) {}

  public list(): readonly RulesLedgerRecord[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, event_json, hash FROM rules_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    return Object.freeze(rows.map(row => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), event: JSON.parse(String(row.event_json)) as RulesLedgerEvent, hash: String(row.hash) })));
  }

  public append(event: RulesLedgerEvent): RulesLedgerRecord {
    return this.db.transaction(() => {
      const record = appendRulesEvent(this.list(), event).at(-1)!;
      this.db.connection.prepare("INSERT INTO rules_events(sequence, previous_hash, event_json, hash) VALUES(?,?,?,?)").run(record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      const replay = replayRulesLedger(this.list());
      this.db.connection.prepare("INSERT INTO rules_state(id, ledger_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET ledger_hash=excluded.ledger_hash").run(replay.hash);
      return record;
    });
  }

  public verify(): void {
    const records = this.list(); const replay = replayRulesLedger(records);
    const row = this.db.connection.prepare("SELECT ledger_hash FROM rules_state WHERE id=1").get() as { ledger_hash: unknown } | undefined;
    if (row == null) { if (records.length === 0) return; throw new Error("rules snapshot missing"); }
    if (String(row.ledger_hash) !== replay.hash) throw new Error("rules snapshot mismatch");
  }
}
