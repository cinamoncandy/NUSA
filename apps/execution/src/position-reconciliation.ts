import type { WalletPositionSnapshot } from "../../../packages/contracts/src/index";
import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestriction,
  type OrderOperationalRestrictionRepository,
  type OrderOperationalRestrictionReleaseEvidenceRepository,
  type OrderRestrictionReleaseTransaction
} from "./order-restriction";

export enum PositionReconciliationStatus {
  MATCHED = "MATCHED",
  MISMATCH = "MISMATCH",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export interface ProviderPositionSnapshot {
  readonly accountId: string;
  readonly symbol: string;
  readonly baseQtyRaw: bigint;
  readonly avgEntryPriceRaw?: bigint;
  readonly observedAtMs: number;
}

export interface PositionReconciliationPolicy {
  readonly baseQtyToleranceRaw: bigint;
  readonly avgEntryPriceToleranceRaw: bigint;
}

export interface PositionReconciliationResult {
  readonly reconciliationId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly status: PositionReconciliationStatus;
  readonly localBaseQtyRaw: bigint;
  readonly providerBaseQtyRaw?: bigint;
  readonly baseQtyDifferenceRaw?: bigint;
  readonly localAvgEntryPriceRaw?: bigint;
  readonly providerAvgEntryPriceRaw?: bigint;
  readonly avgEntryPriceDifferenceRaw?: bigint;
  readonly observedAtMs: number;
  readonly restrictionId?: string;
  readonly reason?: string;
}

export interface PositionProvider { getPosition(accountId: string, symbol: string): ProviderPositionSnapshot | undefined; }
export interface PositionReconciliationEvidenceRepository {
  append(result: PositionReconciliationResult): void;
  getById(reconciliationId: string): PositionReconciliationResult | undefined;
  getLatestForScope(accountId: string, symbol: string): PositionReconciliationResult | undefined;
}

function absolute(value: bigint): bigint { return value < 0n ? -value : value; }
function assertPolicy(policy: PositionReconciliationPolicy): void {
  if (typeof policy.baseQtyToleranceRaw !== "bigint" || policy.baseQtyToleranceRaw < 0n) throw new Error("baseQtyToleranceRaw must be a non-negative bigint");
  if (typeof policy.avgEntryPriceToleranceRaw !== "bigint" || policy.avgEntryPriceToleranceRaw < 0n) throw new Error("avgEntryPriceToleranceRaw must be a non-negative bigint");
}

export function reconcilePosition(input: {
  readonly reconciliationId: string;
  readonly restrictionId: string;
  readonly accountId: string;
  readonly local: WalletPositionSnapshot;
  readonly provider: PositionProvider;
  readonly policy: PositionReconciliationPolicy;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly evidence: PositionReconciliationEvidenceRepository;
  readonly nowMs: number;
}): PositionReconciliationResult {
  if (input.reconciliationId.trim() === "") throw new Error("reconciliationId is required");
  if (input.restrictionId.trim() === "") throw new Error("restrictionId is required");
  if (input.accountId.trim() === "") throw new Error("accountId is required");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error("nowMs must be a non-negative safe integer");
  if (input.local.walletId !== input.accountId) throw new Error("local position account mismatch");
  assertPolicy(input.policy);
  if (input.evidence.getById(input.reconciliationId) != null) throw new Error("position reconciliation id already exists");

  const remote = input.provider.getPosition(input.accountId, input.local.symbol);
  if (remote == null) {
    const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.accountId, symbol: input.local.symbol, status: PositionReconciliationStatus.PROVIDER_UNAVAILABLE, localBaseQtyRaw: input.local.baseQtyRaw, localAvgEntryPriceRaw: input.local.avgEntryPriceRaw, observedAtMs: input.nowMs, reason: "provider position unavailable" });
    input.evidence.append(result);
    return result;
  }
  if (remote.accountId !== input.accountId || remote.symbol !== input.local.symbol) throw new Error("provider position identity mismatch");
  if (remote.observedAtMs > input.nowMs) throw new Error("provider observation cannot be in the future");

  const baseDifference = absolute(input.local.baseQtyRaw - remote.baseQtyRaw);
  const localAverage = input.local.avgEntryPriceRaw;
  const remoteAverage = remote.avgEntryPriceRaw;
  const averageDifference = localAverage == null && remoteAverage == null ? 0n : localAverage == null || remoteAverage == null ? input.policy.avgEntryPriceToleranceRaw + 1n : absolute(localAverage - remoteAverage);
  const mismatch = baseDifference > input.policy.baseQtyToleranceRaw || averageDifference > input.policy.avgEntryPriceToleranceRaw;

  let restriction: OrderOperationalRestriction | undefined;
  if (mismatch) {
    const active = input.restrictions.getActiveForAccount(input.accountId);
    restriction = active ?? input.restrictions.save(Object.freeze({ restrictionId: input.restrictionId, accountId: input.accountId, reason: OrderOperationalRestrictionReason.POSITION_MISMATCH, sourceRunId: input.reconciliationId, sourceIntentIds: Object.freeze([]), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs }));
  }

  const result = Object.freeze({ reconciliationId: input.reconciliationId, accountId: input.accountId, symbol: input.local.symbol, status: mismatch ? PositionReconciliationStatus.MISMATCH : PositionReconciliationStatus.MATCHED, localBaseQtyRaw: input.local.baseQtyRaw, providerBaseQtyRaw: remote.baseQtyRaw, baseQtyDifferenceRaw: baseDifference, localAvgEntryPriceRaw: localAverage, providerAvgEntryPriceRaw: remoteAverage, avgEntryPriceDifferenceRaw: averageDifference, observedAtMs: input.nowMs, ...(restriction == null ? {} : { restrictionId: restriction.restrictionId }), ...(mismatch ? { reason: "provider and local position differ beyond tolerance" } : {}) });
  input.evidence.append(result);
  return result;
}

export function releasePositionMismatchRestriction(input: {
  readonly releaseId: string;
  readonly restrictionId: string;
  readonly matchedReconciliationId: string;
  readonly requestedBy: string;
  readonly verifiedBy: string;
  readonly rationale: string;
  readonly nowMs: number;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly reconciliations: PositionReconciliationEvidenceRepository;
  readonly releaseEvidence: OrderOperationalRestrictionReleaseEvidenceRepository;
  readonly transaction?: OrderRestrictionReleaseTransaction;
}): OrderOperationalRestriction {
  if (input.releaseId.trim() === "") throw new Error("releaseId is required");
  if (input.matchedReconciliationId.trim() === "") throw new Error("matchedReconciliationId is required");
  if (input.requestedBy.trim() === "" || input.verifiedBy.trim() === "") throw new Error("requester and verifier are required");
  if (input.requestedBy === input.verifiedBy) throw new Error("requester and verifier must be different");
  if (input.rationale.trim() === "") throw new Error("release rationale is required");

  const operation = (): OrderOperationalRestriction => {
    const restriction = input.restrictions.getById(input.restrictionId);
    if (restriction == null) throw new Error("restriction not found");
    if (restriction.status !== "ACTIVE") throw new Error("only active restrictions can be released");
    if (restriction.reason !== OrderOperationalRestrictionReason.POSITION_MISMATCH && restriction.reason !== OrderOperationalRestrictionReason.POSITION_STATE_UNCERTAIN && restriction.reason !== OrderOperationalRestrictionReason.POSITION_RECONCILIATION_STALE) throw new Error("restriction is not position-related");
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < restriction.createdAtMs) throw new Error("release time is invalid");
    const matched = input.reconciliations.getById(input.matchedReconciliationId);
    if (matched == null) throw new Error("matched reconciliation evidence not found");
    if (matched.status !== PositionReconciliationStatus.MATCHED) throw new Error("position reconciliation is not matched");
    if (matched.accountId !== restriction.accountId) throw new Error("matched reconciliation account mismatch");
    if (matched.observedAtMs < restriction.createdAtMs) throw new Error("matched reconciliation predates restriction");
    if (matched.reconciliationId === restriction.sourceRunId) throw new Error("source reconciliation cannot release restriction");

    input.releaseEvidence.append(Object.freeze({ releaseId: input.releaseId, restrictionId: restriction.restrictionId, accountId: restriction.accountId, requestedBy: input.requestedBy, verifiedBy: input.verifiedBy, rationale: input.rationale.trim(), verifiedIntentIds: Object.freeze([]), matchedReconciliationId: matched.reconciliationId, releasedAtMs: input.nowMs }));
    return input.restrictions.save(Object.freeze({ ...restriction, status: "RELEASED", releasedAtMs: input.nowMs }));
  };
  return input.transaction == null ? operation() : input.transaction.transaction(operation);
}

export class ScriptedSyntheticPositionProvider implements PositionProvider {
  public constructor(private readonly snapshots: readonly ProviderPositionSnapshot[]) {}
  public getPosition(accountId: string, symbol: string): ProviderPositionSnapshot | undefined { return this.snapshots.find(snapshot => snapshot.accountId === accountId && snapshot.symbol === symbol); }
}
