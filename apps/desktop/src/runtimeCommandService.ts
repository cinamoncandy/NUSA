import { ControlPlane, type ControlPlaneRuntimeState } from "./controlPlane";
import { PaperBroker, type PaperOrder, type PaperSide } from "./paperBroker";
import { StrategyEngine, type StrategySignal } from "./strategyEngine";
import type { OperationalReadinessDecision } from "../../cloud/src/operationalReadinessGate";
import type { PaperScenarioEvidenceRecorder } from "./paperScenarioEvidenceRecorder";

export interface RuntimePersistence {
  save(paper: ReturnType<PaperBroker["exportState"]>, control: ReturnType<ControlPlane["exportState"]>): void;
  saveWithScenarioEvent?(paper: ReturnType<PaperBroker["exportState"]>, control: ReturnType<ControlPlane["exportState"]>, event: Parameters<PaperScenarioEvidenceRecorder["bind"]>[0] extends infer E ? E : never): void;
}

export type AutomaticResult = { outcome: "SKIPPED" | "DUPLICATE" | "FILLED" | "REJECTED"; order?: PaperOrder; error?: string };
export const PERSISTENCE_REPAIR_MESSAGE = "Paper trading is unavailable because local persistence requires operator repair.";
export const PERSISTENCE_FAULT_MESSAGE = "Local Paper Trading storage failed. Trading was stopped to protect account consistency. Restart after repairing or restoring the local database.";

interface RuntimeSnapshot {
  readonly paper: ReturnType<PaperBroker["exportState"]>;
  readonly control: ControlPlaneRuntimeState;
  readonly strategyRunning: boolean;
}

export class RuntimeCommandService {
  private available = true;

  constructor(
    private readonly broker: PaperBroker,
    private readonly control: ControlPlane,
    private readonly strategy: StrategyEngine,
    private readonly persistence: RuntimePersistence,
    private readonly readiness?: () => OperationalReadinessDecision,
    private readonly evidence?: PaperScenarioEvidenceRecorder
  ) {}

  isAvailable(): boolean { return this.available; }
  markUnavailable(): void { this.available = false; this.strategy.stop(); }

  manualOrder(side: PaperSide, quantity: number, price: number): PaperOrder {
    return this.commit("manual paper order", () => {
      const order = this.broker.execute(side, quantity, price);
      this.control.record("ORDER", `manual ${side} filled`, order);
      return order;
    }, (order) => this.evidence?.bind({ eventId: order.id, type: "ORDER_COMPLETED", occurredAt: Date.parse(order.filledAt) }));
  }

  start(): void { this.commit("control start", () => { this.strategy.start(); this.control.start(); }); }
  stop(): void { this.commit("control stop", () => { this.strategy.stop(); this.control.stop(); }); }
  setAutoTrade(enabled: boolean): void { this.commit("control auto", () => this.control.setAutoTrade(enabled)); }
  setOrderQuantity(quantity: number): void { this.commit("control quantity", () => this.control.setOrderQuantity(quantity)); }

  automaticSignal(market: string, price: number, positionQuantity: number, signal: StrategySignal): AutomaticResult {
    if (!this.available) return { outcome: "SKIPPED" };
    const snapshot = this.capture();
    try {
      this.control.record("SIGNAL", `${signal.type}: ${signal.reason}`, signal);
      if (!this.control.canAutoTrade() || signal.type === "HOLD") { this.persist(); return { outcome: "SKIPPED" }; }
      const readiness = this.readiness?.();
      if (readiness && (readiness.action === "HALT" || (signal.type === "BUY" && readiness.action !== "ALLOW_NEW_ENTRIES"))) {
        const message = `operational readiness blocked ${signal.type}: ${readiness.reasons.join(",")}`;
        this.control.record("RISK", message, readiness);
        this.persist();
        return { outcome: "REJECTED", error: message };
      }
      const key = `${market}:${signal.timestamp}:${signal.type}`;
      if (!this.control.claimAutomaticSignal(key)) return { outcome: "DUPLICATE" };
      if (signal.type === "SELL" && positionQuantity <= 0) {
        this.control.record("RISK", "insufficient paper position");
        this.persist();
        return { outcome: "REJECTED", error: "insufficient paper position" };
      }
      const quantity = signal.type === "SELL" ? Math.min(positionQuantity, this.control.getOrderQuantity()) : this.control.getOrderQuantity();
      let order: PaperOrder;
      try { order = this.broker.execute(signal.type, quantity, price); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.control.record("RISK", message);
        this.persist();
        return { outcome: "REJECTED", error: message };
      }
      this.control.record("ORDER", `automatic ${signal.type} filled`, order);
      this.persist();
      return { outcome: "FILLED", order };
    } catch (error) {
      this.restore(snapshot);
      this.failClosed();
      return { outcome: "REJECTED", error: PERSISTENCE_REPAIR_MESSAGE };
    }
  }

  private commit<T>(_name: string, mutation: () => T, evidenceFactory?: (result: T) => ReturnType<PaperScenarioEvidenceRecorder["bind"]> | undefined): T {
    if (!this.available) throw new Error(PERSISTENCE_REPAIR_MESSAGE);
    const snapshot = this.capture();
    let result: T;
    try { result = mutation(); }
    catch (error) {
      this.restore(snapshot);
      throw error;
    }
    try { this.persist(evidenceFactory?.(result)); return result; }
    catch (error) {
      this.restore(snapshot);
      this.failClosed();
      throw new Error(PERSISTENCE_REPAIR_MESSAGE, { cause: error });
    }
  }

  private capture(): RuntimeSnapshot {
    return { paper: this.broker.exportState(), control: this.control.exportRuntimeState(), strategyRunning: this.strategy.isRunning() };
  }
  private restore(snapshot: RuntimeSnapshot): void {
    this.broker.restoreState(snapshot.paper);
    this.control.restoreRuntimeState(snapshot.control);
    this.strategy.restoreRunning(snapshot.strategyRunning);
  }
  private persist(event?: ReturnType<PaperScenarioEvidenceRecorder["bind"]>): void {
    if (event && this.persistence.saveWithScenarioEvent) this.persistence.saveWithScenarioEvent(this.broker.exportState(), this.control.exportState(), event);
    else this.persistence.save(this.broker.exportState(), this.control.exportState());
  }
  private failClosed(): void {
    this.available = false;
    this.strategy.stop();
    this.control.fault(PERSISTENCE_FAULT_MESSAGE);
  }
}
