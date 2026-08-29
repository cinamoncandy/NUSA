import { researchHardeningHash, type ResearchCostEvidence } from "../../../packages/contracts/src/researchHardening";

export type { ResearchCostEvidence } from "../../../packages/contracts/src/researchHardening";

export interface ResearchCostEvidenceDecision {
  readonly status: "VERIFIED" | "REJECTED";
  readonly reasons: readonly string[];
  readonly evidenceHash: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;
const validTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validVersion = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

function canonicalHashNumber(value: unknown): number | string | null {
  if (typeof value !== "number") return null;
  if (Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return "NaN";
  return value === Number.POSITIVE_INFINITY ? "Infinity" : "-Infinity";
}

function costEvidenceHash(evidence: ResearchCostEvidence): string {
  return researchHardeningHash({
    schemaVersion: canonicalHashNumber(evidence.schemaVersion),
    evaluationId: typeof evidence.evaluationId === "string" ? evidence.evaluationId : null,
    datasetId: typeof evidence.datasetId === "string" ? evidence.datasetId : null,
    datasetContentSha256: typeof evidence.datasetContentSha256 === "string" ? evidence.datasetContentSha256 : null,
    feeRate: canonicalHashNumber(evidence.feeRate),
    spreadRate: canonicalHashNumber(evidence.spreadRate),
    slippageRate: canonicalHashNumber(evidence.slippageRate),
    turnoverRate: canonicalHashNumber(evidence.turnoverRate),
    grossReturn: canonicalHashNumber(evidence.grossReturn),
    netReturn: canonicalHashNumber(evidence.netReturn),
    costModelVersion: typeof evidence.costModelVersion === "string" ? evidence.costModelVersion : null,
    observedAt: canonicalHashNumber(evidence.observedAt),
  });
}

export function validateResearchCostEvidence(evidence: ResearchCostEvidence, evaluationTimestamp: number): ResearchCostEvidenceDecision {
  const reasons: string[] = [];
  if (evidence.schemaVersion !== 1) reasons.push("UNSUPPORTED_COST_EVIDENCE_SCHEMA");
  if (!validVersion(evidence.evaluationId)) reasons.push("MISSING_COST_EVALUATION_ID");
  if (!validVersion(evidence.datasetId)) reasons.push("MISSING_COST_DATASET_ID");
  if (!validDigest(evidence.datasetContentSha256)) reasons.push("INVALID_COST_DATASET_HASH");
  if (!nonNegative(evidence.feeRate)) reasons.push("INVALID_FEE_EVIDENCE");
  if (!nonNegative(evidence.spreadRate)) reasons.push("INVALID_SPREAD_EVIDENCE");
  if (!nonNegative(evidence.slippageRate)) reasons.push("INVALID_SLIPPAGE_EVIDENCE");
  if (!nonNegative(evidence.turnoverRate)) reasons.push("INVALID_TURNOVER_EVIDENCE");
  if (!finite(evidence.grossReturn)) reasons.push("INVALID_GROSS_RETURN_EVIDENCE");
  if (!finite(evidence.netReturn)) reasons.push("INVALID_NET_RETURN_EVIDENCE");
  if (!validVersion(evidence.costModelVersion)) reasons.push("MISSING_COST_MODEL_VERSION");
  if (!validTimestamp(evidence.observedAt)) reasons.push("INVALID_COST_EVIDENCE_TIMESTAMP");
  if (!validTimestamp(evaluationTimestamp)) reasons.push("INVALID_EVALUATION_TIMESTAMP");
  else if (validTimestamp(evidence.observedAt) && evidence.observedAt > evaluationTimestamp) reasons.push("FUTURE_COST_EVIDENCE");

  if (finite(evidence.grossReturn) && finite(evidence.netReturn)
    && nonNegative(evidence.feeRate) && nonNegative(evidence.spreadRate)
    && nonNegative(evidence.slippageRate) && nonNegative(evidence.turnoverRate)) {
    const expectedCost = evidence.turnoverRate * (evidence.feeRate + evidence.spreadRate + evidence.slippageRate);
    const expectedNet = evidence.grossReturn - expectedCost;
    if (Math.abs(expectedNet - evidence.netReturn) > 1e-12) reasons.push("COST_RECONCILIATION_MISMATCH");
  }

  const normalizedReasons = Object.freeze([...new Set(reasons)].sort());
  return Object.freeze({
    status: normalizedReasons.length === 0 ? "VERIFIED" : "REJECTED",
    reasons: normalizedReasons,
    evidenceHash: costEvidenceHash(evidence),
  });
}
