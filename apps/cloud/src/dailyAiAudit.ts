import type { OpportunityAttribution } from "./opportunityAttribution";

export type StrategyHealth = "HEALTHY" | "WATCH" | "THROTTLE_RECOMMENDED" | "PAPER_ONLY_RECOMMENDED";

export interface DailyAiAuditThresholds {
  readonly minimumTrades: number;
  readonly minimumAverageCaptureRatio: number;
  readonly maximumAverageCalibrationError: number;
  readonly maximumExecutionCostRatio: number;
  readonly minimumNetPnl: number;
}

export interface DailyAiAuditInput {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly generatedAt: number;
  readonly attributions: readonly OpportunityAttribution[];
  readonly thresholds: DailyAiAuditThresholds;
}

export interface StrategyHealthSummary {
  readonly strategyId: string;
  readonly tradeCount: number;
  readonly netPnl: number;
  readonly averageCaptureRatio: number;
  readonly averageCalibrationError: number;
  readonly executionCostRatio: number;
  readonly health: StrategyHealth;
  readonly reasons: readonly string[];
}

export interface DailyAiAudit {
  readonly periodStart: number;
  readonly periodEnd: number;
  readonly generatedAt: number;
  readonly totalTrades: number;
  readonly totalNetPnl: number;
  readonly totalExpectedEdgeValue: number;
  readonly totalCapturedEdgeValue: number;
  readonly portfolioCaptureRatio: number;
  readonly averageCalibrationError: number;
  readonly totalExecutionDrag: number;
  readonly strategies: readonly StrategyHealthSummary[];
  readonly warnings: readonly string[];
}

const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

const assertTime = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const assertFinite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const validateThresholds = (thresholds: DailyAiAuditThresholds): void => {
  if (!Number.isSafeInteger(thresholds.minimumTrades) || thresholds.minimumTrades < 1) throw new Error("minimumTrades must be a positive safe integer");
  assertFinite(thresholds.minimumAverageCaptureRatio, "minimumAverageCaptureRatio");
  assertFinite(thresholds.maximumAverageCalibrationError, "maximumAverageCalibrationError");
  assertFinite(thresholds.maximumExecutionCostRatio, "maximumExecutionCostRatio");
  assertFinite(thresholds.minimumNetPnl, "minimumNetPnl");
  if (thresholds.maximumAverageCalibrationError < 0 || thresholds.maximumAverageCalibrationError > 1) throw new Error("maximumAverageCalibrationError must be between 0 and 1");
  if (thresholds.maximumExecutionCostRatio < 0) throw new Error("maximumExecutionCostRatio must be non-negative");
};

interface MutableStrategyGroup {
  count: number;
  netPnl: number;
  expectedEdge: number;
  capturedEdge: number;
  calibrationError: number;
  executionDrag: number;
}

const classify = (group: MutableStrategyGroup, thresholds: DailyAiAuditThresholds): Readonly<{ health: StrategyHealth; reasons: readonly string[] }> => {
  const reasons: string[] = [];
  const capture = group.expectedEdge > 0 ? group.capturedEdge / group.expectedEdge : 0;
  const calibration = group.count > 0 ? group.calibrationError / group.count : 0;
  const executionRatio = group.expectedEdge > 0 ? group.executionDrag / group.expectedEdge : 0;

  if (group.count < thresholds.minimumTrades) reasons.push("INSUFFICIENT_SAMPLE");
  if (capture < thresholds.minimumAverageCaptureRatio) reasons.push("LOW_EDGE_CAPTURE");
  if (calibration > thresholds.maximumAverageCalibrationError) reasons.push("CALIBRATION_ERROR_HIGH");
  if (executionRatio > thresholds.maximumExecutionCostRatio) reasons.push("EXECUTION_DRAG_HIGH");
  if (group.netPnl < thresholds.minimumNetPnl) reasons.push("NET_PNL_BELOW_THRESHOLD");

  const severe = reasons.includes("NET_PNL_BELOW_THRESHOLD") && (reasons.includes("LOW_EDGE_CAPTURE") || reasons.includes("EXECUTION_DRAG_HIGH"));
  const health: StrategyHealth = severe
    ? "PAPER_ONLY_RECOMMENDED"
    : reasons.includes("LOW_EDGE_CAPTURE") || reasons.includes("EXECUTION_DRAG_HIGH")
      ? "THROTTLE_RECOMMENDED"
      : reasons.length > 0
        ? "WATCH"
        : "HEALTHY";

  return Object.freeze({ health, reasons: Object.freeze(reasons.sort()) });
};

export function buildDailyAiAudit(input: DailyAiAuditInput): DailyAiAudit {
  assertTime(input.periodStart, "periodStart");
  assertTime(input.periodEnd, "periodEnd");
  assertTime(input.generatedAt, "generatedAt");
  if (input.periodEnd < input.periodStart) throw new Error("periodEnd must not precede periodStart");
  if (input.generatedAt < input.periodEnd) throw new Error("generatedAt must not precede periodEnd");
  validateThresholds(input.thresholds);

  const seen = new Set<string>();
  const groups = new Map<string, MutableStrategyGroup>();
  let totalNetPnl = 0;
  let totalExpectedEdgeValue = 0;
  let totalCapturedEdgeValue = 0;
  let totalCalibrationError = 0;
  let totalExecutionDrag = 0;

  for (const item of input.attributions) {
    if (!item.opportunityId.trim() || !item.strategyId.trim()) throw new Error("attribution identifiers are required");
    if (seen.has(item.opportunityId)) throw new Error("duplicate opportunity attribution");
    seen.add(item.opportunityId);

    for (const [field, value] of Object.entries({
      netPnl: item.netPnl,
      expectedEdgeValue: item.expectedEdgeValue,
      capturedEdgeValue: item.capturedEdgeValue,
      confidenceCalibrationError: item.confidenceCalibrationError,
      executionContribution: item.executionContribution,
      feeContribution: item.feeContribution,
      slippageContribution: item.slippageContribution
    })) assertFinite(value, field);

    const executionDrag = Math.max(0, -(item.executionContribution + item.feeContribution + item.slippageContribution));
    const group = groups.get(item.strategyId) ?? { count: 0, netPnl: 0, expectedEdge: 0, capturedEdge: 0, calibrationError: 0, executionDrag: 0 };
    group.count += 1;
    group.netPnl += item.netPnl;
    group.expectedEdge += item.expectedEdgeValue;
    group.capturedEdge += item.capturedEdgeValue;
    group.calibrationError += item.confidenceCalibrationError;
    group.executionDrag += executionDrag;
    groups.set(item.strategyId, group);

    totalNetPnl += item.netPnl;
    totalExpectedEdgeValue += item.expectedEdgeValue;
    totalCapturedEdgeValue += item.capturedEdgeValue;
    totalCalibrationError += item.confidenceCalibrationError;
    totalExecutionDrag += executionDrag;
  }

  const strategies = [...groups.entries()].map(([strategyId, group]) => {
    const assessment = classify(group, input.thresholds);
    return Object.freeze({
      strategyId,
      tradeCount: group.count,
      netPnl: round8(group.netPnl),
      averageCaptureRatio: round8(group.expectedEdge > 0 ? group.capturedEdge / group.expectedEdge : 0),
      averageCalibrationError: round8(group.count > 0 ? group.calibrationError / group.count : 0),
      executionCostRatio: round8(group.expectedEdge > 0 ? group.executionDrag / group.expectedEdge : 0),
      health: assessment.health,
      reasons: assessment.reasons
    });
  }).sort((a, b) => a.health.localeCompare(b.health) || b.netPnl - a.netPnl || a.strategyId.localeCompare(b.strategyId));

  const warnings = strategies
    .filter((item) => item.health !== "HEALTHY")
    .map((item) => `${item.strategyId}:${item.health}`)
    .sort();

  return Object.freeze({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    generatedAt: input.generatedAt,
    totalTrades: input.attributions.length,
    totalNetPnl: round8(totalNetPnl),
    totalExpectedEdgeValue: round8(totalExpectedEdgeValue),
    totalCapturedEdgeValue: round8(totalCapturedEdgeValue),
    portfolioCaptureRatio: round8(totalExpectedEdgeValue > 0 ? totalCapturedEdgeValue / totalExpectedEdgeValue : 0),
    averageCalibrationError: round8(input.attributions.length > 0 ? totalCalibrationError / input.attributions.length : 0),
    totalExecutionDrag: round8(totalExecutionDrag),
    strategies: Object.freeze(strategies),
    warnings: Object.freeze(warnings)
  });
}
