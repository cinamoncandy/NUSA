import type { SqliteDatabase } from "./index";
import type { DailyLossState, PaperApproval, RiskIdempotencyRecord, RiskOrderRecord, RiskSafetyPersistence } from "../../contracts/src/risk-safety-integration";

type Row = Record<string, string | number | bigint | null>;
const text = (value: string | number | bigint | null): string => String(value);

export class SqliteRiskSafetyPersistence implements RiskSafetyPersistence {
  public constructor(private readonly db: Pick<SqliteDatabase, "connection" | "transaction">) {}

  public saveApproval(approval: PaperApproval): void {
    this.db.connection.prepare("INSERT INTO risk_paper_approvals(approval_id,payload_json,expires_at_ms,status) VALUES(?,?,?,'VALID') ON CONFLICT(approval_id) DO UPDATE SET payload_json=excluded.payload_json,expires_at_ms=excluded.expires_at_ms,status='VALID'").run(approval.approvalId, JSON.stringify(approval), approval.expiresAtMs);
  }
  public loadApproval(approvalId: string): PaperApproval | undefined {
    const row = this.db.connection.prepare("SELECT payload_json FROM risk_paper_approvals WHERE approval_id=? AND status='VALID'").get(approvalId) as Row | undefined;
    return row == null ? undefined : Object.freeze(JSON.parse(text(row.payload_json)) as PaperApproval);
  }
  /** WO-0019. status flips to REVOKED so a subsequent loadApproval (status='VALID' only) can never see it again. Idempotent: revoking an already-revoked or unknown id is a no-op, never an error. */
  public revokeApproval(approvalId: string, _reason: string): void {
    this.db.connection.prepare("UPDATE risk_paper_approvals SET status='REVOKED' WHERE approval_id=? AND status='VALID'").run(approvalId);
  }
  public loadDailyLoss(accountId: string): DailyLossState | undefined {
    const row = this.db.connection.prepare("SELECT * FROM risk_daily_loss_state WHERE account_id=?").get(accountId) as Row | undefined;
    return row == null ? undefined : Object.freeze({ accountId: text(row.account_id), tradingDay: text(row.trading_day), dayStartEquity: Number(row.day_start_equity), updatedAtMs: Number(row.updated_at_ms) });
  }
  public saveDailyLoss(state: DailyLossState): void {
    this.db.connection.prepare("INSERT INTO risk_daily_loss_state(account_id,trading_day,day_start_equity,updated_at_ms) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET trading_day=excluded.trading_day,day_start_equity=excluded.day_start_equity,updated_at_ms=excluded.updated_at_ms").run(state.accountId, state.tradingDay, state.dayStartEquity, state.updatedAtMs);
  }
  public getIdempotency(accountId: string, key: string): RiskIdempotencyRecord | undefined {
    const row = this.db.connection.prepare("SELECT * FROM risk_idempotency_records WHERE account_id=? AND (idempotency_key=? OR command_id=? OR signal_id=? OR client_order_id=?)").get(accountId, key, key, key, key) as Row | undefined;
    return row == null ? undefined : this.decodeIdempotency(row);
  }
  public claimIdempotency(record: RiskIdempotencyRecord): void {
    this.db.transaction(() => {
      const existing = this.getIdempotency(record.accountId, record.commandId) ?? this.getIdempotency(record.accountId, record.signalId) ?? this.getIdempotency(record.accountId, record.clientOrderId);
      if (existing != null) {
        if (existing.payloadFingerprint !== record.payloadFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
        throw new Error("IDEMPOTENCY_DUPLICATE");
      }
      this.db.connection.prepare("INSERT INTO risk_idempotency_records(account_id,idempotency_key,command_id,signal_id,client_order_id,payload_fingerprint,created_at_ms) VALUES(?,?,?,?,?,?,?)").run(record.accountId, record.commandId, record.commandId, record.signalId, record.clientOrderId, record.payloadFingerprint, record.createdAtMs);
      this.db.connection.prepare("INSERT INTO risk_idempotency_records(account_id,idempotency_key,command_id,signal_id,client_order_id,payload_fingerprint,created_at_ms) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(record.accountId, record.signalId, record.commandId, record.signalId, record.clientOrderId, record.payloadFingerprint, record.createdAtMs);
      this.db.connection.prepare("INSERT INTO risk_idempotency_records(account_id,idempotency_key,command_id,signal_id,client_order_id,payload_fingerprint,created_at_ms) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(record.accountId, record.clientOrderId, record.commandId, record.signalId, record.clientOrderId, record.payloadFingerprint, record.createdAtMs);
    });
  }
  public saveOrder(record: RiskOrderRecord): void { this.db.connection.prepare("INSERT INTO risk_order_state(account_id,order_id,status,updated_at_ms) VALUES(?,?,?,?) ON CONFLICT(account_id,order_id) DO UPDATE SET status=excluded.status,updated_at_ms=excluded.updated_at_ms").run(record.accountId, record.orderId, record.status, record.updatedAtMs); }
  public listOrders(accountId: string): readonly RiskOrderRecord[] { return Object.freeze((this.db.connection.prepare("SELECT * FROM risk_order_state WHERE account_id=? ORDER BY updated_at_ms ASC, order_id ASC").all(accountId) as Row[]).map((row) => Object.freeze({ accountId: text(row.account_id), orderId: text(row.order_id), status: text(row.status) as RiskOrderRecord["status"], updatedAtMs: Number(row.updated_at_ms) }))); }

  private decodeIdempotency(row: Row): RiskIdempotencyRecord { return Object.freeze({ accountId: text(row.account_id), commandId: text(row.command_id), signalId: text(row.signal_id), clientOrderId: text(row.client_order_id), payloadFingerprint: text(row.payload_fingerprint), createdAtMs: Number(row.created_at_ms) }); }
}
