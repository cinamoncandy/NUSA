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

export interface ControlPlaneState {
  version: 1;
  status: ControlStatus;
  strategyId: string;
  orderQuantity: number;
  events: readonly ControlEvent[];
  processedSignalKeys: readonly string[];
}

export interface ControlPlaneRuntimeState {
  readonly persisted: ControlPlaneState;
  readonly autoTradeEnabled: boolean;
}

export class ControlPlane {
  private status: ControlStatus = "STOPPED";
  private autoTradeEnabled = false;
  private orderQuantity = 0.001;
  private readonly events: ControlEvent[] = [];
  private readonly processedSignalKeys: string[] = [];

  constructor(private readonly strategyId = "sma-crossover", private readonly maxEvents = 200, restoredState?: ControlPlaneState) {
    if (!restoredState) return;
    if (restoredState.version !== 1 || restoredState.strategyId !== strategyId) throw new Error("invalid control plane state");
    if (!Number.isFinite(restoredState.orderQuantity) || restoredState.orderQuantity <= 0) throw new Error("invalid control order quantity");
    this.status = restoredState.status;
    this.orderQuantity = restoredState.orderQuantity;
    this.events.push(...restoredState.events.slice(0, maxEvents));
    this.processedSignalKeys.push(...restoredState.processedSignalKeys.slice(0, maxEvents));
    this.autoTradeEnabled = false;
    this.record("SYSTEM", "control state restored; paper auto trading remains disabled");
  }

  start(): void {
    if (this.status === "FAULTED") throw new Error("faulted control plane requires operator repair before restart");
    this.status = "RUNNING";
    this.record("STATUS", "strategy started");
  }
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

  claimAutomaticSignal(key: string): boolean {
    if (!key) throw new Error("automatic signal key is required");
    if (this.processedSignalKeys.includes(key)) return false;
    this.processedSignalKeys.unshift(key);
    if (this.processedSignalKeys.length > this.maxEvents) this.processedSignalKeys.length = this.maxEvents;
    return true;
  }

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

  exportState(): ControlPlaneState {
    return Object.freeze({
      version: 1 as const,
      status: this.status,
      strategyId: this.strategyId,
      orderQuantity: this.orderQuantity,
      events: Object.freeze([...this.events]),
      processedSignalKeys: Object.freeze([...this.processedSignalKeys])
    });
  }

  exportRuntimeState(): ControlPlaneRuntimeState {
    return Object.freeze({ persisted: this.exportState(), autoTradeEnabled: this.autoTradeEnabled });
  }

  restoreRuntimeState(state: ControlPlaneRuntimeState): void {
    if (state.persisted.version !== 1 || state.persisted.strategyId !== this.strategyId) throw new Error("invalid control plane state");
    if (!Number.isFinite(state.persisted.orderQuantity) || state.persisted.orderQuantity <= 0) throw new Error("invalid control order quantity");
    this.status = state.persisted.status;
    this.orderQuantity = state.persisted.orderQuantity;
    this.events.splice(0, this.events.length, ...state.persisted.events.slice(0, this.maxEvents));
    this.processedSignalKeys.splice(0, this.processedSignalKeys.length, ...state.persisted.processedSignalKeys.slice(0, this.maxEvents));
    this.autoTradeEnabled = state.autoTradeEnabled;
  }
}

