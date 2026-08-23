import {
  evaluateLiveReadiness,
  type LiveAuthorityState,
  type LiveReadinessEvidence,
  type LiveRuntimeSafetyState,
} from "./liveReadinessGate";

export type LiveOrderSide = "BUY" | "SELL";
export type LiveOrderType = "MARKET" | "LIMIT";

export interface LiveOrderIntent {
  readonly idempotencyKey: string;
  readonly decisionId: string;
  readonly strategyVersion: string;
  readonly inputSnapshotHash: string;
  readonly market: string;
  readonly side: LiveOrderSide;
  readonly orderType: LiveOrderType;
  readonly quantity: number;
  readonly expectedNotional: number;
  readonly expectedSlippageBps: number;
  readonly limitPrice?: number;
}

export interface LiveCancelIntent {
  readonly idempotencyKey: string;
  readonly decisionId: string;
  readonly market: string;
  readonly brokerOrderId: string;
}

export interface LiveBrokerOrderReceipt {
  readonly brokerOrderId: string;
  readonly acceptedAt: string;
}

export interface LiveBrokerCancelReceipt {
  readonly brokerOrderId: string;
  readonly cancelledAt: string;
}

/**
 * Server-side mutation surface only. It intentionally exposes order/cancel and
 * has no withdrawal or transfer capability.
 */
export interface LiveBrokerAdapter {
  placeOrder(intent: LiveOrderIntent): Promise<LiveBrokerOrderReceipt>;
  cancelOrder(intent: LiveCancelIntent): Promise<LiveBrokerCancelReceipt>;
}

export interface LiveExecutionJournal {
  /** Must be durable and atomic. False means this key was already reserved. */
  reserveIdempotencyKey(idempotencyKey: string): Promise<boolean>;
  append(event: LiveExecutionAuditEvent): Promise<void>;
}

export interface LiveExecutionAuditEvent {
  readonly kind: "ORDER_SUBMIT" | "ORDER_ACK" | "ORDER_CANCEL" | "ORDER_CANCEL_ACK" | "BLOCKED";
  readonly occurredAt: string;
  readonly decisionId: string;
  readonly idempotencyKey: string;
  readonly market: string;
  readonly environmentFingerprint: string;
  readonly accountFingerprint: string;
  readonly leaseId?: string;
  readonly reason?: string;
  readonly brokerOrderId?: string;
}

export interface LiveExecutionExposureSnapshot {
  readonly dailyLoss: number;
  readonly openExposure: number;
  readonly concurrentPositions: number;
  readonly ordersLastMinute: number;
}

export interface LiveExecutionContext {
  readonly evidence: LiveReadinessEvidence;
  readonly runtime: LiveRuntimeSafetyState;
  readonly authority: LiveAuthorityState;
  readonly exposure: LiveExecutionExposureSnapshot;
  readonly nowIso: string;
}

export class LiveExecutionBlockedError extends Error {
  readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super(`LIVE execution blocked: ${blockers.join(",")}`);
    this.name = "LiveExecutionBlockedError";
    this.blockers = Object.freeze([...blockers]);
  }
}

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const finiteNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

function commonBlockers(context: LiveExecutionContext): string[] {
  const result = evaluateLiveReadiness(
    context.evidence,
    context.runtime,
    context.authority,
    context.nowIso,
  );
  return result.status === "ENABLED" ? [] : [`READINESS_${result.status}`, ...result.blockers];
}

function orderBlockers(context: LiveExecutionContext, intent: LiveOrderIntent): string[] {
  const blockers = commonBlockers(context);
  const limits = context.evidence.riskLimits;
  if (!limits) return [...blockers, "RISK_LIMITS_MISSING"];

  if (!intent.idempotencyKey.trim()) blockers.push("IDEMPOTENCY_KEY_MISSING");
  if (!intent.decisionId.trim()) blockers.push("DECISION_ID_MISSING");
  if (!intent.strategyVersion.trim()) blockers.push("STRATEGY_VERSION_MISSING");
  if (!intent.inputSnapshotHash.trim()) blockers.push("INPUT_SNAPSHOT_HASH_MISSING");
  if (!limits.marketAllowlist.includes(intent.market)) blockers.push("MARKET_NOT_ALLOWLISTED");
  if (!finitePositive(intent.quantity)) blockers.push("QUANTITY_INVALID");
  if (!finitePositive(intent.expectedNotional)) blockers.push("EXPECTED_NOTIONAL_INVALID");
  else if (intent.expectedNotional > limits.maxNotionalPerOrder) blockers.push("MAX_NOTIONAL_EXCEEDED");
  if (!finiteNonNegative(intent.expectedSlippageBps)) blockers.push("EXPECTED_SLIPPAGE_INVALID");
  else if (intent.expectedSlippageBps > limits.maxSlippageBps) blockers.push("MAX_SLIPPAGE_EXCEEDED");
  if (intent.orderType === "LIMIT" && !finitePositive(intent.limitPrice ?? Number.NaN)) blockers.push("LIMIT_PRICE_INVALID");

  if (!finiteNonNegative(context.exposure.dailyLoss)) blockers.push("DAILY_LOSS_SNAPSHOT_INVALID");
  else if (context.exposure.dailyLoss >= limits.maxDailyLoss) blockers.push("MAX_DAILY_LOSS_REACHED");
  if (!finiteNonNegative(context.exposure.openExposure)) blockers.push("OPEN_EXPOSURE_SNAPSHOT_INVALID");
  else if (context.exposure.openExposure + intent.expectedNotional > limits.maxOpenExposure) blockers.push("MAX_OPEN_EXPOSURE_EXCEEDED");
  if (!Number.isSafeInteger(context.exposure.concurrentPositions) || context.exposure.concurrentPositions < 0) blockers.push("CONCURRENT_POSITIONS_SNAPSHOT_INVALID");
  else if (context.exposure.concurrentPositions >= limits.maxConcurrentPositions) blockers.push("MAX_CONCURRENT_POSITIONS_REACHED");
  if (!Number.isSafeInteger(context.exposure.ordersLastMinute) || context.exposure.ordersLastMinute < 0) blockers.push("ORDER_FREQUENCY_SNAPSHOT_INVALID");
  else if (context.exposure.ordersLastMinute >= limits.maxOrdersPerMinute) blockers.push("MAX_ORDER_FREQUENCY_REACHED");

  return [...new Set(blockers)];
}

function cancelBlockers(context: LiveExecutionContext, intent: LiveCancelIntent): string[] {
  const blockers = commonBlockers(context);
  if (!intent.idempotencyKey.trim()) blockers.push("IDEMPOTENCY_KEY_MISSING");
  if (!intent.decisionId.trim()) blockers.push("DECISION_ID_MISSING");
  if (!intent.market.trim()) blockers.push("MARKET_MISSING");
  if (!intent.brokerOrderId.trim()) blockers.push("BROKER_ORDER_ID_MISSING");
  return [...new Set(blockers)];
}

function auditBase(context: LiveExecutionContext, intent: LiveOrderIntent | LiveCancelIntent) {
  return {
    occurredAt: context.nowIso,
    decisionId: intent.decisionId,
    idempotencyKey: intent.idempotencyKey,
    market: intent.market,
    environmentFingerprint: context.evidence.environmentFingerprint,
    accountFingerprint: context.evidence.accountFingerprint,
    leaseId: context.authority.activationLease?.leaseId,
  } as const;
}

export class LiveExecutionBoundary {
  constructor(
    private readonly broker: LiveBrokerAdapter,
    private readonly journal: LiveExecutionJournal,
  ) {}

  async placeOrder(context: LiveExecutionContext, intent: LiveOrderIntent): Promise<LiveBrokerOrderReceipt> {
    const blockers = orderBlockers(context, intent);
    if (blockers.length > 0) {
      await this.journal.append({ ...auditBase(context, intent), kind: "BLOCKED", reason: blockers.join(",") });
      throw new LiveExecutionBlockedError(blockers);
    }

    if (!(await this.journal.reserveIdempotencyKey(intent.idempotencyKey))) {
      const duplicate = ["DUPLICATE_IDEMPOTENCY_KEY"] as const;
      await this.journal.append({ ...auditBase(context, intent), kind: "BLOCKED", reason: duplicate[0] });
      throw new LiveExecutionBlockedError(duplicate);
    }

    await this.journal.append({ ...auditBase(context, intent), kind: "ORDER_SUBMIT" });
    const receipt = await this.broker.placeOrder(intent);
    await this.journal.append({ ...auditBase(context, intent), kind: "ORDER_ACK", brokerOrderId: receipt.brokerOrderId });
    return Object.freeze({ ...receipt });
  }

  async cancelOrder(context: LiveExecutionContext, intent: LiveCancelIntent): Promise<LiveBrokerCancelReceipt> {
    const blockers = cancelBlockers(context, intent);
    if (blockers.length > 0) {
      await this.journal.append({ ...auditBase(context, intent), kind: "BLOCKED", reason: blockers.join(",") });
      throw new LiveExecutionBlockedError(blockers);
    }

    if (!(await this.journal.reserveIdempotencyKey(intent.idempotencyKey))) {
      const duplicate = ["DUPLICATE_IDEMPOTENCY_KEY"] as const;
      await this.journal.append({ ...auditBase(context, intent), kind: "BLOCKED", reason: duplicate[0] });
      throw new LiveExecutionBlockedError(duplicate);
    }

    await this.journal.append({ ...auditBase(context, intent), kind: "ORDER_CANCEL", brokerOrderId: intent.brokerOrderId });
    const receipt = await this.broker.cancelOrder(intent);
    await this.journal.append({ ...auditBase(context, intent), kind: "ORDER_CANCEL_ACK", brokerOrderId: receipt.brokerOrderId });
    return Object.freeze({ ...receipt });
  }
}
