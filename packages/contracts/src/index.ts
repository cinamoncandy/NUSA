export * from "./decision";
export * from "./decisionRecord";
export * from "./decisionAudit";
export * from "./decisionAuthorization";
export * from "./decisionExecutionIntent";
export * from "./decisionExecutionReceipt";
export * from "./compliance";
export * from "./resilience";
export * from "./rules";
export * from "./multiAgentGovernance";
export * from "./riskGateway";
export * from "./paperSafetySnapshot";
export * from "./persistenceLedger";
export * from "./executionPersistence";
export * from "./evidenceGraph";
export * from "./recovery";
export * from "./recoveryEvidence";
export * from "./strategyGovernanceLedger";
export * from "./capabilityRegistry";
export * from "./championChallenger";
export * from "./dataStrategyIdentity";
export * from "./deploymentBundle";
export * from "./safetyArchitecture";
export * from "./shadowGovernance";
export * from "./shadowObservabilityReadOnly";
export * from "./restrictedLiveGovernance";
export * from "./researchRuntime";
export * from "./candidatePromotion";
export * from "./researchRecovery";
export * from "./researchAutomation";
export * from "./researchHardening";
export * from "./researchMemoryLifecycle";
export * from "./personalPaperOperations";
export * from "./operationalProgress";
export * from "./evolutionLearningSupervisor";
export * from "./aiInference";
export * from "./aiCalibrationDurability";
export * from "./aiInferenceResources";
export * from "./aiExplanationFaithfulness";
export * from "./liveReadinessObservability";
export * from "./paperForwardEvidence";
export * from "./leagueCapitalAllocation";
export * from "./persistedPaperPeriod";
export * from "./uxTelemetryEvent";
export * from "./aiTradingJudgment";
export * from "./researchHypothesisContract";
export * from "./portfolioRiskIntelligence";
export * from "./aiEvaluationTemporalPartition";
export * from "./aiEvaluationDataVintage";
export * from "./aiEvaluationDependenceGroups";
export * from "./aiEvaluationMultipleTestingCorrection";
export * from "./aiEvaluationEconomicCostDecomposition";
export * from "./aiEvaluationLineage";
export * from "./aiEvaluationFrozenSelection";
export * from "./aiEvaluationPointInTimeRegimeLabels";
export * from "./aiEvaluationConfirmatoryLabeling";
export * from "./aiEvaluationTailConditionalLoss";
export * from "./aiEvaluationSensitivityAnalysisLabeling";
export * from "./aiEvaluationRegimeDegradationMonitoring";
export * from "./aiEvaluationCalibrationMetrics";
export * from "./aiEvaluationCohortAccounting";
export * from "./aiEvaluationTailEventIdentity";
export * from "./aiEvaluationAbstention";
export * from "./aiEvaluationUniverseMembership";

export enum LedgerSide { BUY = "BUY", SELL = "SELL" }
export enum PositionScopeType { WALLET = "WALLET", STRATEGY = "STRATEGY" }
export enum PositionStatus { OPEN = "OPEN", CLOSED = "CLOSED" }
export enum RiskDecisionType { ALLOW = "ALLOW", BLOCK = "BLOCK" }
export enum RiskReasonCode {
  RISK_DISABLED = "RISK_DISABLED",
  MAX_NOTIONAL_EXCEEDED = "MAX_NOTIONAL_EXCEEDED",
  MAX_POSITION_QTY_EXCEEDED = "MAX_POSITION_QTY_EXCEEDED",
  MAX_LOSS_EXCEEDED = "MAX_LOSS_EXCEEDED",
  OVERSOLD = "OVERSOLD"
}

export interface PositionLedgerEntry {
  readonly id: string;
  readonly walletId: string;
  readonly strategyId?: string;
  readonly symbol: string;
  readonly side: LedgerSide;
  readonly baseQtyRaw: bigint;
  readonly quoteQtyRaw?: bigint;
  readonly ts: string;
  readonly createdAt: string;
  readonly sourceTradeId?: string;
}

export interface PositionSnapshot {
  readonly scopeType: PositionScopeType;
  readonly walletId: string;
  readonly strategyId?: string;
  readonly symbol: string;
  readonly baseQtyRaw: bigint;
  readonly quoteCostRaw: bigint;
  readonly avgEntryPriceRaw?: bigint;
  readonly realizedPnlRaw: bigint;
  readonly status: PositionStatus;
  readonly lastLedgerEntryId?: string;
  readonly lastLedgerOrderKey?: string;
  readonly version: number;
}

export type WalletPositionSnapshot = PositionSnapshot & { readonly scopeType: PositionScopeType.WALLET };
export type StrategyPositionSnapshot = PositionSnapshot & { readonly scopeType: PositionScopeType.STRATEGY; readonly strategyId: string };
export interface PositionLedgerEntryInput extends PositionLedgerEntry {}
export function assertNonEmpty(value: string, name: string): string { if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`); return value; }
export function assertBigInt(value: unknown, name: string): bigint { if (typeof value !== "bigint") throw new Error(`${name} must be bigint`); return value; }
export function compareLedgerOrder(a: PositionLedgerEntry, b: PositionLedgerEntry): number { if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1; if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1; return a.id.localeCompare(b.id); }
export function makePositionLedgerEntry(input: PositionLedgerEntryInput): PositionLedgerEntry {
  const baseQtyRaw = assertBigInt(input.baseQtyRaw, "baseQtyRaw");
  const quoteQtyRaw = input.quoteQtyRaw == null ? undefined : assertBigInt(input.quoteQtyRaw, "quoteQtyRaw");
  if (baseQtyRaw <= 0n) throw new Error("baseQtyRaw must be positive");
  if (quoteQtyRaw != null && quoteQtyRaw < 0n) throw new Error("quoteQtyRaw cannot be negative");
  return Object.freeze({ id: assertNonEmpty(input.id, "id"), walletId: assertNonEmpty(input.walletId, "walletId"), strategyId: input.strategyId == null ? undefined : assertNonEmpty(input.strategyId, "strategyId"), symbol: assertNonEmpty(input.symbol, "symbol"), side: input.side, baseQtyRaw, quoteQtyRaw, ts: assertNonEmpty(input.ts, "ts"), createdAt: assertNonEmpty(input.createdAt, "createdAt"), sourceTradeId: input.sourceTradeId });
}
export function emptyWalletPositionSnapshot(walletId: string, symbol: string): WalletPositionSnapshot { return Object.freeze({ scopeType: PositionScopeType.WALLET, walletId: assertNonEmpty(walletId, "walletId"), symbol: assertNonEmpty(symbol, "symbol"), baseQtyRaw: 0n, quoteCostRaw: 0n, avgEntryPriceRaw: undefined, realizedPnlRaw: 0n, status: PositionStatus.CLOSED, lastLedgerEntryId: undefined, lastLedgerOrderKey: undefined, version: 0 }); }
export function emptyStrategyPositionSnapshot(walletId: string, strategyId: string, symbol: string): StrategyPositionSnapshot { return Object.freeze({ scopeType: PositionScopeType.STRATEGY, walletId: assertNonEmpty(walletId, "walletId"), strategyId: assertNonEmpty(strategyId, "strategyId"), symbol: assertNonEmpty(symbol, "symbol"), baseQtyRaw: 0n, quoteCostRaw: 0n, avgEntryPriceRaw: undefined, realizedPnlRaw: 0n, status: PositionStatus.CLOSED, lastLedgerEntryId: undefined, lastLedgerOrderKey: undefined, version: 0 }); }
