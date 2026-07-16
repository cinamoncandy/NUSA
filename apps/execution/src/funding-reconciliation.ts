import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestrictionRepository
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

export interface FundingReconciliationPolicy {
  readonly amountToleranceRaw: bigint;
}

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
}

const absolute = (value: bigint): bigint => value < 0n ? -value : value;

function duplicateIds(records: readonly FundingFeeRecord[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.fundingId)) duplicates.add(record.fundingId);
    else seen.add(record.fundingId);
  }
  return Object.freeze([...duplicates].sort());
}

export function reconcileFundingFees(input: {
  readonly reconciliationId: string;
  readonly restrictionId: string;
  readonly accountId: string;
  readonly local: readonly FundingFeeRecord[];
  readonly provider: FundingFeeProvider;
  readonly fromMs: number;
  readonly toMs: number;
  readonly policy: FundingReconciliationPolicy;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly evidence: FundingReconciliationEvidenceRepository;
  readonly nowMs: number;
}): FundingReconciliationResult {
  if (input.reconciliationId.trim() === "" || input.restrictionId.trim() === "" || input.accountId.trim() === "") throw new Error("funding reconciliation identity is required");
  if (!Number.isSafeInteger(input.fromMs) || !Number.isSafeInteger(input.toMs) || input.fromMs < 0 || input.toMs < input.fromMs) throw new Error("funding reconciliation window is invalid");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < input.toMs) throw new Error("nowMs is invalid");
  if (typeof input.policy.amountToleranceRaw !== "bigint" || input.policy.amountToleranceRaw < 0n) throw new Error("amountToleranceRaw must be a non-negative bigint");
  if (input.evidence.getById(input.reconciliationId) != null) throw new Error("funding reconciliation id already exists");
  if (input.local.some(record => record.accountId !== input.accountId || record.fundingTimeMs < input.fromMs || record.fundingTimeMs > input.toMs)) throw new Error("local funding record outside scope");

  const remote = input.provider.listFundingFees(input.accountId, input.fromMs, input.toMs);
  let status: FundingReconciliationStatus;
  let mismatches: readonly string[] = Object.freeze([]);

  if (remote == null) {
    status = FundingReconciliationStatus.PROVIDER_UNAVAILABLE;
  } else {
    if (remote.some(record => record.accountId !== input.accountId || record.fundingTimeMs < input.fromMs || record.fundingTimeMs > input.toMs)) throw new Error("provider funding record outside scope");
    const localDuplicates = duplicateIds(input.local);
    const remoteDuplicates = duplicateIds(remote);
    if (localDuplicates.length > 0) {
      status = FundingReconciliationStatus.DUPLICATE_LOCAL;
      mismatches = localDuplicates;
    } else if (remoteDuplicates.length > 0) {
      status = FundingReconciliationStatus.DUPLICATE_PROVIDER;
      mismatches = remoteDuplicates;
    } else {
      const localById = new Map(input.local.map(record => [record.fundingId, record]));
      const remoteById = new Map(remote.map(record => [record.fundingId, record]));
      const missingLocal = [...remoteById.keys()].filter(id => !localById.has(id)).sort();
      const missingProvider = [...localById.keys()].filter(id => !remoteById.has(id)).sort();
      const amountMismatch = [...localById.entries()].filter(([id, local]) => {
        const providerRecord = remoteById.get(id);
        return providerRecord != null && (providerRecord.symbol !== local.symbol || providerRecord.asset !== local.asset || absolute(providerRecord.amountRaw - local.amountRaw) > input.policy.amountToleranceRaw);
      }).map(([id]) => id).sort();
      if (missingLocal.length > 0) { status = FundingReconciliationStatus.MISSING_LOCAL; mismatches = Object.freeze(missingLocal); }
      else if (missingProvider.length > 0) { status = FundingReconciliationStatus.MISSING_PROVIDER; mismatches = Object.freeze(missingProvider); }
      else if (amountMismatch.length > 0) { status = FundingReconciliationStatus.AMOUNT_MISMATCH; mismatches = Object.freeze(amountMismatch); }
      else status = FundingReconciliationStatus.MATCHED;
    }
  }

  let restrictionId: string | undefined;
  if (status !== FundingReconciliationStatus.MATCHED) {
    const existing = input.restrictions.getActiveForAccount(input.accountId);
    const restriction = existing ?? input.restrictions.save(Object.freeze({
      restrictionId: input.restrictionId,
      accountId: input.accountId,
      reason: status === FundingReconciliationStatus.PROVIDER_UNAVAILABLE ? OrderOperationalRestrictionReason.FUNDING_STATE_UNCERTAIN : OrderOperationalRestrictionReason.FUNDING_RECONCILIATION_MISMATCH,
      sourceRunId: input.reconciliationId,
      sourceIntentIds: Object.freeze([]),
      blockNewExposure: true,
      manualReleaseRequired: true,
      status: "ACTIVE",
      createdAtMs: input.nowMs
    }));
    restrictionId = restriction.restrictionId;
  }

  const result = Object.freeze({
    reconciliationId: input.reconciliationId,
    accountId: input.accountId,
    status,
    localCount: input.local.length,
    providerCount: remote?.length ?? 0,
    mismatchFundingIds: Object.freeze([...mismatches]),
    observedAtMs: input.nowMs,
    ...(restrictionId == null ? {} : { restrictionId }),
    ...(status === FundingReconciliationStatus.MATCHED ? {} : { reason: "funding fee records are not fully reconciled" })
  });
  input.evidence.append(result);
  return result;
}

export class ScriptedSyntheticFundingFeeProvider implements FundingFeeProvider {
  public constructor(private readonly records?: readonly FundingFeeRecord[]) {}
  public listFundingFees(accountId: string, fromMs: number, toMs: number): readonly FundingFeeRecord[] | undefined {
    return this.records?.filter(record => record.accountId === accountId && record.fundingTimeMs >= fromMs && record.fundingTimeMs <= toMs);
  }
}
