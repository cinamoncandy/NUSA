import type { PaperSide } from "./paperBroker";

export interface ExecutionCostModel {
  readonly spreadBps: number;
  readonly slippageBps: number;
}

export interface AppliedExecutionCost {
  readonly referencePrice: number;
  readonly executedPrice: number;
  readonly adverseRate: number;
  readonly spreadBps: number;
  readonly slippageBps: number;
  /**
   * Present when the model charges nothing. A zero-cost fill is a legitimate configuration but
   * it is not a realistic one: the reported result excludes the half-spread crossed on entry and
   * exit and any slippage, so it will read better than the same strategy would in a venue. This
   * follows the convention already used for LATENCY_NOT_MODELED -- name the omission rather than
   * let the number stand unqualified.
   */
  readonly warning?: "EXECUTION_COST_NOT_MODELED";
}

export const ZERO_EXECUTION_COST: ExecutionCostModel = Object.freeze({ spreadBps: 0, slippageBps: 0 });

export function validateExecutionCostModel(model: ExecutionCostModel): ExecutionCostModel {
  for (const [name, value] of [["spreadBps", model.spreadBps], ["slippageBps", model.slippageBps]] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`);
  }
  if (model.spreadBps / 2 + model.slippageBps >= 10_000) throw new Error("execution cost model would produce a non-positive sell price");
  return Object.freeze({ spreadBps: model.spreadBps, slippageBps: model.slippageBps });
}

/**
 * Adjusts a reference market price to the price a marketable order would actually fill at.
 *
 * A buyer lifts the offer and a seller hits the bid, so each crosses half the quoted spread; any
 * slippage is adverse in the same direction. Both sides are therefore moved against the trader,
 * never in their favour.
 *
 * This is the single definition of that adjustment. The backtest engine and the live paper
 * runtime both call it, so a strategy validated in backtest under a given cost model cannot then
 * report better numbers in paper trading purely because the two paths priced fills differently.
 */
export function applyExecutionCost(side: PaperSide, referencePrice: number, model: ExecutionCostModel): AppliedExecutionCost {
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) throw new Error("referencePrice must be positive");
  const validated = validateExecutionCostModel(model);
  const adverseRate = validated.spreadBps / 20_000 + validated.slippageBps / 10_000;
  const executedPrice = side === "BUY" ? referencePrice * (1 + adverseRate) : referencePrice * (1 - adverseRate);
  const applied: AppliedExecutionCost = {
    referencePrice,
    executedPrice,
    adverseRate,
    spreadBps: validated.spreadBps,
    slippageBps: validated.slippageBps,
    ...(adverseRate === 0 ? { warning: "EXECUTION_COST_NOT_MODELED" as const } : {})
  };
  return Object.freeze(applied);
}
