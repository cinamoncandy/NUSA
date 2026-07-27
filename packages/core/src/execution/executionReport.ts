/**
 * E02-T005 -- Execution Report (self-scoped: no formal ticket text was given, designed to
 * match the exact conventions of E02-T002/T003/T004 -- a Result discriminated union, pure
 * builder functions, no exceptions), per the pipeline diagram:
 *   ... -> PaperExecutor -> ExecutionReport -> Portfolio -> PnL
 *
 * Pure domain module: a formal report of what happened when a PlannedOrder was submitted
 * for execution. This is NOT a re-implementation of PaperBroker's fill logic
 * (apps/desktop/src/paperBroker.ts remains the actual execution engine and single source
 * of truth for real fills, fees, and the fill model) -- it only defines the report shape
 * and pure builder functions that construct one from an already-known fill or rejection
 * reason, so the pipeline's execution outcome has one formally named, testable type instead
 * of ad hoc {order} / {reason} handling at each call site. No framework/database/network
 * dependency; no async; no time or random values; inputs are never mutated.
 */

import type { RiskOrderSide } from "../risk/riskEngine";

export interface FilledExecutionReport {
  readonly status: "FILLED";
  readonly side: RiskOrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly orderValue: number;
  readonly strategyId?: string;
  readonly symbol?: string;
}

export interface RejectedExecutionReport {
  readonly status: "REJECTED";
  readonly reason: string;
}

export type ExecutionReport = FilledExecutionReport | RejectedExecutionReport;

export interface FilledExecutionInput {
  readonly side: RiskOrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly fee: number;
  readonly strategyId?: string;
  readonly symbol?: string;
}

/** orderValue = price * quantity, matching the same convention as OrderPlanner/RiskEngine. */
export function filledExecutionReport(input: FilledExecutionInput): FilledExecutionReport {
  return {
    status: "FILLED",
    side: input.side,
    quantity: input.quantity,
    price: input.price,
    fee: input.fee,
    orderValue: input.price * input.quantity,
    ...(input.strategyId === undefined ? {} : { strategyId: input.strategyId }),
    ...(input.symbol === undefined ? {} : { symbol: input.symbol })
  };
}

export function rejectedExecutionReport(reason: string): RejectedExecutionReport {
  return { status: "REJECTED", reason };
}
