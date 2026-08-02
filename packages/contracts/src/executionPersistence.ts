export enum OrderSubmissionStatus {
  SUBMITTING = "SUBMITTING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN"
}

export interface OrderExecutionRecord {
  readonly executionId: string;
  readonly intentId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly status: OrderSubmissionStatus;
  readonly providerOrderId?: string;
  readonly reason?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface OrderExecutionRepository {
  getByIntentId(intentId: string): OrderExecutionRecord | undefined;
  save(record: OrderExecutionRecord): OrderExecutionRecord;
}

export interface OrderExecutionStatusRepository extends OrderExecutionRepository {
  listByStatus(status: OrderSubmissionStatus): readonly OrderExecutionRecord[];
}

export function isAllowedTransition(previous: OrderSubmissionStatus, next: OrderSubmissionStatus): boolean {
  if (previous === next) return true;
  if (previous === OrderSubmissionStatus.SUBMITTING) return next === OrderSubmissionStatus.ACCEPTED || next === OrderSubmissionStatus.REJECTED || next === OrderSubmissionStatus.SUBMISSION_UNKNOWN;
  if (previous === OrderSubmissionStatus.SUBMISSION_UNKNOWN) return next === OrderSubmissionStatus.ACCEPTED || next === OrderSubmissionStatus.REJECTED;
  return false;
}
