import { createHash } from "node:crypto";

export type RiskBoundary = "MANUAL" | "STRATEGY" | "RECONNECT_REPLAY" | "SHADOW" | "CANARY";
export type CanonicalRiskStatus = "APPROVED" | "REJECTED" | "BLOCKED" | "UNKNOWN";
export type PaperOrderStatus = "OPEN" | "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";

export interface ApprovalScope {
  readonly mode: "PAPER";
  readonly symbol: string;
  readonly strategyId: string;
  readonly policyFingerprint: string;
  readonly expiresAtMs: number;
  /**
   * WO-0019. Set only on a MANUAL approval: binds it to the exact side that was confirmed,
   * so a quantity/side change after confirmation cannot ride on the same approval.
   */
  readonly side?: "BUY" | "SELL";
  /**
   * WO-0019. Set only on a MANUAL approval: binds it to the single commandId it was minted
   * for. A different commandId can never satisfy scope, which is what makes a MANUAL
   * approval single-use by construction -- there is no separate "consumed" flag to forget
   * to check.
   */
  readonly commandId?: string;
}

export interface PaperApproval extends ApprovalScope {
  readonly approvalId: string;
  readonly approvedBy: string;
  readonly approvedAtMs: number;
}

export interface DailyLossState {
  readonly accountId: string;
  readonly tradingDay: string;
  readonly dayStartEquity: number;
  readonly updatedAtMs: number;
}

export interface RiskIdempotencyRecord {
  readonly accountId: string;
  readonly commandId: string;
  readonly signalId: string;
  readonly clientOrderId: string;
  readonly payloadFingerprint: string;
  readonly createdAtMs: number;
}

export interface RiskOrderRecord {
  readonly accountId: string;
  readonly orderId: string;
  readonly status: PaperOrderStatus;
  readonly updatedAtMs: number;
}

export interface RiskSafetyPersistence {
  saveApproval(approval: PaperApproval): void;
  loadApproval(approvalId: string): PaperApproval | undefined;
  /** WO-0019. Invalidates an approval so a later loadApproval can never see it as VALID again. */
  revokeApproval(approvalId: string, reason: string): void;
  loadDailyLoss(accountId: string): DailyLossState | undefined;
  saveDailyLoss(state: DailyLossState): void;
  getIdempotency(accountId: string, key: string): RiskIdempotencyRecord | undefined;
  claimIdempotency(record: RiskIdempotencyRecord): void;
  saveOrder(record: RiskOrderRecord): void;
  listOrders(accountId: string): readonly RiskOrderRecord[];
}

export class InMemoryRiskSafetyPersistence implements RiskSafetyPersistence {
  private readonly approvals = new Map<string, PaperApproval>();
  private readonly dailyLoss = new Map<string, DailyLossState>();
  private readonly idempotency = new Map<string, RiskIdempotencyRecord>();
  private readonly orders = new Map<string, RiskOrderRecord>();

  public saveApproval(approval: PaperApproval): void { this.approvals.set(approval.approvalId, Object.freeze({ ...approval })); }
  public loadApproval(approvalId: string): PaperApproval | undefined { return this.approvals.get(approvalId); }
  public revokeApproval(approvalId: string): void { this.approvals.delete(approvalId); }
  public loadDailyLoss(accountId: string): DailyLossState | undefined { return this.dailyLoss.get(accountId); }
  public saveDailyLoss(state: DailyLossState): void { this.dailyLoss.set(state.accountId, Object.freeze({ ...state })); }
  public getIdempotency(accountId: string, key: string): RiskIdempotencyRecord | undefined { return this.idempotency.get(`${accountId}:${key}`); }
  public claimIdempotency(record: RiskIdempotencyRecord): void {
    const keys = [record.commandId, record.signalId, record.clientOrderId].map((key) => `${record.accountId}:${key}`);
    const existing = keys.map((key) => this.idempotency.get(key)).find(Boolean);
    if (existing != null && existing.payloadFingerprint !== record.payloadFingerprint) throw new Error("IDEMPOTENCY_CONFLICT");
    if (existing != null) throw new Error("IDEMPOTENCY_DUPLICATE");
    const frozen = Object.freeze({ ...record });
    for (const key of keys) this.idempotency.set(key, frozen);
  }
  public saveOrder(record: RiskOrderRecord): void { this.orders.set(`${record.accountId}:${record.orderId}`, Object.freeze({ ...record })); }
  public listOrders(accountId: string): readonly RiskOrderRecord[] { return Object.freeze([...this.orders.values()].filter((order) => order.accountId === accountId)); }
}

export interface CanonicalRiskRequest {
  readonly accountId: string;
  readonly requestId: string;
  readonly boundary: RiskBoundary;
  readonly mode: "PAPER" | "SHADOW" | "LIVE";
  readonly symbol: string;
  readonly side: "BUY" | "SELL";
  readonly strategyId: string;
  readonly policyFingerprint: string;
  readonly approvalId?: string;
  readonly nowMs: number;
  readonly currentEquity: number;
  readonly marketDataFresh: boolean;
  readonly marketHealthy: boolean;
  readonly killSwitchActive: boolean;
  readonly liveMutationAllowed: false;
  readonly recoveryReady: boolean;
  readonly persistenceHealthy: boolean;
  readonly maxDailyLoss: number;
  readonly maxOpenOrders: number;
  readonly idempotency: RiskIdempotencyRecord;
}

export interface CanonicalRiskDecision {
  readonly status: CanonicalRiskStatus;
  readonly reasonCodes: readonly string[];
  readonly reason: string;
  readonly evaluatedAtMs: number;
  readonly decisionId: string;
  readonly productionMutationAllowed: false;
  readonly dashboard: Readonly<{ status: CanonicalRiskStatus; reasonCodes: readonly string[] }>;
}

export interface PaperBrokerPort { submit(request: CanonicalRiskRequest): void; }

const DAY_TIME_ZONE = "Asia/Seoul";
const isSafeTime = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const requireText = (value: string, name: string): void => { if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`); };

export function tradingDayKey(nowMs: number): string {
  if (!isSafeTime(nowMs)) throw new Error("valid timestamp is required");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(nowMs));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function countOpenOrders(orders: readonly RiskOrderRecord[]): number {
  return orders.filter((order) => order.status === "OPEN" || order.status === "PENDING").length;
}

function stableFingerprint(request: CanonicalRiskRequest): string {
  return createHash("sha256").update(JSON.stringify({ accountId: request.accountId, boundary: request.boundary, mode: request.mode, symbol: request.symbol, strategyId: request.strategyId, policyFingerprint: request.policyFingerprint, idempotency: request.idempotency }), "utf8").digest("hex");
}

export class CanonicalRiskSafetyGate {
  public constructor(private readonly persistence: RiskSafetyPersistence) {}

  public saveApproval(approval: PaperApproval): void {
    requireText(approval.approvalId, "approvalId"); requireText(approval.symbol, "approval.symbol"); requireText(approval.strategyId, "approval.strategyId"); requireText(approval.policyFingerprint, "approval.policyFingerprint"); requireText(approval.approvedBy, "approval.approvedBy");
    if (approval.mode !== "PAPER") throw new Error("approval mode must be PAPER");
    if (!isSafeTime(approval.expiresAtMs) || !isSafeTime(approval.approvedAtMs) || approval.expiresAtMs <= approval.approvedAtMs) throw new Error("approval expiry is invalid");
    if (approval.side !== undefined && approval.side !== "BUY" && approval.side !== "SELL") throw new Error("approval side is invalid");
    if (approval.commandId !== undefined) requireText(approval.commandId, "approval.commandId");
    this.persistence.saveApproval(Object.freeze({ ...approval }));
  }

  /** WO-0019. The only way an approval stops being usable before it naturally expires. */
  public revokeApproval(approvalId: string, reason: string): void {
    requireText(approvalId, "approvalId");
    requireText(reason, "reason");
    this.persistence.revokeApproval(approvalId, reason);
  }

  public evaluate(request: CanonicalRiskRequest): CanonicalRiskDecision {
    const reasonCodes: string[] = [];
    const reject = (code: string): void => { if (!reasonCodes.includes(code)) reasonCodes.push(code); };
    try {
      if (!request.persistenceHealthy) reject("PERSISTENCE_UNHEALTHY");
      if (!request.recoveryReady) reject("RECOVERY_PENDING");
      if (request.mode !== "PAPER") reject("LIVE_CAPABILITY_DETECTED");
      if (request.liveMutationAllowed !== false) reject("LIVE_MUTATION_NOT_DISABLED");
      if (request.killSwitchActive) reject("KILL_SWITCH_ACTIVE");
      if (!request.marketDataFresh || !request.marketHealthy) reject("MARKET_DATA_STALE");
      if (request.boundary === "SHADOW") reject("SHADOW_EVALUATION_ONLY");
      if (!isSafeTime(request.nowMs) || !Number.isFinite(request.currentEquity) || request.currentEquity < 0 || request.maxDailyLoss < 0 || request.maxOpenOrders < 0) reject("INVALID_REQUEST");
      const day = tradingDayKey(request.nowMs);
      const savedDay = this.persistence.loadDailyLoss(request.accountId);
      const dayState = savedDay?.tradingDay === day ? savedDay : { accountId: request.accountId, tradingDay: day, dayStartEquity: request.currentEquity, updatedAtMs: request.nowMs };
      if (savedDay?.tradingDay !== day) this.persistence.saveDailyLoss(dayState);
      const dailyPnL = request.currentEquity - dayState.dayStartEquity;
      if (dailyPnL < -request.maxDailyLoss) reject("DAILY_LOSS_LIMIT");
      const openOrderCount = countOpenOrders(this.persistence.listOrders(request.accountId));
      if (openOrderCount >= request.maxOpenOrders) reject("OPEN_ORDER_LIMIT");
      const approval = request.approvalId == null ? undefined : this.persistence.loadApproval(request.approvalId);
      if (request.boundary !== "SHADOW" && approval == null) reject("APPROVAL_MISSING");
      if (approval != null) {
        if (approval.expiresAtMs <= request.nowMs) reject("APPROVAL_EXPIRED");
        if (approval.mode !== request.mode || approval.symbol !== request.symbol || approval.strategyId !== request.strategyId) reject("APPROVAL_SCOPE_MISMATCH");
        if (approval.policyFingerprint !== request.policyFingerprint) reject("RISK_POLICY_FINGERPRINT_MISMATCH");
        if (approval.commandId !== undefined && approval.commandId !== request.idempotency.commandId) reject("APPROVAL_SCOPE_MISMATCH");
        if (approval.side !== undefined && approval.side !== request.side) reject("APPROVAL_SCOPE_MISMATCH");
      }
      const idempotencyKeys = [request.idempotency.commandId, request.idempotency.signalId, request.idempotency.clientOrderId];
      if (idempotencyKeys.some((key) => this.persistence.getIdempotency(request.accountId, key) != null)) reject("DUPLICATE_COMMAND");
      const failClosedCodes = ["PERSISTENCE_UNHEALTHY", "RECOVERY_PENDING", "LIVE_CAPABILITY_DETECTED", "LIVE_MUTATION_NOT_DISABLED", "KILL_SWITCH_ACTIVE", "MARKET_DATA_STALE", "SHADOW_EVALUATION_ONLY", "INVALID_REQUEST", "APPROVAL_MISSING", "APPROVAL_EXPIRED", "APPROVAL_SCOPE_MISMATCH", "RISK_POLICY_FINGERPRINT_MISMATCH", "DUPLICATE_COMMAND"];
      const status: CanonicalRiskStatus = reasonCodes.length === 0 ? "APPROVED" : reasonCodes.some((code) => failClosedCodes.includes(code)) ? "BLOCKED" : "REJECTED";
      if (status === "APPROVED") {
        try { this.persistence.claimIdempotency({ ...request.idempotency, payloadFingerprint: stableFingerprint(request) }); }
        catch (error) { reject(error instanceof Error && error.message === "IDEMPOTENCY_DUPLICATE" ? "DUPLICATE_COMMAND" : "PERSISTENCE_UNHEALTHY"); }
      }
      const finalStatus: CanonicalRiskStatus = reasonCodes.length === 0 ? status : status === "APPROVED" ? "UNKNOWN" : status;
      return this.decision(finalStatus, reasonCodes, request.nowMs);
    } catch (error) {
      return this.decision("UNKNOWN", ["PERSISTENCE_UNHEALTHY"], request.nowMs, error instanceof Error ? error.message : "risk evaluation failed");
    }
  }

  public evaluateAndSubmit(request: CanonicalRiskRequest, broker: PaperBrokerPort): CanonicalRiskDecision {
    const decision = this.evaluate(request);
    if (decision.status === "APPROVED" && request.boundary !== "SHADOW") {
      try { broker.submit(request); }
      catch (error) { return this.decision("UNKNOWN", ["BROKER_SUBMISSION_FAILED"], request.nowMs, error instanceof Error ? error.message : "broker submission failed"); }
    }
    return decision;
  }

  public projectDashboard(decision: CanonicalRiskDecision): Readonly<{ status: CanonicalRiskStatus; reasonCodes: readonly string[] }> {
    try {
      if (decision.productionMutationAllowed !== false || !Array.isArray(decision.reasonCodes)) throw new Error("invalid risk projection");
      return Object.freeze({ status: decision.status, reasonCodes: Object.freeze([...decision.reasonCodes]) });
    } catch { return Object.freeze({ status: "BLOCKED", reasonCodes: Object.freeze(["PROJECTION_UNHEALTHY"]) }); }
  }

  private decision(status: CanonicalRiskStatus, reasonCodes: readonly string[], evaluatedAtMs: number, reason = reasonCodes.join(",") || "APPROVED"): CanonicalRiskDecision {
    const frozenCodes = Object.freeze([...new Set(reasonCodes)].sort());
    const decision = Object.freeze({ status, reasonCodes: frozenCodes, reason, evaluatedAtMs, decisionId: createHash("sha256").update(`${status}|${frozenCodes.join("|")}|${evaluatedAtMs}`, "utf8").digest("hex").slice(0, 24), productionMutationAllowed: false as const, dashboard: Object.freeze({ status, reasonCodes: frozenCodes }) });
    return decision;
  }
}
