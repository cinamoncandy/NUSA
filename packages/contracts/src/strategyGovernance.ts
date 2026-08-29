export type StrategyLifecycle = "DRAFT" | "RESEARCHING" | "VALIDATED" | "PAPER_CANDIDATE" | "PAPER_ACTIVE" | "PROMOTION_PENDING" | "CHAMPION" | "CHALLENGER" | "SUSPENDED" | "ROLLED_BACK" | "RETIRED" | "REJECTED";
export type StrategyAuthorType = "HUMAN" | "AI" | "HYBRID";
export type CommitteeMember = "MACRO" | "NEWS" | "QUANT" | "ONCHAIN" | "DERIVATIVES" | "RISK" | "EXECUTION" | "CIO";
export type CommitteeDecision = "APPROVE" | "REJECT" | "NEED_MORE_PAPER";

export interface StrategyIdentity {
  readonly strategyId: string; readonly version: string; readonly name: string; readonly createdAt: number;
  readonly gitCommitSha: string; readonly featureFingerprint: string; readonly engineVersion: string; readonly authorType: StrategyAuthorType;
}
export interface StrategyValidationSummary {
  readonly deflatedSharpeRatio: number; readonly outOfSampleSharpe: number; readonly inSampleSharpe: number; readonly outOfSampleToInSampleRatio: number;
  readonly profitFactor: number; readonly maximumDrawdown: number; readonly walkForwardPositiveWindowRatio: number; readonly monteCarloRuinProbability: number;
  readonly worstCostStressReturn: number; readonly outOfSampleTradeCount: number; readonly dataFingerprint: string; readonly validatedAt: number;
}
export interface PaperPerformanceSummary {
  readonly startedAt: number; readonly endedAt?: number; readonly observationDays: number; readonly tradeCount: number; readonly netReturn: number;
  readonly sharpeRatio: number; readonly profitFactor: number; readonly maximumDrawdown: number; readonly availabilityRatio: number;
  readonly unresolvedFaultCount: number; readonly killSwitchActivationCount: number; readonly executionQualityScore: number;
}
export interface CommitteeVote {
  readonly member: CommitteeMember; readonly decision: CommitteeDecision; readonly score: number; readonly confidence: number;
  readonly reasons: readonly string[]; readonly decidedAt: number;
}
export interface StrategyGovernanceDecision {
  readonly action: "REJECT" | "NEED_MORE_PAPER" | "APPROVE_CHALLENGER" | "PROMOTE_CHAMPION" | "SUSPEND" | "ROLLBACK" | "RETIRE";
  readonly reasons: readonly string[]; readonly decidedAt: number; readonly strategyId: string; readonly version: string;
  readonly previousChampionVersion?: string; readonly targetLifecycle: StrategyLifecycle;
}
export interface RegisteredStrategy { readonly identity: StrategyIdentity; readonly lifecycle: StrategyLifecycle; }
export type StrategyGovernanceEventType = "STRATEGY_REGISTERED" | "VALIDATION_RECORDED" | "PAPER_STARTED" | "PAPER_COMPLETED" | "PROMOTION_REQUESTED" | "PROMOTION_REJECTED" | "CHALLENGER_APPROVED" | "CHAMPION_PROMOTED" | "STRATEGY_SUSPENDED" | "STRATEGY_ROLLED_BACK" | "STRATEGY_RETIRED";
export interface StrategyGovernanceApproval {
  readonly actorType: "HUMAN";
  readonly approvalReference: string;
  readonly decisionFingerprint: string;
  readonly approvedAt: number;
}
export interface StrategyGovernanceEvent {
  readonly type: StrategyGovernanceEventType; readonly strategyId: string; readonly version: string; readonly lifecycle: StrategyLifecycle;
  readonly family: string; readonly occurredAt: number; readonly reason: string; readonly approval?: StrategyGovernanceApproval;
}
