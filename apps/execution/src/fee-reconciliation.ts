import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestrictionRepository
} from "./order-restriction";

export enum FeeLiquidityRole { MAKER = "MAKER", TAKER = "TAKER" }
export enum FeeReconciliationStatus {
  MATCHED = "MATCHED",
  MISSING_LOCAL = "MISSING_LOCAL",
  MISSING_PROVIDER = "MISSING_PROVIDER",
  AMOUNT_MISMATCH = "AMOUNT_MISMATCH",
  ASSET_MISMATCH = "ASSET_MISMATCH",
  LIQUIDITY_ROLE_MISMATCH = "LIQUIDITY_ROLE_MISMATCH",
  DUPLICATE_LOCAL = "DUPLICATE_LOCAL",
  DUPLICATE_PROVIDER = "DUPLICATE_PROVIDER",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export interface TradeFeeRecord {
  readonly tradeId: string;
  readonly orderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly asset: string;
  readonly amountRaw: bigint;
  readonly liquidityRole: FeeLiquidityRole;
  readonly tradeTimeMs: number;
}
export interface TradeFeeProvider { listTradeFees(accountId: string, fromMs: number, toMs: number): readonly TradeFeeRecord[] | undefined; }
export interface FeeReconciliationPolicy { readonly amountToleranceRaw: bigint; }
export interface FeeReconciliationResult {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly status: FeeReconciliationStatus;
  readonly localCount: number;
  readonly providerCount: number;
  readonly mismatchTradeIds: readonly string[];
  readonly observedAtMs: number;
  readonly restrictionId?: string;
  readonly reason?: string;
}
export interface FeeReconciliationEvidenceRepository {
  append(result: FeeReconciliationResult): void;
  getById(reconciliationId: string): FeeReconciliationResult | undefined;
  getLatest(accountId: string): FeeReconciliationResult | undefined;
}

const absolute = (value: bigint): bigint => value < 0n ? -value : value;
function duplicates(records: readonly TradeFeeRecord[]): readonly string[] {
  const seen = new Set<string>(); const duplicate = new Set<string>();
  for (const record of records) { if (seen.has(record.tradeId)) duplicate.add(record.tradeId); else seen.add(record.tradeId); }
  return Object.freeze([...duplicate].sort());
}

export function reconcileTradeFees(input: {
  readonly reconciliationId: string; readonly restrictionId: string; readonly accountId: string;
  readonly local: readonly TradeFeeRecord[]; readonly provider: TradeFeeProvider;
  readonly fromMs: number; readonly toMs: number; readonly nowMs: number;
  readonly policy: FeeReconciliationPolicy; readonly restrictions: OrderOperationalRestrictionRepository;
  readonly evidence: FeeReconciliationEvidenceRepository;
}): FeeReconciliationResult {
  if ([input.reconciliationId, input.restrictionId, input.accountId].some(value => value.trim() === "")) throw new Error("fee reconciliation identity is required");
  if (!Number.isSafeInteger(input.fromMs) || !Number.isSafeInteger(input.toMs) || input.fromMs < 0 || input.toMs < input.fromMs || !Number.isSafeInteger(input.nowMs) || input.nowMs < input.toMs) throw new Error("fee reconciliation time window is invalid");
  if (typeof input.policy.amountToleranceRaw !== "bigint" || input.policy.amountToleranceRaw < 0n) throw new Error("amountToleranceRaw must be a non-negative bigint");
  if (input.evidence.getById(input.reconciliationId) != null) throw new Error("fee reconciliation id already exists");
  if (input.local.some(record => record.accountId !== input.accountId || record.tradeTimeMs < input.fromMs || record.tradeTimeMs > input.toMs || record.amountRaw < 0n)) throw new Error("local fee record outside scope");

  const remote = input.provider.listTradeFees(input.accountId, input.fromMs, input.toMs);
  let status: FeeReconciliationStatus; let mismatches: readonly string[] = Object.freeze([]);
  if (remote == null) status = FeeReconciliationStatus.PROVIDER_UNAVAILABLE;
  else {
    if (remote.some(record => record.accountId !== input.accountId || record.tradeTimeMs < input.fromMs || record.tradeTimeMs > input.toMs || record.amountRaw < 0n)) throw new Error("provider fee record outside scope");
    const localDuplicates = duplicates(input.local); const providerDuplicates = duplicates(remote);
    if (localDuplicates.length > 0) { status = FeeReconciliationStatus.DUPLICATE_LOCAL; mismatches = localDuplicates; }
    else if (providerDuplicates.length > 0) { status = FeeReconciliationStatus.DUPLICATE_PROVIDER; mismatches = providerDuplicates; }
    else {
      const localById = new Map(input.local.map(record => [record.tradeId, record]));
      const remoteById = new Map(remote.map(record => [record.tradeId, record]));
      const missingLocal = [...remoteById.keys()].filter(id => !localById.has(id)).sort();
      const missingProvider = [...localById.keys()].filter(id => !remoteById.has(id)).sort();
      const assetMismatch = [...localById.entries()].filter(([id, local]) => remoteById.get(id)?.asset !== local.asset).map(([id]) => id).sort();
      const roleMismatch = [...localById.entries()].filter(([id, local]) => remoteById.get(id)?.liquidityRole !== local.liquidityRole).map(([id]) => id).sort();
      const amountMismatch = [...localById.entries()].filter(([id, local]) => { const providerRecord = remoteById.get(id); return providerRecord != null && (providerRecord.orderId !== local.orderId || providerRecord.symbol !== local.symbol || absolute(providerRecord.amountRaw - local.amountRaw) > input.policy.amountToleranceRaw); }).map(([id]) => id).sort();
      if (missingLocal.length) { status = FeeReconciliationStatus.MISSING_LOCAL; mismatches = Object.freeze(missingLocal); }
      else if (missingProvider.length) { status = FeeReconciliationStatus.MISSING_PROVIDER; mismatches = Object.freeze(missingProvider); }
      else if (assetMismatch.length) { status = FeeReconciliationStatus.ASSET_MISMATCH; mismatches = Object.freeze(assetMismatch); }
      else if (roleMismatch.length) { status = FeeReconciliationStatus.LIQUIDITY_ROLE_MISMATCH; mismatches = Object.freeze(roleMismatch); }
      else if (amountMismatch.length) { status = FeeReconciliationStatus.AMOUNT_MISMATCH; mismatches = Object.freeze(amountMismatch); }
      else status = FeeReconciliationStatus.MATCHED;
    }
  }

  let restrictionId: string | undefined;
  if (status !== FeeReconciliationStatus.MATCHED) {
    const restriction = input.restrictions.getActiveForAccount(input.accountId) ?? input.restrictions.save(Object.freeze({
      restrictionId: input.restrictionId, accountId: input.accountId,
      reason: status === FeeReconciliationStatus.PROVIDER_UNAVAILABLE ? OrderOperationalRestrictionReason.FEE_STATE_UNCERTAIN : OrderOperationalRestrictionReason.FEE_RECONCILIATION_MISMATCH,
      sourceRunId: input.reconciliationId, sourceIntentIds: Object.freeze([]), blockNewExposure: true,
      manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs
    }));
    restrictionId = restriction.restrictionId;
  }
  const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.accountId, status, localCount: input.local.length, providerCount: remote?.length ?? 0, mismatchTradeIds: Object.freeze([...mismatches]), observedAtMs: input.nowMs, ...(restrictionId == null ? {} : { restrictionId }), ...(status === FeeReconciliationStatus.MATCHED ? {} : { reason: "trade fee records are not fully reconciled" }) });
  input.evidence.append(result); return result;
}

export class ScriptedSyntheticTradeFeeProvider implements TradeFeeProvider {
  public constructor(private readonly records?: readonly TradeFeeRecord[]) {}
  public listTradeFees(accountId: string, fromMs: number, toMs: number): readonly TradeFeeRecord[] | undefined { return this.records?.filter(record => record.accountId === accountId && record.tradeTimeMs >= fromMs && record.tradeTimeMs <= toMs); }
}
