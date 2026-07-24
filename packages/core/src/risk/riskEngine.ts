/**
 * E02-T002 -- Risk Engine.
 *
 * Pure domain module: given a TradingIntent, RiskContext, and RiskPolicy, decides ALLOW
 * or BLOCK. No fees/slippage, no order sizing, no execution, no portfolio bookkeeping --
 * those belong to OrderPlanner/Executor/Portfolio, deliberately out of scope here. No
 * framework, database, or network dependency; no async; no time or random values; inputs
 * are never mutated.
 */

export type RiskOrderSide = "BUY" | "SELL";

/** The minimal shape this engine needs from a trading intent: a direction and a quantity. */
export interface TradingIntent {
  readonly side: RiskOrderSide;
  readonly quantity: number;
}

/** Live account/market state the decision is evaluated against. */
export interface RiskContext {
  readonly marketPrice: number;
  readonly availableQuoteBalance: number;
  readonly currentPositionValue: number;
}

/** Operator-configured limits. minimumOrderValue may be 0 (no floor); maximumPositionValue must be positive. */
export interface RiskPolicy {
  readonly minimumOrderValue: number;
  readonly maximumPositionValue: number;
}

export type RiskRejectionCode =
  | "INVALID_QUANTITY"
  | "INVALID_MARKET_PRICE"
  | "INVALID_POLICY"
  | "BELOW_MINIMUM_ORDER_VALUE"
  | "INSUFFICIENT_BALANCE"
  | "MAXIMUM_POSITION_EXCEEDED";

export interface RiskAllowDecision {
  readonly outcome: "ALLOW";
  readonly orderValue: number;
}

export interface RiskBlockDecision {
  readonly outcome: "BLOCK";
  readonly code: RiskRejectionCode;
  readonly reason: string;
}

export type RiskDecision = RiskAllowDecision | RiskBlockDecision;

export interface RiskEngine {
  evaluate(intent: TradingIntent, context: RiskContext, policy: RiskPolicy): RiskDecision;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function block(code: RiskRejectionCode, reason: string): RiskBlockDecision {
  return { outcome: "BLOCK", code, reason };
}

/**
 * Validation and rule order (fixed, matches the spec exactly):
 *   1. quantity is finite and positive
 *   2. marketPrice is finite and positive
 *   3. RiskPolicy values are valid
 *   4. orderValue = quantity * marketPrice
 *   5. orderValue vs minimumOrderValue (both sides)
 *   6. BUY only: orderValue vs availableQuoteBalance
 *   7. BUY only: currentPositionValue + orderValue vs maximumPositionValue
 * SELL intents are never subject to steps 6-7: selling does not consume quote balance or
 * increase position exposure, so those checks do not apply to it.
 */
export class DefaultRiskEngine implements RiskEngine {
  evaluate(intent: TradingIntent, context: RiskContext, policy: RiskPolicy): RiskDecision {
    if (!isFinitePositive(intent.quantity)) {
      return block("INVALID_QUANTITY", "quantity must be a finite positive number");
    }
    if (!isFinitePositive(context.marketPrice)) {
      return block("INVALID_MARKET_PRICE", "marketPrice must be a finite positive number");
    }
    if (
      !Number.isFinite(policy.minimumOrderValue) || policy.minimumOrderValue < 0 ||
      !Number.isFinite(policy.maximumPositionValue) || policy.maximumPositionValue <= 0
    ) {
      return block("INVALID_POLICY", "minimumOrderValue must be finite and >= 0; maximumPositionValue must be finite and > 0");
    }

    const orderValue = intent.quantity * context.marketPrice;

    if (orderValue < policy.minimumOrderValue) {
      return block("BELOW_MINIMUM_ORDER_VALUE", `orderValue (${orderValue}) is below minimumOrderValue (${policy.minimumOrderValue})`);
    }

    if (intent.side === "BUY") {
      if (orderValue > context.availableQuoteBalance) {
        return block("INSUFFICIENT_BALANCE", `orderValue (${orderValue}) exceeds availableQuoteBalance (${context.availableQuoteBalance})`);
      }
      const projectedPositionValue = context.currentPositionValue + orderValue;
      if (projectedPositionValue > policy.maximumPositionValue) {
        return block("MAXIMUM_POSITION_EXCEEDED", `projectedPositionValue (${projectedPositionValue}) exceeds maximumPositionValue (${policy.maximumPositionValue})`);
      }
    }

    return { outcome: "ALLOW", orderValue };
  }
}
