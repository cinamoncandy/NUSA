import { LedgerSide, RiskDecisionType, RiskReasonCode } from "../../../packages/contracts/src/index";

export * from "./final-certification";

export interface RiskPosition { readonly baseQtyRaw: bigint; readonly realizedPnlRaw: bigint; }
export interface PreTradeRiskContext { readonly position?: RiskPosition; }
export interface PreTradeOrder { readonly side: LedgerSide; readonly baseQtyRaw: bigint; readonly quoteQtyRaw?: bigint; }
export interface PreTradeRiskPolicy { readonly enabled?: boolean; readonly maxOrderQuoteRaw?: bigint; readonly maxPositionBaseRaw?: bigint; readonly maxRealizedLossRaw?: bigint; }
export interface RiskDecision { readonly type: RiskDecisionType; readonly reasonCode?: RiskReasonCode; readonly reason?: string; }

export function allow(): RiskDecision { return Object.freeze({ type: RiskDecisionType.ALLOW }); }
export function block(reasonCode: RiskReasonCode, reason: string): RiskDecision { return Object.freeze({ type: RiskDecisionType.BLOCK, reasonCode, reason }); }

export function evaluatePreTradeRisk(context: PreTradeRiskContext, order: PreTradeOrder, policy: PreTradeRiskPolicy = {}): RiskDecision {
  if (policy.enabled === false) return allow();
  if (typeof order.baseQtyRaw !== "bigint") throw new Error("order.baseQtyRaw must be bigint");
  if (order.quoteQtyRaw != null && typeof order.quoteQtyRaw !== "bigint") throw new Error("order.quoteQtyRaw must be bigint");
  const current = context.position;
  if (order.side === LedgerSide.SELL && (current == null || current.baseQtyRaw < order.baseQtyRaw)) return block(RiskReasonCode.OVERSOLD, "sell quantity exceeds position");
  if (policy.maxOrderQuoteRaw != null && order.quoteQtyRaw != null && order.quoteQtyRaw > policy.maxOrderQuoteRaw) return block(RiskReasonCode.MAX_NOTIONAL_EXCEEDED, "order quote exceeds policy");
  const currentBase = current?.baseQtyRaw ?? 0n;
  const nextBase = order.side === LedgerSide.BUY ? currentBase + order.baseQtyRaw : currentBase - order.baseQtyRaw;
  if (policy.maxPositionBaseRaw != null && nextBase > policy.maxPositionBaseRaw) return block(RiskReasonCode.MAX_POSITION_QTY_EXCEEDED, "position base exceeds policy");
  if (policy.maxRealizedLossRaw != null && current != null && current.realizedPnlRaw < -policy.maxRealizedLossRaw) return block(RiskReasonCode.MAX_LOSS_EXCEEDED, "realized loss exceeds policy");
  return allow();
}
