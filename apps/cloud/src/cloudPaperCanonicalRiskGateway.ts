import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqliteRiskSafetyPersistence } from "../../../packages/storage/src/index";
import type { PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import { CanonicalRiskSafetyGate } from "../../execution/src/risk-safety-integration";
import { evaluatePreTradeRisk, type IndependentRiskLimits, type RiskIdentityState } from "./independentRiskGateway";
import { RUNTIME_EXCHANGE_CAPABILITIES } from "./runtimeExchangeCapabilities";
import type { PaperAccountState } from "./paperTradingExecutionLoop";

const ACCOUNT_ID = "paper-default";
const STRATEGY_ID = "CIO_PAPER";

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
  readonly commandId: string;
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
}

export interface CloudPaperRiskGate {
  evaluate(input: CloudPaperRiskRequest): Readonly<{
    status: "ALLOW" | "REJECT" | "HALT";
    reasonCodes: readonly string[];
  }>;
}

export interface CloudPaperCanonicalRiskGatewayOptions {
  readonly database: SqliteDatabase;
  readonly initialCapital: number;
  readonly sourceCommitSha: string;
  readonly limits?: IndependentRiskLimits;
}

const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const tradingDay = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

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
    return required.every((table) => database.connection
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) != null);
  } catch {
    return false;
  }
}

function stateHealthy(state: PaperAccountState): boolean {
  try {
    if (state.version !== 1 || !Number.isFinite(state.cash) || state.cash < 0 || !Number.isFinite(state.equity) || state.equity < 0) return false;
    const projected = state.cash + state.positions.reduce((sum, position) => sum + position.quantity * position.markPrice, 0);
    const tolerance = Math.max(1e-6, Math.abs(projected) * 1e-8);
    return Number.isFinite(projected)
      && Math.abs(projected - state.equity) <= tolerance
      && new Set(state.processedIdempotencyKeys).size === state.processedIdempotencyKeys.length
      && new Set(state.orders.map((order) => order.id)).size === state.orders.length
      && state.positions.every((position) => Number.isFinite(position.quantity) && position.quantity >= 0 && Number.isFinite(position.markPrice) && position.markPrice >= 0);
  } catch {
    return false;
  }
}

function rateState(state: PaperAccountState, now: number, side: "BUY" | "SELL"): Readonly<{
  ordersInLastSecond: number;
  ordersInLastMinute: number;
  sameSideStreak: number;
}> {
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
  const day = tradingDay(now);
  let dailyBuyNotional = 0;
  let dailySellNotional = 0;
  for (const order of state.orders) {
    if (tradingDay(order.filledAt) !== day) continue;
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
  const day = tradingDay(now);
  const dailyRealizedPnL = sells.filter((sell) => tradingDay(sell.filledAt) === day).reduce((sum, sell) => sum + sell.pnl, 0);
  let consecutiveLossCount = 0;
  for (let index = sells.length - 1; index >= 0; index -= 1) {
    if (sells[index]!.pnl >= 0) break;
    consecutiveLossCount += 1;
  }
  return Object.freeze({ dailyRealizedPnL, consecutiveLossCount });
}

/**
 * Production Cloud PAPER risk adapter. It combines the independent pre-trade limits with
 * the canonical persistent risk gate and owns no execution authority itself.
 *
 * Cloud currently has no explicit human STRATEGY approval issuer. That absence is
 * intentionally represented as approval=false / no approvalId, so autonomous strategy
 * PAPER mutation fails closed instead of manufacturing approval.
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
    const loss = realizedLossState(input.state, input.now);
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
      requestId: `${this.options.sourceCommitSha}:STRATEGY:${input.commandId}`,
      signalId: input.commandId,
      commandId: input.commandId,
      clientOrderId: input.commandId,
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
      controlState: {
        killSwitchActive: input.killSwitchActive,
        liveCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.liveTrading,
        privateApiCapabilityDetected: RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation
      },
      approvalState: { approved: false, expiresAt: input.now, symbols: [input.market] },
      persistenceState: { healthy: persistent },
      reconciliationState: { healthy: reconciled, openP0: input.openP0 },
      deploymentState: { integrityVerified: persistent },
      rateState: rateState(input.state, input.now, input.side),
      exposureState: {
        symbolExposureNotional,
        portfolioExposureNotional,
        dailyBuyNotional: notionals.dailyBuyNotional,
        dailySellNotional: notionals.dailySellNotional
      },
      sessionState: {
        dailyRealizedPnL: loss.dailyRealizedPnL,
        consecutiveLossCount: loss.consecutiveLossCount,
        sessionPeakEquity: this.peakEquity,
        sessionEquity: currentEquity
      }
    };
    const independent = evaluatePreTradeRisk(independentRequest, identity, this.limits);
    const canonical = this.canonical.evaluate({
      accountId: ACCOUNT_ID,
      requestId: `STRATEGY:${input.commandId}`,
      boundary: "STRATEGY",
      mode: "PAPER",
      symbol: input.market,
      side: input.side,
      strategyId: STRATEGY_ID,
      policyFingerprint: this.fingerprints.riskPolicy,
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
      idempotency: {
        accountId: ACCOUNT_ID,
        commandId: input.commandId,
        signalId: input.commandId,
        clientOrderId: input.commandId,
        payloadFingerprint: "PENDING",
        createdAtMs: input.now
      }
    });

    const reasonCodes = Object.freeze([...new Set([...independent.reasonCodes, ...canonical.reasonCodes])].sort());
    if (independent.status === "HALT" || canonical.status === "BLOCKED" || canonical.status === "UNKNOWN") {
      return Object.freeze({ status: "HALT", reasonCodes });
    }
    if (independent.status === "REJECT" || canonical.status === "REJECTED") return Object.freeze({ status: "REJECT", reasonCodes });
    return Object.freeze({ status: "ALLOW", reasonCodes });
  }
}
