import type { MultiAgentGovernanceEvent, MultiAgentGovernanceRecord } from "../../contracts/src/multiAgentGovernance";
import { appendMultiAgentGovernanceEvent, replayMultiAgentGovernance } from "../../contracts/src/persistenceLedger";

export interface MultiAgentGovernanceDatabase {
  readonly connection: {
    prepare(sql: string): {
      all(...args: unknown[]): unknown[];
      get(...args: unknown[]): unknown;
      run(...args: unknown[]): unknown;
    };
  };
  transaction<T>(fn: () => T): T;
}

/** SQLite durability for the zero-authority governance audit chain. */
export class SqliteMultiAgentGovernanceStore {
  public constructor(private readonly db: MultiAgentGovernanceDatabase) {}

  public list(): readonly MultiAgentGovernanceRecord[] {
    const rows = this.db.connection.prepare("SELECT sequence, previous_hash, event_json, hash FROM multi_agent_governance_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>;
    return Object.freeze(rows.map(row => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), event: JSON.parse(String(row.event_json)) as MultiAgentGovernanceEvent, hash: String(row.hash) })));
  }

  public append(event: MultiAgentGovernanceEvent): MultiAgentGovernanceRecord {
    return this.db.transaction(() => {
      const record = appendMultiAgentGovernanceEvent(this.list(), event).at(-1)!;
      this.db.connection.prepare("INSERT INTO multi_agent_governance_events(sequence, previous_hash, event_json, hash) VALUES(?,?,?,?)").run(record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      const replay = replayMultiAgentGovernance(this.list());
      this.db.connection.prepare("INSERT INTO multi_agent_governance_state(id, ledger_hash) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET ledger_hash=excluded.ledger_hash").run(replay.hash);
      return record;
    });
  }

  public verify(): void {
    const records = this.list(); const replay = replayMultiAgentGovernance(records);
    const row = this.db.connection.prepare("SELECT ledger_hash FROM multi_agent_governance_state WHERE id=1").get() as { ledger_hash: unknown } | undefined;
    if (row == null) { if (records.length === 0) return; throw new Error("multi-agent snapshot missing"); }
    if (String(row.ledger_hash) !== replay.hash) throw new Error("multi-agent snapshot mismatch");
  }
}
