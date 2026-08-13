/**
 * Governed, zero-authority independent-provider disagreement comparison for the
 * ADVERSARIAL_CRITIC role -- the third and final role extended after RISK_VERIFIER (ADR-0015)
 * and EVIDENCE_PRODUCER (ADR-0016), closing "not universal across all roles" for all four
 * multi-agent roles. See ADR-0017 for the full rationale.
 *
 * Same principle as the other two comparators: free-text content (counterClaims,
 * failedAssumptions, missingTests, alternativeExplanations are all free-text string arrays in
 * the underlying schema) is never compared directly -- only its structured shape (severity,
 * and each list's COUNT, not its content) drives the comparison, so independently-worded
 * critiques can never manufacture a false disagreement out of paraphrasing.
 */

export type AdversarialCriticSeverity = "none" | "low" | "medium" | "high" | "critical";

export interface AdversarialCriticProviderOutput {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  /** Both providers must have reviewed the identical proposal for a comparison to be
   * meaningful -- see compareAdversarialCriticOutputs's validation. */
  readonly reviewedProposalHash: string;
  readonly severity: AdversarialCriticSeverity;
  readonly counterClaimCount: number;
  readonly failedAssumptionCount: number;
  readonly missingTestCount: number;
  readonly alternativeExplanationCount: number;
}

export type AdversarialCriticComparisonState = "CONSENSUS" | "DISAGREEMENT" | "INCOMPLETE";
export type AdversarialCriticTrustDisposition = "NO_UPLIFT" | "REDUCE" | "ABSTAIN";

export type AdversarialCriticDisagreementCode =
  | "SEVERITY_DISAGREEMENT"
  | "COUNTER_CLAIM_COUNT_MISMATCH"
  | "FAILED_ASSUMPTION_COUNT_MISMATCH"
  | "MISSING_TEST_COUNT_MISMATCH"
  | "ALTERNATIVE_EXPLANATION_COUNT_MISMATCH"
  | "INSUFFICIENT_INDEPENDENT_GROUPS";

export interface AdversarialCriticDisagreementMetrics {
  readonly severityAgreement: boolean;
  readonly counterClaimCountAgreement: boolean;
  readonly failedAssumptionCountAgreement: boolean;
  readonly missingTestCountAgreement: boolean;
  readonly alternativeExplanationCountAgreement: boolean;
  readonly disagreementCodes: readonly AdversarialCriticDisagreementCode[];
}

export interface AdversarialCriticComparisonResult {
  readonly schemaVersion: 1;
  readonly comparisonState: AdversarialCriticComparisonState;
  readonly trustDisposition: AdversarialCriticTrustDisposition;
  readonly independentGroupCount: number;
  readonly metrics: AdversarialCriticDisagreementMetrics;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}
