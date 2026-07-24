export type StrategyLifecycleStage = "IDEA" | "RESEARCH" | "BACKTEST" | "WALK_FORWARD" | "PAPER" | "CHAMPION" | "ARCHIVED";

export interface StrategyLifecycleInput {
  readonly strategyId: string;
  readonly stage: StrategyLifecycleStage;
  readonly researchPassed: boolean;
  readonly backtestPassed: boolean;
  readonly walkForwardPassed: boolean;
  readonly paperEligible: boolean;
  readonly champion: boolean;
  readonly archived: boolean;
}

export interface StrategyLifecycleView {
  readonly strategyId: string;
  readonly currentStage: StrategyLifecycleStage;
  readonly completedStages: readonly StrategyLifecycleStage[];
  readonly nextStage: StrategyLifecycleStage | null;
  readonly reasons: readonly string[];
}

const order: readonly StrategyLifecycleStage[] = ["IDEA", "RESEARCH", "BACKTEST", "WALK_FORWARD", "PAPER", "CHAMPION", "ARCHIVED"];

export function buildStrategyLifecycleView(input: StrategyLifecycleInput): StrategyLifecycleView {
  if (!input.strategyId.trim()) throw new Error("strategyId is required");
  const reasons: string[] = [];
  if (input.stage === "CHAMPION" && !input.paperEligible) reasons.push("Champion stage requires Paper eligibility");
  if (input.champion && input.stage !== "CHAMPION") reasons.push("Champion flag and lifecycle stage disagree");
  if (input.archived && input.stage !== "ARCHIVED") reasons.push("Archived flag and lifecycle stage disagree");
  const index = order.indexOf(input.stage);
  const completedStages = order.slice(0, index + 1);
  const nextStage = index >= order.length - 1 ? null : order[index + 1];
  return Object.freeze({
    strategyId: input.strategyId.trim(),
    currentStage: input.stage,
    completedStages: Object.freeze([...completedStages]),
    nextStage,
    reasons: Object.freeze(reasons)
  });
}
