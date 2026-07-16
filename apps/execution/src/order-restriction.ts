import { OrderSubmissionStatus, type OrderExecutionRepository } from "./execution-gateway";

export enum OrderOperationalRestrictionReason {
  CRITICAL_UNKNOWN_SUBMISSION = "CRITICAL_UNKNOWN_SUBMISSION",
  POSITION_MISMATCH = "POSITION_MISMATCH",
  POSITION_STATE_UNCERTAIN = "POSITION_STATE_UNCERTAIN",
  POSITION_RECONCILIATION_STALE = "POSITION_RECONCILIATION_STALE",
  BALANCE_MISMATCH = "BALANCE_MISMATCH",
  BALANCE_STATE_UNCERTAIN = "BALANCE_STATE_UNCERTAIN",
  BALANCE_RECONCILIATION_STALE = "BALANCE_RECONCILIATION_STALE",
  FUNDING_RECONCILIATION_MISMATCH = "FUNDING_RECONCILIATION_MISMATCH",
  FUNDING_STATE_UNCERTAIN = "FUNDING_STATE_UNCERTAIN",
  FUNDING_RECONCILIATION_STALE = "FUNDING_RECONCILIATION_STALE"
}

export interface OrderOperationalRestriction { readonly restrictionId: string; readonly accountId: string; readonly reason: OrderOperationalRestrictionReason; readonly sourceRunId: string; readonly sourceIntentIds: readonly string[]; readonly blockNewExposure: true; readonly manualReleaseRequired: true; readonly status: "ACTIVE" | "RELEASED"; readonly createdAtMs: number; readonly releasedAtMs?: number; }
export interface OrderOperationalRestrictionReleaseEvidence { readonly releaseId: string; readonly restrictionId: string; readonly accountId: string; readonly requestedBy: string; readonly verifiedBy: string; readonly rationale: string; readonly verifiedIntentIds: readonly string[]; readonly matchedReconciliationId?: string; readonly matchedBalanceReconciliationId?: string; readonly matchedFundingReconciliationId?: string; readonly releasedAtMs: number; }
export interface OrderOperationalRestrictionRepository { getById(restrictionId: string): OrderOperationalRestriction | undefined; getActiveForAccount(accountId: string): OrderOperationalRestriction | undefined; save(restriction: OrderOperationalRestriction): OrderOperationalRestriction; }
export interface OrderOperationalRestrictionReleaseEvidenceRepository { append(evidence: OrderOperationalRestrictionReleaseEvidence): OrderOperationalRestrictionReleaseEvidence; getByRestrictionId(restrictionId: string): OrderOperationalRestrictionReleaseEvidence | undefined; }
export interface OrderRestrictionReleaseTransaction { transaction<T>(operation: () => T): T; }

export class InMemoryOrderOperationalRestrictionRepository implements OrderOperationalRestrictionRepository {
  private readonly records = new Map<string, OrderOperationalRestriction>();
  getById(restrictionId: string) { return this.records.get(restrictionId); }
  getActiveForAccount(accountId: string) { return [...this.records.values()].find(record => record.accountId === accountId && record.status === "ACTIVE"); }
  save(restriction: OrderOperationalRestriction) {
    const previous = this.records.get(restriction.restrictionId);
    if (previous != null) {
      if (previous.accountId !== restriction.accountId || previous.reason !== restriction.reason || previous.sourceRunId !== restriction.sourceRunId) throw new Error("restriction identity cannot be changed");
      if (previous.status === "RELEASED" && restriction.status !== "RELEASED") throw new Error("released restriction cannot be reactivated");
      if (restriction.createdAtMs !== previous.createdAtMs || (restriction.releasedAtMs != null && restriction.releasedAtMs < restriction.createdAtMs)) throw new Error("restriction timestamps are invalid");
    }
    const stored = Object.freeze({ ...restriction, sourceIntentIds: Object.freeze([...restriction.sourceIntentIds]) }); this.records.set(stored.restrictionId, stored); return stored;
  }
}

export class InMemoryOrderOperationalRestrictionReleaseEvidenceRepository implements OrderOperationalRestrictionReleaseEvidenceRepository {
  private readonly byRestriction = new Map<string, OrderOperationalRestrictionReleaseEvidence>(); private readonly releaseIds = new Set<string>();
  append(evidence: OrderOperationalRestrictionReleaseEvidence) { if (this.releaseIds.has(evidence.releaseId)) throw new Error("release evidence id already exists"); if (this.byRestriction.has(evidence.restrictionId)) throw new Error("restriction already has release evidence"); const stored = Object.freeze({ ...evidence, verifiedIntentIds: Object.freeze([...evidence.verifiedIntentIds]) }); this.releaseIds.add(stored.releaseId); this.byRestriction.set(stored.restrictionId, stored); return stored; }
  getByRestrictionId(restrictionId: string) { return this.byRestriction.get(restrictionId); }
}

export function createCriticalUnknownSubmissionRestriction(input: { readonly restrictionId: string; readonly accountId: string; readonly sourceRunId: string; readonly sourceIntentIds: readonly string[]; readonly nowMs: number; }): OrderOperationalRestriction {
  if (input.restrictionId.trim() === "" || input.accountId.trim() === "" || input.sourceRunId.trim() === "" || input.sourceIntentIds.length === 0) throw new Error("restriction identity and source intents are required");
  return Object.freeze({ restrictionId: input.restrictionId, accountId: input.accountId, reason: OrderOperationalRestrictionReason.CRITICAL_UNKNOWN_SUBMISSION, sourceRunId: input.sourceRunId, sourceIntentIds: Object.freeze([...new Set(input.sourceIntentIds)].sort()), blockNewExposure: true, manualReleaseRequired: true, status: "ACTIVE", createdAtMs: input.nowMs });
}

export function releaseOrderOperationalRestriction(input: { readonly releaseId: string; readonly restrictionId: string; readonly requestedBy: string; readonly verifiedBy: string; readonly rationale: string; readonly nowMs: number; readonly restrictions: OrderOperationalRestrictionRepository; readonly executions: OrderExecutionRepository; readonly evidence: OrderOperationalRestrictionReleaseEvidenceRepository; readonly transaction?: OrderRestrictionReleaseTransaction; }): OrderOperationalRestriction {
  if (input.releaseId.trim() === "" || input.requestedBy.trim() === "" || input.verifiedBy.trim() === "" || input.requestedBy === input.verifiedBy || input.rationale.trim() === "") throw new Error("valid separated release approval is required");
  const operation = () => { const restriction = input.restrictions.getById(input.restrictionId); if (restriction == null || restriction.status !== "ACTIVE") throw new Error("active restriction not found"); if (restriction.reason !== OrderOperationalRestrictionReason.CRITICAL_UNKNOWN_SUBMISSION) throw new Error("reconciliation restriction requires matched domain evidence"); if (!Number.isSafeInteger(input.nowMs) || input.nowMs < restriction.createdAtMs) throw new Error("release time is invalid"); for (const intentId of restriction.sourceIntentIds) { const execution = input.executions.getByIntentId(intentId); if (execution == null || execution.status === OrderSubmissionStatus.SUBMITTING || execution.status === OrderSubmissionStatus.SUBMISSION_UNKNOWN) throw new Error(`source execution remains unresolved: ${intentId}`); } input.evidence.append(Object.freeze({ releaseId: input.releaseId, restrictionId: restriction.restrictionId, accountId: restriction.accountId, requestedBy: input.requestedBy, verifiedBy: input.verifiedBy, rationale: input.rationale.trim(), verifiedIntentIds: Object.freeze([...restriction.sourceIntentIds]), releasedAtMs: input.nowMs })); return input.restrictions.save(Object.freeze({ ...restriction, status: "RELEASED", releasedAtMs: input.nowMs })); };
  return input.transaction == null ? operation() : input.transaction.transaction(operation);
}
