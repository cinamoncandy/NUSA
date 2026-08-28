import type { DatabaseSync } from "node:sqlite";
import type { RegisteredStrategy, StrategyGovernanceEvent } from "../../contracts/src/strategyGovernance";
import { appendStrategyGovernanceEvent, replayStrategyGovernanceLedger, type StrategyGovernanceLedgerRecord } from "../../contracts/src/strategyGovernanceLedger";

export interface StrategyGovernanceDatabase { readonly connection: DatabaseSync; transaction<T>(fn: () => T): T; }

const strategyKey = (strategy: RegisteredStrategy): string => `${strategy.identity.strategyId}|${strategy.identity.version}`;

export class SqliteStrategyGovernanceStore {
  constructor(private readonly db: StrategyGovernanceDatabase) { this.db.connection.prepare("SELECT 1 FROM strategy_governance_state LIMIT 1").all(); }

  claimCommand(commandId: string, fingerprint: string): boolean {
    return this.db.transaction(() => {
      if (!commandId.trim() || !fingerprint.trim()) throw new Error("governance command is invalid");
      const existing = this.db.connection.prepare("SELECT fingerprint FROM strategy_governance_commands WHERE command_id=?").get(commandId) as { fingerprint: string } | undefined;
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error("governance command conflict");
        return false;
      }
      this.db.connection.prepare("INSERT INTO strategy_governance_commands(command_id,fingerprint) VALUES(?,?)").run(commandId, fingerprint);
      return true;
    });
  }

  append(strategy: RegisteredStrategy, event: StrategyGovernanceEvent): void {
    this.db.transaction(() => {
      const records = this.listEvents();
      const next = appendStrategyGovernanceEvent(records, event);
      const replay = replayStrategyGovernanceLedger(next);
      const lifecycle = replay.lifecycles.get(strategyKey(strategy));
      if (!lifecycle) throw new Error("strategy governance lifecycle missing");
      const persisted = Object.freeze({ identity: Object.freeze({ ...strategy.identity }), lifecycle });
      const payload = JSON.stringify(persisted);
      const existing = this.db.connection.prepare("SELECT payload FROM strategy_registry WHERE strategy_id=? AND version=?").get(strategy.identity.strategyId, strategy.identity.version) as { payload: string } | undefined;
      if (!existing) {
        this.db.connection.prepare("INSERT INTO strategy_registry(strategy_id,version,payload) VALUES(?,?,?)").run(strategy.identity.strategyId, strategy.identity.version, payload);
      } else {
        const current = JSON.parse(existing.payload) as RegisteredStrategy;
        if (!current.identity || JSON.stringify(current.identity) !== JSON.stringify(persisted.identity)) throw new Error("strategy registry conflict");
        this.db.connection.prepare("UPDATE strategy_registry SET payload=? WHERE strategy_id=? AND version=?").run(payload, strategy.identity.strategyId, strategy.identity.version);
      }
      const record = next.at(-1)!;
      this.db.connection.prepare("INSERT INTO strategy_governance_events(sequence,previous_hash,event_json,hash) VALUES(?,?,?,?)").run(record.sequence, record.previousHash, JSON.stringify(record.event), record.hash);
      const snapshot = JSON.stringify({ hash: replay.hash, lifecycles: [...replay.lifecycles], champions: [...replay.champions] });
      this.db.connection.prepare("INSERT INTO strategy_governance_state(id,snapshot_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET snapshot_json=excluded.snapshot_json").run(snapshot);
      for (const [family, strategyKeyValue] of replay.champions) this.db.connection.prepare("INSERT INTO champion_assignments(family,strategy_key) VALUES(?,?) ON CONFLICT(family) DO UPDATE SET strategy_key=excluded.strategy_key").run(family, strategyKeyValue);
    });
  }

  listEvents(): readonly StrategyGovernanceLedgerRecord[] {
    return Object.freeze((this.db.connection.prepare("SELECT * FROM strategy_governance_events ORDER BY sequence ASC").all() as Array<Record<string, unknown>>).map((row) => Object.freeze({ sequence: Number(row.sequence), previousHash: String(row.previous_hash), event: JSON.parse(String(row.event_json)) as StrategyGovernanceEvent, hash: String(row.hash) })));
  }

  private listRegistryRows(): readonly RegisteredStrategy[] {
    return Object.freeze((this.db.connection.prepare("SELECT payload FROM strategy_registry ORDER BY strategy_id ASC, version ASC").all() as Array<{ payload: string }>).map((row) => {
      const value = JSON.parse(row.payload) as RegisteredStrategy;
      if (!value.identity || !value.lifecycle) throw new Error("governance registry record malformed");
      return Object.freeze({ identity: Object.freeze({ ...value.identity }), lifecycle: value.lifecycle });
    }));
  }

  listStrategies(): readonly RegisteredStrategy[] {
    this.verify();
    return this.listRegistryRows();
  }

  verify(): void {
    const events = this.listEvents();
    const replay = replayStrategyGovernanceLedger(events);
    const row = this.db.connection.prepare("SELECT snapshot_json FROM strategy_governance_state WHERE id=1").get() as { snapshot_json: string } | undefined;
    if (!row) {
      if (events.length === 0 && this.listRegistryRows().length === 0) return;
      throw new Error("governance snapshot missing");
    }
    const expectedSnapshot = JSON.stringify({ hash: replay.hash, lifecycles: [...replay.lifecycles], champions: [...replay.champions] });
    if (row.snapshot_json !== expectedSnapshot) throw new Error("governance snapshot mismatch");
    for (const strategy of this.listRegistryRows()) {
      const expectedLifecycle = replay.lifecycles.get(strategyKey(strategy));
      if (!expectedLifecycle || strategy.lifecycle !== expectedLifecycle) throw new Error("governance registry lifecycle mismatch");
    }
  }
}
