import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteRiskSafetyPersistence } from "../../../packages/storage/src/index";
import type { PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import { CanonicalRiskSafetyGate } from "../../../packages/contracts/src/risk-safety-integration";
import { evaluatePreTradeRisk, type IndependentRiskLimits, type RiskIdentityState } from "./independentRiskGateway";
import { RUNTIME_EXCHANGE_CAPABILITIES } from "./runtimeExchangeCapabilities";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const ACCOUNT_ID = "paper-default";
const MANUAL_APPROVAL_TTL_MS = 60_000;

/** Same conservative PAPER envelope already used by the desktop canonical composition. */
export const CLOUD_PAPER_RISK_LIMITS: IndependentRiskLimits = Object.freeze({
  maxOrderNotional: 2_000_000,
  maxPositionNotional: 2_000_000,
  maxOpenOrders: 1,
  maxOrdersPerSecond: 1,
  maxOrdersPerMinute: 60,
  maxSameSideStreak: 10,
  maxSymbolExposureNotional: 2_000_000,
  maxPortfolioExposureNotional: 2_000_000,
  maxDailyBuyNotional: 2_000_000,
  maxDailySellNotional: 2_000_000,
  maxDailyLoss: 1_000_000,
  maxConsecutiveLosses: 3,
  maxSessionDrawdownRatio: 0.2,
  maxPriceDeviationRatio: 0.05
});

export interface CloudPaperRiskRequest {
  readonly path: "MANUAL" | "STRATEGY";
  readonly commandId: string;
  readonly signalId: string;
  readonly clientOrderId: string;
  readonly strategyId: string;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: number;
  readonly price: number;
  readonly now: number;
  readonly observedAt: number;
  readonly maximumMarketAgeMs: number;
  readonly killSwitchActive: boolean;
  readonly openP0: boolean;
  readonly overallHealth: "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
  readonly state: PaperAccountState;
  readonly approvedBy?: string;
}

export interface CloudPaperRiskGate {
  evaluate(input: CloudPaperRiskRequest): Readonly<{ status: "ALLOW" | "REJECT" | "HALT"; reasonCodes: readonly string[] }>;
}

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const dayOf = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

function validateLimits(limits: IndependentRiskLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`cloud PAPER risk limit ${name} is invalid`);
  }
  if (limits.maxOrdersPerSecond < 1 || limits.maxOrdersPerMinute < 1 || limits.maxSameSideStreak < 1 || limits.maxConsecutiveLosses < 1) {
    throw new Error("cloud PAPER rate/loss limits must be positive");
  }
  if (limits.maxSessionDrawdownRatio > 1 || limits.maxPriceDeviationRatio > 1) throw new Error("cloud PAPER ratio limit is invalid");
}

function databaseHealthy(database: SqliteDatabase): boolean {
  try {
    const quick = database.connection.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined;
    if (quick == null || !Object.values(quick).includes("ok")) return false;
    const required = ["risk_paper_approvals", "risk_daily_loss_state", "risk_idempotency_records", "risk_order_state"];
    for (const table of required) {
      const row = database.connection.prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?").get(table) as Record<string, unknown> | undefined;
      if (row == null) return false;
    }
    return true;
  } catch { return false; }
}

function stateHealthy(state: PaperAccountState): boolean {
  try {
    if (state.version !== 1 || !Number.isFinite(state.cash) || state.cash < 0 || !Number.isFinite(state.equity) || state.equity < 0) return false;
    const projected = state.cash + state.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0);
    const tolerance = Math.max(1e-6, Math.abs(projected) * 1e-8);
    if (!Number.isFinite(projected) || Math.abs(projected - state.equity) > tolerance) return false;
    if (new Set(state.processedIdempotencyKeys).size !== state.processedIdempotencyKeys.length) return false;
    if (new Set(state.orders.map((order) => order.id)).size !== state.orders.length) return false;
    return state.positions.every((position) => Number.isFinite(position.quantity) && position.quantity >= 0 && Number.isFinite(position.markPrice) && position.markPrice >= 0);
  } catch { return false; }
}

function rateState(state: PaperAccountState, now: number, side: "BUY" | "SELL"): Readonly<{ ordersInLastSecond: number; ordersInLastMinute: number; sameSideStreak: number }> {
  let ordersInLastSecond = 0;
  let ordersInLastMinute = 0;
  for (const order of state.orders) {
    const age = now - order.filledAt;
    if (age >= 0 && age < 1_000) ordersInLastSecond += 1;
    if (age >= 0 && age < 60_000) ordersInLastMinute += 1;
  }
  let sameSideStreak = 0;
  for (const order of state.orders) {
    if (order.side !== side) break;
    sameSideStreak += 1;
  }
  return Object.freeze({ ordersInLastSecond, ordersInLastMinute, sameSideStreak });
}

function dailyNotional(state: PaperAccountState, now: number): Readonly<{ dailyBuyNotional: number; dailySellNotional: number }> {
  const day = dayOf(now);
  let dailyBuyNotional = 0;
  let dailySellNotional = 0;
  for (const order of state.orders) {
    if (dayOf(order.filledAt) !== day) continue;
    const notional = order.quantity * order.price;
    if (order.side === "BUY") dailyBuyNotional += notional;
    else dailySellNotional += notional;
  }
  return Object.freeze({ dailyBuyNotional, dailySellNotional });
}

function realizedLossState(state: PaperAccountState, now: number): Readonly<{ dailyRealizedPnL: number; consecutiveLossCount: number }> {
  const positions = new Map<string, { quantity: number; averageEntryPrice: number }>();
  const sells: Array<{ pnl: number; filledAt: number }> = [];
  for (const order of [...state.orders].reverse()) {
    const prior = positions.get(order.market) ?? { quantity: 0, averageEntryPrice: 0 };
    if (order.side === "BUY") {
      const nextQuantity = prior.quantity + order.quantity;
      const nextAverage = nextQuantity <= 0 ? 0 : (prior.averageEntryPrice * prior.quantity + order.quantity * order.price + order.fee) / nextQuantity;
      positions.set(order.market, { quantity: nextQuantity, averageEntryPrice: nextAverage });
      continue;
    }
    if (order.quantity > prior.quantity + Number.EPSILON) return Object.freeze({ dailyRealizedPnL: Number.NaN, consecutiveLossCount: Number.MAX_SAFE_INTEGER });
    const pnl = (order.price - prior.averageEntryPrice) * order.quantity - order.fee;
    const nextQuantity = Math.max(0, prior.quantity - order.quantity);
    positions.set(order.market, { quantity: nextQuantity, averageEntryPrice: nextQuantity === 0 ? 0 : prior.averageEntryPrice });
    sells.push({ pnl, filledAt: order.filledAt });
  }
  const today = dayOf(now);
  const dailyRealizedPnL = sells.filter((sell) => dayOf(sell.filledAt) === today).reduce((sum, sell) => sum + sell.pnl, 0);
  let consecutiveLossCount = 0;
  for (let index = sells.length - 1; index >= 0; index -= 1) {
    if (sells[index]!.pnl >= 0) break;
    consecutiveLossCount += 1;
  }
  return Object.freeze({ dailyRealizedPnL, consecutiveLossCount });
}

export interface CloudPaperCanonicalRiskGatewayOptions {
  readonly database: SqliteDatabase;
  readonly initialCapital: number;
  readonly sourceCommitSha: string;
  readonly limits?: IndependentRiskLimits;
}

/**
 * Cloud adapter over the existing independent gateway + CanonicalRiskSafetyGate.
 * It owns no broker mutation. A separate production execution boundary may mutate PAPER
 * state only after this returns ALLOW.
 */
export class CloudPaperCanonicalRiskGateway implements CloudPaperRiskGate {
  private readonly persistence: SqliteRiskSafetyPersistence;
  private readonly canonical: CanonicalRiskSafetyGate;
  private readonly limits: IndependentRiskLimits;
  private readonly fingerprints: Readonly<{ strategy: string; config: string; runtime: string; riskPolicy: string }>;
  private peakEquity: number;

  public constructor(private readonly options: CloudPaperCanonicalRiskGatewayOptions) {
    if (!Number.isFinite(options.initialCapital) || options.initialCapital <= 0) throw new Error("cloud PAPER initial capital is invalid");
    if (!options.sourceCommitSha.trim()) throw new Error("cloud PAPER source commit is required");
    this.limits = Object.freeze({ ...(options.limits ?? CLOUD_PAPER_RISK_LIMITS) });
    validateLimits(this.limits);
    this.persistence = new SqliteRiskSafetyPersistence(options.database);
    this.canonical = new CanonicalRiskSafetyGate(this.persistence);
    this.peakEquity = options.initialCapital;
    this.fingerprints = Object.freeze({
      strategy: hash("cloud-paper-cio-v1"),
      config: hash({ initialCapital: options.initialCapital }),
      runtime: hash(options.sourceCommitSha.trim()),
      riskPolicy: hash(this.limits)
    });
  }

  public evaluate(input: CloudPaperRiskRequest): Readonly<{ status: "ALLOW" | "REJECT" | "HALT"; reasonCodes: readonly string[] }> {
    const persistent = databaseHealthy(this.options.database);
    const reconciled = stateHealthy(input.state);
    const marketAge = input.now - input.observedAt;
    const marketStatus = !Number.isSafeInteger(input.observedAt) || input.observedAt < 0 || input.observedAt > input.now
      ? "INVALID" as const
      : marketAge >= input.maximumMarketAgeMs ? "STALE" as const : "HEALTHY" as const;
    const position = input.state.positions.find((item) => item.market === input.market);
    const symbolExposureNotional = (position?.quantity ?? 0) * input.price;
    const portfolioExposureNotional = input.state.positions.reduce((sum, item) => sum + item.quantity * item.markPrice, 0);
    const notionals = dailyNotional(input.state, input.now);
    const lossState = realizedLossState(input.state, input.now);
    const currentEquity = input.state.cash + input.state.positions.reduce((sum, item) => sum + item.quantity * (item.market === input.market ? input.price : item.markPrice), 0);
    this.peakEquity = Math.max(this.peakEquity, currentEquity);
    const identity: RiskIdentityState = Object.freeze({
      strategyFingerprint: this.fingerprints.strategy,
      configFingerprint: this.fingerprints.config,
      runtimeFingerprint: this.fingerprints.runtime,
      riskPolicyFingerprint: this.fingerprints.riskPolicy,
      seenSignalIds: new Set(input.state.processedIdempotencyKeys),
      seenCommandIds: new Set(input.state.processedIdempotencyKeys),
      seenClientOrderIds: new Set(input.state.processedIdempotencyKeys)
    });
    const independentRequest: PreTradeRiskRequest = {
      schemaVersion: 1,
      requestId: `${this.options.sourceCommitSha}:${input.path}:${input.commandId}`,
      signalId: input.signalId,
      commandId: input.commandId,
      clientOrderId: input.clientOrderId,
      strategyFingerprint: this.fingerprints.strategy,
      configFingerprint: this.fingerprints.config,
      runtimeFingerprint: this.fingerprints.runtime,
      riskPolicyFingerprint: this.fingerprints.riskPolicy,
      symbol: input.market,
      side: input.side,
      quantity: input.quantity,
      referencePrice: input.price,
      requestedAt: input.now,
      marketDataState: { status: marketStatus, price: marketStatus === "HEALTHY" ? input.price : null },
      accountState: { cash: input.state.cash, positionQuantity: position?.quantity ?? 0, openOrderCount: 0 },
      controlState: { killSwitchActive: input.killSwitchActive, liveCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.liveTrading, privateApiCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation },
      approvalState: { approved: true, expiresAt: input.now + 1, symbols: [input.market] },
      persistenceState: { healthy: persistent },
      reconciliationState: { healthy: reconciled, openP0: input.openP0 },
      deploymentState: { integrityVerified: persistent },
      rateState: rateState(input.state, input.now, input.side),
      exposureState: { symbolExposureNotional, portfolioExposureNotional, dailyBuyNotional: notionals.dailyBuyNotional, dailySellNotional: notionals.dailySellNotional },
      sessionState: { dailyRealizedPnL: lossState.dailyRealizedPnL, consecutiveLossCount: lossState.consecutiveLossCount, sessionPeakEquity: this.peakEquity, sessionEquity: currentEquity }
    };
    const independent = evaluatePreTradeRisk(independentRequest, identity, this.limits);
    if (independent.status !== "ALLOW") return Object.freeze({ status: independent.status === "REJECT" ? "REJECT" : "HALT", reasonCodes: independent.reasonCodes });

    const strategyId = input.path === "MANUAL" ? "MANUAL" : input.strategyId.trim();
    const approvedBy = input.path === "MANUAL" ? input.approvedBy?.trim() : "CIO_PAPER";
    if (!approvedBy || !strategyId) return Object.freeze({ status: "HALT", reasonCodes: Object.freeze(["APPROVAL_MISSING"]) });
    let approvalId: string | undefined;
    {
      approvalId = `cloud-paper-${hash({ account: ACCOUNT_ID, commandId: input.commandId, approvedBy, strategyId, market: input.market, side: input.side, policy: this.fingerprints.riskPolicy }).slice(0, 32)}`;
      try {
        this.canonical.saveApproval({
          approvalId,
          mode: "PAPER",
          symbol: input.market,
          strategyId,
          policyFingerprint: this.fingerprints.riskPolicy,
          side: input.side,
          commandId: input.commandId,
          expiresAtMs: input.now + MANUAL_APPROVAL_TTL_MS,
          approvedBy,
          approvedAtMs: input.now
        });
      } catch { return Object.freeze({ status: "HALT", reasonCodes: Object.freeze(["PERSISTENCE_UNHEALTHY"]) }); }
    }

    const canonical = this.canonical.evaluate({
      accountId: ACCOUNT_ID,
      requestId: `${input.path}:${input.commandId}`,
      boundary: input.path,
      mode: "PAPER",
      symbol: input.market,
      side: input.side,
      strategyId,
      policyFingerprint: this.fingerprints.riskPolicy,
      ...(approvalId === undefined ? {} : { approvalId }),
      nowMs: input.now,
      currentEquity,
      marketDataFresh: marketStatus === "HEALTHY",
      marketHealthy: marketStatus === "HEALTHY" && input.overallHealth === "HEALTHY",
      killSwitchActive: input.killSwitchActive,
      liveMutationAllowed: false,
      recoveryReady: persistent && reconciled && !input.openP0,
      persistenceHealthy: persistent,
      maxDailyLoss: this.limits.maxDailyLoss,
      maxOpenOrders: this.limits.maxOpenOrders,
      idempotency: { accountId: ACCOUNT_ID, commandId: input.commandId, signalId: input.signalId, clientOrderId: input.clientOrderId, payloadFingerprint: "PENDING", createdAtMs: input.now }
    });
    if (approvalId !== undefined) {
      try { this.canonical.revokeApproval(approvalId, "single-use manual approval evaluated"); } catch { return Object.freeze({ status: "HALT", reasonCodes: Object.freeze(["PERSISTENCE_UNHEALTHY"]) }); }
    }
    return Object.freeze({
      status: canonical.status === "APPROVED" ? "ALLOW" : canonical.status === "REJECTED" ? "REJECT" : "HALT",
      reasonCodes: Object.freeze([...independent.reasonCodes, ...canonical.reasonCodes])
    });
  }
}
