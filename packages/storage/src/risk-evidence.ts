import type { DatabaseSync } from "node:sqlite";
import type { RiskDecision, RiskEvidenceRepository, RiskResult } from "../../contracts/src/global-risk-gateway";

type Row = { decision_id: string; result: string; policy_version: string; reason_codes: string; observed_at: string; execution_id: string; rule_id: string; input_parameters: string; account_state: string; market_state: string; correlation_id: string };
export interface RiskEvidenceDatabase { readonly connection: DatabaseSync; }

export class SqliteRiskEvidenceRepository implements RiskEvidenceRepository {
  public constructor(private readonly db: RiskEvidenceDatabase) {
    this.db.connection.exec("CREATE TABLE IF NOT EXISTS risk_decision_evidence (decision_id TEXT PRIMARY KEY, result TEXT NOT NULL, policy_version TEXT NOT NULL, reason_codes TEXT NOT NULL, observed_at TEXT NOT NULL, execution_id TEXT NOT NULL, rule_id TEXT NOT NULL, input_parameters TEXT NOT NULL, account_state TEXT NOT NULL, market_state TEXT NOT NULL, correlation_id TEXT NOT NULL UNIQUE); CREATE INDEX IF NOT EXISTS idx_risk_evidence_execution ON risk_decision_evidence(execution_id, observed_at, decision_id);");
  }

  public append(record: RiskDecision): void {
    if (!record.decisionId.trim() || !record.executionId.trim() || !record.policyVersion.trim()) throw new Error("risk evidence identity is required");
    if (!Array.isArray(record.reasonCodes)) throw new Error("risk evidence reason codes are invalid");
    this.db.connection.prepare("INSERT INTO risk_decision_evidence(decision_id,result,policy_version,reason_codes,observed_at,execution_id,rule_id,input_parameters,account_state,market_state,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(record.decisionId, record.result, record.policyVersion, JSON.stringify([...record.reasonCodes]), record.observedAt, record.executionId, record.ruleId, JSON.stringify(record.inputParameters), JSON.stringify(record.accountState), JSON.stringify(record.marketState), record.correlationId);
  }

  public getByDecisionId(decisionId: string): RiskDecision | undefined {
    const row = this.db.connection.prepare("SELECT * FROM risk_decision_evidence WHERE decision_id=?").get(decisionId) as Row | undefined;
    return row === undefined ? undefined : decode(row);
  }

  public list(filter: Readonly<{ result?: RiskResult; executionId?: string }> = {}): readonly RiskDecision[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.result !== undefined) { clauses.push("result=?"); values.push(filter.result); }
    if (filter.executionId !== undefined) { clauses.push("execution_id=?"); values.push(filter.executionId); }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    const rows = this.db.connection.prepare(`SELECT * FROM risk_decision_evidence${where} ORDER BY observed_at ASC, decision_id ASC`).all(...values) as Row[];
    return Object.freeze(rows.map(decode));
  }
}

function decode(row: Row): RiskDecision {
  return Object.freeze({ decisionId: row.decision_id, result: row.result as RiskResult, policyVersion: row.policy_version, reasonCodes: Object.freeze(JSON.parse(row.reason_codes) as string[]), observedAt: row.observed_at, executionId: row.execution_id, ruleId: row.rule_id, inputParameters: Object.freeze(JSON.parse(row.input_parameters)), accountState: Object.freeze(JSON.parse(row.account_state)), marketState: Object.freeze(JSON.parse(row.market_state)), correlationId: row.correlation_id });
}
