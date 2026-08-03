import {
  OrderSubmissionStatus,
  reconcileUnknownSubmission,
  type OrderExecutionRecord,
  type OrderExecutionStatusRepository,
  type OrderProvider,
  type SubmissionReconciliationResult
} from "./execution-gateway";
import {
  createCriticalUnknownSubmissionRestriction,
  type OrderOperationalRestrictionRepository
} from "./order-restriction";

export enum UnknownSubmissionAgeStatus {
  RECENT = "RECENT",
  OVERDUE = "OVERDUE",
  CRITICAL = "CRITICAL"
}

export interface UnknownSubmissionReconciliationPolicy {
  readonly overdueAfterMs: number;
  readonly criticalAfterMs: number;
  readonly maximumRecordsPerRun: number;
}

export interface UnknownSubmissionAssessment {
  readonly intentId: string;
  readonly executionId: string;
  readonly ageMs: number;
  readonly ageStatus: UnknownSubmissionAgeStatus;
}

export interface UnknownSubmissionReconciliationItem {
  readonly assessment: UnknownSubmissionAssessment;
  readonly reconciliation: SubmissionReconciliationResult;
}

export interface UnknownSubmissionReconciliationRun {
  readonly runId?: string;
  readonly startedAtMs: number;
  readonly scannedCount: number;
  readonly resolvedCount: number;
  readonly unresolvedCount: number;
  readonly overdueCount: number;
  readonly criticalCount: number;
  readonly truncated: boolean;
  readonly nextCursor: string | undefined;
  readonly items: readonly UnknownSubmissionReconciliationItem[];
}

export interface UnknownSubmissionReconciliationEvidenceRepository {
  append(run: UnknownSubmissionReconciliationRun & { readonly runId: string }): void;
}

export interface UnknownSubmissionReconciliationEvidenceContext {
  readonly repository: UnknownSubmissionReconciliationEvidenceRepository;
  readonly createRunId: () => string;
}

export interface UnknownSubmissionRestrictionContext {
  readonly accountId: string;
  readonly repository: OrderOperationalRestrictionRepository;
  readonly createRestrictionId: () => string;
}

function validatePolicy(policy: UnknownSubmissionReconciliationPolicy): void {
  if (!Number.isSafeInteger(policy.overdueAfterMs) || policy.overdueAfterMs < 0) {
    throw new Error("overdueAfterMs must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(policy.criticalAfterMs) || policy.criticalAfterMs < policy.overdueAfterMs) {
    throw new Error("criticalAfterMs must be greater than or equal to overdueAfterMs");
  }
  if (!Number.isSafeInteger(policy.maximumRecordsPerRun) || policy.maximumRecordsPerRun <= 0) {
    throw new Error("maximumRecordsPerRun must be a positive safe integer");
  }
}

export function assessUnknownSubmission(
  record: OrderExecutionRecord,
  nowMs: number,
  policy: UnknownSubmissionReconciliationPolicy
): UnknownSubmissionAssessment {
  validatePolicy(policy);
  if (record.status !== OrderSubmissionStatus.SUBMISSION_UNKNOWN) {
    throw new Error("only unknown submissions can be assessed");
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < record.createdAtMs) {
    throw new Error("nowMs cannot predate execution creation");
  }
  const ageMs = nowMs - record.createdAtMs;
  const ageStatus = ageMs >= policy.criticalAfterMs
    ? UnknownSubmissionAgeStatus.CRITICAL
    : ageMs >= policy.overdueAfterMs
      ? UnknownSubmissionAgeStatus.OVERDUE
      : UnknownSubmissionAgeStatus.RECENT;
  return Object.freeze({
    intentId: record.intentId,
    executionId: record.executionId,
    ageMs,
    ageStatus
  });
}

export function reconcileUnknownSubmissions(
  nowMs: number,
  repository: OrderExecutionStatusRepository,
  provider: OrderProvider,
  policy: UnknownSubmissionReconciliationPolicy,
  evidence?: UnknownSubmissionReconciliationEvidenceContext,
  restriction?: UnknownSubmissionRestrictionContext,
  /**
   * executionId of the last record scanned by the previous run (its nextCursor).
   * When the unknown-submission count exceeds maximumRecordsPerRun, passing this
   * back in advances the scan window instead of rescanning the same oldest slice
   * every run, which would leave newer unknown submissions never reconciled.
   */
  cursor?: string
): UnknownSubmissionReconciliationRun {
  validatePolicy(policy);
  const runId = evidence?.createRunId();
  if (evidence != null && (runId == null || runId.length === 0)) {
    throw new Error("reconciliation run id is required");
  }
  if (restriction != null && restriction.accountId.trim() === "") {
    throw new Error("restriction account id is required");
  }

  const allUnknown = repository.listByStatus(OrderSubmissionStatus.SUBMISSION_UNKNOWN);
  const startIndex = (() => {
    if (cursor === undefined || allUnknown.length === 0) return 0;
    const cursorIndex = allUnknown.findIndex(record => record.executionId === cursor);
    return cursorIndex === -1 ? 0 : (cursorIndex + 1) % allUnknown.length;
  })();
  const rotated = startIndex === 0 ? allUnknown : [...allUnknown.slice(startIndex), ...allUnknown.slice(0, startIndex)];
  const selected = rotated.slice(0, policy.maximumRecordsPerRun);
  const items = selected.map(record => {
    const assessment = assessUnknownSubmission(record, nowMs, policy);
    const reconciliation = reconcileUnknownSubmission(record.intentId, nowMs, repository, provider);
    return Object.freeze({ assessment, reconciliation });
  });

  const run = Object.freeze({
    ...(runId == null ? {} : { runId }),
    startedAtMs: nowMs,
    scannedCount: selected.length,
    resolvedCount: items.filter(item => item.reconciliation.resolved).length,
    unresolvedCount: items.filter(item => !item.reconciliation.resolved).length,
    overdueCount: items.filter(item => !item.reconciliation.resolved && item.assessment.ageStatus === UnknownSubmissionAgeStatus.OVERDUE).length,
    criticalCount: items.filter(item => !item.reconciliation.resolved && item.assessment.ageStatus === UnknownSubmissionAgeStatus.CRITICAL).length,
    truncated: allUnknown.length > selected.length,
    nextCursor: selected.length > 0 ? selected[selected.length - 1].executionId : cursor,
    items: Object.freeze(items)
  }) as UnknownSubmissionReconciliationRun;

  if (evidence != null) {
    evidence.repository.append(run as UnknownSubmissionReconciliationRun & { readonly runId: string });
  }
  if (restriction != null && run.criticalCount > 0 && restriction.repository.getActiveForAccount(restriction.accountId) == null) {
    const restrictionId = restriction.createRestrictionId();
    const sourceRunId = run.runId ?? `unpersisted-${nowMs}`;
    restriction.repository.save(createCriticalUnknownSubmissionRestriction({
      restrictionId,
      accountId: restriction.accountId,
      sourceRunId,
      sourceIntentIds: run.items
        .filter(item => !item.reconciliation.resolved && item.assessment.ageStatus === UnknownSubmissionAgeStatus.CRITICAL)
        .map(item => item.assessment.intentId),
      nowMs
    }));
  }
  return run;
}
