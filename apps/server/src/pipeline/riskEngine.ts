import type { TradingIntent } from "./tradingIntent";

export interface RiskContext {
  /** ControlPlane.canAutoTrade(): strategy RUNNING and auto-trade explicitly enabled by the operator. */
  readonly autoTradeAllowed: boolean;
  readonly positionQuantity: number;
}

export interface RiskDecision {
  readonly approved: boolean;
  readonly reason?: string;
}

/**
 * The "RiskEngine" pipeline stage: decides whether a TradingIntent may proceed to order
 * planning at all. Deliberately narrow -- it only ever answers "should we act on this
 * intent right now", never "how much" (that's OrderPlanner) or "is this specific order
 * within notional/position/loss limits" (that remains PaperBroker's job, since it needs
 * the concrete planned quantity and fill price this stage does not have yet). Can only
 * ever block a trade, never manufacture permission the operator/broker didn't already
 * grant -- same risk-reducing-only shape as apps/desktop/src/exitRules.ts.
 */
export class RiskEngine {
  evaluate(intent: TradingIntent, context: RiskContext): RiskDecision {
    if (intent.type === "HOLD") return { approved: false, reason: "HOLD" };
    if (!context.autoTradeAllowed) return { approved: false, reason: "automatic trading is not enabled" };
    if (intent.type === "SELL" && context.positionQuantity <= 0) return { approved: false, reason: "insufficient paper position" };
    return { approved: true };
  }
}
