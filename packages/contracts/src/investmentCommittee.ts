export type CommitteeMember = "MACRO" | "NEWS" | "QUANT" | "TECHNICAL" | "ONCHAIN" | "DERIVATIVES" | "FLOW" | "EXECUTION" | "RISK" | "PORTFOLIO" | "CIO";
export type CommitteeSignal = "BUY" | "SELL" | "REDUCE" | "EXIT" | "HOLD" | "WAIT";
export type CommitteeDecision = "REJECT" | "WAIT" | "PAPER_ONLY" | "REDUCE" | "APPROVE" | "APPROVE_PARTIAL" | "EMERGENCY_EXIT";
export type ConflictLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CommitteeOpinion {
  readonly member: CommitteeMember;
  readonly signal: CommitteeSignal;
  readonly confidence: number;
  readonly edge: number;
  readonly expectedReturn: number;
  readonly expectedRisk: number;
  readonly timeHorizonMs: number;
  readonly reasons: readonly string[];
  readonly observedAt: number;
}

export interface CommitteeSafetyContext {
  readonly killSwitchActive: boolean;
  readonly unresolvedRecovery: boolean;
  readonly strategySuspended: boolean;
  readonly executionQualityScore: number;
  readonly minimumExecutionQualityScore: number;
  readonly netEdge: number;
  readonly portfolioHeat: number;
  readonly maximumPortfolioHeat: number;
  readonly drawdown: number;
  readonly maximumDrawdown: number;
  readonly marginBuffer: number;
  readonly minimumMarginBuffer: number;
  readonly fundingCarrySafe: boolean;
  readonly probabilityFresh: boolean;
  readonly featureFingerprintMatches: boolean;
}

export interface CommitteeConsensus {
  readonly weightedSignalScore: number;
  readonly weightedConfidence: number;
  readonly weightedEdge: number;
  readonly weightedRisk: number;
  readonly agreementScore: number;
  readonly disagreementScore: number;
  readonly entropy: number;
  readonly conflictLevel: ConflictLevel;
  readonly vetoReasons: readonly string[];
}

export interface InvestmentCommitteeResult {
  readonly decision: CommitteeDecision;
  readonly consensus: CommitteeConsensus;
  readonly reasons: readonly string[];
  readonly decidedAt: number;
}
