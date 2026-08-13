/**
 * Governed, zero-authority independent-provider disagreement comparison for the RISK_VERIFIER
 * role.
 *
 * NUSA_AI_CAPABILITY_AUDIT_2026-08-10.md scored "Independent provider/model diversity" at 3/4:
 * WO-AI-007's NVersionStrategyEvaluator compares independent providers for STRATEGY_PROPOSER
 * only -- "coverage is not universal across all roles." RISK_VERIFIER is the highest-value role
 * to extend next: it is the gate a candidate must pass before proceeding, so a single provider's
 * risk verification going uncontested is exactly the kind of "fake independence" gap N-version
 * comparison exists to catch.
 *
 * This is the comparator only -- a deterministic, pure function over already-produced
 * RISK_VERIFIER outputs from independent providers. It intentionally does NOT itself dispatch
 * model calls or manage a provider pool (that live-execution plumbing, budget policy, and
 * scheduling is NVersionStrategyEvaluator/runtime.ts's job for STRATEGY_PROPOSER and is a much
 * larger undertaking to replicate correctly for a second role); see the ADR for the explicit
 * scope boundary and what wiring this into a live comparison pathway still requires.
 */

export type RiskVerifierResult = "verified" | "denied" | "incomplete";

export interface RiskVerifierProviderOutput {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  readonly result: RiskVerifierResult;
  readonly hardDenies: readonly string[];
  readonly requiredEscalations: readonly string[];
}

export type RiskVerifierComparisonState = "CONSENSUS" | "DISAGREEMENT" | "INCOMPLETE";
export type RiskVerifierTrustDisposition = "NO_UPLIFT" | "REDUCE" | "ABSTAIN";

export type RiskVerifierDisagreementCode =
  | "RESULT_DISAGREEMENT"
  | "HARD_DENY_MISMATCH"
  | "ESCALATION_MISMATCH"
  | "INSUFFICIENT_INDEPENDENT_GROUPS";

export interface RiskVerifierDisagreementMetrics {
  readonly decisionAgreement: boolean;
  /** Jaccard overlap (|intersection| / |union|) of hardDenies across all groups. 1 when every
   * group's set is identical (including all-empty); null when there is nothing to compare. */
  readonly hardDenyOverlapRatio: number | null;
  readonly requiredEscalationOverlapRatio: number | null;
  readonly disagreementCodes: readonly RiskVerifierDisagreementCode[];
}

export interface RiskVerifierComparisonResult {
  readonly schemaVersion: 1;
  readonly comparisonState: RiskVerifierComparisonState;
  readonly trustDisposition: RiskVerifierTrustDisposition;
  readonly independentGroupCount: number;
  readonly metrics: RiskVerifierDisagreementMetrics;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}
