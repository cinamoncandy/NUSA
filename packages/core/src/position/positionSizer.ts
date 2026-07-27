/**
 * E02-T004 -- Position Sizer (self-scoped: no formal ticket text was given, designed to
 * match the exact conventions of E02-T002's RiskEngine and E02-T003's OrderPlanner --
 * interface + Default* implementation, a Result discriminated union, a fixed validation
 * order, no exceptions for domain failures -- per the pipeline diagram:
 *   Strategy -> TradingIntent -> PositionSizer -> RiskEngine -> OrderPlanner ->
 *   PaperExecutor -> ExecutionReport -> Portfolio -> PnL
 *
 * Pure domain module: given a not-yet-sized TradingIntent (direction only, no quantity --
 * see the updated TradingIntent doc comment in ../risk/riskEngine.ts), an account
 * SizingContext, and a SizingPolicy, produces a sized TradingIntent (quantity populated)
 * ready for RiskEngine. Does not check risk limits, does not reject a SELL that exceeds
 * the current position (PaperBroker already caps that defensively, and duplicating it here
 * would blur PositionSizer's one job: deciding how much capital a fresh intent should
 * risk). No framework/database/network dependency; no async; no time or random values;
 * inputs are never mutated.
 */

import type { TradingIntent } from "../risk/riskEngine";

export type SizingMode = "FIXED" | "FIXED_FRACTIONAL";

/**
 * FIXED requires fixedQuantity (finite, > 0). FIXED_FRACTIONAL requires riskFraction
 * (finite, in (0, 1]) -- quantity = equity * riskFraction / marketPrice. quantityStep, if
 * given, floors the result to that step (finite, > 0); omitting it returns the raw
 * quotient unfloored, matching apps/desktop/src/positionSizing.ts's own convention.
 */
export interface SizingPolicy {
  readonly mode: SizingMode;
  readonly fixedQuantity?: number;
  readonly riskFraction?: number;
  readonly quantityStep?: number;
}

export interface SizingContext {
  readonly equity: number;
  readonly marketPrice: number;
}

export type SizingFailureCode =
  | "INVALID_POLICY"
  | "INVALID_EQUITY"
  | "INVALID_MARKET_PRICE"
  | "ZERO_QUANTITY";

export interface PositionSizedResult {
  readonly status: "SIZED";
  /** The input intent with quantity populated; all other fields (side, strategyId, symbol) copied through unchanged. */
  readonly intent: TradingIntent;
}

export interface PositionSizingFailedResult {
  readonly status: "FAILED";
  readonly code: SizingFailureCode;
  readonly reason: string;
}

export type PositionSizingResult = PositionSizedResult | PositionSizingFailedResult;

export interface PositionSizer {
  size(intent: TradingIntent, context: SizingContext, policy: SizingPolicy): PositionSizingResult;
}

function isFinitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function failed(code: SizingFailureCode, reason: string): PositionSizingFailedResult {
  return { status: "FAILED", code, reason };
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  const exponentMarker = text.indexOf("e-");
  if (exponentMarker >= 0) return Number(text.slice(exponentMarker + 2));
  const decimalMarker = text.indexOf(".");
  return decimalMarker < 0 ? 0 : text.length - decimalMarker - 1;
}

function floorToStep(value: number, step: number): number {
  const precision = Math.min(15, Math.max(decimalPlaces(step), 0));
  const units = Math.floor((value + Number.EPSILON) / step);
  return Number((units * step).toFixed(precision));
}

/**
 * Validation/computation order (fixed):
 *   1. SizingPolicy is valid for its mode -> else INVALID_POLICY
 *   2. context.equity finite and positive -> else INVALID_EQUITY
 *   3. context.marketPrice finite and positive -> else INVALID_MARKET_PRICE
 *   4. rawQuantity computed per mode (FIXED: policy.fixedQuantity as-is; FIXED_FRACTIONAL:
 *      equity * riskFraction / marketPrice)
 *   5. floor to quantityStep if provided
 *   6. quantity > 0 -> else ZERO_QUANTITY
 *   7. return SIZED with the intent's quantity set to this value
 * Only the first failing check is ever returned. intent.quantity, if the caller already
 * set one, is always overridden -- PositionSizer is the single source of truth for
 * quantity in this pipeline stage.
 */
export class DefaultPositionSizer implements PositionSizer {
  size(intent: TradingIntent, context: SizingContext, policy: SizingPolicy): PositionSizingResult {
    if (policy.mode === "FIXED") {
      if (!isFinitePositive(policy.fixedQuantity)) {
        return failed("INVALID_POLICY", "fixedQuantity must be finite and positive when mode is FIXED");
      }
    } else if (policy.mode === "FIXED_FRACTIONAL") {
      if (policy.riskFraction === undefined || !Number.isFinite(policy.riskFraction) || policy.riskFraction <= 0 || policy.riskFraction > 1) {
        return failed("INVALID_POLICY", "riskFraction must be finite and within (0, 1] when mode is FIXED_FRACTIONAL");
      }
    } else {
      return failed("INVALID_POLICY", `unknown sizing mode: ${String(policy.mode)}`);
    }
    if (policy.quantityStep !== undefined && !isFinitePositive(policy.quantityStep)) {
      return failed("INVALID_POLICY", "quantityStep must be finite and positive when provided");
    }

    if (!isFinitePositive(context.equity)) {
      return failed("INVALID_EQUITY", "equity must be finite and positive");
    }
    if (!isFinitePositive(context.marketPrice)) {
      return failed("INVALID_MARKET_PRICE", "marketPrice must be finite and positive");
    }

    const rawQuantity = policy.mode === "FIXED"
      ? (policy.fixedQuantity as number)
      : (context.equity * (policy.riskFraction as number)) / context.marketPrice;

    const quantity = policy.quantityStep === undefined ? rawQuantity : floorToStep(rawQuantity, policy.quantityStep);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return failed("ZERO_QUANTITY", `computed quantity (${quantity}) is not a positive finite number`);
    }

    return {
      status: "SIZED",
      intent: {
        ...(intent.strategyId === undefined ? {} : { strategyId: intent.strategyId }),
        ...(intent.symbol === undefined ? {} : { symbol: intent.symbol }),
        side: intent.side,
        quantity
      }
    };
  }
}
