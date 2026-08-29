import { researchHardeningHash } from "../../../packages/contracts/src/researchHardening";

export interface ResearchCostEvidence {
  readonly schemaVersion: 1;
  readonly feeRate: number;
  readonly spreadRate: number;
  readonly slippageRate: number;
  readonly turnoverRate: number;
  readonly grossReturn: number;
  readonly netReturn: number;
  readonly costModelVersion: string;
  readonly observedAt: number;
}

export interface ResearchCostEvidenceDecision {
  readonly status: "VERIFIED" | "REJECTED";
  readonly reasons: readonly string[];
  readonly evidenceHash: string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonNegative = (value: unknown): value is number => finite(value) && value >= 0;
const validTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validVersion = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export function validateResearchCostEvidence(evidence: ResearchCostEvidence, evaluationTimestamp: number): ResearchCostEvidenceDecision {
  const reasons: string[] = [];
  if (evidence.schemaVersion !== 1) reasons.push("UNSUPPORTED_COST_EVIDENCE_SCHEMA");
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
    evidenceHash: researchHardeningHash(evidence),
  });
}
