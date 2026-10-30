import type { DailyLossState, RiskIdempotencyRecord, RiskOrderRecord, RiskSafetyPersistence } from "../../../packages/contracts/src/risk-safety-integration";
import { LEGACY_PAPER_ACCOUNT_ID, paperAccountIdForCapital } from "./paperTradingExecutionLoop";

const PAPER_ACCOUNT_ID = /^paper-[a-z0-9_-]{1,64}$/;
const SESSION_PEAK_KEY_PREFIX = "session-peak:";
const SESSION_PEAK_MARKER = "SESSION_PEAK_V1";

/** The PAPER account the risk rows belong to: the explicit id, else the one the runtime derives from the initial capital. */
export function resolveRiskAccountId(initialCapital: number, explicit?: string): string {
  const accountId = explicit ?? paperAccountIdForCapital(initialCapital);
  if (!PAPER_ACCOUNT_ID.test(accountId)) throw new Error("cloud PAPER risk account id is invalid");
  return accountId;
}

/**
 * Risk persistence scoped to one PAPER account. Writes and the daily-loss row always use that account. Reads that can only make
 * the decision stricter (a duplicate command, an open order) also see the rows written under the legacy "paper-default" account
 * before risk rows were keyed per account, so an old row is honoured and a command id already claimed there is never accepted
 * twice. The legacy daily-loss row is not borrowed: it is another account's starting equity.
 */
export class AccountScopedRiskPersistence implements RiskSafetyPersistence {
  public constructor(
    private readonly inner: RiskSafetyPersistence,
    private readonly accountId: string,
    private readonly legacyAccountId: string = LEGACY_PAPER_ACCOUNT_ID
  ) {}

  public saveApproval: RiskSafetyPersistence["saveApproval"] = (approval) => this.inner.saveApproval(approval);
  public loadApproval: RiskSafetyPersistence["loadApproval"] = (approvalId) => this.inner.loadApproval(approvalId);
  public revokeApproval: RiskSafetyPersistence["revokeApproval"] = (approvalId, reason) => this.inner.revokeApproval(approvalId, reason);
  public loadDailyLoss(accountId: string): DailyLossState | undefined { return this.inner.loadDailyLoss(accountId); }
  public saveDailyLoss(state: DailyLossState): void { this.inner.saveDailyLoss(state); }
  public claimIdempotency(record: RiskIdempotencyRecord): void { this.inner.claimIdempotency(record); }
  public saveOrder(record: RiskOrderRecord): void { this.inner.saveOrder(record); }

  public getIdempotency(accountId: string, key: string): RiskIdempotencyRecord | undefined {
    const own = this.inner.getIdempotency(accountId, key);
    if (own != null || accountId !== this.accountId || accountId === this.legacyAccountId) return own;
    return this.inner.getIdempotency(this.legacyAccountId, key);
  }

  public listOrders(accountId: string): readonly RiskOrderRecord[] {
    const own = this.inner.listOrders(accountId);
    if (accountId !== this.accountId || accountId === this.legacyAccountId) return own;
    return Object.freeze([...own, ...this.inner.listOrders(this.legacyAccountId)]);
  }
}

export type SessionPeakRead = Readonly<{ status: "ABSENT" } | { status: "OK"; peak: number } | { status: "INVALID" }>;

/**
 * Durable high-water mark of the PAPER account equity behind the session drawdown limit. It lives in the existing risk state
 * table (risk_daily_loss_state) under a namespaced key, so no schema change is needed, and it is only ever raised.
 */
export class SessionPeakStore {
  private readonly key: string;
  public constructor(private readonly persistence: RiskSafetyPersistence, accountId: string, private readonly floor: number) {
    this.key = `${SESSION_PEAK_KEY_PREFIX}${accountId}`;
  }

  /** A read error propagates to the caller, which must treat it as "peak unknown". */
  public read(): SessionPeakRead {
    const row = this.persistence.loadDailyLoss(this.key);
    if (row == null) return Object.freeze({ status: "ABSENT" as const });
    if (row.tradingDay !== SESSION_PEAK_MARKER || typeof row.dayStartEquity !== "number" || !Number.isFinite(row.dayStartEquity) || row.dayStartEquity < this.floor) {
      return Object.freeze({ status: "INVALID" as const });
    }
    return Object.freeze({ status: "OK" as const, peak: row.dayStartEquity });
  }

  public write(peak: number, nowMs: number): void {
    if (!Number.isFinite(peak) || peak < this.floor) throw new Error("session peak is invalid");
    this.persistence.saveDailyLoss(Object.freeze({ accountId: this.key, tradingDay: SESSION_PEAK_MARKER, dayStartEquity: peak, updatedAtMs: nowMs }));
  }
}
