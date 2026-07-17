import { FeeReconciliationStatus, type FeeReconciliationEvidenceRepository } from "./fee-reconciliation";
import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestriction,
  type OrderOperationalRestrictionReleaseEvidenceRepository,
  type OrderOperationalRestrictionRepository,
  type OrderRestrictionReleaseTransaction
} from "./order-restriction";

export enum FeeReconciliationFreshnessStatus { FRESH = "FRESH", EXPIRING_SOON = "EXPIRING_SOON", STALE = "STALE", NOT_MATCHED = "NOT_MATCHED" }
export interface FeeFreshnessPolicy { readonly maxAgeMs: number; readonly expiringSoonAgeMs: number; }

export function evaluateFeeReconciliationFreshness(result: ReturnType<FeeReconciliationEvidenceRepository["getById"]>, nowMs: number, policy: FeeFreshnessPolicy): FeeReconciliationFreshnessStatus {
  if (!Number.isSafeInteger(policy.maxAgeMs) || !Number.isSafeInteger(policy.expiringSoonAgeMs) || policy.maxAgeMs <= 0 || policy.expiringSoonAgeMs < 0 || policy.expiringSoonAgeMs >= policy.maxAgeMs) throw new Error("fee freshness policy is invalid");
  if (result == null || result.status !== FeeReconciliationStatus.MATCHED) return FeeReconciliationFreshnessStatus.NOT_MATCHED;
  const age = nowMs - result.observedAtMs;
  if (!Number.isSafeInteger(nowMs) || age < 0) throw new Error("fee freshness time is invalid");
  if (age > policy.maxAgeMs) return FeeReconciliationFreshnessStatus.STALE;
  if (age >= policy.expiringSoonAgeMs) return FeeReconciliationFreshnessStatus.EXPIRING_SOON;
  return FeeReconciliationFreshnessStatus.FRESH;
}

export function enforceFeeReconciliationFreshness(input: { readonly accountId: string; readonly restrictionId: string; readonly nowMs: number; readonly policy: FeeFreshnessPolicy; readonly evidence: FeeReconciliationEvidenceRepository; readonly restrictions: OrderOperationalRestrictionRepository; }): OrderOperationalRestriction | undefined {
  const latest = input.evidence.getLatest(input.accountId);
  const freshness = evaluateFeeReconciliationFreshness(latest, input.nowMs, input.policy);
  if (freshness === FeeReconciliationFreshnessStatus.FRESH || freshness === FeeReconciliationFreshnessStatus.EXPIRING_SOON) return undefined;
  return input.restrictions.getActiveForAccount(input.accountId) ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.accountId, reason: OrderOperationalRestrictionReason.FEE_RECONCILIATION_STALE, sourceRunId: latest?.reconciliationId ?? "NO_FEE_RECONCILIATION", sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }));
}

export function releaseFeeRestriction(input: { readonly releaseId: string; readonly restrictionId: string; readonly matchedFeeReconciliationId: string; readonly requestedBy: string; readonly verifiedBy: string; readonly rationale: string; readonly nowMs: number; readonly restrictions: OrderOperationalRestrictionRepository; readonly feeEvidence: FeeReconciliationEvidenceRepository; readonly releaseEvidence: OrderOperationalRestrictionReleaseEvidenceRepository; readonly transaction?: OrderRestrictionReleaseTransaction; }): OrderOperationalRestriction {
  if ([input.releaseId, input.restrictionId, input.matchedFeeReconciliationId, input.requestedBy, input.verifiedBy, input.rationale].some(value => value.trim() === "")) throw new Error("complete fee release evidence is required");
  if (input.requestedBy === input.verifiedBy) throw new Error("requester and verifier must be different");
  const operation = () => {
    const restriction = input.restrictions.getById(input.restrictionId);
    if (restriction == null || restriction.status !== "ACTIVE") throw new Error("active fee restriction not found");
    if (![OrderOperationalRestrictionReason.FEE_RECONCILIATION_MISMATCH, OrderOperationalRestrictionReason.FEE_STATE_UNCERTAIN, OrderOperationalRestrictionReason.FEE_RECONCILIATION_STALE].includes(restriction.reason)) throw new Error("restriction is not a fee restriction");
    const matched = input.feeEvidence.getById(input.matchedFeeReconciliationId);
    if (matched == null || matched.status !== FeeReconciliationStatus.MATCHED || matched.accountId !== restriction.accountId || matched.observedAtMs <= restriction.createdAtMs || input.nowMs < matched.observedAtMs) throw new Error("later matched fee reconciliation is required");
    input.releaseEvidence.append(Object.freeze({ releaseId: input.releaseId, restrictionId: restriction.restrictionId, accountId: restriction.accountId, requestedBy: input.requestedBy, verifiedBy: input.verifiedBy, rationale: input.rationale.trim(), verifiedIntentIds: Object.freeze([]), matchedFeeReconciliationId: matched.reconciliationId, releasedAtMs: input.nowMs }));
    return input.restrictions.save(Object.freeze({ ...restriction, status: "RELEASED", releasedAtMs: input.nowMs }));
  };
  return input.transaction == null ? operation() : input.transaction.transaction(operation);
}
