export type ControlStatus = "STOPPED" | "RUNNING" | "PAUSED" | "FAULTED";
export type ControlEventType = "STATUS" | "SIGNAL" | "ORDER" | "RISK" | "SYSTEM";

export interface ControlEvent {
  id: string;
  type: ControlEventType;
  message: string;
  timestamp: string;
  data?: unknown;
}

export interface ControlSnapshot {
  status: ControlStatus;
  strategyId: string;
  autoTradeEnabled: boolean;
  orderQuantity: number;
  events: readonly ControlEvent[];
}

export class ControlPlane {
  private status: ControlStatus = "STOPPED";
  private autoTradeEnabled = false;
  private orderQuantity = 0.001;
  private readonly events: ControlEvent[] = [];

  constructor(private readonly strategyId = "sma-crossover", private readonly maxEvents = 200) {}

  start(): void { this.status = "RUNNING"; this.record("STATUS", "strategy started"); }
  stop(): void { this.status = "STOPPED"; this.autoTradeEnabled = false; this.record("STATUS", "strategy stopped"); }
  pause(): void { this.status = "PAUSED"; this.record("STATUS", "strategy paused"); }
  fault(message: string): void { this.status = "FAULTED"; this.autoTradeEnabled = false; this.record("SYSTEM", message); }

  setAutoTrade(enabled: boolean): void {
    if (enabled && this.status !== "RUNNING") throw new Error("strategy must be running before auto trading");
    this.autoTradeEnabled = enabled;
    this.record("STATUS", enabled ? "paper auto trading enabled" : "paper auto trading disabled");
  }

  setOrderQuantity(quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("order quantity must be positive");
    this.orderQuantity = quantity;
    this.record("STATUS", `order quantity set to ${quantity}`);
  }

  canAutoTrade(): boolean { return this.status === "RUNNING" && this.autoTradeEnabled; }
  getOrderQuantity(): number { return this.orderQuantity; }

  record(type: ControlEventType, message: string, data?: unknown): ControlEvent {
    const timestamp = new Date().toISOString();
    const event = Object.freeze({ id: `${Date.now()}-${this.events.length + 1}`, type, message, timestamp, data });
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;
    return event;
  }

  snapshot(): ControlSnapshot {
    return Object.freeze({
      status: this.status,
      strategyId: this.strategyId,
      autoTradeEnabled: this.autoTradeEnabled,
      orderQuantity: this.orderQuantity,
      events: Object.freeze([...this.events])
    });
  }
}
