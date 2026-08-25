import { randomUUID } from "node:crypto";

export type RiskResult = "APPROVED" | "REJECTED" | "BLOCKED" | "UNKNOWN";
export type KillSwitchScope = "GLOBAL" | "EXCHANGE" | "STRATEGY" | "SYMBOL" | "SESSION";
export interface KillSwitch { readonly scope: KillSwitchScope; readonly key: string; readonly active: boolean; readonly reasonCode: string; readonly activatedAt: string | null; }
export interface RiskPolicy { readonly policyVersion: string; readonly maxGlobalExposure: string; readonly maxDailyLoss: string; readonly maxPositionSize: string; readonly maxPositionCount: number; readonly maxStrategyExposure: string; readonly maxSymbolExposure: string; readonly maxConsecutiveLosses: number; }
export interface RiskContext {
  readonly exchange: "UPBIT"; readonly strategyId: string; readonly symbol: string; readonly sessionId: string;
  readonly currentPosition: string; readonly openOrderExposure: string; readonly partialFillExposure: string; readonly expectedFillExposure: string;
  readonly realizedPnl: string; readonly unrealizedPnl: string; readonly positionCount: number; readonly strategyExposure: string; readonly symbolExposure: string; readonly consecutiveLosses: number;
  readonly unknownExecutionCount: number; readonly reconciliationStatus: "MATCH" | "UNKNOWN" | "DIFF"; readonly marketData: "HEALTHY" | "STALE" | "DISCONNECTED" | "WARMING_UP"; readonly credentialStatus: "READY" | "ERROR"; readonly recoveryStatus: "COMPLETE" | "PENDING";
  readonly manualApprovalToken: string | null; readonly productionMutationAllowed: false; readonly killSwitches: readonly KillSwitch[];
}
export interface RiskDecision { readonly decisionId: string; readonly result: RiskResult; readonly policyVersion: string; readonly reasonCodes: readonly string[]; readonly observedAt: string; readonly executionId: string; readonly ruleId: string; readonly inputParameters: Readonly<Record<string, string | number>>; readonly accountState: Readonly<Record<string, string | number>>; readonly marketState: Readonly<Record<string, string>>; readonly correlationId: string; }
export interface RiskEvidenceSink { append(record: RiskDecision): void; }
export interface RiskEvidenceRepository extends RiskEvidenceSink { getByDecisionId(decisionId: string): RiskDecision | undefined; list(filter?: Readonly<{ result?: RiskResult; executionId?: string }>): readonly RiskDecision[]; }
export class InMemoryRiskEvidenceSink implements RiskEvidenceRepository { public readonly records: RiskDecision[] = []; append(record: RiskDecision): void { if (this.getByDecisionId(record.decisionId)) throw new Error("duplicate risk decision evidence"); this.records.push(freezeDecision(record)); } getByDecisionId(decisionId: string): RiskDecision | undefined { return this.records.find(record => record.decisionId === decisionId); } list(filter: Readonly<{ result?: RiskResult; executionId?: string }> = {}): readonly RiskDecision[] { return Object.freeze(this.records.filter(record => (filter.result === undefined || record.result === filter.result) && (filter.executionId === undefined || record.executionId === filter.executionId))); } }
const freezeDecision = (record: RiskDecision): RiskDecision => Object.freeze({ ...record, reasonCodes: Object.freeze([...record.reasonCodes]), inputParameters: Object.freeze({ ...record.inputParameters }), accountState: Object.freeze({ ...record.accountState }), marketState: Object.freeze({ ...record.marketState }) });
export const RISK_CAPABILITY_DESCRIPTOR = Object.freeze({ riskGatewayPresent: true as const, killSwitchPresent: true as const, productionMutationAllowed: false as const });
const n = (value: string): number => { if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("INVALID_RISK_DECIMAL"); const result = Number(value); if (!Number.isFinite(result)) throw new Error("INVALID_RISK_DECIMAL"); return result; };
const pnl = (value: string): number => { if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error("INVALID_RISK_DECIMAL"); const result = Number(value); if (!Number.isFinite(result)) throw new Error("INVALID_RISK_DECIMAL"); return result; };
function activeSwitches(context: RiskContext): string[] { return context.killSwitches.filter(x => x.active && (x.scope === "GLOBAL" || (x.scope === "EXCHANGE" && x.key === context.exchange) || (x.scope === "STRATEGY" && x.key === context.strategyId) || (x.scope === "SYMBOL" && x.key === context.symbol) || (x.scope === "SESSION" && x.key === context.sessionId))).map(x => `KILL_SWITCH_${x.scope}`).sort(); }

export function evaluateGlobalRisk(executionId: string, policy: RiskPolicy, context: RiskContext, observedAt = new Date().toISOString()): RiskDecision {
  const evidence = (result: RiskResult, reasonCodes: readonly string[]): RiskDecision => Object.freeze({ decisionId: randomUUID(), result, policyVersion: policy.policyVersion, reasonCodes: Object.freeze([...reasonCodes]), observedAt, executionId, ruleId: policy.policyVersion, correlationId: `${executionId}:${observedAt}`, inputParameters: Object.freeze({ expectedFillExposure: context.expectedFillExposure, currentPosition: context.currentPosition, openOrderExposure: context.openOrderExposure, partialFillExposure: context.partialFillExposure }), accountState: Object.freeze({ positionCount: context.positionCount, realizedPnl: context.realizedPnl, unrealizedPnl: context.unrealizedPnl, strategyExposure: context.strategyExposure, symbolExposure: context.symbolExposure }), marketState: Object.freeze({ exchange: context.exchange, symbol: context.symbol, marketData: context.marketData, reconciliationStatus: context.reconciliationStatus, recoveryStatus: context.recoveryStatus }) });
  const blocked: string[] = []; const rejected: string[] = [];
  try {
    if (!policy.policyVersion || policy.maxPositionCount < 0 || policy.maxConsecutiveLosses < 0) return evidence("UNKNOWN", ["INVALID_RISK_POLICY"]);
    const globalExposure = n(context.currentPosition) + n(context.openOrderExposure) + n(context.partialFillExposure) + n(context.expectedFillExposure);
    const dailyLoss = pnl(context.realizedPnl) + pnl(context.unrealizedPnl);
    if (globalExposure > n(policy.maxGlobalExposure)) rejected.push("GLOBAL_EXPOSURE_LIMIT");
    if (dailyLoss < -n(policy.maxDailyLoss)) rejected.push("MAX_DAILY_LOSS");
    if (n(context.expectedFillExposure) > n(policy.maxPositionSize)) rejected.push("MAX_POSITION_SIZE");
    if (context.positionCount >= policy.maxPositionCount) rejected.push("MAX_POSITION_COUNT");
    if (n(context.strategyExposure) + n(context.expectedFillExposure) > n(policy.maxStrategyExposure)) rejected.push("STRATEGY_EXPOSURE_LIMIT");
    if (n(context.symbolExposure) + n(context.expectedFillExposure) > n(policy.maxSymbolExposure)) rejected.push("SYMBOL_EXPOSURE_LIMIT");
    if (context.consecutiveLosses >= policy.maxConsecutiveLosses) rejected.push("MAX_CONSECUTIVE_LOSS");
    if (context.unknownExecutionCount > 0) blocked.push("UNKNOWN_EXECUTION");
    if (context.reconciliationStatus !== "MATCH") blocked.push(`RECONCILIATION_${context.reconciliationStatus}`);
    if (context.marketData !== "HEALTHY") blocked.push(`MARKET_DATA_${context.marketData}`);
    if (context.credentialStatus !== "READY") blocked.push("CREDENTIAL_ERROR");
    if (context.recoveryStatus !== "COMPLETE") blocked.push("RECOVERY_PENDING");
    if (context.productionMutationAllowed !== false) blocked.push("PRODUCTION_MUTATION_NOT_DISABLED");
    if (!context.manualApprovalToken) blocked.push("MANUAL_APPROVAL_REQUIRED");
    blocked.push(...activeSwitches(context));
  } catch { return evidence("UNKNOWN", ["RISK_EVALUATION_UNKNOWN"]); }
  const reasonCodes = Object.freeze([...new Set([...blocked, ...rejected])].sort());
  const result: RiskResult = blocked.length ? "BLOCKED" : rejected.length ? "REJECTED" : "APPROVED";
  return evidence(result, reasonCodes);
}

export class GlobalRiskGateway {
  public readonly descriptor = RISK_CAPABILITY_DESCRIPTOR;
  public constructor(private readonly policy: RiskPolicy, private readonly evidence: RiskEvidenceSink = new InMemoryRiskEvidenceSink()) {}
  evaluate(executionId: string, context: RiskContext, observedAt?: string): RiskDecision { const decision = evaluateGlobalRisk(executionId, this.policy, context, observedAt); this.evidence.append(decision); return decision; }
  assertSubmitAllowed(decision: RiskDecision): void { if (decision.result !== "APPROVED") throw new Error(`RISK_GATE_${decision.result}:${decision.reasonCodes.join(",")}`); }
}
