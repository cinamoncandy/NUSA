import type { DatabaseSync } from "node:sqlite";
import type { ExecutionFill, ExecutionRecord, ExecutionRepository, ExecutionTransition } from "../../../apps/execution/src/durable-execution";
import type { ExecutionState } from "../../../apps/execution/src/durable-execution";

// Mirror of the canonical transition table in apps/execution/src/durable-execution.ts.
// A runtime import would violate STORAGE_RUNTIME_APP_REFERENCE, so the table is
// duplicated here and pinned identical by tests/durable-execution-sqlite.test.js.
const transitions: Readonly<Record<ExecutionState, readonly ExecutionState[]>> = {
  INTENT_CREATED: ["RISK_APPROVED", "RISK_REJECTED"], RISK_APPROVED: ["QUEUED"], QUEUED: ["SUBMITTING", "CANCELED"],
  SUBMITTING: ["ACCEPTED", "REJECTED", "SUBMISSION_UNKNOWN"], ACCEPTED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "EXPIRED", "RECONCILIATION_REQUIRED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "EXPIRED", "RECONCILIATION_REQUIRED"], CANCEL_REQUESTED: ["CANCELING", "RECONCILIATION_REQUIRED"],
  CANCELING: ["CANCELED", "FILLED", "PARTIALLY_FILLED", "SUBMISSION_UNKNOWN", "RECONCILIATION_REQUIRED"], SUBMISSION_UNKNOWN: ["ACCEPTED", "PARTIALLY_FILLED", "FILLED", "REJECTED", "RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["RECONCILED", "ACCEPTED", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED"],
  RISK_REJECTED: [], REJECTED: [], FILLED: [], CANCELED: [], EXPIRED: [], RECONCILED: []
};
function assertLocalTransition(from: ExecutionState, to: ExecutionState): void { if (from === to) return; if (!transitions[from].includes(to)) throw new Error(`INVALID_EXECUTION_TRANSITION:${from}->${to}`); }

function parseStored<T>(json: string, what: string, id: string): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`STORED_RECORD_CORRUPT:${what}:${id}`);
  }
}

export interface DurableExecutionDatabase { readonly connection: DatabaseSync; transaction<T>(fn: () => T): T; }
export class SqliteDurableExecutionRepository implements ExecutionRepository {
  public constructor(private readonly db: DurableExecutionDatabase) {
    db.connection.exec(`CREATE TABLE IF NOT EXISTS execution_records (execution_id TEXT PRIMARY KEY, client_order_id TEXT NOT NULL UNIQUE, state TEXT NOT NULL, version INTEGER NOT NULL, record_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS execution_transitions (transition_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, transition_json TEXT NOT NULL, UNIQUE(execution_id, sequence)); CREATE TABLE IF NOT EXISTS execution_fills (fill_id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, exchange_trade_id TEXT NOT NULL UNIQUE, fill_json TEXT NOT NULL);`);
  }
  get(id: string): ExecutionRecord | null { const r = this.db.connection.prepare("SELECT record_json FROM execution_records WHERE execution_id=?").get(id) as { record_json: string } | undefined; return r ? parseStored<ExecutionRecord>(r.record_json, "execution-record", id) : null; }
  getByClientOrderId(id: string): ExecutionRecord | null { const r = this.db.connection.prepare("SELECT record_json FROM execution_records WHERE client_order_id=?").get(id) as { record_json: string } | undefined; return r ? parseStored<ExecutionRecord>(r.record_json, "execution-record", id) : null; }
  save(record: ExecutionRecord, transition: ExecutionTransition): ExecutionRecord { return this.db.transaction(() => { const old = this.get(record.executionId); if (old && (record.version !== old.version + 1 || transition.sequence !== this.transitions(record.executionId).length + 1)) throw new Error("EXECUTION_VERSION_CONFLICT"); if (old) assertLocalTransition(old.state, record.state); else if (transition.fromState !== null || transition.sequence !== 1) throw new Error("INVALID_INITIAL_TRANSITION"); this.db.connection.prepare("INSERT INTO execution_records(execution_id,client_order_id,state,version,record_json,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(execution_id) DO UPDATE SET state=excluded.state,version=excluded.version,record_json=excluded.record_json,updated_at=excluded.updated_at").run(record.executionId, record.clientOrderId, record.state, record.version, JSON.stringify(record), record.updatedAt); this.db.connection.prepare("INSERT INTO execution_transitions(transition_id,execution_id,sequence,transition_json) VALUES(?,?,?,?)").run(transition.transitionId, transition.executionId, transition.sequence, JSON.stringify(transition)); return record; }); }
  transitions(id: string): readonly ExecutionTransition[] { const rows = this.db.connection.prepare("SELECT transition_json FROM execution_transitions WHERE execution_id=? ORDER BY sequence").all(id) as Array<{ transition_json: string }>; return Object.freeze(rows.map((x, index) => parseStored<ExecutionTransition>(x.transition_json, "execution-transition", `${id}#${index}`))); }
  fills(id: string): readonly ExecutionFill[] { const rows = this.db.connection.prepare("SELECT fill_json FROM execution_fills WHERE execution_id=? ORDER BY rowid").all(id) as Array<{ fill_json: string }>; return Object.freeze(rows.map((x, index) => parseStored<ExecutionFill>(x.fill_json, "execution-fill", `${id}#${index}`))); }
  appendFill(fill: ExecutionFill): void { this.db.connection.prepare("INSERT OR IGNORE INTO execution_fills(fill_id,execution_id,exchange_trade_id,fill_json) VALUES(?,?,?,?)").run(fill.fillId, fill.executionId, fill.exchangeTradeId, JSON.stringify(fill)); }
  listActive(): readonly ExecutionRecord[] { const rows = this.db.connection.prepare("SELECT record_json FROM execution_records WHERE state NOT IN ('RISK_REJECTED','REJECTED','FILLED','CANCELED','EXPIRED','RECONCILED') ORDER BY updated_at").all() as Array<{ record_json: string }>; return Object.freeze(rows.map((x, index) => parseStored<ExecutionRecord>(x.record_json, "execution-record", `active#${index}`))); }
}
