import type { WalletPositionSnapshot } from "../../../packages/contracts/src/index";
import {
  OrderOperationalRestrictionReason,
  type OrderOperationalRestrictionRepository
} from "./order-restriction";
import {
  PositionReconciliationStatus,
  reconcilePosition,
  type PositionProvider,
  type PositionReconciliationEvidenceRepository,
  type PositionReconciliationPolicy,
  type PositionReconciliationResult
} from "./position-reconciliation";

export interface WalletPositionSource {
  list(): readonly WalletPositionSnapshot[];
}

export interface PositionReconciliationWorkerPolicy extends PositionReconciliationPolicy {
  readonly maxPositionsPerRun: number;
}

export interface PositionReconciliationWorkerResult {
  readonly runId: string;
  readonly scannedCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly unavailableCount: number;
  readonly restrictionCount: number;
  readonly truncated: boolean;
  readonly results: readonly PositionReconciliationResult[];
}

export interface PositionReconciliationRunEvidence {
  readonly runId: string;
  readonly startedAtMs: number;
  readonly scannedCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly unavailableCount: number;
  readonly restrictionCount: number;
  readonly truncated: boolean;
  readonly reconciliationIds: readonly string[];
}

export interface PositionReconciliationRunEvidenceRepository {
  append(run: PositionReconciliationRunEvidence): PositionReconciliationRunEvidence;
  getById(runId: string): PositionReconciliationRunEvidence | undefined;
}

export class InMemoryPositionReconciliationRunEvidenceRepository implements PositionReconciliationRunEvidenceRepository {
  private readonly records = new Map<string, PositionReconciliationRunEvidence>();
  append(run: PositionReconciliationRunEvidence): PositionReconciliationRunEvidence {
    if (this.records.has(run.runId)) throw new Error("position reconciliation run id already exists");
    const stored = Object.freeze({ ...run, reconciliationIds: Object.freeze([...run.reconciliationIds]) });
    this.records.set(run.runId, stored);
    return stored;
  }
  getById(runId: string): PositionReconciliationRunEvidence | undefined { return this.records.get(runId); }
}

export enum PositionReconciliationFreshnessStatus {
  FRESH = "FRESH",
  EXPIRING_SOON = "EXPIRING_SOON",
  STALE = "STALE",
  NOT_MATCHED = "NOT_MATCHED"
}

export function evaluatePositionReconciliationFreshness(input: {
  readonly result: PositionReconciliationResult;
  readonly nowMs: number;
  readonly maximumAgeMs: number;
  readonly warningAgeMs: number;
}): PositionReconciliationFreshnessStatus {
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < input.result.observedAtMs) throw new Error("nowMs is invalid");
  if (!Number.isSafeInteger(input.maximumAgeMs) || input.maximumAgeMs <= 0) throw new Error("maximumAgeMs must be positive");
  if (!Number.isSafeInteger(input.warningAgeMs) || input.warningAgeMs < 0 || input.warningAgeMs >= input.maximumAgeMs) throw new Error("warningAgeMs must be non-negative and less than maximumAgeMs");
  if (input.result.status !== PositionReconciliationStatus.MATCHED) return PositionReconciliationFreshnessStatus.NOT_MATCHED;
  const ageMs = input.nowMs - input.result.observedAtMs;
  if (ageMs >= input.maximumAgeMs) return PositionReconciliationFreshnessStatus.STALE;
  if (ageMs >= input.warningAgeMs) return PositionReconciliationFreshnessStatus.EXPIRING_SOON;
  return PositionReconciliationFreshnessStatus.FRESH;
}

function assertWorkerPolicy(policy: PositionReconciliationWorkerPolicy): void {
  if (!Number.isSafeInteger(policy.maxPositionsPerRun) || policy.maxPositionsPerRun <= 0) throw new Error("maxPositionsPerRun must be a positive safe integer");
}

export function runPositionReconciliationWorker(input: {
  readonly runId: string;
  readonly positions: WalletPositionSource;
  readonly provider: PositionProvider;
  readonly policy: PositionReconciliationWorkerPolicy;
  readonly restrictions: OrderOperationalRestrictionRepository;
  readonly evidence: PositionReconciliationEvidenceRepository;
  readonly runEvidence?: PositionReconciliationRunEvidenceRepository;
  readonly nowMs: number;
}): PositionReconciliationWorkerResult {
  if (input.runId.trim() === "") throw new Error("runId is required");
  if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error("nowMs must be a non-negative safe integer");
  assertWorkerPolicy(input.policy);
  if (input.runEvidence?.getById(input.runId) != null) throw new Error("position reconciliation run id already exists");

  const all = [...input.positions.list()].sort((left, right) =>
    left.walletId.localeCompare(right.walletId) || left.symbol.localeCompare(right.symbol)
  );
  const selected = all.slice(0, input.policy.maxPositionsPerRun);
  const results: PositionReconciliationResult[] = [];
  let restrictionCount = 0;

  selected.forEach((local, index) => {
    const reconciliationId = `${input.runId}:position:${index + 1}`;
    const restrictionId = `${input.runId}:restriction:${index + 1}`;
    const result = reconcilePosition({
      reconciliationId,
      restrictionId,
      accountId: local.walletId,
      local,
      provider: input.provider,
      policy: input.policy,
      restrictions: input.restrictions,
      evidence: input.evidence,
      nowMs: input.nowMs
    });

    if (result.status === PositionReconciliationStatus.PROVIDER_UNAVAILABLE && local.baseQtyRaw !== 0n) {
      const active = input.restrictions.getActiveForAccount(local.walletId);
      if (active == null) {
        input.restrictions.save(Object.freeze({
          restrictionId,
          accountId: local.walletId,
          reason: OrderOperationalRestrictionReason.POSITION_STATE_UNCERTAIN,
          sourceRunId: reconciliationId,
          sourceIntentIds: Object.freeze([]),
          blockNewExposure: true,
          manualReleaseRequired: true,
          status: "ACTIVE",
          createdAtMs: input.nowMs
        }));
        restrictionCount += 1;
      }
    } else if (result.restrictionId != null) {
      restrictionCount += 1;
    }
    results.push(result);
  });

  const workerResult = Object.freeze({
    runId: input.runId,
    scannedCount: results.length,
    matchedCount: results.filter(result => result.status === PositionReconciliationStatus.MATCHED).length,
    mismatchCount: results.filter(result => result.status === PositionReconciliationStatus.MISMATCH).length,
    unavailableCount: results.filter(result => result.status === PositionReconciliationStatus.PROVIDER_UNAVAILABLE).length,
    restrictionCount,
    truncated: all.length > selected.length,
    results: Object.freeze(results)
  });

  input.runEvidence?.append(Object.freeze({
    runId: workerResult.runId,
    startedAtMs: input.nowMs,
    scannedCount: workerResult.scannedCount,
    matchedCount: workerResult.matchedCount,
    mismatchCount: workerResult.mismatchCount,
    unavailableCount: workerResult.unavailableCount,
    restrictionCount: workerResult.restrictionCount,
    truncated: workerResult.truncated,
    reconciliationIds: Object.freeze(workerResult.results.map(result => result.reconciliationId))
  }));

  return workerResult;
}
