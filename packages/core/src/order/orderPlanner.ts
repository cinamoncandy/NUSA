/**
 * E02-T003 -- Order Planner.
 *
 * Pure domain module: given a RiskEngine-approved TradingIntent, the RiskDecision that
 * approved it, a marketPrice, and an ExecutionPolicy, produces a PlannedOrder -- the
 * pre-execution shape an Exchange Adapter would submit. Does not execute orders, round to
 * exchange tick/step/precision (that is the Exchange Adapter's job), generate ids or
 * timestamps, or depend on any framework/database/network/exchange SDK. No async, no
 * Date.now()/Math.random(), inputs are never mutated, domain failures are returned as a
 * Result rather than thrown.
 */

import type { RiskDecision, RiskOrderSide, TradingIntent } from "../risk/riskEngine";

export type OrderType = "MARKET";

/** feeRate and slippageRate must each be finite and within [0, 1]. */
export interface ExecutionPolicy {
  readonly feeRate: number;
  readonly slippageRate: number;
}

/**
 * strategyId/symbol are copied from TradingIntent as-is (optional there, optional here --
 * never fabricated when absent).
 */
export interface PlannedOrder {
  readonly strategyId?: string;
  readonly symbol?: string;
  readonly side: RiskOrderSide;
  readonly orderType: OrderType;
  readonly quantity: number;
  readonly marketPrice: number;
  readonly executionPrice: number;
  readonly orderValue: number;
  readonly estimatedFee: number;
  readonly estimatedSlippage: number;
}

export type PlannerFailureCode =
  | "RISK_BLOCKED"
  | "INVALID_POLICY"
  | "INVALID_MARKET_PRICE"
  | "INVALID_QUANTITY"
  | "INVALID_EXECUTION_PRICE"
  | "INVALID_ORDER_VALUE";

export interface PlannerPlannedResult {
  readonly status: "PLANNED";
  readonly order: PlannedOrder;
}

export interface PlannerFailedResult {
  readonly status: "FAILED";
  readonly code: PlannerFailureCode;
  readonly reason: string;
}

export type PlannerResult = PlannerPlannedResult | PlannerFailedResult;

export interface OrderPlanner {
  plan(intent: TradingIntent, decision: RiskDecision, marketPrice: number, policy: ExecutionPolicy): PlannerResult;
}

const ORDER_TYPE: OrderType = "MARKET";

function failed(code: PlannerFailureCode, reason: string): PlannerFailedResult {
  return { status: "FAILED", code, reason };
}

function isFiniteWithinUnitRange(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validation/computation order (fixed):
 *   1. RiskDecision is ALLOW -> else RISK_BLOCKED
 *   2. ExecutionPolicy (feeRate, slippageRate each finite, in [0, 1]) -> else INVALID_POLICY
 *   3. marketPrice finite and positive -> else INVALID_MARKET_PRICE
 *   4. quantity finite and positive -> else INVALID_QUANTITY
 *   5. executionPrice = marketPrice * (1 +/- slippageRate); finite and positive -> else
 *      INVALID_EXECUTION_PRICE
 *   6. orderValue = executionPrice * quantity; finite and positive -> else
 *      INVALID_ORDER_VALUE
 *   7. estimatedFee = orderValue * feeRate; estimatedSlippage = |executionPrice -
 *      marketPrice| * quantity (no separate validation: both are bounded by already-valid
 *      orderValue/executionPrice and a feeRate/slippageRate already confirmed to be within
 *      [0, 1], so cannot overflow independently)
 *   8. return PLANNED with the new PlannedOrder
 * Only the first failing check is ever returned.
 */
export class DefaultOrderPlanner implements OrderPlanner {
  plan(intent: TradingIntent, decision: RiskDecision, marketPrice: number, policy: ExecutionPolicy): PlannerResult {
    if (decision.outcome !== "ALLOW") {
      return failed("RISK_BLOCKED", `risk decision was not ALLOW: ${decision.code} -- ${decision.reason}`);
    }
    if (!isFiniteWithinUnitRange(policy.feeRate) || !isFiniteWithinUnitRange(policy.slippageRate)) {
      return failed("INVALID_POLICY", "feeRate and slippageRate must each be finite and within [0, 1]");
    }
    if (!Number.isFinite(marketPrice) || marketPrice <= 0) {
      return failed("INVALID_MARKET_PRICE", "marketPrice must be a finite positive number");
    }
    if (!Number.isFinite(intent.quantity) || intent.quantity <= 0) {
      return failed("INVALID_QUANTITY", "quantity must be a finite positive number");
    }

    const executionPrice = intent.side === "BUY"
      ? marketPrice * (1 + policy.slippageRate)
      : marketPrice * (1 - policy.slippageRate);
    if (!Number.isFinite(executionPrice) || executionPrice <= 0) {
      return failed("INVALID_EXECUTION_PRICE", `computed executionPrice (${executionPrice}) must be finite and positive`);
    }

    const orderValue = executionPrice * intent.quantity;
    if (!Number.isFinite(orderValue) || orderValue <= 0) {
      return failed("INVALID_ORDER_VALUE", `computed orderValue (${orderValue}) must be finite and positive`);
    }

    const estimatedFee = orderValue * policy.feeRate;
    const estimatedSlippage = Math.abs(executionPrice - marketPrice) * intent.quantity;

    return {
      status: "PLANNED",
      order: {
        ...(intent.strategyId === undefined ? {} : { strategyId: intent.strategyId }),
        ...(intent.symbol === undefined ? {} : { symbol: intent.symbol }),
        side: intent.side,
        orderType: ORDER_TYPE,
        quantity: intent.quantity,
        marketPrice,
        executionPrice,
        orderValue,
        estimatedFee,
        estimatedSlippage
      }
    };
  }
}
