import type {
  EvidenceProducerComparisonResult,
  EvidenceProducerDisagreementCode,
  EvidenceProducerProviderOutput
} from "../../../../packages/contracts/src/aiEvidenceProducerDiversity";

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

const requiredStringArray = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be a string array`);
  return value;
};

function assertValidOutput(output: EvidenceProducerProviderOutput): void {
  requiredText(output.groupId, "groupId");
  requiredText(output.providerId, "providerId");
  requiredText(output.modelVersionId, "modelVersionId");
  if (!/^[a-f0-9]{64}$/i.test(output.evidenceBundleHash)) throw new Error("evidenceBundleHash must be sha256");
  nonNegativeInteger(output.factClaimCount, "factClaimCount");
  requiredStringArray(output.missingEvidence, "missingEvidence");
  requiredStringArray(output.citedEvidenceReferences, "citedEvidenceReferences");
}

/** Same normalized Jaccard overlap as riskVerifierDiversityComparator.ts -- see its comment. */
function jaccardOverlap(sets: readonly (readonly string[])[]): number | null {
  if (sets.length < 2) return null;
  const normalized = sets.map((set) => new Set(set.map((item) => item.trim().toLowerCase())));
  const [first, ...rest] = normalized;
  const union = new Set(normalized.flatMap((set) => [...set]));
  if (union.size === 0) return 1;
  const intersection = new Set([...first!].filter((item) => rest.every((set) => set.has(item))));
  return intersection.size / union.size;
}

/**
 * Compares independent providers' EVIDENCE_PRODUCER outputs over the SAME evidence bundle.
 * Pure and deterministic. Throws if the outputs don't share one evidenceBundleHash -- that
 * means the providers weren't shown identical evidence, so any difference between them proves
 * nothing about provider disagreement (same rationale as the duplicate-groupId check: a
 * structural precondition failure, not a disagreement outcome to score).
 */
export function compareEvidenceProducerOutputs(outputs: readonly EvidenceProducerProviderOutput[]): EvidenceProducerComparisonResult {
  for (const output of outputs) assertValidOutput(output);
  const groupIds = new Set(outputs.map((output) => output.groupId));
  if (groupIds.size !== outputs.length) throw new Error("groupId must be unique across independent provider outputs");
  const bundleHashes = new Set(outputs.map((output) => output.evidenceBundleHash));
  if (bundleHashes.size > 1) throw new Error("all outputs must be evaluated against the same evidenceBundleHash to be comparable");

  const independentGroupCount = outputs.length;
  if (independentGroupCount < 2) {
    return Object.freeze({
      schemaVersion: 1,
      comparisonState: "INCOMPLETE",
      trustDisposition: "ABSTAIN",
      independentGroupCount,
      metrics: Object.freeze({
        factClaimCountAgreement: false,
        missingEvidenceOverlapRatio: null,
        citedEvidenceOverlapRatio: null,
        disagreementCodes: Object.freeze(["INSUFFICIENT_INDEPENDENT_GROUPS"] as const)
      }),
      liveAuthority: "NONE",
      productionMutationAllowed: false
    });
  }

  const distinctFactClaimCounts = new Set(outputs.map((output) => output.factClaimCount));
  const factClaimCountAgreement = distinctFactClaimCounts.size === 1;
  const missingEvidenceOverlapRatio = jaccardOverlap(outputs.map((output) => output.missingEvidence));
  const citedEvidenceOverlapRatio = jaccardOverlap(outputs.map((output) => output.citedEvidenceReferences));

  const disagreementCodes: EvidenceProducerDisagreementCode[] = [];
  if (!factClaimCountAgreement) disagreementCodes.push("FACT_CLAIM_COUNT_MISMATCH");
  if (missingEvidenceOverlapRatio !== null && missingEvidenceOverlapRatio < 1) disagreementCodes.push("MISSING_EVIDENCE_MISMATCH");
  if (citedEvidenceOverlapRatio !== null && citedEvidenceOverlapRatio < 1) disagreementCodes.push("CITED_EVIDENCE_MISMATCH");

  const comparisonState = disagreementCodes.length === 0 ? "CONSENSUS" : "DISAGREEMENT";
  // Unlike RISK_VERIFIER (where a result mismatch means the gate outcome itself is contested),
  // evidence-producer disagreement never blocks anything by itself -- downstream roles (the
  // proposer, the critic, the risk verifier) still apply their own gates to whatever evidence
  // was cited. Any disagreement here is real signal worth surfacing, but it only REDUCEs trust,
  // never ABSTAINs outright.
  const trustDisposition = comparisonState === "CONSENSUS" ? "NO_UPLIFT" : "REDUCE";

  return Object.freeze({
    schemaVersion: 1,
    comparisonState,
    trustDisposition,
    independentGroupCount,
    metrics: Object.freeze({ factClaimCountAgreement, missingEvidenceOverlapRatio, citedEvidenceOverlapRatio, disagreementCodes: Object.freeze(disagreementCodes) }),
    liveAuthority: "NONE",
    productionMutationAllowed: false
  });
}
