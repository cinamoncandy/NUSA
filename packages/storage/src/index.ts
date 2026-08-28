import { DatabaseSync } from "node:sqlite";
import {
  LedgerSide, PositionScopeType, PositionStatus, type PositionLedgerEntry, type PositionSnapshot,
  type StrategyPositionSnapshot, type WalletPositionSnapshot,
  emptyStrategyPositionSnapshot, emptyWalletPositionSnapshot
} from "../../contracts/src/index";
import { runMigrations, type MigrationResult, type SqliteMigration } from "./migrationRunner";

export { runMigrations } from "./migrationRunner";
export type { MigrationResult, SqliteMigration } from "./migrationRunner";
export { SqliteResearchMemoryRepository } from "./researchMemory";
export type { HypothesisStatus, ResearchExperimentRecord, ResearchHypothesis, ResearchMemoryDatabase } from "./researchMemory";
export { SqliteComplianceControlPlaneStore } from "./complianceControlPlaneStore";
export type { ComplianceDatabase } from "./complianceControlPlaneStore";
export { SqliteResilienceControlPlaneStore } from "./resilienceControlPlaneStore";
export { SqliteImprovementCandidateMemory } from "./improvementCandidateMemory";
export type { ImprovementCandidateMemoryDatabase, ImprovementCandidateMemoryRecord } from "./improvementCandidateMemory";
export { SqliteRulesControlPlaneStore } from "./rulesControlPlaneStore";
export type { RulesDatabase } from "./rulesControlPlaneStore";
export { SqliteMultiAgentGovernanceStore } from "./multiAgentGovernanceStore";
export type { MultiAgentGovernanceDatabase } from "./multiAgentGovernanceStore";
export { SqliteRiskSafetyPersistence } from "./risk-safety";
export { SqliteResearchEvaluationLedger } from "./researchEvaluationLedger";
export type { ResearchEvaluationDatabase } from "./researchEvaluationLedger";
export { SqliteResearchHypothesisLifecycleRepository } from "./researchHypothesisLifecycle";
export type { ResearchHypothesisLifecycleDatabase } from "./researchHypothesisLifecycle";
export { SqliteCandidatePromotionRepository } from "./candidatePromotionRepository";
export type { CandidatePromotionDatabase, PromotionAtomicInput } from "./candidatePromotionRepository";
export { SqliteResearchSessionRepository } from "./researchAutomation";
export type { ResearchAutomationDatabase } from "./researchAutomation";

type SqlRow = Record<string, string | number | bigint | null>;
type LedgerFilter = Pick<PositionLedgerEntry, "walletId" | "strategyId" | "symbol">;

export interface PositionLedgerRepository {
  append(entry: PositionLedgerEntry): PositionLedgerEntry;
  list(filter?: Partial<LedgerFilter>): readonly PositionLedgerEntry[];
  getById(id: string): PositionLedgerEntry | undefined;
}

export interface WalletPositionSnapshotRepository {
  get(walletId: string, symbol: string): WalletPositionSnapshot | undefined;
  save(snapshot: WalletPositionSnapshot): WalletPositionSnapshot;
  list(): readonly WalletPositionSnapshot[];
}

export interface StrategyPositionSnapshotRepository {
  get(walletId: string, strategyId: string, symbol: string): StrategyPositionSnapshot | undefined;
  save(snapshot: StrategyPositionSnapshot): StrategyPositionSnapshot;
  list(): readonly StrategyPositionSnapshot[];
}

export interface AppliedLedgerMarkerRepository {
  tryMarkApplied(scopeType: PositionScopeType, scopeId: string, entry: PositionLedgerEntry): boolean;
  clearScope(scopeType: PositionScopeType, scopeId: string): void;
  list(scopeType: PositionScopeType, scopeId: string): readonly { ledgerEntryId: string; ledgerOrderKey: string }[];
}

export interface TransactionRunner { transaction<T>(fn: () => T): T; }

export function ledgerKey(entry: PositionLedgerEntry): string { return `${entry.ts}|${entry.createdAt}|${entry.id}`; }
const walletScopeId = (walletId: string, symbol: string): string => `${walletId}|${symbol}`;
const strategyScopeId = (walletId: string, strategyId: string, symbol: string): string => `${walletId}|${strategyId}|${symbol}`;
const raw = (value: bigint | undefined): string | null => value == null ? null : value.toString();
const fromRaw = (value: string | number | bigint | null): bigint | undefined => value == null ? undefined : BigInt(value);
const asString = (value: string | number | bigint | null): string => String(value);

function decodeLedger(row: SqlRow): PositionLedgerEntry {
  return Object.freeze({ id: asString(row.id), walletId: asString(row.wallet_id), strategyId: row.strategy_id == null ? undefined : asString(row.strategy_id), symbol: asString(row.symbol), side: asString(row.side) as LedgerSide, baseQtyRaw: BigInt(asString(row.base_qty_raw)), quoteQtyRaw: fromRaw(row.quote_qty_raw), ts: asString(row.ts), createdAt: asString(row.created_at), sourceTradeId: row.source_trade_id == null ? undefined : asString(row.source_trade_id) });
}

function decodeWalletSnapshot(row: SqlRow): WalletPositionSnapshot {
  return Object.freeze({ scopeType: PositionScopeType.WALLET, walletId: asString(row.wallet_id), symbol: asString(row.symbol), baseQtyRaw: BigInt(asString(row.base_qty_raw)), quoteCostRaw: BigInt(asString(row.quote_cost_raw)), avgEntryPriceRaw: fromRaw(row.avg_entry_price_raw), realizedPnlRaw: BigInt(asString(row.realized_pnl_raw)), status: asString(row.status) as PositionStatus, lastLedgerEntryId: row.last_ledger_entry_id == null ? undefined : asString(row.last_ledger_entry_id), lastLedgerOrderKey: row.last_ledger_order_key == null ? undefined : asString(row.last_ledger_order_key), version: Number(row.version) });
}

function decodeStrategySnapshot(row: SqlRow): StrategyPositionSnapshot {
  return Object.freeze({ ...decodeWalletSnapshot(row), scopeType: PositionScopeType.STRATEGY, strategyId: asString(row.strategy_id) });
}

export function applyLedgerEntryToSnapshot(snapshot: PositionSnapshot, entry: PositionLedgerEntry): PositionSnapshot {
  const entryOrder = ledgerKey(entry);
  if (snapshot.lastLedgerOrderKey != null && snapshot.lastLedgerOrderKey > entryOrder) throw new Error("ledger order regression rejected");
  if (snapshot.lastLedgerEntryId === entry.id) return snapshot;
  let baseQtyRaw = snapshot.baseQtyRaw;
  let quoteCostRaw = snapshot.quoteCostRaw;
  let realizedPnlRaw = snapshot.realizedPnlRaw;
  if (entry.side === LedgerSide.BUY) {
    baseQtyRaw += entry.baseQtyRaw;
    if (entry.quoteQtyRaw != null) quoteCostRaw += entry.quoteQtyRaw;
  } else {
    if (entry.baseQtyRaw > baseQtyRaw) throw new Error("oversell rejected");
    const soldCostRaw = baseQtyRaw === 0n ? 0n : quoteCostRaw * entry.baseQtyRaw / baseQtyRaw;
    if (entry.quoteQtyRaw != null) realizedPnlRaw += entry.quoteQtyRaw - soldCostRaw;
    baseQtyRaw -= entry.baseQtyRaw;
    quoteCostRaw -= soldCostRaw;
    if (baseQtyRaw === 0n) quoteCostRaw = 0n;
  }
  return Object.freeze({ ...snapshot, baseQtyRaw, quoteCostRaw, avgEntryPriceRaw: baseQtyRaw === 0n ? undefined : quoteCostRaw / baseQtyRaw, realizedPnlRaw, status: baseQtyRaw === 0n ? PositionStatus.CLOSED : PositionStatus.OPEN, lastLedgerEntryId: entry.id, lastLedgerOrderKey: entryOrder, version: snapshot.version + 1 });
}

export class SqliteDatabase implements TransactionRunner {
  public readonly connection: DatabaseSync;
  public readonly migrationResult: MigrationResult;
  private inTransaction = false;
  public constructor(filename = ":memory:") {
    this.connection = new DatabaseSync(filename);
    try {
      this.connection.exec("PRAGMA foreign_keys = ON");
      this.connection.exec("PRAGMA busy_timeout = 5000");
      if (filename !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL");
      this.connection.exec("PRAGMA synchronous = FULL");
      this.migrationResult = runMigrations(this.connection, migrations);
      const check = this.connection.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
      if (check == null || !Object.values(check).includes("ok")) throw new Error("sqlite quick_check failed");
    } catch (error) {
      this.connection.close();
      throw error;
    }
  }
  public transaction<T>(fn: () => T): T {
    if (this.inTransaction) return fn();
    this.inTransaction = true;
    this.connection.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.connection.exec("COMMIT"); return result; }
    catch (error) { this.connection.exec("ROLLBACK"); throw error; }
    finally { this.inTransaction = false; }
  }
  public close(): void { this.connection.close(); }
}

export class SqlitePositionLedgerRepository implements PositionLedgerRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public append(entry: PositionLedgerEntry): PositionLedgerEntry {
    this.db.connection.prepare("INSERT INTO position_ledger_entries (id, wallet_id, strategy_id, symbol, side, base_qty_raw, quote_qty_raw, ts, created_at, source_trade_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").run(entry.id, entry.walletId, entry.strategyId ?? null, entry.symbol, entry.side, raw(entry.baseQtyRaw), raw(entry.quoteQtyRaw), entry.ts, entry.createdAt, entry.sourceTradeId ?? null);
    const stored = this.getById(entry.id);
    if (stored == null) throw new Error("ledger append did not persist");
    return stored;
  }
  public getById(id: string): PositionLedgerEntry | undefined {
    const row = this.db.connection.prepare("SELECT * FROM position_ledger_entries WHERE id = ?").get(id) as SqlRow | undefined;
    return row == null ? undefined : decodeLedger(row);
  }
  public list(filter: Partial<LedgerFilter> = {}): readonly PositionLedgerEntry[] {
    const clauses: string[] = []; const values: string[] = [];
    if (filter.walletId != null) { clauses.push("wallet_id = ?"); values.push(filter.walletId); }
    if (filter.strategyId != null) { clauses.push("strategy_id = ?"); values.push(filter.strategyId); }
    if (filter.symbol != null) { clauses.push("symbol = ?"); values.push(filter.symbol); }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    return (this.db.connection.prepare(`SELECT * FROM position_ledger_entries${where} ORDER BY ts ASC, created_at ASC, id ASC`).all(...values) as SqlRow[]).map(decodeLedger);
  }
}

export class SqliteWalletPositionSnapshotRepository implements WalletPositionSnapshotRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public get(walletId: string, symbol: string): WalletPositionSnapshot | undefined {
    const row = this.db.connection.prepare("SELECT * FROM wallet_position_snapshots WHERE wallet_id = ? AND symbol = ?").get(walletId, symbol) as SqlRow | undefined;
    return row == null ? undefined : decodeWalletSnapshot(row);
  }
  public save(snapshot: WalletPositionSnapshot): WalletPositionSnapshot {
    this.db.connection.prepare("INSERT INTO wallet_position_snapshots (wallet_id, symbol, base_qty_raw, quote_cost_raw, avg_entry_price_raw, realized_pnl_raw, status, last_ledger_entry_id, last_ledger_order_key, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(wallet_id, symbol) DO UPDATE SET base_qty_raw=excluded.base_qty_raw, quote_cost_raw=excluded.quote_cost_raw, avg_entry_price_raw=excluded.avg_entry_price_raw, realized_pnl_raw=excluded.realized_pnl_raw, status=excluded.status, last_ledger_entry_id=excluded.last_ledger_entry_id, last_ledger_order_key=excluded.last_ledger_order_key, version=excluded.version").run(snapshot.walletId, snapshot.symbol, raw(snapshot.baseQtyRaw), raw(snapshot.quoteCostRaw), raw(snapshot.avgEntryPriceRaw), raw(snapshot.realizedPnlRaw), snapshot.status, snapshot.lastLedgerEntryId ?? null, snapshot.lastLedgerOrderKey ?? null, snapshot.version);
    return this.get(snapshot.walletId, snapshot.symbol)!;
  }
  public list(): readonly WalletPositionSnapshot[] { return (this.db.connection.prepare("SELECT * FROM wallet_position_snapshots ORDER BY wallet_id ASC, symbol ASC").all() as SqlRow[]).map(decodeWalletSnapshot); }
}

export class SqliteStrategyPositionSnapshotRepository implements StrategyPositionSnapshotRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public get(walletId: string, strategyId: string, symbol: string): StrategyPositionSnapshot | undefined {
    const row = this.db.connection.prepare("SELECT * FROM strategy_position_snapshots WHERE wallet_id = ? AND strategy_id = ? AND symbol = ?").get(walletId, strategyId, symbol) as SqlRow | undefined;
    return row == null ? undefined : decodeStrategySnapshot(row);
  }
  public save(snapshot: StrategyPositionSnapshot): StrategyPositionSnapshot {
    this.db.connection.prepare("INSERT INTO strategy_position_snapshots (wallet_id, strategy_id, symbol, base_qty_raw, quote_cost_raw, avg_entry_price_raw, realized_pnl_raw, status, last_ledger_entry_id, last_ledger_order_key, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(wallet_id, strategy_id, symbol) DO UPDATE SET base_qty_raw=excluded.base_qty_raw, quote_cost_raw=excluded.quote_cost_raw, avg_entry_price_raw=excluded.avg_entry_price_raw, realized_pnl_raw=excluded.realized_pnl_raw, status=excluded.status, last_ledger_entry_id=excluded.last_ledger_entry_id, last_ledger_order_key=excluded.last_ledger_order_key, version=excluded.version").run(snapshot.walletId, snapshot.strategyId, snapshot.symbol, raw(snapshot.baseQtyRaw), raw(snapshot.quoteCostRaw), raw(snapshot.avgEntryPriceRaw), raw(snapshot.realizedPnlRaw), snapshot.status, snapshot.lastLedgerEntryId ?? null, snapshot.lastLedgerOrderKey ?? null, snapshot.version);
    return this.get(snapshot.walletId, snapshot.strategyId, snapshot.symbol)!;
  }
  public list(): readonly StrategyPositionSnapshot[] { return (this.db.connection.prepare("SELECT * FROM strategy_position_snapshots ORDER BY wallet_id ASC, strategy_id ASC, symbol ASC").all() as SqlRow[]).map(decodeStrategySnapshot); }
}

export class SqliteAppliedLedgerMarkerRepository implements AppliedLedgerMarkerRepository {
  public constructor(private readonly db: SqliteDatabase) {}
  public tryMarkApplied(scopeType: PositionScopeType, scopeId: string, entry: PositionLedgerEntry): boolean {
    const duplicate = this.db.connection.prepare("SELECT 1 FROM applied_ledger_markers WHERE scope_type = ? AND scope_id = ? AND ledger_entry_id = ?").get(scopeType, scopeId, entry.id);
    if (duplicate != null) return false;
    const previous = this.db.connection.prepare("SELECT ledger_order_key FROM applied_ledger_markers WHERE scope_type = ? AND scope_id = ? ORDER BY ledger_order_key DESC LIMIT 1").get(scopeType, scopeId) as SqlRow | undefined;
    const nextOrder = ledgerKey(entry);
    if (previous != null && asString(previous.ledger_order_key) > nextOrder) throw new Error("applied marker order regression rejected");
    this.db.connection.prepare("INSERT INTO applied_ledger_markers (scope_type, scope_id, ledger_entry_id, ledger_order_key) VALUES (?, ?, ?, ?)").run(scopeType, scopeId, entry.id, nextOrder);
    return true;
  }
  public clearScope(scopeType: PositionScopeType, scopeId: string): void { this.db.connection.prepare("DELETE FROM applied_ledger_markers WHERE scope_type = ? AND scope_id = ?").run(scopeType, scopeId); }
  public list(scopeType: PositionScopeType, scopeId: string): readonly { ledgerEntryId: string; ledgerOrderKey: string }[] {
    return (this.db.connection.prepare("SELECT ledger_entry_id, ledger_order_key FROM applied_ledger_markers WHERE scope_type = ? AND scope_id = ? ORDER BY ledger_order_key ASC").all(scopeType, scopeId) as SqlRow[]).map(row => Object.freeze({ ledgerEntryId: asString(row.ledger_entry_id), ledgerOrderKey: asString(row.ledger_order_key) }));
  }
}

export class WalletPositionSnapshotService {
  public constructor(private readonly ledger: PositionLedgerRepository, private readonly snapshots: WalletPositionSnapshotRepository, private readonly markers: AppliedLedgerMarkerRepository, private readonly transactions: TransactionRunner) {}
  public appendAndApply(entry: PositionLedgerEntry): WalletPositionSnapshot { return this.transactions.transaction(() => this.applyInTransaction(this.ledger.append(entry))); }
  public applyLedgerEntry(entry: PositionLedgerEntry): WalletPositionSnapshot { return this.transactions.transaction(() => this.applyInTransaction(entry)); }
  public rebuildFromLedger(walletId: string, symbol: string): WalletPositionSnapshot {
    return this.transactions.transaction(() => {
      const scopeId = walletScopeId(walletId, symbol); this.markers.clearScope(PositionScopeType.WALLET, scopeId);
      let snapshot = emptyWalletPositionSnapshot(walletId, symbol);
      for (const entry of this.ledger.list({ walletId, symbol })) { this.markers.tryMarkApplied(PositionScopeType.WALLET, scopeId, entry); snapshot = applyLedgerEntryToSnapshot(snapshot, entry) as WalletPositionSnapshot; }
      return this.snapshots.save(snapshot);
    });
  }
  private applyInTransaction(entry: PositionLedgerEntry): WalletPositionSnapshot {
    const scopeId = walletScopeId(entry.walletId, entry.symbol);
    if (!this.markers.tryMarkApplied(PositionScopeType.WALLET, scopeId, entry)) return this.snapshots.get(entry.walletId, entry.symbol) ?? emptyWalletPositionSnapshot(entry.walletId, entry.symbol);
    const current = this.snapshots.get(entry.walletId, entry.symbol) ?? emptyWalletPositionSnapshot(entry.walletId, entry.symbol);
    return this.snapshots.save(applyLedgerEntryToSnapshot(current, entry) as WalletPositionSnapshot);
  }
}

export class StrategyPositionSnapshotService {
  public constructor(private readonly ledger: PositionLedgerRepository, private readonly snapshots: StrategyPositionSnapshotRepository, private readonly markers: AppliedLedgerMarkerRepository, private readonly transactions: TransactionRunner) {}
  public appendAndApply(entry: PositionLedgerEntry): StrategyPositionSnapshot | undefined { return entry.strategyId == null ? undefined : this.transactions.transaction(() => this.applyInTransaction(this.ledger.append(entry))); }
  public applyLedgerEntry(entry: PositionLedgerEntry): StrategyPositionSnapshot | undefined { return entry.strategyId == null ? undefined : this.transactions.transaction(() => this.applyInTransaction(entry)); }
  public rebuildFromLedger(walletId: string, strategyId: string, symbol: string): StrategyPositionSnapshot {
    return this.transactions.transaction(() => {
      const scopeId = strategyScopeId(walletId, strategyId, symbol); this.markers.clearScope(PositionScopeType.STRATEGY, scopeId);
      let snapshot = emptyStrategyPositionSnapshot(walletId, strategyId, symbol);
      for (const entry of this.ledger.list({ walletId, strategyId, symbol })) { this.markers.tryMarkApplied(PositionScopeType.STRATEGY, scopeId, entry); snapshot = applyLedgerEntryToSnapshot(snapshot, entry) as StrategyPositionSnapshot; }
      return this.snapshots.save(snapshot);
    });
  }
  private applyInTransaction(entry: PositionLedgerEntry): StrategyPositionSnapshot {
    const strategyId = entry.strategyId!; const scopeId = strategyScopeId(entry.walletId, strategyId, entry.symbol);
    if (!this.markers.tryMarkApplied(PositionScopeType.STRATEGY, scopeId, entry)) return this.snapshots.get(entry.walletId, strategyId, entry.symbol) ?? emptyStrategyPositionSnapshot(entry.walletId, strategyId, entry.symbol);
    const current = this.snapshots.get(entry.walletId, strategyId, entry.symbol) ?? emptyStrategyPositionSnapshot(entry.walletId, strategyId, entry.symbol);
    return this.snapshots.save(applyLedgerEntryToSnapshot(current, entry) as StrategyPositionSnapshot);
  }
}

export const migrations: readonly SqliteMigration[] = [{ id: "001_position_accounting", sql: `
CREATE TABLE IF NOT EXISTS position_ledger_entries (id TEXT PRIMARY KEY, wallet_id TEXT NOT NULL, strategy_id TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL, base_qty_raw TEXT NOT NULL, quote_qty_raw TEXT, ts TEXT NOT NULL, created_at TEXT NOT NULL, source_trade_id TEXT);
CREATE INDEX IF NOT EXISTS idx_position_ledger_order ON position_ledger_entries (wallet_id, symbol, ts, created_at, id);
CREATE TABLE IF NOT EXISTS wallet_position_snapshots (wallet_id TEXT NOT NULL, symbol TEXT NOT NULL, base_qty_raw TEXT NOT NULL, quote_cost_raw TEXT NOT NULL, avg_entry_price_raw TEXT, realized_pnl_raw TEXT NOT NULL, status TEXT NOT NULL, last_ledger_entry_id TEXT, last_ledger_order_key TEXT, version INTEGER NOT NULL, PRIMARY KEY (wallet_id, symbol));
CREATE TABLE IF NOT EXISTS strategy_position_snapshots (wallet_id TEXT NOT NULL, strategy_id TEXT NOT NULL, symbol TEXT NOT NULL, base_qty_raw TEXT NOT NULL, quote_cost_raw TEXT NOT NULL, avg_entry_price_raw TEXT, realized_pnl_raw TEXT NOT NULL, status TEXT NOT NULL, last_ledger_entry_id TEXT, last_ledger_order_key TEXT, version INTEGER NOT NULL, PRIMARY KEY (wallet_id, strategy_id, symbol));
CREATE TABLE IF NOT EXISTS applied_ledger_markers (scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, ledger_entry_id TEXT NOT NULL, ledger_order_key TEXT NOT NULL, PRIMARY KEY (scope_type, scope_id, ledger_entry_id));
` }, { id: "002_research_memory", sql: `
CREATE TABLE IF NOT EXISTS research_hypotheses (id TEXT PRIMARY KEY, title TEXT NOT NULL, statement TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_experiment_records (id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, content_sha256 TEXT NOT NULL, manifest_schema_version INTEGER NOT NULL, market TEXT NOT NULL, interval TEXT NOT NULL, start_open_time INTEGER NOT NULL, end_close_time INTEGER NOT NULL, walk_forward_config_json TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL, hypothesis_id TEXT);
CREATE INDEX IF NOT EXISTS idx_research_experiment_dataset ON research_experiment_records (dataset_id, created_at, id);
` }, { id: "003_governance_control", sql: `
CREATE TABLE IF NOT EXISTS strategy_registry (strategy_id TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(strategy_id, version));
CREATE TABLE IF NOT EXISTS strategy_governance_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS strategy_governance_state (id INTEGER PRIMARY KEY CHECK(id = 1), snapshot_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS champion_assignments (family TEXT PRIMARY KEY, strategy_key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS strategy_governance_commands (command_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investment_committee_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, decision_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS investment_committee_snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), hash TEXT NOT NULL);
` }, { id: "004_compliance_control_plane", sql: `
CREATE TABLE IF NOT EXISTS compliance_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS compliance_state (id INTEGER PRIMARY KEY CHECK(id = 1), ledger_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS compliance_rules (rule_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(rule_id, version));
CREATE TABLE IF NOT EXISTS compliance_decisions (decision_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS surveillance_alerts (alert_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS compliance_cases (case_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS regulatory_reports (report_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence_packages (evidence_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS compliance_certifications (certification_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
` }, { id: "005_resilience_control_plane", sql: `
CREATE TABLE IF NOT EXISTS resilience_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS resilience_state (id INTEGER PRIMARY KEY CHECK(id=1), ledger_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS resilience_services (service_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS continuity_plans (plan_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(plan_id,version));
CREATE TABLE IF NOT EXISTS resilience_evidence_packages (evidence_hash TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
` }, { id: "006_rules_control_plane", sql: `
CREATE TABLE IF NOT EXISTS rules_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS rules_state (id INTEGER PRIMARY KEY CHECK(id=1), ledger_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rules (rule_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rule_versions (rule_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(rule_id, version));
CREATE TABLE IF NOT EXISTS policies (policy_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_versions (policy_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(policy_id, version));
CREATE TABLE IF NOT EXISTS decision_tables (policy_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(policy_id, version));
CREATE TABLE IF NOT EXISTS formulas (formula_id TEXT NOT NULL, version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(formula_id, version));
CREATE TABLE IF NOT EXISTS evaluations (evaluation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluation_traces (evaluation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS explanations (evaluation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS simulations (evaluation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision_evidence (evidence_hash TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision_certifications (certification_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
` }, { id: "007_multi_agent_governance", sql: `
CREATE TABLE IF NOT EXISTS multi_agent_governance_events (sequence INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, event_json TEXT NOT NULL, hash TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS multi_agent_governance_state (id INTEGER PRIMARY KEY CHECK(id=1), ledger_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_definitions (agent_id TEXT NOT NULL, definition_version TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(agent_id, definition_version));
CREATE TABLE IF NOT EXISTS agent_role_contracts (contract_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_evidence (evidence_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_context_snapshots (context_snapshot_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_runs (agent_run_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS multi_agent_orchestration_runs (orchestration_run_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS multi_agent_decisions (decision_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS multi_agent_incidents (incident_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS multi_agent_certifications (certification_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
` }, { id: "008_cloud_dashboard_snapshots", sql: `
CREATE TABLE IF NOT EXISTS cloud_dashboard_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  source_commit TEXT NOT NULL,
  source_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  saved_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('VALID','CORRUPTED','INVALID'))
);
CREATE INDEX IF NOT EXISTS idx_cloud_dashboard_snapshots_latest ON cloud_dashboard_snapshots (status, saved_at DESC);
` }, { id: "009_cloud_paper_accounts", sql: `
CREATE TABLE IF NOT EXISTS cloud_paper_accounts (
  account_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('VALID','CORRUPTED','INVALID'))
);
` }, { id: "010_risk_safety_integration", sql: `
CREATE TABLE IF NOT EXISTS risk_paper_approvals (
  approval_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('VALID','REVOKED'))
);
CREATE TABLE IF NOT EXISTS risk_daily_loss_state (
  account_id TEXT PRIMARY KEY,
  trading_day TEXT NOT NULL,
  day_start_equity REAL NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS risk_idempotency_records (
  account_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, idempotency_key),
  UNIQUE (account_id, command_id),
  UNIQUE (account_id, signal_id),
  UNIQUE (account_id, client_order_id)
);
CREATE TABLE IF NOT EXISTS risk_order_state (
  account_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','PENDING','FILLED','CANCELLED','REJECTED')),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, order_id)
);
` }, { id: "011_research_evaluation_ledger", sql: `
CREATE TABLE IF NOT EXISTS research_evaluation_ledger (
  sequence INTEGER PRIMARY KEY,
  evaluation_id TEXT NOT NULL UNIQUE,
  previous_hash TEXT NOT NULL,
  record_json TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
` }, { id: "012_candidate_promotion_runtime", sql: `
CREATE TABLE IF NOT EXISTS research_candidates (
  candidate_id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  lifecycle TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_champion_pointer (id INTEGER PRIMARY KEY CHECK(id = 1), candidate_id TEXT, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS research_promotion_commands (command_id TEXT PRIMARY KEY, payload_fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS research_promotion_audit (sequence INTEGER PRIMARY KEY, command_id TEXT NOT NULL, previous_hash TEXT NOT NULL, record_json TEXT NOT NULL, current_hash TEXT NOT NULL UNIQUE);
` }, { id: "013_research_automation_sessions", sql: `
CREATE TABLE IF NOT EXISTS research_sessions (
  session_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('IDLE','RUNNING','PAUSED','HALTED','COMPLETED','FAILED')),
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sessions_state ON research_sessions (state, updated_at, session_id);
` }, { id: "014_research_hypothesis_events", sql: `
CREATE TABLE IF NOT EXISTS research_hypothesis_events (
  sequence INTEGER PRIMARY KEY,
  hypothesis_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('CREATED','ACTIVATED','SUPPORTED','REJECTED','RETIRED')),
  title TEXT NOT NULL,
  statement TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_research_hypothesis_events_id ON research_hypothesis_events (hypothesis_id, sequence);
` }, { id: "015_cloud_paper_writer_lease", sql: `
CREATE TABLE IF NOT EXISTS cloud_paper_writer_leases (
  account_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_until_ms INTEGER NOT NULL,
  heartbeat_at_ms INTEGER NOT NULL
);
` }, { id: "016_improvement_candidate_memory", sql: `
CREATE TABLE IF NOT EXISTS improvement_candidate_memory (
  fingerprint TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  severity TEXT NOT NULL,
  score INTEGER NOT NULL,
  occurrences INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_improvement_candidate_memory_retention ON improvement_candidate_memory (score ASC, last_seen_at DESC, fingerprint DESC);
` }, { id: "017_paper_realized_periods", sql: `
CREATE TABLE IF NOT EXISTS paper_realized_periods (
  period_id TEXT PRIMARY KEY,
  period_index INTEGER NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('OPEN','REALIZED')),
  period_start_at INTEGER NOT NULL,
  period_end_at INTEGER,
  payload_json TEXT NOT NULL,
  checksum TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_realized_periods_order
  ON paper_realized_periods (lifecycle_state, period_index ASC, period_id ASC);
` }];
