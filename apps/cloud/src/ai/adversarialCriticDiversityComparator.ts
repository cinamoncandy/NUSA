import type {
  AdversarialCriticComparisonResult,
  AdversarialCriticDisagreementCode,
  AdversarialCriticProviderOutput,
  AdversarialCriticSeverity
} from "../../../../packages/contracts/src/aiAdversarialCriticDiversity";

const SEVERITIES: readonly AdversarialCriticSeverity[] = ["none", "low", "medium", "high", "critical"];

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`);
  return value;
};

function assertValidOutput(output: AdversarialCriticProviderOutput): void {
  requiredText(output.groupId, "groupId");
  requiredText(output.providerId, "providerId");
  requiredText(output.modelVersionId, "modelVersionId");
  if (!/^[a-f0-9]{64}$/i.test(output.reviewedProposalHash)) throw new Error("reviewedProposalHash must be sha256");
  if (!SEVERITIES.includes(output.severity)) throw new Error("severity must be one of " + SEVERITIES.join(","));
  nonNegativeInteger(output.counterClaimCount, "counterClaimCount");
  nonNegativeInteger(output.failedAssumptionCount, "failedAssumptionCount");
  nonNegativeInteger(output.missingTestCount, "missingTestCount");
  nonNegativeInteger(output.alternativeExplanationCount, "alternativeExplanationCount");
}

const allEqual = (values: readonly number[]): boolean => new Set(values).size === 1;

/**
 * Compares independent providers' ADVERSARIAL_CRITIC outputs over the SAME reviewed proposal.
 * Pure and deterministic. Throws if the outputs don't share one reviewedProposalHash -- the
 * providers weren't reviewing the same thing, so nothing about their difference is meaningful
 * (same structural-precondition rationale as the other two comparators).
 */
export function compareAdversarialCriticOutputs(outputs: readonly AdversarialCriticProviderOutput[]): AdversarialCriticComparisonResult {
  for (const output of outputs) assertValidOutput(output);
  const groupIds = new Set(outputs.map((output) => output.groupId));
  if (groupIds.size !== outputs.length) throw new Error("groupId must be unique across independent provider outputs");
  const reviewedHashes = new Set(outputs.map((output) => output.reviewedProposalHash));
  if (reviewedHashes.size > 1) throw new Error("all outputs must review the same reviewedProposalHash to be comparable");

  const independentGroupCount = outputs.length;
  if (independentGroupCount < 2) {
    return Object.freeze({
      schemaVersion: 1,
      comparisonState: "INCOMPLETE",
      trustDisposition: "ABSTAIN",
      independentGroupCount,
      metrics: Object.freeze({
        severityAgreement: false,
        counterClaimCountAgreement: false,
        failedAssumptionCountAgreement: false,
        missingTestCountAgreement: false,
        alternativeExplanationCountAgreement: false,
        disagreementCodes: Object.freeze(["INSUFFICIENT_INDEPENDENT_GROUPS"] as const)
      }),
      liveAuthority: "NONE",
      productionMutationAllowed: false
    });
  }

  const severityAgreement = new Set(outputs.map((output) => output.severity)).size === 1;
  const counterClaimCountAgreement = allEqual(outputs.map((output) => output.counterClaimCount));
  const failedAssumptionCountAgreement = allEqual(outputs.map((output) => output.failedAssumptionCount));
  const missingTestCountAgreement = allEqual(outputs.map((output) => output.missingTestCount));
  const alternativeExplanationCountAgreement = allEqual(outputs.map((output) => output.alternativeExplanationCount));

  const disagreementCodes: AdversarialCriticDisagreementCode[] = [];
  if (!severityAgreement) disagreementCodes.push("SEVERITY_DISAGREEMENT");
  if (!counterClaimCountAgreement) disagreementCodes.push("COUNTER_CLAIM_COUNT_MISMATCH");
  if (!failedAssumptionCountAgreement) disagreementCodes.push("FAILED_ASSUMPTION_COUNT_MISMATCH");
  if (!missingTestCountAgreement) disagreementCodes.push("MISSING_TEST_COUNT_MISMATCH");
  if (!alternativeExplanationCountAgreement) disagreementCodes.push("ALTERNATIVE_EXPLANATION_COUNT_MISMATCH");

  const comparisonState = disagreementCodes.length === 0 ? "CONSENSUS" : "DISAGREEMENT";
  // A severity disagreement means the providers can't agree on how dangerous the proposal even
  // is -- the same "can't agree on the gate-adjacent outcome itself" severity as RISK_VERIFIER's
  // result mismatch, so it ABSTAINs. A same-severity disagreement over exactly how many specific
  // issues were found is real but less severe, so it only REDUCEs trust.
  const trustDisposition = comparisonState === "CONSENSUS"
    ? "NO_UPLIFT"
    : disagreementCodes.includes("SEVERITY_DISAGREEMENT") ? "ABSTAIN" : "REDUCE";

  return Object.freeze({
    schemaVersion: 1,
    comparisonState,
    trustDisposition,
    independentGroupCount,
    metrics: Object.freeze({
      severityAgreement,
      counterClaimCountAgreement,
      failedAssumptionCountAgreement,
      missingTestCountAgreement,
      alternativeExplanationCountAgreement,
      disagreementCodes: Object.freeze(disagreementCodes)
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false
  });
}
