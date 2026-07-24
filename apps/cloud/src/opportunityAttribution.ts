export interface OpportunityAttributionInput {
  readonly opportunityId: string;
  readonly strategyId: string;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly notional: number;
  readonly expectedEdgeBps: number;
  readonly entryReferencePrice: number;
  readonly entryFillPrice: number;
  readonly exitReferencePrice: number;
  readonly exitFillPrice: number;
  readonly side: "LONG" | "SHORT" | "NEUTRAL";
  readonly fundingContribution: number;
  readonly feeCost: number;
  readonly slippageCost: number;
  readonly decayLoss: number;
  readonly confidence: number;
  readonly realizedOutcome: 0 | 1;
}

export interface OpportunityAttribution {
  readonly opportunityId: string;
  readonly strategyId: string;
  readonly holdingPeriodMs: number;
  readonly grossPnl: number;
  readonly netPnl: number;
  readonly marketMoveContribution: number;
  readonly fundingContribution: number;
  readonly executionContribution: number;
  readonly feeContribution: number;
  readonly slippageContribution: number;
  readonly timingContribution: number;
  readonly decayContribution: number;
  readonly expectedEdgeValue: number;
  readonly capturedEdgeValue: number;
  readonly edgeCaptureRatio: number;
  readonly confidenceCalibrationError: number;
  readonly reconciliationError: number;
}

const finite = (value: number, field: string): void => {
  if (!Number.isFinite(value)) throw new Error(`${field} must be finite`);
};

const positive = (value: number, field: string): void => {
  finite(value, field);
  if (value <= 0) throw new Error(`${field} must be positive`);
};

const time = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
};

const round8 = (value: number): number => Math.round(value * 100_000_000) / 100_000_000;

const signedReturn = (side: OpportunityAttributionInput["side"], from: number, to: number): number => {
  const raw = (to - from) / from;
  if (side === "LONG") return raw;
  if (side === "SHORT") return -raw;
  return 0;
};

export function attributeOpportunityPerformance(input: OpportunityAttributionInput): OpportunityAttribution {
  if (!input.opportunityId.trim() || !input.strategyId.trim()) throw new Error("opportunityId and strategyId are required");
  time(input.openedAt, "openedAt");
  time(input.closedAt, "closedAt");
  if (input.closedAt < input.openedAt) throw new Error("closedAt must not precede openedAt");
  positive(input.notional, "notional");
  finite(input.expectedEdgeBps, "expectedEdgeBps");
  positive(input.entryReferencePrice, "entryReferencePrice");
  positive(input.entryFillPrice, "entryFillPrice");
  positive(input.exitReferencePrice, "exitReferencePrice");
  positive(input.exitFillPrice, "exitFillPrice");
  for (const [field, value] of Object.entries({
    fundingContribution: input.fundingContribution,
    feeCost: input.feeCost,
    slippageCost: input.slippageCost,
    decayLoss: input.decayLoss,
    confidence: input.confidence,
    realizedOutcome: input.realizedOutcome
  })) finite(value, field);
  if (input.feeCost < 0 || input.slippageCost < 0 || input.decayLoss < 0) throw new Error("cost inputs must be non-negative");
  if (input.confidence < 0 || input.confidence > 1) throw new Error("confidence must be between 0 and 1");

  const grossPnl = input.notional * signedReturn(input.side, input.entryFillPrice, input.exitFillPrice);
  const marketMoveContribution = input.notional * signedReturn(input.side, input.entryReferencePrice, input.exitReferencePrice);
  const entryExecution = input.notional * signedReturn(input.side, input.entryReferencePrice, input.entryFillPrice);
  const exitExecution = input.notional * signedReturn(input.side, input.exitReferencePrice, input.exitFillPrice);
  const executionContribution = entryExecution + exitExecution;
  const feeContribution = -input.feeCost;
  const slippageContribution = -input.slippageCost;
  const decayContribution = -input.decayLoss;
  const expectedEdgeValue = input.notional * input.expectedEdgeBps / 10_000;
  const netPnl = grossPnl + input.fundingContribution + feeContribution + slippageContribution + decayContribution;
  const timingContribution = grossPnl - marketMoveContribution - executionContribution;
  const capturedEdgeValue = netPnl;
  const edgeCaptureRatio = expectedEdgeValue > 0 ? capturedEdgeValue / expectedEdgeValue : 0;
  const confidenceCalibrationError = Math.abs(input.confidence - input.realizedOutcome);
  const components = marketMoveContribution + executionContribution + timingContribution + input.fundingContribution + feeContribution + slippageContribution + decayContribution;
  const reconciliationError = netPnl - components;

  return Object.freeze({
    opportunityId: input.opportunityId.trim(),
    strategyId: input.strategyId.trim(),
    holdingPeriodMs: input.closedAt - input.openedAt,
    grossPnl: round8(grossPnl),
    netPnl: round8(netPnl),
    marketMoveContribution: round8(marketMoveContribution),
    fundingContribution: round8(input.fundingContribution),
    executionContribution: round8(executionContribution),
    feeContribution: round8(feeContribution),
    slippageContribution: round8(slippageContribution),
    timingContribution: round8(timingContribution),
    decayContribution: round8(decayContribution),
    expectedEdgeValue: round8(expectedEdgeValue),
    capturedEdgeValue: round8(capturedEdgeValue),
    edgeCaptureRatio: round8(edgeCaptureRatio),
    confidenceCalibrationError: round8(confidenceCalibrationError),
    reconciliationError: round8(reconciliationError)
  });
}

export function aggregateOpportunityAttributions(items: readonly OpportunityAttribution[]): Readonly<{
  totalNetPnl: number;
  averageEdgeCaptureRatio: number;
  averageCalibrationError: number;
  byStrategy: readonly Readonly<{ strategyId: string; count: number; netPnl: number }>[];
}> {
  const seen = new Set<string>();
  const groups = new Map<string, { count: number; netPnl: number }>();
  for (const item of items) {
    if (seen.has(item.opportunityId)) throw new Error("duplicate opportunity attribution");
    seen.add(item.opportunityId);
    const group = groups.get(item.strategyId) ?? { count: 0, netPnl: 0 };
    group.count += 1;
    group.netPnl += item.netPnl;
    groups.set(item.strategyId, group);
  }
  const totalNetPnl = items.reduce((sum, item) => sum + item.netPnl, 0);
  const averageEdgeCaptureRatio = items.length === 0 ? 0 : items.reduce((sum, item) => sum + item.edgeCaptureRatio, 0) / items.length;
  const averageCalibrationError = items.length === 0 ? 0 : items.reduce((sum, item) => sum + item.confidenceCalibrationError, 0) / items.length;
  const byStrategy = [...groups.entries()]
    .map(([strategyId, value]) => Object.freeze({ strategyId, count: value.count, netPnl: round8(value.netPnl) }))
    .sort((a, b) => b.netPnl - a.netPnl || a.strategyId.localeCompare(b.strategyId));
  return Object.freeze({
    totalNetPnl: round8(totalNetPnl),
    averageEdgeCaptureRatio: round8(averageEdgeCaptureRatio),
    averageCalibrationError: round8(averageCalibrationError),
    byStrategy: Object.freeze(byStrategy)
  });
}
