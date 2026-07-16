import { LedgerSide, RiskDecisionType, type RiskReasonCode } from "../../../packages/contracts/src/index";
import { evaluatePreTradeRisk, type PreTradeRiskContext, type PreTradeRiskPolicy } from "./pre-trade-risk";

export enum OrderAdmissionDecisionType { ALLOW = "ALLOW", BLOCK = "BLOCK", DUPLICATE = "DUPLICATE" }
export enum OrderAdmissionReasonCode {
  INVALID_INTENT = "INVALID_INTENT",
  ENVIRONMENT_MISMATCH = "ENVIRONMENT_MISMATCH",
  ACCOUNT_NOT_AUTHORIZED = "ACCOUNT_NOT_AUTHORIZED",
  STRATEGY_NOT_AUTHORIZED = "STRATEGY_NOT_AUTHORIZED",
  SYMBOL_NOT_AUTHORIZED = "SYMBOL_NOT_AUTHORIZED",
  ORDER_TYPE_NOT_AUTHORIZED = "ORDER_TYPE_NOT_AUTHORIZED",
  AUTHORIZATION_EXPIRED = "AUTHORIZATION_EXPIRED",
  PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY = "PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY",
  INTENT_REPLAYED_WITH_DIFFERENT_KEY = "INTENT_REPLAYED_WITH_DIFFERENT_KEY",
  RISK_BLOCKED = "RISK_BLOCKED"
}

export interface OrderIntent {
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly environment: "SYNTHETIC" | "TESTNET" | "PRODUCTION";
  readonly accountId: string;
  readonly strategyId: string;
  readonly symbol: string;
  readonly side: LedgerSide;
  readonly orderType: "MARKET" | "LIMIT";
  readonly baseQtyRaw: bigint;
  readonly quoteQtyRaw?: bigint;
  readonly createdAtMs: number;
}

export interface OrderAuthorizationScope {
  readonly environment: OrderIntent["environment"];
  readonly accountIds: readonly string[];
  readonly strategyIds: readonly string[];
  readonly symbols: readonly string[];
  readonly orderTypes: readonly OrderIntent["orderType"][];
  readonly expiresAtMs: number;
}

export interface OrderAdmissionContext {
  readonly nowMs: number;
  readonly authorization: OrderAuthorizationScope;
  readonly riskContext: PreTradeRiskContext;
  readonly riskPolicy?: PreTradeRiskPolicy;
}

export interface OrderAdmissionDecision {
  readonly type: OrderAdmissionDecisionType;
  readonly reasonCode?: OrderAdmissionReasonCode;
  readonly riskReasonCode?: RiskReasonCode;
  readonly reason?: string;
  readonly payloadHash: string;
}

export interface IdempotencyRecord { readonly key: string; readonly intentId: string; readonly payloadHash: string; }
export interface IdempotencyStore {
  getByKey(key: string): IdempotencyRecord | undefined;
  getByIntentId(intentId: string): IdempotencyRecord | undefined;
  save(record: IdempotencyRecord): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly byKey = new Map<string, IdempotencyRecord>();
  private readonly byIntentId = new Map<string, IdempotencyRecord>();
  getByKey(key: string): IdempotencyRecord | undefined { return this.byKey.get(key); }
  getByIntentId(intentId: string): IdempotencyRecord | undefined { return this.byIntentId.get(intentId); }
  save(record: IdempotencyRecord): void {
    const frozen = Object.freeze({ ...record });
    this.byKey.set(record.key, frozen);
    this.byIntentId.set(record.intentId, frozen);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
}

function stablePayload(intent: OrderIntent): string {
  return [intent.intentId, intent.environment, intent.accountId, intent.strategyId, intent.symbol, intent.side, intent.orderType, intent.baseQtyRaw.toString(), intent.quoteQtyRaw?.toString() ?? "", intent.createdAtMs.toString()].join("|");
}

export function hashOrderIntent(intent: OrderIntent): string {
  let hash = 2166136261;
  for (const character of stablePayload(intent)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function admitOrder(intent: OrderIntent, context: OrderAdmissionContext, idempotencyStore: IdempotencyStore): OrderAdmissionDecision {
  assertNonEmpty(intent.intentId, "intent.intentId");
  assertNonEmpty(intent.idempotencyKey, "intent.idempotencyKey");
  assertNonEmpty(intent.accountId, "intent.accountId");
  assertNonEmpty(intent.strategyId, "intent.strategyId");
  assertNonEmpty(intent.symbol, "intent.symbol");
  if (typeof intent.baseQtyRaw !== "bigint" || intent.baseQtyRaw <= 0n) throw new Error("intent.baseQtyRaw must be a positive bigint");
  if (intent.quoteQtyRaw != null && (typeof intent.quoteQtyRaw !== "bigint" || intent.quoteQtyRaw < 0n)) throw new Error("intent.quoteQtyRaw must be a non-negative bigint");

  const payloadHash = hashOrderIntent(intent);
  const byKey = idempotencyStore.getByKey(intent.idempotencyKey);
  if (byKey != null) {
    if (byKey.payloadHash !== payloadHash) return Object.freeze({ type: OrderAdmissionDecisionType.BLOCK, reasonCode: OrderAdmissionReasonCode.PAYLOAD_CHANGED_FOR_IDEMPOTENCY_KEY, reason: "idempotency key was reused for a different payload", payloadHash });
    return Object.freeze({ type: OrderAdmissionDecisionType.DUPLICATE, payloadHash });
  }
  const byIntent = idempotencyStore.getByIntentId(intent.intentId);
  if (byIntent != null) {
    if (byIntent.payloadHash === payloadHash) return Object.freeze({ type: OrderAdmissionDecisionType.DUPLICATE, payloadHash });
    return Object.freeze({ type: OrderAdmissionDecisionType.BLOCK, reasonCode: OrderAdmissionReasonCode.INTENT_REPLAYED_WITH_DIFFERENT_KEY, reason: "economic intent was reused with a different idempotency key or payload", payloadHash });
  }

  const authorization = context.authorization;
  const block = (reasonCode: OrderAdmissionReasonCode, reason: string): OrderAdmissionDecision => Object.freeze({ type: OrderAdmissionDecisionType.BLOCK, reasonCode, reason, payloadHash });
  if (authorization.expiresAtMs <= context.nowMs) return block(OrderAdmissionReasonCode.AUTHORIZATION_EXPIRED, "authorization expired");
  if (authorization.environment !== intent.environment) return block(OrderAdmissionReasonCode.ENVIRONMENT_MISMATCH, "intent environment is outside authorization scope");
  if (!authorization.accountIds.includes(intent.accountId)) return block(OrderAdmissionReasonCode.ACCOUNT_NOT_AUTHORIZED, "account is outside authorization scope");
  if (!authorization.strategyIds.includes(intent.strategyId)) return block(OrderAdmissionReasonCode.STRATEGY_NOT_AUTHORIZED, "strategy is outside authorization scope");
  if (!authorization.symbols.includes(intent.symbol)) return block(OrderAdmissionReasonCode.SYMBOL_NOT_AUTHORIZED, "symbol is outside authorization scope");
  if (!authorization.orderTypes.includes(intent.orderType)) return block(OrderAdmissionReasonCode.ORDER_TYPE_NOT_AUTHORIZED, "order type is outside authorization scope");

  const riskDecision = evaluatePreTradeRisk(context.riskContext, intent, context.riskPolicy);
  if (riskDecision.type === RiskDecisionType.BLOCK) return Object.freeze({ type: OrderAdmissionDecisionType.BLOCK, reasonCode: OrderAdmissionReasonCode.RISK_BLOCKED, riskReasonCode: riskDecision.reasonCode, reason: riskDecision.reason, payloadHash });

  idempotencyStore.save(Object.freeze({ key: intent.idempotencyKey, intentId: intent.intentId, payloadHash }));
  return Object.freeze({ type: OrderAdmissionDecisionType.ALLOW, payloadHash });
}
