import { createHash, randomUUID } from "node:crypto";

export type OrderEngineState =
  | "CREATED" | "QUEUED" | "SUBMITTING" | "ACCEPTED" | "PARTIALLY_FILLED"
  | "FILLED" | "CANCEL_REQUESTED" | "CANCELED" | "FAILED" | "DEAD_LETTERED";

export interface OrderEngineEvent {
  readonly eventId: string;
  readonly orderId: string;
  readonly type: "CREATED" | "QUEUED" | "SUBMITTING" | "ACCEPTED" | "PARTIAL_FILL" | "FILLED" | "CANCEL_REQUESTED" | "CANCELED" | "FAILED" | "DEAD_LETTERED";
  readonly sequence: number;
  readonly occurredAtMs: number;
  readonly quantity?: string;
  readonly price?: string;
  readonly reason?: string;
}

export interface ReplayedOrder {
  readonly orderId: string;
  readonly state: OrderEngineState;
  readonly filledQuantity: string;
  readonly remainingQuantity: string | null;
  readonly averageFillPrice: string | null;
  readonly sequence: number;
}

const transitions: Readonly<Record<OrderEngineState, readonly OrderEngineState[]>> = Object.freeze({
  CREATED: ["QUEUED", "FAILED"],
  QUEUED: ["SUBMITTING", "CANCELED", "FAILED"],
  SUBMITTING: ["ACCEPTED", "FAILED", "DEAD_LETTERED"],
  ACCEPTED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "FAILED"],
  PARTIALLY_FILLED: ["PARTIALLY_FILLED", "FILLED", "CANCEL_REQUESTED", "FAILED"],
  FILLED: [], CANCELED: [], FAILED: [], DEAD_LETTERED: [], CANCEL_REQUESTED: ["CANCELED", "FILLED", "PARTIALLY_FILLED", "FAILED"]
});

function requireText(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

function decimal(value: string, name: string): { value: bigint; scale: number } {
  const text = requireText(value, name);
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${name} must be a non-negative decimal`);
  const [whole, fraction = ""] = text.split(".");
  return { value: BigInt(`${whole}${fraction}`), scale: fraction.length };
}

function add(a: string, b: string): string {
  const left = decimal(a, "decimal"); const right = decimal(b, "decimal");
  const scale = Math.max(left.scale, right.scale);
  const value = left.value * 10n ** BigInt(scale - left.scale) + right.value * 10n ** BigInt(scale - right.scale);
  const text = value.toString().padStart(scale + 1, "0");
  return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.0+$/, "");
}

function compare(a: string, b: string): number {
  const left = decimal(a, "decimal"); const right = decimal(b, "decimal");
  const scale = Math.max(left.scale, right.scale);
  const l = left.value * 10n ** BigInt(scale - left.scale); const r = right.value * 10n ** BigInt(scale - right.scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

function subtract(a: string, b: string): string {
  if (compare(a, b) < 0) throw new Error("quantity cannot become negative");
  const left = decimal(a, "decimal"); const right = decimal(b, "decimal");
  const scale = Math.max(left.scale, right.scale);
  const value = left.value * 10n ** BigInt(scale - left.scale) - right.value * 10n ** BigInt(scale - right.scale);
  const text = value.toString().padStart(scale + 1, "0");
  return scale === 0 ? text : `${text.slice(0, -scale)}.${text.slice(-scale)}`.replace(/\.0+$/, "");
}

function averagePrice(fills: readonly Pick<OrderEngineEvent, "quantity" | "price">[]): string | null {
  if (fills.length === 0) return null;
  const maxScale = Math.max(...fills.map((fill) => decimal(fill.quantity ?? "", "quantity").scale));
  const priceScale = Math.max(...fills.map((fill) => decimal(fill.price ?? "", "price").scale));
  let totalQuantity = 0n; let totalValue = 0n;
  for (const fill of fills) {
    const quantity = decimal(fill.quantity ?? "", "quantity"); const price = decimal(fill.price ?? "", "price");
    const q = quantity.value * 10n ** BigInt(maxScale - quantity.scale);
    const p = price.value * 10n ** BigInt(priceScale - price.scale);
    totalQuantity += q; totalValue += q * p;
  }
  const scaled = totalValue / totalQuantity;
  const text = scaled.toString().padStart(priceScale + 1, "0");
  return priceScale === 0 ? text : `${text.slice(0, -priceScale)}.${text.slice(-priceScale)}`.replace(/\.0+$/, "");
}

export function assertOrderEngineTransition(from: OrderEngineState, to: OrderEngineState): void {
  if (!transitions[from]?.includes(to)) throw new Error(`INVALID_ORDER_TRANSITION:${from}->${to}`);
}

export function replayOrderEvents(events: readonly OrderEngineEvent[], requestedQuantity?: string): ReplayedOrder {
  if (events.length === 0) throw new Error("ORDER_EVENTS_REQUIRED");
  const first = events[0];
  if (first.type !== "CREATED" || first.sequence !== 1) throw new Error("ORDER_REPLAY_MUST_START_CREATED");
  const fills: OrderEngineEvent[] = []; let state: OrderEngineState = "CREATED"; let lastSequence = 0;
  for (const event of events) {
    if (event.orderId !== first.orderId || event.sequence !== lastSequence + 1 || event.occurredAtMs < (events[event.sequence - 2]?.occurredAtMs ?? event.occurredAtMs)) throw new Error("ORDER_REPLAY_SEQUENCE_INVALID");
    if (event.type === "CREATED") { lastSequence = event.sequence; continue; }
    const next: OrderEngineState = event.type === "PARTIAL_FILL" ? "PARTIALLY_FILLED" : event.type === "FILLED" ? "FILLED" : event.type === "CANCEL_REQUESTED" ? "CANCEL_REQUESTED" : event.type === "DEAD_LETTERED" ? "DEAD_LETTERED" : event.type;
    assertOrderEngineTransition(state, next);
    if (event.type === "PARTIAL_FILL" || event.type === "FILLED") {
      decimal(event.quantity ?? "", "fill quantity"); decimal(event.price ?? "", "fill price"); fills.push(event);
    }
    state = next; lastSequence = event.sequence;
  }
  const filledQuantity = fills.reduce((sum, fill) => add(sum, fill.quantity ?? "0"), "0");
  if (requestedQuantity !== undefined && compare(filledQuantity, requestedQuantity) > 0) throw new Error("ORDER_REPLAY_OVERFILLED");
  return Object.freeze({ orderId: first.orderId, state, filledQuantity, remainingQuantity: requestedQuantity === undefined ? null : subtract(requestedQuantity, filledQuantity), averageFillPrice: averagePrice(fills), sequence: lastSequence });
}

export interface PartialFillState { readonly requestedQuantity: string; readonly filledQuantity: string; readonly remainingQuantity: string; readonly averageFillPrice: string | null; readonly fills: readonly Readonly<{ quantity: string; price: string }>[]; }
export class PartialFillManager {
  private state: PartialFillState;
  public constructor(requestedQuantity: string) { decimal(requestedQuantity, "requestedQuantity"); this.state = Object.freeze({ requestedQuantity, filledQuantity: "0", remainingQuantity: requestedQuantity, averageFillPrice: null, fills: Object.freeze([]) }); }
  public apply(fill: Readonly<{ quantity: string; price: string }>): PartialFillState { decimal(fill.quantity, "fill quantity"); decimal(fill.price, "fill price"); const filledQuantity = add(this.state.filledQuantity, fill.quantity); if (compare(filledQuantity, this.state.requestedQuantity) > 0) throw new Error("PARTIAL_FILL_OVERFLOW"); const fills = Object.freeze([...this.state.fills, Object.freeze({ quantity: fill.quantity, price: fill.price })]); this.state = Object.freeze({ requestedQuantity: this.state.requestedQuantity, filledQuantity, remainingQuantity: subtract(this.state.requestedQuantity, filledQuantity), averageFillPrice: averagePrice(fills.map((item) => ({ quantity: item.quantity, price: item.price }))), fills }); return this.state; }
  public snapshot(): PartialFillState { return this.state; }
}

export interface GhostFill { readonly exchangeTradeId: string; readonly quantity: string; readonly price: string; readonly executedAtMs: number; }
export interface GhostFillRecoveryResult { readonly status: "MATCHED" | "RECOVERED" | "BLOCKED"; readonly recovered: readonly GhostFill[]; readonly duplicateIds: readonly string[]; readonly unknownIds: readonly string[]; }
export function recoverGhostFills(local: readonly GhostFill[], remote: readonly GhostFill[]): GhostFillRecoveryResult {
  const localIds = new Set(local.map((fill) => fill.exchangeTradeId)); const seen = new Set<string>(); const recovered: GhostFill[] = []; const duplicateIds: string[] = [];
  for (const fill of remote) { requireText(fill.exchangeTradeId, "exchangeTradeId"); decimal(fill.quantity, "fill quantity"); decimal(fill.price, "fill price"); if (seen.has(fill.exchangeTradeId)) { duplicateIds.push(fill.exchangeTradeId); continue; } seen.add(fill.exchangeTradeId); if (!localIds.has(fill.exchangeTradeId)) recovered.push(Object.freeze({ ...fill })); }
  const unknownIds = local.filter((fill) => !seen.has(fill.exchangeTradeId)).map((fill) => fill.exchangeTradeId);
  const status = duplicateIds.length > 0 || unknownIds.length > 0 ? "BLOCKED" : recovered.length > 0 ? "RECOVERED" : "MATCHED";
  return Object.freeze({ status, recovered: Object.freeze(recovered), duplicateIds: Object.freeze([...duplicateIds]), unknownIds: Object.freeze([...unknownIds]) });
}

export interface OrderQueueItem<T> { readonly orderId: string; readonly value: T; readonly enqueuedAtMs: number; readonly attempts: number; }
export class OrderQueue<T> {
  private readonly items: OrderQueueItem<T>[] = [];
  private readonly ids = new Set<string>();
  public constructor(private readonly maximumItems = 256) { if (!Number.isSafeInteger(maximumItems) || maximumItems <= 0) throw new Error("invalid order queue capacity"); }
  public enqueue(item: OrderQueueItem<T>): boolean { requireText(item.orderId, "orderId"); if (this.ids.has(item.orderId)) return false; if (this.items.length >= this.maximumItems) throw new Error("ORDER_QUEUE_FULL"); this.items.push(Object.freeze({ ...item })); this.ids.add(item.orderId); return true; }
  public dequeue(): OrderQueueItem<T> | undefined { const item = this.items.shift(); if (item) this.ids.delete(item.orderId); return item; }
  public get depth(): number { return this.items.length; }
  public snapshot(): readonly OrderQueueItem<T>[] { return Object.freeze([...this.items]); }
}

export interface RetryPolicy { readonly maximumAttempts: number; readonly baseDelayMs: number; readonly maximumDelayMs: number; readonly retryableReasons: readonly string[]; }
export function retryDelay(policy: RetryPolicy, attempt: number, reason: string): number | null { if (!policy.retryableReasons.includes(reason) || attempt >= policy.maximumAttempts) return null; if (![policy.baseDelayMs, policy.maximumDelayMs].every((value) => Number.isSafeInteger(value) && value >= 0) || policy.maximumDelayMs < policy.baseDelayMs) throw new Error("invalid retry policy"); return Math.min(policy.maximumDelayMs, policy.baseDelayMs * 2 ** attempt); }

export interface DeadLetter<T> { readonly id: string; readonly orderId: string; readonly value: T; readonly reason: string; readonly failedAtMs: number; }
export class DeadLetterQueue<T> {
  private readonly items: DeadLetter<T>[] = [];
  public constructor(private readonly maximumItems = 256) {}
  public append(item: Omit<DeadLetter<T>, "id">): DeadLetter<T> { if (this.items.length >= this.maximumItems) throw new Error("DEAD_LETTER_QUEUE_FULL"); const value = Object.freeze({ ...item, id: randomUUID() }); this.items.push(value); return value; }
  public list(): readonly DeadLetter<T>[] { return Object.freeze([...this.items]); }
}

export interface CancelReplacePort<T> { cancel(orderId: string): Promise<"CANCELED" | "FILLED" | "UNKNOWN">; submit(value: T): Promise<{ readonly orderId: string }>; }
export class CancelReplaceManager<T> {
  public constructor(private readonly port: CancelReplacePort<T>) {}
  public async replace(orderId: string, replacement: T): Promise<Readonly<{ status: "REPLACED" | "FILLED" | "BLOCKED"; orderId?: string }>> {
    const canceled = await this.port.cancel(orderId);
    if (canceled === "UNKNOWN") return Object.freeze({ status: "BLOCKED" });
    if (canceled === "FILLED") return Object.freeze({ status: "FILLED" });
    const submitted = await this.port.submit(replacement);
    return Object.freeze({ status: "REPLACED", orderId: submitted.orderId });
  }
}

export interface SynchronizedOrderSnapshot { readonly sequence: number; readonly orderId: string; readonly state: OrderEngineState; readonly fills: readonly OrderEngineEvent[]; }
export class WebSocketOrderSynchronizer {
  private lastSequence = 0;
  public apply(snapshot: SynchronizedOrderSnapshot): "APPLIED" | "DUPLICATE" | "GAP" | "OUT_OF_ORDER" { if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1) throw new Error("INVALID_ORDER_SEQUENCE"); if (snapshot.sequence === this.lastSequence) return "DUPLICATE"; if (snapshot.sequence < this.lastSequence) return "OUT_OF_ORDER"; if (snapshot.sequence !== this.lastSequence + 1) return "GAP"; this.lastSequence = snapshot.sequence; return "APPLIED"; }
  public get sequence(): number { return this.lastSequence; }
}

export interface InventoryReservation { readonly orderId: string; readonly market: string; readonly quantity: string; }
export class InventoryReservationManager {
  private readonly reservations = new Map<string, InventoryReservation>();
  public reserve(reservation: InventoryReservation): void { if (this.reservations.has(reservation.orderId)) throw new Error("DUPLICATE_INVENTORY_RESERVATION"); decimal(reservation.quantity, "reservation quantity"); this.reservations.set(reservation.orderId, Object.freeze({ ...reservation })); }
  public release(orderId: string): void { this.reservations.delete(requireText(orderId, "orderId")); }
  public list(market?: string): readonly InventoryReservation[] { return Object.freeze([...this.reservations.values()].filter((item) => market === undefined || item.market === market)); }
}

export interface ExecutionAuditRecord { readonly sequence: number; readonly orderId: string; readonly event: string; readonly reason?: string; readonly occurredAtMs: number; readonly previousHash: string; readonly hash: string; }
export class ExecutionAudit {
  private readonly records: ExecutionAuditRecord[] = [];
  public append(input: Readonly<{ orderId: string; event: string; reason?: string; occurredAtMs: number }>): ExecutionAuditRecord { const previousHash = this.records.at(-1)?.hash ?? "0".repeat(64); const sequence = this.records.length + 1; const payload = JSON.stringify({ sequence, ...input, previousHash }); const hash = createHash("sha256").update(payload, "utf8").digest("hex"); const record = Object.freeze({ sequence, ...input, previousHash, hash }); this.records.push(record); return record; }
  public list(): readonly ExecutionAuditRecord[] { return Object.freeze([...this.records]); }
  public verify(): void { let previousHash = "0".repeat(64); for (let index = 0; index < this.records.length; index += 1) { const record = this.records[index]; const payload = JSON.stringify({ sequence: record.sequence, orderId: record.orderId, event: record.event, reason: record.reason, occurredAtMs: record.occurredAtMs, previousHash: record.previousHash }); const expected = createHash("sha256").update(payload, "utf8").digest("hex"); if (record.sequence !== index + 1 || record.previousHash !== previousHash || record.hash !== expected) throw new Error("EXECUTION_AUDIT_INTEGRITY_FAILURE"); previousHash = record.hash; } }
}

export interface ExecutionMetricsSnapshot { readonly submitted: number; readonly accepted: number; readonly rejected: number; readonly filled: number; readonly partialFills: number; readonly retries: number; readonly deadLetters: number; readonly queueHighWaterMark: number; readonly totalLatencyMs: number; }
export class ExecutionMetrics {
  private state: ExecutionMetricsSnapshot = Object.freeze({ submitted: 0, accepted: 0, rejected: 0, filled: 0, partialFills: 0, retries: 0, deadLetters: 0, queueHighWaterMark: 0, totalLatencyMs: 0 });
  public observe(event: keyof Pick<ExecutionMetricsSnapshot, "submitted" | "accepted" | "rejected" | "filled" | "partialFills" | "retries" | "deadLetters">, queueDepth = 0, latencyMs = 0): void { if (!Number.isSafeInteger(queueDepth) || queueDepth < 0 || !Number.isFinite(latencyMs) || latencyMs < 0) throw new Error("INVALID_EXECUTION_METRIC"); this.state = Object.freeze({ ...this.state, [event]: this.state[event] + 1, queueHighWaterMark: Math.max(this.state.queueHighWaterMark, queueDepth), totalLatencyMs: this.state.totalLatencyMs + latencyMs }); }
  public snapshot(): ExecutionMetricsSnapshot { return this.state; }
}
