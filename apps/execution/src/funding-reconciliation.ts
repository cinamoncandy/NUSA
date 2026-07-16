import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestrictionRepository,
  type OrderOperationalRestrictionReleaseEvidenceRepository,
  type OrderRestrictionReleaseTransaction
} from "./order-restriction";

export enum FundingReconciliationStatus {
  MATCHED = "MATCHED",
  MISSING_LOCAL = "MISSING_LOCAL",
  MISSING_PROVIDER = "MISSING_PROVIDER",
  AMOUNT_MISMATCH = "AMOUNT_MISMATCH",
  DUPLICATE_LOCAL = "DUPLICATE_LOCAL",
  DUPLICATE_PROVIDER = "DUPLICATE_PROVIDER",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export enum FundingReconciliationFreshnessStatus {
  FRESH = "FRESH",
  EXPIRING_SOON = "EXPIRING_SOON",
  STALE = "STALE",
  NOT_MATCHED = "NOT_MATCHED"
}

export interface FundingFeeRecord {
  readonly fundingId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly amountRaw: bigint;
  readonly fundingTimeMs: number;
}

export interface FundingFeeProvider {
  listFundingFees(accountId: string, fromMs: number, toMs: number): readonly FundingFeeRecord[] | undefined;
}

export interface FundingReconciliationPolicy { readonly amountToleranceRaw: bigint; }
export interface FundingFreshnessPolicy { readonly maximumAgeMs: number; readonly expiringSoonAgeMs: number; }

export interface FundingReconciliationResult {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly status: FundingReconciliationStatus;
  readonly localCount: number;
  readonly providerCount: number;
  readonly mismatchFundingIds: readonly string[];
  readonly observedAtMs: number;
  readonly restrictionId?: string;
  readonly reason?: string;
}

export interface FundingReconciliationEvidenceRepository {
  append(result: FundingReconciliationResult): void;
  getById(reconciliationId: string): FundingReconciliationResult | undefined;
  getLatest(accountId: string): FundingReconciliationResult | undefined;
}

const absolute = (value: bigint): bigint => value < 0n ? -value : value;

function duplicateIds(records: readonly FundingFeeRecord[]): readonly string[] {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const record of records) seen.has(record.fundingId) ? duplicates.add(record.fundingId) : seen.add(record.fundingId);
  return Object.freeze([...duplicates].sort());
}

export function evaluateFundingReconciliationFreshness(result: FundingReconciliationResult | undefined, nowMs: number, policy: FundingFreshnessPolicy): FundingReconciliationFreshnessStatus {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(policy.maximumAgeMs) || !Number.isSafeInteger(policy.expiringSoonAgeMs) || policy.maximumAgeMs <= 0 || policy.expiringSoonAgeMs < 0 || policy.expiringSoonAgeMs >= policy.maximumAgeMs) throw new Error("funding freshness policy is invalid");
  if (result == null || result.status !== FundingReconciliationStatus.MATCHED) return FundingReconciliationFreshnessStatus.NOT_MATCHED;
  const age = nowMs - result.observedAtMs;
  if (age < 0) throw new Error("funding evidence cannot be from the future");
  if (age >= policy.maximumAgeMs) return FundingReconciliationFreshnessStatus.STALE;
  if (age >= policy.expiringSoonAgeMs) return FundingReconciliationFreshnessStatus.EXPIRING_SOON;
  return FundingReconciliationFreshnessStatus.FRESH;
}

export function enforceFundingReconciliationFreshness(input: { readonly restrictionId: string; readonly accountId: string; readonly evidence: FundingReconciliationEvidenceRepository; readonly restrictions: OrderOperationalRestrictionRepository; readonly policy: FundingFreshnessPolicy; readonly nowMs: number; }) {
  const latest = input.evidence.getLatest(input.accountId);
  const freshness = evaluateFundingReconciliationFreshness(latest, input.nowMs, input.policy);
  if (freshness === FundingReconciliationFreshnessStatus.FRESH || freshness === FundingReconciliationFreshnessStatus.EXPIRING_SOON) return undefined;
  return input.restrictions.getActiveForAccount(input.accountId) ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.accountId, reason: OrderOperationalRestrictionReason.FUNDING_RECONCILIATION_STALE, sourceRunId: latest?.reconciliationId ?? "MISSING_FUNDING_RECONCILIATION", sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }));
}

export function releaseFundingRestriction(input: { readonly releaseId: string; readonly restrictionId: string; readonly matchedFundingReconciliationId: string; readonly requestedBy: string; readonly verifiedBy: string; readonly rationale: string; readonly nowMs: number; readonly restrictions: OrderOperationalRestrictionRepository; readonly reconciliations: FundingReconciliationEvidenceRepository; readonly evidence: OrderOperationalRestrictionReleaseEvidenceRepository; readonly transaction?: OrderRestrictionReleaseTransaction; }) {
  if (input.requestedBy.trim() === "" || input.verifiedBy.trim() === "" || input.requestedBy === input.verifiedBy) throw new Error("separated requester and verifier are required");
  if (input.rationale.trim() === "") throw new Error("release rationale is required");
  const operation = () => {
    const restriction = input.restrictions.getById(input.restrictionId);
    if (restriction == null || restriction.status !== "ACTIVE") throw new Error("active funding restriction not found");
    if (![OrderOperationalRestrictionReason.FUNDING_RECONCILIATION_MISMATCH, OrderOperationalRestrictionReason.FUNDING_STATE_UNCERTAIN, OrderOperationalRestrictionReason.FUNDING_RECONCILIATION_STALE].includes(restriction.reason)) throw new Error("restriction is not funding-related");
    const matched = input.reconciliations.getById(input.matchedFundingReconciliationId);
    if (matched == null || matched.status !== FundingReconciliationStatus.MATCHED || matched.accountId !== restriction.accountId || matched.observedAtMs <= restriction.createdAtMs) throw new Error("later matched funding reconciliation is required");
    input.evidence.append(Object.freeze({ releaseId: input.releaseId, restrictionId: restriction.restrictionId, accountId: restriction.accountId, requestedBy: input.requestedBy, verifiedBy: input.verifiedBy, rationale: input.rationale.trim(), verifiedIntentIds: Object.freeze([]), matchedFundingReconciliationId: matched.reconciliationId, releasedAtMs: input.nowMs }));
    return input.restrictions.save(Object.freeze({ ...restriction, status: "RELEASED", releasedAtMs: input.nowMs }));
  };
  return input.transaction == null ? operation() : input.transaction.transaction(operation);
}

export function reconcileFundingFees(input: { readonly reconciliationId: string; readonly restrictionId: string; readonly accountId: string; readonly local: readonly FundingFeeRecord[]; readonly provider: FundingFeeProvider; readonly fromMs: number; readonly toMs: number; readonly policy: FundingReconciliationPolicy; readonly restrictions: OrderOperationalRestrictionRepository; readonly evidence: FundingReconciliationEvidenceRepository; readonly nowMs: number; }): FundingReconciliationResult {
  if (input.reconciliationId.trim() === "" || input.restrictionId.trim() === "" || input.accountId.trim() === "") throw new Error("funding reconciliation identity is required");
  if (!Number.isSafeInteger(input.fromMs) || !Number.isSafeInteger(input.toMs) || input.fromMs < 0 || input.toMs < input.fromMs || !Number.isSafeInteger(input.nowMs) || input.nowMs < input.toMs) throw new Error("funding reconciliation window is invalid");
  if (typeof input.policy.amountToleranceRaw !== "bigint" || input.policy.amountToleranceRaw < 0n) throw new Error("amountToleranceRaw must be a non-negative bigint");
  if (input.evidence.getById(input.reconciliationId) != null) throw new Error("funding reconciliation id already exists");
  if (input.local.some(record => record.accountId !== input.accountId || record.fundingTimeMs < input.fromMs || record.fundingTimeMs > input.toMs)) throw new Error("local funding record outside scope");
  const remote = input.provider.listFundingFees(input.accountId, input.fromMs, input.toMs);
  let status: FundingReconciliationStatus; let mismatches: readonly string[] = Object.freeze([]);
  if (remote == null) status = FundingReconciliationStatus.PROVIDER_UNAVAILABLE;
  else {
    if (remote.some(record => record.accountId !== input.accountId || record.fundingTimeMs < input.fromMs || record.fundingTimeMs > input.toMs)) throw new Error("provider funding record outside scope");
    const localDuplicates = duplicateIds(input.local); const remoteDuplicates = duplicateIds(remote);
    if (localDuplicates.length > 0) { status = FundingReconciliationStatus.DUPLICATE_LOCAL; mismatches = localDuplicates; }
    else if (remoteDuplicates.length > 0) { status = FundingReconciliationStatus.DUPLICATE_PROVIDER; mismatches = remoteDuplicates; }
    else {
      const localById = new Map(input.local.map(record => [record.fundingId, record])); const remoteById = new Map(remote.map(record => [record.fundingId, record]));
      const missingLocal = [...remoteById.keys()].filter(id => !localById.has(id)).sort(); const missingProvider = [...localById.keys()].filter(id => !remoteById.has(id)).sort();
      const amountMismatch = [...localById.entries()].filter(([id, local]) => { const providerRecord = remoteById.get(id); return providerRecord != null && (providerRecord.symbol !== local.symbol || providerRecord.asset !== local.asset || absolute(providerRecord.amountRaw - local.amountRaw) > input.policy.amountToleranceRaw); }).map(([id]) => id).sort();
      if (missingLocal.length > 0) { status = FundingReconciliationStatus.MISSING_LOCAL; mismatches = Object.freeze(missingLocal); }
      else if (missingProvider.length > 0) { status = FundingReconciliationStatus.MISSING_PROVIDER; mismatches = Object.freeze(missingProvider); }
      else if (amountMismatch.length > 0) { status = FundingReconciliationStatus.AMOUNT_MISMATCH; mismatches = Object.freeze(amountMismatch); }
      else status = FundingReconciliationStatus.MATCHED;
    }
  }
  let restrictionId: string | undefined;
  if (status !== FundingReconciliationStatus.MATCHED) { const existing = input.restrictions.getActiveForAccount(input.accountId); const restriction = existing ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.accountId, reason: status === FundingReconciliationStatus.PROVIDER_UNAVAILABLE ? OrderOperationalRestrictionReason.FUNDING_STATE_UNCERTAIN : OrderOperationalRestrictionReason.FUNDING_RECONCILIATION_MISMATCH, sourceRunId: input.reconciliationId, sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs })); restrictionId = restriction.restrictionId; }
  const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.accountId, status, localCount: input.local.length, providerCount: remote?.length ?? 0, mismatchFundingIds: Object.freeze([...mismatches]), observedAtMs: input.nowMs, ...(restrictionId == null ? {} : { restrictionId }), ...(status === FundingReconciliationStatus.MATCHED ? {} : { reason: "funding fee records are not fully reconciled" }) });
  input.evidence.append(result); return result;
}

export class ScriptedSyntheticFundingFeeProvider implements FundingFeeProvider {
  public constructor(private readonly records?: readonly FundingFeeRecord[]) {}
  public listFundingFees(accountId: string, fromMs: number, toMs: number): readonly FundingFeeRecord[] | undefined { return this.records?.filter(record => record.accountId === accountId && record.fundingTimeMs >= fromMs && record.fundingTimeMs <= toMs); }
}
