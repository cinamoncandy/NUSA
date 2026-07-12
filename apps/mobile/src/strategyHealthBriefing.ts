import type { DailyAiAudit, StrategyHealth } from "../../cloud/src/dailyAiAudit";

export interface StrategyHealthBriefingInput {
  readonly audit: DailyAiAudit;
  readonly maximumAgeMs: number;
}

export interface StrategyHealthCard {
  readonly strategyId: string;
  readonly health: StrategyHealth;
  readonly severity: "NORMAL" | "CAUTION" | "WARNING" | "BLOCKED";
  readonly tradeCount: number;
  readonly netPnl: number;
  readonly capturePercent: number;
  readonly calibrationErrorPercent: number;
  readonly executionCostPercent: number;
  readonly reasons: readonly string[];
}

export interface StrategyHealthBriefing {
  readonly status: "HEALTHY" | "CAUTION" | "BLOCKED";
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly generatedAt: number;
  readonly totalTrades: number;
  readonly totalNetPnl: number;
  readonly portfolioCapturePercent: number;
  readonly averageCalibrationErrorPercent: number;
  readonly totalExecutionDrag: number;
  readonly cards: readonly StrategyHealthCard[];
  readonly warnings: readonly string[];
}

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const percent = (value: number): number => Math.round(value * 10_000) / 100;

const severityFor = (health: StrategyHealth): StrategyHealthCard["severity"] => {
  switch (health) {
    case "HEALTHY": return "NORMAL";
    case "WATCH": return "CAUTION";
    case "THROTTLE_RECOMMENDED": return "WARNING";
    case "PAPER_ONLY_RECOMMENDED": return "BLOCKED";
  }
};

export function buildStrategyHealthBriefing(
  input: StrategyHealthBriefingInput,
  now: number
): StrategyHealthBriefing {
  time(now, "now");
  time(input.maximumAgeMs, "maximumAgeMs");
  time(input.audit.generatedAt, "audit.generatedAt");
  if (input.audit.generatedAt > now) throw new Error("strategy health audit cannot come from the future");
  if (now - input.audit.generatedAt > input.maximumAgeMs) throw new Error("strategy health audit is stale");

  for (const [field, value] of Object.entries({
    totalNetPnl: input.audit.totalNetPnl,
    portfolioCaptureRatio: input.audit.portfolioCaptureRatio,
    averageCalibrationError: input.audit.averageCalibrationError,
    totalExecutionDrag: input.audit.totalExecutionDrag
  })) finite(value, field);

  const seen = new Set<string>();
  const cards = input.audit.strategies.map((strategy) => {
    const strategyId = strategy.strategyId.trim();
    if (!strategyId) throw new Error("strategyId is required");
    if (seen.has(strategyId)) throw new Error("duplicate strategy health summary");
    seen.add(strategyId);
    const reasons = Object.freeze([...strategy.reasons].sort());
    return Object.freeze({
      strategyId,
      health: strategy.health,
      severity: severityFor(strategy.health),
      tradeCount: strategy.tradeCount,
      netPnl: strategy.netPnl,
      capturePercent: percent(strategy.averageCaptureRatio),
      calibrationErrorPercent: percent(strategy.averageCalibrationError),
      executionCostPercent: percent(strategy.executionCostRatio),
      reasons
    });
  }).sort((a, b) => b.severity.localeCompare(a.severity) || a.strategyId.localeCompare(b.strategyId));

  const hasBlocked = cards.some((card) => card.severity === "BLOCKED");
  const hasCaution = cards.some((card) => card.severity !== "NORMAL");

  return Object.freeze({
    status: hasBlocked ? "BLOCKED" : hasCaution ? "CAUTION" : "HEALTHY",
    periodStart: input.audit.periodStart,
    periodEnd: input.audit.periodEnd,
    generatedAt: input.audit.generatedAt,
    totalTrades: input.audit.totalTrades,
    totalNetPnl: input.audit.totalNetPnl,
    portfolioCapturePercent: percent(input.audit.portfolioCaptureRatio),
    averageCalibrationErrorPercent: percent(input.audit.averageCalibrationError),
    totalExecutionDrag: input.audit.totalExecutionDrag,
    cards: Object.freeze(cards),
    warnings: Object.freeze([...input.audit.warnings].sort())
  });
}
