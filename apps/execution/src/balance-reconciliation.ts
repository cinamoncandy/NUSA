import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestriction,
  type OrderOperationalRestrictionRepository,
  type OrderOperationalRestrictionReleaseEvidenceRepository,
  type OrderRestrictionReleaseTransaction
} from "./order-restriction";

export enum BalanceReconciliationStatus {
  MATCHED = "MATCHED",
  MISMATCH = "MISMATCH",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export enum BalanceReconciliationFreshnessStatus {
  FRESH = "FRESH",
  EXPIRING_SOON = "EXPIRING_SOON",
  STALE = "STALE",
  NOT_MATCHED = "NOT_MATCHED"
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

export function evaluateBalanceReconciliationFreshness(input: {
  readonly result: BalanceReconciliationResult;
  readonly nowMs: number;
  readonly warningAgeMs: number;
  readonly maximumAgeMs: number;
}): BalanceReconciliationFreshnessStatus {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < input.result.observedAtMs) throw new Error("nowMs is invalid");
  if (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs <= 0) throw new Error("maximumAgeMs must be positive");
  if (!Number.isSafeInteger(input.warningAgeMs) || input.warningAgeMs < 0 || input.warningAgeMs >= input.maximumAgeMs) throw new Error("warningAgeMs must be non-negative and less than maximumAgeMs");
  if (input.result.status !== BalanceReconciliationStatus.MATCHED) return BalanceReconciliationFreshnessStatus.NOT_MATCHED;
  const ageMs = input.nowMs - input.result.observedAtMs;
  if (ageMs >= input.maximumAgeMs) return BalanceReconciliationFreshnessStatus.STALE;
  if (ageMs >= input.warningAgeMs) return BalanceReconciliationFreshnessStatus.EXPIRING_SOON;
  return BalanceReconciliationFreshnessStatus.FRESH;
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
    const restriction = active ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.local.accountId, reason: OrderOperationalRestrictionReason.BALANCE_STATE_UNCERTAIN, sourceRunId: input.reconciliationId, sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }));
    const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.local.accountId, asset: input.local.asset, status: BalanceReconciliationStatus.PROVIDER_UNAVAILABLE, localWalletBalanceRaw: input.local.walletBalanceRaw, localAvailableBalanceRaw: input.local.availableBalanceRaw, observedAtMs: input.nowMs, restrictionId: restriction.restrictionId, reason: "provider balance unavailable" });
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
  const restriction = mismatch ? (active ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.local.accountId, reason: OrderOperationalRestrictionReason.BALANCE_MISMATCH, sourceRunId: input.reconciliationId, sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }))) : undefined;
  const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.local.accountId, asset: input.local.asset, status: mismatch ? BalanceReconciliationStatus.MISMATCH : BalanceReconciliationStatus.MATCHED, localWalletBalanceRaw: input.local.walletBalanceRaw, providerWalletBalanceRaw: remote.walletBalanceRaw, walletBalanceDifferenceRaw: walletDifference, localAvailableBalanceRaw: input.local.availableBalanceRaw, providerAvailableBalanceRaw: remote.availableBalanceRaw, availableBalanceDifferenceRaw: availableDifference, observedAtMs: input.nowMs, ...(restriction == null ? {} : { restrictionId: restriction.restrictionId }), ...(mismatch ? { reason: "provider and local balance differ beyond tolerance" } : {}) });
  input.evidence.append(result);
  return result;
}

export function enforceBalanceReconciliationFreshness(input: {
  readonly restrictionId: string;
  readonly local: LocalBalanceSnapshot;
  readonly evidence: BalanceReconciliationEvidenceRepository;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly nowMs: number;
  readonly warningAgeMs: number;
  readonly maximumAgeMs: number;
}): OrderOperationalRestriction | undefined {
  const latest = input.evidence.getLatest(input.local.accountId, input.local.asset);
  const stale = latest == null || evaluateBalanceReconciliationFreshness({ result: latest, nowMs: input.nowMs, warningAgeMs: input.warningAgeMs, maximumAgeMs: input.maximumAgeMs }) === BalanceReconciliationFreshnessStatus.STALE || latest.status !== BalanceReconciliationStatus.MATCHED;
  if (!stale) return undefined;
  const active = input.restrictions.getActiveForAccount(input.local.accountId);
  if (active != null) return active;
  return input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.local.accountId, reason: OrderOperationalRestrictionReason.BALANCE_RECONCILIATION_STALE, sourceRunId: latest?.reconciliationId ?? `missing:${input.local.asset}`, sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }));
}

export function releaseBalanceRestriction(input: {
  readonly releaseId: string;
  readonly restrictionId: string;
  readonly matchedBalanceReconciliationId: string;
  readonly requestedBy: string;
  readonly verifiedBy: string;
  readonly rationale: string;
  readonly nowMs: number;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly reconciliations: BalanceReconciliationEvidenceRepository;
  readonly releaseEvidence: OrderOperationalRestrictionReleaseEvidenceRepository;
  readonly transaction?: OrderRestrictionReleaseTransaction;
}): OrderOperationalRestriction {
  if (input.releaseId.trim() === "" || input.matchedBalanceReconciliationId.trim() === "") throw new Error("release and reconciliation ids are required");
  if (input.requestedBy.trim() === "" || input.verifiedBy.trim() === "") throw new Error("requester and verifier are required");
  if (input.requestedBy === input.verifiedBy) throw new Error("requester and verifier must be different");
  if (input.rationale.trim() === "") throw new Error("release rationale is required");
  const operation = (): OrderOperationalRestriction => {
    const restriction = input.restrictions.getById(input.restrictionId);
    if (restriction == null || restriction.status !== "ACTIVE") throw new Error("active restriction not found");
    if (restriction.reason !== OrderOperationalRestrictionReason.BALANCE_MISMATCH && restriction.reason !== OrderOperationalRestrictionReason.BALANCE_STATE_UNCERTAIN && restriction.reason !== OrderOperationalRestrictionReason.BALANCE_RECONCILIATION_STALE) throw new Error("restriction is not balance-related");
    const matched = input.reconciliations.getById(input.matchedBalanceReconciliationId);
    if (matched == null || matched.status !== BalanceReconciliationStatus.MATCHED) throw new Error("matched balance reconciliation evidence is required");
    if (matched.accountId !== restriction.accountId) throw new Error("matched balance reconciliation account mismatch");
    if (matched.observedAtMs < restriction.createdAtMs || matched.reconciliationId === restriction.sourceRunId) throw new Error("matched balance reconciliation must postdate the restriction");
    input.releaseEvidence.append(Object.freeze({ releaseId: input.releaseId, restrictionId: restriction.restrictionId, accountId: restriction.accountId, requestedBy: input.requestedBy, verifiedBy: input.verifiedBy, rationale: input.rationale.trim(), verifiedIntentIds: Object.freeze([]), matchedBalanceReconciliationId: matched.reconciliationId, releasedAtMs: input.nowMs }));
    return input.restrictions.save(Object.freeze({ ...restriction, status: "RELEASED", releasedAtMs: input.nowMs }));
  };
  return input.transaction == null ? operation() : input.transaction.transaction(operation);
}

export class ScriptedSyntheticBalanceProvider implements BalanceProvider {
  public constructor(private readonly snapshots: readonly ProviderBalanceSnapshot[]) {}
  public getBalance(accountId: string, asset: string): ProviderBalanceSnapshot | undefined { return this.snapshots.find(snapshot => snapshot.accountId === accountId && snapshot.asset === asset); }
}
