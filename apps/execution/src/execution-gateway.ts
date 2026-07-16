import {
  admitOrder,
  OrderAdmissionDecisionType,
  type IdempotencyStore,
  type OrderAdmissionContext,
  type OrderAdmissionDecision,
  type OrderIntent
} from "./order-admission";

export enum OrderSubmissionStatus {
  SUBMITTING = "SUBMITTING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  SUBMISSION_UNKNOWN = "SUBMISSION_UNKNOWN"
}

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

export interface OrderProvider {
  readonly environment: "SYNTHETIC" | "TESTNET";
  submit(request: ProviderOrderRequest): ProviderOrderResponse;
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

export class InMemoryOrderExecutionRepository implements OrderExecutionRepository {
  private readonly records = new Map<string, OrderExecutionRecord>();

  getByIntentId(intentId: string): OrderExecutionRecord | undefined {
    return this.records.get(intentId);
  }

  save(record: OrderExecutionRecord): OrderExecutionRecord {
    const previous = this.records.get(record.intentId);
    if (previous != null && previous.executionId !== record.executionId) {
      throw new Error("intent already belongs to another execution");
    }
    if (previous != null && isTerminal(previous.status) && previous.status !== record.status) {
      throw new Error("terminal execution status cannot be changed");
    }
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

function isTerminal(status: OrderSubmissionStatus): boolean {
  return status === OrderSubmissionStatus.ACCEPTED
    || status === OrderSubmissionStatus.REJECTED
    || status === OrderSubmissionStatus.SUBMISSION_UNKNOWN;
}

function toProviderRequest(intent: OrderIntent): ProviderOrderRequest {
  return Object.freeze({
    intentId: intent.intentId,
    clientOrderId: intent.idempotencyKey,
    accountId: intent.accountId,
    symbol: intent.symbol,
    side: intent.side,
    orderType: intent.orderType,
    baseQtyRaw: intent.baseQtyRaw,
    quoteQtyRaw: intent.quoteQtyRaw
  });
}

export function executeAdmittedOrder(
  intent: OrderIntent,
  context: ExecutionGatewayContext,
  idempotencyStore: IdempotencyStore,
  executionRepository: OrderExecutionRepository,
  provider: OrderProvider
): ExecutionGatewayResult {
  if (intent.environment === "PRODUCTION") {
    throw new Error("production execution is not available in the reconstructed baseline");
  }
  if (provider.environment !== intent.environment) {
    throw new Error("provider environment does not match order intent");
  }

  const existing = executionRepository.getByIntentId(intent.intentId);
  if (existing != null) {
    return Object.freeze({
      admission: Object.freeze({ type: OrderAdmissionDecisionType.DUPLICATE, payloadHash: existing.payloadHash }),
      execution: existing
    });
  }

  const admission = admitOrder(intent, context.admission, idempotencyStore);
  if (admission.type !== OrderAdmissionDecisionType.ALLOW) {
    return Object.freeze({ admission });
  }

  const executionId = context.createExecutionId();
  const submitting = executionRepository.save(Object.freeze({
    executionId,
    intentId: intent.intentId,
    idempotencyKey: intent.idempotencyKey,
    payloadHash: admission.payloadHash,
    status: OrderSubmissionStatus.SUBMITTING,
    createdAtMs: context.nowMs,
    updatedAtMs: context.nowMs
  }));

  try {
    const response = provider.submit(toProviderRequest(intent));
    const completed = executionRepository.save(Object.freeze({
      ...submitting,
      status: response.status === "ACCEPTED" ? OrderSubmissionStatus.ACCEPTED : OrderSubmissionStatus.REJECTED,
      providerOrderId: response.providerOrderId,
      reason: response.reason,
      updatedAtMs: context.nowMs
    }));
    return Object.freeze({ admission, execution: completed });
  } catch (error) {
    const unknown = executionRepository.save(Object.freeze({
      ...submitting,
      status: OrderSubmissionStatus.SUBMISSION_UNKNOWN,
      reason: error instanceof Error ? error.message : "provider submission outcome is unknown",
      updatedAtMs: context.nowMs
    }));
    return Object.freeze({ admission, execution: unknown });
  }
}

export type SyntheticProviderOutcome =
  | Readonly<{ type: "ACCEPT"; providerOrderId: string }>
  | Readonly<{ type: "REJECT"; reason: string }>
  | Readonly<{ type: "THROW"; reason: string }>;

export class ScriptedSyntheticOrderProvider implements OrderProvider {
  public readonly environment = "SYNTHETIC" as const;
  public submitCount = 0;

  public constructor(private readonly outcomes: readonly SyntheticProviderOutcome[]) {}

  submit(_request: ProviderOrderRequest): ProviderOrderResponse {
    const outcome = this.outcomes[this.submitCount];
    this.submitCount += 1;
    if (outcome == null) throw new Error("no synthetic provider outcome configured");
    if (outcome.type === "THROW") throw new Error(outcome.reason);
    if (outcome.type === "REJECT") return Object.freeze({ status: "REJECTED", reason: outcome.reason });
    return Object.freeze({ status: "ACCEPTED", providerOrderId: outcome.providerOrderId });
  }
}
