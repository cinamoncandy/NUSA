export enum OrderOperationalRestrictionReason {
  CRITICAL_UNKNOWN_SUBMISSION = "CRITICAL_UNKNOWN_SUBMISSION"
}

export interface OrderOperationalRestriction {
  readonly restrictionId: string;
  readonly accountId: string;
  readonly reason: OrderOperationalRestrictionReason;
  readonly sourceRunId: string;
  readonly sourceIntentIds: readonly string[];
  readonly blockNewExposure: true;
  readonly manualReleaseRequired: true;
  readonly status: "ACTIVE" | "RELEASED";
  readonly createdAtMs: number;
  readonly releasedAtMs?: number;
}

export interface OrderOperationalRestrictionRepository {
  getActiveForAccount(accountId: string): OrderOperationalRestriction | undefined;
  save(restriction: OrderOperationalRestriction): OrderOperationalRestriction;
}

export class InMemoryOrderOperationalRestrictionRepository implements OrderOperationalRestrictionRepository {
  private readonly records = new Map<string, OrderOperationalRestriction>();

  getActiveForAccount(accountId: string): OrderOperationalRestriction | undefined {
    return [...this.records.values()].find(record => record.accountId === accountId && record.status === "ACTIVE");
  }

  save(restriction: OrderOperationalRestriction): OrderOperationalRestriction {
    const previous = this.records.get(restriction.restrictionId);
    if (previous != null) {
      if (previous.accountId !== restriction.accountId || previous.reason !== restriction.reason || previous.sourceRunId !== restriction.sourceRunId) {
        throw new Error("restriction identity cannot be changed");
      }
      if (previous.status === "RELEASED" && restriction.status !== "RELEASED") {
        throw new Error("released restriction cannot be reactivated");
      }
      if (restriction.createdAtMs !== previous.createdAtMs || (restriction.releasedAtMs != null && restriction.releasedAtMs < restriction.createdAtMs)) {
        throw new Error("restriction timestamps are invalid");
      }
    }
    const stored = Object.freeze({ ...restriction, sourceIntentIds: Object.freeze([...restriction.sourceIntentIds]) });
    this.records.set(stored.restrictionId, stored);
    return stored;
  }
}

export function createCriticalUnknownSubmissionRestriction(input: {
  readonly restrictionId: string;
  readonly accountId: string;
  readonly sourceRunId: string;
  readonly sourceIntentIds: readonly string[];
  readonly nowMs: number;
}): OrderOperationalRestriction {
  if (input.restrictionId.trim() === "") throw new Error("restrictionId is required");
  if (input.accountId.trim() === "") throw new Error("accountId is required");
  if (input.sourceRunId.trim() === "") throw new Error("sourceRunId is required");
  if (input.sourceIntentIds.length === 0) throw new Error("at least one source intent is required");
  return Object.freeze({
    restrictionId: input.restrictionId,
    accountId: input.accountId,
    reason: OrderOperationalRestrictionReason.CRITICAL_UNKNOWN_SUBMISSION,
    sourceRunId: input.sourceRunId,
    sourceIntentIds: Object.freeze([...new Set(input.sourceIntentIds)].sort()),
    blockNewExposure: true,
    manualReleaseRequired: true,
    status: "ACTIVE",
    createdAtMs: input.nowMs
  });
}
