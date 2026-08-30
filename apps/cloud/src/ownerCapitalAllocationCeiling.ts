import type { CapitalAllocationResult } from "./capitalAllocationEngine";

export interface OwnerCapitalAllocationPolicy {
  readonly ownerPrincipalId: string;
  readonly investmentCapitalWeight: number;
  readonly configuredAt: string;
}

export interface OwnerBoundCapitalAllocationResult extends CapitalAllocationResult {
  readonly ownerPrincipalId: string;
  readonly ownerInvestmentCapitalWeight: number;
  readonly ownerCapitalCeilingUsd: number;
}

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

/**
 * Applies the owner's portfolio-level investment-capital setting to an already risk-gated
 * allocation decision. This function can only reduce or reject capital. It cannot turn a
 * rejected allocation into an allocation, grant LIVE authority, or bypass risk controls.
 */
export function applyOwnerCapitalAllocationCeiling(
  allocation: CapitalAllocationResult,
  totalEquityUsd: number,
  policy: OwnerCapitalAllocationPolicy,
): OwnerBoundCapitalAllocationResult {
  if (!policy.ownerPrincipalId.trim()) throw new Error("ownerPrincipalId is required");
  if (!Number.isFinite(Date.parse(policy.configuredAt))) throw new Error("configuredAt must be a valid ISO timestamp");
  if (!Number.isFinite(totalEquityUsd) || totalEquityUsd <= 0) throw new Error("totalEquityUsd must be positive");
  if (!Number.isFinite(policy.investmentCapitalWeight) || policy.investmentCapitalWeight < 0 || policy.investmentCapitalWeight > 1) {
    throw new Error("investmentCapitalWeight must be between 0 and 1");
  }

  const ownerCapitalCeilingUsd = round(totalEquityUsd * policy.investmentCapitalWeight);
  const targetCapitalUsd = Math.min(allocation.targetCapitalUsd, ownerCapitalCeilingUsd);
  const targetWeight = Math.min(allocation.targetWeight, policy.investmentCapitalWeight);
  const maximumWeight = Math.min(allocation.maximumWeight, policy.investmentCapitalWeight);
  const reasons = [...allocation.reasons];

  let decision = allocation.decision;
  if (allocation.decision !== "REJECT" && targetCapitalUsd < allocation.targetCapitalUsd) {
    decision = "REDUCE";
    reasons.push("OWNER_CAPITAL_CEILING_APPLIED");
  }
  if (allocation.decision !== "REJECT" && ownerCapitalCeilingUsd === 0) {
    decision = "REJECT";
    if (!reasons.includes("OWNER_CAPITAL_CEILING_APPLIED")) reasons.push("OWNER_CAPITAL_CEILING_APPLIED");
  }

  return Object.freeze({
    ...allocation,
    decision,
    targetWeight: round(targetWeight),
    maximumWeight: round(maximumWeight),
    targetCapitalUsd: round(targetCapitalUsd),
    reasons: Object.freeze(reasons),
    ownerPrincipalId: policy.ownerPrincipalId,
    ownerInvestmentCapitalWeight: policy.investmentCapitalWeight,
    ownerCapitalCeilingUsd,
  });
}
