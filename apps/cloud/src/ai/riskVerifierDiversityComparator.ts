import type {
  RiskVerifierComparisonResult,
  RiskVerifierDisagreementCode,
  RiskVerifierProviderOutput
} from "../../../../packages/contracts/src/aiRiskVerifierDiversity";

const requiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${field} is required`);
  return value.trim();
};

const requiredStringArray = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${field} must be a string array`);
  return value;
};

function assertValidOutput(output: RiskVerifierProviderOutput): void {
  requiredText(output.groupId, "groupId");
  requiredText(output.providerId, "providerId");
  requiredText(output.modelVersionId, "modelVersionId");
  if (!["verified", "denied", "incomplete"].includes(output.result)) throw new Error("result must be verified, denied, or incomplete");
  requiredStringArray(output.hardDenies, "hardDenies");
  requiredStringArray(output.requiredEscalations, "requiredEscalations");
}

/** Case/whitespace-normalized Jaccard overlap (|intersection| / |union|) across every set.
 * 1 when all sets are identical (including all-empty -- every provider independently agreeing
 * "nothing to flag" is itself a form of agreement); null when there's nothing to compare. */
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
 * Compares independent providers' RISK_VERIFIER outputs for the same decision. Pure and
 * deterministic: same outputs always produce the same comparison, no model call happens here.
 *
 * `groupId` must be unique per call -- the same provider/group reporting twice is not
 * independence, and this throws rather than silently double-counting it as two independent
 * opinions.
 */
export function compareRiskVerifierOutputs(outputs: readonly RiskVerifierProviderOutput[]): RiskVerifierComparisonResult {
  for (const output of outputs) assertValidOutput(output);
  const groupIds = new Set(outputs.map((output) => output.groupId));
  if (groupIds.size !== outputs.length) throw new Error("groupId must be unique across independent provider outputs");

  const independentGroupCount = outputs.length;
  if (independentGroupCount < 2) {
    return Object.freeze({
      schemaVersion: 1,
      comparisonState: "INCOMPLETE",
      trustDisposition: "ABSTAIN",
      independentGroupCount,
      metrics: Object.freeze({
        decisionAgreement: false,
        hardDenyOverlapRatio: null,
        requiredEscalationOverlapRatio: null,
        disagreementCodes: Object.freeze(["INSUFFICIENT_INDEPENDENT_GROUPS"] as const)
      }),
      liveAuthority: "NONE",
      productionMutationAllowed: false
    });
  }

  const distinctResults = new Set(outputs.map((output) => output.result));
  const decisionAgreement = distinctResults.size === 1;
  const hardDenyOverlapRatio = jaccardOverlap(outputs.map((output) => output.hardDenies));
  const requiredEscalationOverlapRatio = jaccardOverlap(outputs.map((output) => output.requiredEscalations));

  const disagreementCodes: RiskVerifierDisagreementCode[] = [];
  if (!decisionAgreement) disagreementCodes.push("RESULT_DISAGREEMENT");
  if (hardDenyOverlapRatio !== null && hardDenyOverlapRatio < 1) disagreementCodes.push("HARD_DENY_MISMATCH");
  if (requiredEscalationOverlapRatio !== null && requiredEscalationOverlapRatio < 1) disagreementCodes.push("ESCALATION_MISMATCH");

  const comparisonState = disagreementCodes.length === 0 ? "CONSENSUS" : "DISAGREEMENT";
  // A RESULT disagreement (one provider says "verified", another says "denied") means the
  // providers cannot even agree on the gate outcome itself -- that is not a case where a
  // reduced-trust reading is safe, so it abstains entirely rather than merely reducing. A
  // same-result disagreement over which specific hard denies/escalations apply is real but
  // less severe: the gate outcome itself is agreed, so REDUCE (not full abstention) applies.
  const trustDisposition = comparisonState === "CONSENSUS"
    ? "NO_UPLIFT"
    : disagreementCodes.includes("RESULT_DISAGREEMENT") ? "ABSTAIN" : "REDUCE";

  return Object.freeze({
    schemaVersion: 1,
    comparisonState,
    trustDisposition,
    independentGroupCount,
    metrics: Object.freeze({ decisionAgreement, hardDenyOverlapRatio, requiredEscalationOverlapRatio, disagreementCodes: Object.freeze(disagreementCodes) }),
    liveAuthority: "NONE",
    productionMutationAllowed: false
  });
}
