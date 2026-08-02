import {
  admitOrder,
  OrderAdmissionDecisionType,
  type IdempotencyStore,
  type OrderAdmissionContext,
  type OrderAdmissionDecision,
  type OrderIntent
} from "./order-admission";
import { OrderSubmissionStatus, isAllowedTransition, type OrderExecutionRecord, type OrderExecutionRepository, type OrderExecutionStatusRepository } from "../../../packages/contracts/src/executionPersistence";
export { OrderSubmissionStatus, isAllowedTransition } from "../../../packages/contracts/src/executionPersistence";
export type { OrderExecutionRecord, OrderExecutionRepository, OrderExecutionStatusRepository } from "../../../packages/contracts/src/executionPersistence";

export interface ProviderOrderRequest {
  readonly intentId: string;
  readonly clientOrderId: string;
  readonly accountId: string;
  readonly symbol: string;
  readonly side: OrderIntent["side"];
  readonly orderType: OrderIntent["orderType"];
  readonly baseQtyRaw: bigint;
  readonly quoteQtyRaw?: bigint;
}

export interface ProviderOrderResponse {
  readonly status: "ACCEPTED" | "REJECTED";
  readonly providerOrderId?: string;
  readonly reason?: string;
}

export type ProviderOrderLookupResult =
  | Readonly<{ status: "FOUND_ACCEPTED"; providerOrderId: string }>
  | Readonly<{ status: "FOUND_REJECTED"; reason: string }>
  | Readonly<{ status: "NOT_FOUND" }>;

export interface OrderProvider {
  readonly environment: "SYNTHETIC" | "TESTNET";
  submit(request: ProviderOrderRequest): ProviderOrderResponse;
  lookupByClientOrderId?(clientOrderId: string): ProviderOrderLookupResult;
}

export class InMemoryOrderExecutionRepository implements OrderExecutionStatusRepository {
  private readonly records = new Map<string, OrderExecutionRecord>();

  getByIntentId(intentId: string): OrderExecutionRecord | undefined {
    return this.records.get(intentId);
  }

  listByStatus(status: OrderSubmissionStatus): readonly OrderExecutionRecord[] {
    return Object.freeze([...this.records.values()]
      .filter(record => record.status === status)
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.executionId.localeCompare(right.executionId)));
  }

  save(record: OrderExecutionRecord): OrderExecutionRecord {
    const previous = this.records.get(record.intentId);
    if (previous != null && previous.executionId !== record.executionId) throw new Error("intent already belongs to another execution");
    if (previous != null && !isAllowedTransition(previous.status, record.status)) throw new Error("execution status transition is not allowed");
    if (previous != null && (previous.idempotencyKey !== record.idempotencyKey || previous.payloadHash !== record.payloadHash || previous.createdAtMs !== record.createdAtMs)) throw new Error("execution identity cannot be changed");
    if (previous != null && record.updatedAtMs < previous.updatedAtMs) throw new Error("execution update time cannot regress");
    const stored = Object.freeze({ ...record });
    this.records.set(record.intentId, stored);
    return stored;
  }
}

export interface ExecutionGatewayContext {
  readonly admission: OrderAdmissionContext;
  readonly nowMs: number;
  readonly createExecutionId: () => string;
}

export interface ExecutionGatewayResult {
  readonly admission: OrderAdmissionDecision;
  readonly execution?: OrderExecutionRecord;
}

export interface SubmissionReconciliationResult {
  readonly before: OrderExecutionRecord;
  readonly after: OrderExecutionRecord;
  readonly resolved: boolean;
  readonly lookupStatus: ProviderOrderLookupResult["status"] | "LOOKUP_FAILED" | "LOOKUP_UNSUPPORTED";
}

function toProviderRequest(intent: OrderIntent): ProviderOrderRequest {
  return Object.freeze({ intentId: intent.intentId, clientOrderId: intent.idempotencyKey, accountId: intent.accountId, symbol: intent.symbol, side: intent.side, orderType: intent.orderType, baseQtyRaw: intent.baseQtyRaw, quoteQtyRaw: intent.quoteQtyRaw });
}

export function executeAdmittedOrder(intent: OrderIntent, context: ExecutionGatewayContext, idempotencyStore: IdempotencyStore, executionRepository: OrderExecutionRepository, provider: OrderProvider): ExecutionGatewayResult {
  if (intent.environment === "PRODUCTION") throw new Error("production execution is not available in the reconstructed baseline");
  if (provider.environment !== intent.environment) throw new Error("provider environment does not match order intent");
  const existing = executionRepository.getByIntentId(intent.intentId);
  if (existing != null) return Object.freeze({ admission: Object.freeze({ type: OrderAdmissionDecisionType.DUPLICATE, payloadHash: existing.payloadHash }), execution: existing });
  const admission = admitOrder(intent, context.admission, idempotencyStore);
  if (admission.type !== OrderAdmissionDecisionType.ALLOW) return Object.freeze({ admission });
  const submitting = executionRepository.save(Object.freeze({ executionId: context.createExecutionId(), intentId: intent.intentId, idempotencyKey: intent.idempotencyKey, payloadHash: admission.payloadHash, status: OrderSubmissionStatus.SUBMITTING, createdAtMs: context.nowMs, updatedAtMs: context.nowMs }));
  try {
    const response = provider.submit(toProviderRequest(intent));
    const completed = executionRepository.save(Object.freeze({ ...submitting, status: response.status === "ACCEPTED" ? OrderSubmissionStatus.ACCEPTED : OrderSubmissionStatus.REJECTED, providerOrderId: response.providerOrderId, reason: response.reason, updatedAtMs: context.nowMs }));
    return Object.freeze({ admission, execution: completed });
  } catch (error) {
    const unknown = executionRepository.save(Object.freeze({ ...submitting, status: OrderSubmissionStatus.SUBMISSION_UNKNOWN, reason: error instanceof Error ? error.message : "provider submission outcome is unknown", updatedAtMs: context.nowMs }));
    return Object.freeze({ admission, execution: unknown });
  }
}

export function reconcileUnknownSubmission(intentId: string, nowMs: number, executionRepository: OrderExecutionRepository, provider: OrderProvider): SubmissionReconciliationResult {
  const before = executionRepository.getByIntentId(intentId);
  if (before == null) throw new Error("execution record not found");
  if (before.status !== OrderSubmissionStatus.SUBMISSION_UNKNOWN) throw new Error("only submission-unknown executions can be reconciled");
  if (provider.lookupByClientOrderId == null) {
    const after = executionRepository.save(Object.freeze({ ...before, reason: "provider lookup unsupported; automatic resubmission remains prohibited", updatedAtMs: nowMs }));
    return Object.freeze({ before, after, resolved: false, lookupStatus: "LOOKUP_UNSUPPORTED" });
  }
  try {
    const lookup = provider.lookupByClientOrderId(before.idempotencyKey);
    if (lookup.status === "NOT_FOUND") {
      const after = executionRepository.save(Object.freeze({ ...before, reason: "provider order not found; automatic resubmission remains prohibited", updatedAtMs: nowMs }));
      return Object.freeze({ before, after, resolved: false, lookupStatus: lookup.status });
    }
    const after = executionRepository.save(Object.freeze({ ...before, status: lookup.status === "FOUND_ACCEPTED" ? OrderSubmissionStatus.ACCEPTED : OrderSubmissionStatus.REJECTED, providerOrderId: lookup.status === "FOUND_ACCEPTED" ? lookup.providerOrderId : undefined, reason: lookup.status === "FOUND_REJECTED" ? lookup.reason : undefined, updatedAtMs: nowMs }));
    return Object.freeze({ before, after, resolved: true, lookupStatus: lookup.status });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "provider lookup failed";
    const after = executionRepository.save(Object.freeze({ ...before, reason, updatedAtMs: nowMs }));
    return Object.freeze({ before, after, resolved: false, lookupStatus: "LOOKUP_FAILED" });
  }
}

export type SyntheticProviderOutcome = Readonly<{ type: "ACCEPT"; providerOrderId: string }> | Readonly<{ type: "REJECT"; reason: string }> | Readonly<{ type: "THROW"; reason: string }>;
export type SyntheticLookupOutcome = ProviderOrderLookupResult | Readonly<{ status: "THROW"; reason: string }>;

export class ScriptedSyntheticOrderProvider implements OrderProvider {
  public readonly environment = "SYNTHETIC" as const;
  public submitCount = 0;
  public lookupCount = 0;
  public constructor(private readonly outcomes: readonly SyntheticProviderOutcome[], private readonly lookupOutcomes: readonly SyntheticLookupOutcome[] = []) {}
  submit(_request: ProviderOrderRequest): ProviderOrderResponse {
    const outcome = this.outcomes[this.submitCount++];
    if (outcome == null) throw new Error("no synthetic provider outcome configured");
    if (outcome.type === "THROW") throw new Error(outcome.reason);
    if (outcome.type === "REJECT") return Object.freeze({ status: "REJECTED", reason: outcome.reason });
    return Object.freeze({ status: "ACCEPTED", providerOrderId: outcome.providerOrderId });
  }
  lookupByClientOrderId(_clientOrderId: string): ProviderOrderLookupResult {
    const outcome = this.lookupOutcomes[this.lookupCount++];
    if (outcome == null) return Object.freeze({ status: "NOT_FOUND" });
    if (outcome.status === "THROW") throw new Error(outcome.reason);
    return outcome;
  }
}
