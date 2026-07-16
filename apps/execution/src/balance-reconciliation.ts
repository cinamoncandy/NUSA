import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestrictionRepository
} from "./order-restriction";

export enum BalanceReconciliationStatus {
  MATCHED = "MATCHED",
  MISMATCH = "MISMATCH",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export interface LocalBalanceSnapshot {
  readonly accountId: string;
  readonly asset: string;
  readonly walletBalanceRaw: bigint;
  readonly availableBalanceRaw: bigint;
  readonly observedAtMs: number;
}

export interface ProviderBalanceSnapshot extends LocalBalanceSnapshot {}

export interface BalanceReconciliationPolicy {
  readonly walletBalanceToleranceRaw: bigint;
  readonly availableBalanceToleranceRaw: bigint;
}

export interface BalanceReconciliationResult {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly asset: string;
  readonly status: BalanceReconciliationStatus;
  readonly localWalletBalanceRaw: bigint;
  readonly providerWalletBalanceRaw?: bigint;
  readonly walletBalanceDifferenceRaw?: bigint;
  readonly localAvailableBalanceRaw: bigint;
  readonly providerAvailableBalanceRaw?: bigint;
  readonly availableBalanceDifferenceRaw?: bigint;
  readonly observedAtMs: number;
  readonly restrictionId?: string;
  readonly reason?: string;
}

export interface BalanceProvider {
  getBalance(accountId: string, asset: string): ProviderBalanceSnapshot | undefined;
}

export interface BalanceReconciliationEvidenceRepository {
  append(result: BalanceReconciliationResult): void;
  getById(reconciliationId: string): BalanceReconciliationResult | undefined;
  getLatest(accountId: string, asset: string): BalanceReconciliationResult | undefined;
}

function absolute(value: bigint): bigint { return value < 0n ? -value : value; }

function assertPolicy(policy: BalanceReconciliationPolicy): void {
  if (typeof policy.walletBalanceToleranceRaw !== "bigint" || policy.walletBalanceToleranceRaw < 0n) throw new Error("walletBalanceToleranceRaw must be a non-negative bigint");
  if (typeof policy.availableBalanceToleranceRaw !== "bigint" || policy.availableBalanceToleranceRaw < 0n) throw new Error("availableBalanceToleranceRaw must be a non-negative bigint");
}

export function reconcileBalance(input: {
  readonly reconciliationId: string;
  readonly restrictionId: string;
  readonly local: LocalBalanceSnapshot;
  readonly provider: BalanceProvider;
  readonly policy: BalanceReconciliationPolicy;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly evidence: BalanceReconciliationEvidenceRepository;
  readonly nowMs: number;
}): BalanceReconciliationResult {
  if (input.reconciliationId.trim() === "") throw new Error("reconciliationId is required");
  if (input.restrictionId.trim() === "") throw new Error("restrictionId is required");
  if (input.local.accountId.trim() === "" || input.local.asset.trim() === "") throw new Error("balance identity is required");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < input.local.observedAtMs) throw new Error("nowMs is invalid");
  if (input.local.availableBalanceRaw > input.local.walletBalanceRaw) throw new Error("local available balance cannot exceed wallet balance");
  assertPolicy(input.policy);
  if (input.evidence.getById(input.reconciliationId) != null) throw new Error("balance reconciliation id already exists");

  const remote = input.provider.getBalance(input.local.accountId, input.local.asset);
  if (remote == null) {
    const active = input.restrictions.getActiveForAccount(input.local.accountId);
    const restriction = active ?? input.restrictions.save(Object.freeze({
      restrictionId: input.restrictionId,
      accountId: input.local.accountId,
      reason: OrderOperationalRestrictionReason.BALANCE_STATE_UNCERTAIN,
      sourceRunId: input.reconciliationId,
      sourceIntentIds: Object.freeze([]),
      blockNewExposure: true,
      manualReleaseRequired: true,
      status: "ACTIVE",
      createdAtMs: input.nowMs
    }));
    const result = Object.freeze({
      reconciliationId: input.reconciliationId,
      accountId: input.local.accountId,
      asset: input.local.asset,
      status: BalanceReconciliationStatus.PROVIDER_UNAVAILABLE,
      localWalletBalanceRaw: input.local.walletBalanceRaw,
      localAvailableBalanceRaw: input.local.availableBalanceRaw,
      observedAtMs: input.nowMs,
      restrictionId: restriction.restrictionId,
      reason: "provider balance unavailable"
    });
    input.evidence.append(result);
    return result;
  }

  if (remote.accountId !== input.local.accountId || remote.asset !== input.local.asset) throw new Error("provider balance identity mismatch");
  if (remote.observedAtMs > input.nowMs) throw new Error("provider balance observation cannot be in the future");
  if (remote.availableBalanceRaw > remote.walletBalanceRaw) throw new Error("provider available balance cannot exceed wallet balance");

  const walletDifference = absolute(input.local.walletBalanceRaw - remote.walletBalanceRaw);
  const availableDifference = absolute(input.local.availableBalanceRaw - remote.availableBalanceRaw);
  const mismatch = walletDifference > input.policy.walletBalanceToleranceRaw || availableDifference > input.policy.availableBalanceToleranceRaw;
  const active = input.restrictions.getActiveForAccount(input.local.accountId);
  const restriction = mismatch ? (active ?? input.restrictions.save(Object.freeze({
    restrictionId: input.restrictionId,
    accountId: input.local.accountId,
    reason: OrderOperationalRestrictionReason.BALANCE_MISMATCH,
    sourceRunId: input.reconciliationId,
    sourceIntentIds: Object.freeze([]),
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "ACTIVE",
    createdAtMs: input.nowMs
  }))) : undefined;

  const result = Object.freeze({
    reconciliationId: input.reconciliationId,
    accountId: input.local.accountId,
    asset: input.local.asset,
    status: mismatch ? BalanceReconciliationStatus.MISMATCH : BalanceReconciliationStatus.MATCHED,
    localWalletBalanceRaw: input.local.walletBalanceRaw,
    providerWalletBalanceRaw: remote.walletBalanceRaw,
    walletBalanceDifferenceRaw: walletDifference,
    localAvailableBalanceRaw: input.local.availableBalanceRaw,
    providerAvailableBalanceRaw: remote.availableBalanceRaw,
    availableBalanceDifferenceRaw: availableDifference,
    observedAtMs: input.nowMs,
    ...(restriction == null ? {} : { restrictionId: restriction.restrictionId }),
    ...(mismatch ? { reason: "provider and local balance differ beyond tolerance" } : {})
  });
  input.evidence.append(result);
  return result;
}

export class ScriptedSyntheticBalanceProvider implements BalanceProvider {
  public constructor(private readonly snapshots: readonly ProviderBalanceSnapshot[]) {}
  public getBalance(accountId: string, asset: string): ProviderBalanceSnapshot | undefined {
    return this.snapshots.find(snapshot => snapshot.accountId === accountId && snapshot.asset === asset);
  }
}
