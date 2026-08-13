/**
 * Governed, zero-authority independent-provider disagreement comparison for the
 * EVIDENCE_PRODUCER role -- the second role extended after RISK_VERIFIER (ADR-0015). See
 * ADR-0016 for the full rationale.
 *
 * Free-text claim content is deliberately NOT compared here: exact-string or fuzzy matching
 * across two independently-worded evidence assessments would manufacture false disagreement out
 * of paraphrasing, not real divergence -- exactly the kind of spurious signal this repo's
 * evaluation work (e.g. WO-AI-009's ablation fixtures) is designed to refuse. Only structured,
 * enumerable fields are compared.
 */

export interface EvidenceProducerProviderOutput {
  readonly groupId: string;
  readonly providerId: string;
  readonly modelVersionId: string;
  /** Both providers must have been shown the identical evidence bundle for a comparison to be
   * meaningful at all -- see compareEvidenceProducerOutputs's validation. */
  readonly evidenceBundleHash: string;
  readonly factClaimCount: number;
  readonly missingEvidence: readonly string[];
  /** Union of evidenceReferences cited across all of this provider's observations. */
  readonly citedEvidenceReferences: readonly string[];
}

export type EvidenceProducerComparisonState = "CONSENSUS" | "DISAGREEMENT" | "INCOMPLETE";
export type EvidenceProducerTrustDisposition = "NO_UPLIFT" | "REDUCE" | "ABSTAIN";

export type EvidenceProducerDisagreementCode =
  | "FACT_CLAIM_COUNT_MISMATCH"
  | "MISSING_EVIDENCE_MISMATCH"
  | "CITED_EVIDENCE_MISMATCH"
  | "INSUFFICIENT_INDEPENDENT_GROUPS";

export interface EvidenceProducerDisagreementMetrics {
  readonly factClaimCountAgreement: boolean;
  readonly missingEvidenceOverlapRatio: number | null;
  readonly citedEvidenceOverlapRatio: number | null;
  readonly disagreementCodes: readonly EvidenceProducerDisagreementCode[];
}

export interface EvidenceProducerComparisonResult {
  readonly schemaVersion: 1;
  readonly comparisonState: EvidenceProducerComparisonState;
  readonly trustDisposition: EvidenceProducerTrustDisposition;
  readonly independentGroupCount: number;
  readonly metrics: EvidenceProducerDisagreementMetrics;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
}
