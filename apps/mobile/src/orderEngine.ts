import type { OrderSide } from "./tradingService";

export type OrderState = "NEW" | "VALIDATING" | "ACCEPTED" | "FILLED" | "CANCELLED" | "REJECTED";

export interface OrderRequest {
  readonly market: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly nowMs: number;
}

export interface PaperOrder {
  readonly id: string;
  readonly market: string;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly price: number;
  readonly state: OrderState;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface Fill {
  readonly id: string;
  readonly orderId: string;
  readonly quantity: number;
  readonly price: number;
  readonly createdAtMs: number;
}

export interface ExecutionEngine {
  execute(order: PaperOrder): Promise<Fill>;
}

const text = (value: string, field: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
};

const positive = (value: number, field: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  return value;
};

const time = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("nowMs must be a non-negative safe integer");
  return value;
};

const transitions: Readonly<Record<OrderState, readonly OrderState[]>> = {
  NEW: ["VALIDATING", "CANCELLED"],
  VALIDATING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["FILLED", "CANCELLED", "REJECTED"],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
};

const transition = (order: PaperOrder, state: OrderState, nowMs: number): PaperOrder => {
  if (!transitions[order.state].includes(state)) throw new Error(`invalid order transition: ${order.state} -> ${state}`);
  return Object.freeze({ ...order, state, updatedAtMs: nowMs });
};

export class MockExecutionEngine implements ExecutionEngine {
  private nextFillId = 1;

  public async execute(order: PaperOrder): Promise<Fill> {
    if (order.state !== "ACCEPTED") throw new Error("only accepted orders can be executed");
    return Object.freeze({ id: `fill-${this.nextFillId++}`, orderId: order.id, quantity: order.quantity, price: order.price, createdAtMs: order.updatedAtMs });
  }
}

export class OrderEngine {
  private readonly orders = new Map<string, PaperOrder>();
  private readonly fills = new Map<string, Fill>();
  private nextOrderId = 1;

  public constructor(private readonly execution: ExecutionEngine = new MockExecutionEngine()) {}

  public async submit(request: OrderRequest): Promise<{ order: PaperOrder; fill: Fill }> {
    const nowMs = time(request.nowMs);
    const orderId = `paper-order-${this.nextOrderId++}`;
    let order: PaperOrder = Object.freeze({ id: orderId, market: text(request.market, "market"), side: request.side, quantity: request.quantity, price: request.price, state: "NEW" as const, createdAtMs: nowMs, updatedAtMs: nowMs });
    this.orders.set(order.id, order);
    order = transition(order, "VALIDATING", nowMs);
    this.orders.set(order.id, order);
    try {
      positive(order.quantity, "quantity");
      positive(order.price, "price");
      if (order.side !== "BUY" && order.side !== "SELL") throw new Error("side must be BUY or SELL");
      order = transition(order, "ACCEPTED", nowMs);
      this.orders.set(order.id, order);
      const fill = await this.execution.execute(order);
      if (fill.orderId !== order.id || fill.quantity !== order.quantity || fill.price !== order.price) throw new Error("execution result does not match order");
      this.fills.set(fill.id, Object.freeze({ ...fill }));
      order = transition(order, "FILLED", fill.createdAtMs);
      this.orders.set(order.id, order);
      return Object.freeze({ order, fill });
    } catch (error) {
      order = transition(order, "REJECTED", nowMs);
      this.orders.set(order.id, order);
      throw error;
    }
  }

  public cancel(orderId: string, nowMs: number): PaperOrder {
    const id = text(orderId, "orderId");
    const order = this.orders.get(id);
    if (!order) throw new Error("order not found");
    const cancelled = transition(order, "CANCELLED", time(nowMs));
    this.orders.set(id, cancelled);
    return cancelled;
  }

  public getOrder(orderId: string): PaperOrder | null { return this.orders.get(text(orderId, "orderId")) ?? null; }
  public getFill(fillId: string): Fill | null { return this.fills.get(text(fillId, "fillId")) ?? null; }
}
