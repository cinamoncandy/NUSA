import { randomUUID } from "node:crypto";
import { ControlPlane, type ControlPlaneRuntimeState } from "./controlPlane";
import { PaperBroker, type PaperOrder, type PaperSide } from "../paper/paperBroker";
import { StrategyEngine, type StrategySignal } from "../strategy/strategyEngine";
import type { OperationalReadinessDecision } from "../../../cloud/src/operationalReadinessGate";
import type { PaperScenarioEvidenceRecorder } from "../paper/paperScenarioEvidenceRecorder";
import { evaluateStrategyRegime } from "../strategy/regimePolicy";
import {
  createAutomaticExecutionBlockedDiagnostic,
  createPaperTradingDisabledDiagnostic,
  createPersistenceMutationFailedDiagnostic,
  createPersistenceRollbackCompletedDiagnostic,
  createPersistenceRollbackFailedDiagnostic,
  type RuntimeMutationDiagnostic
} from "../risk/runtimeMutationDiagnostics";

type ScenarioEvent = ReturnType<PaperScenarioEvidenceRecorder["bind"]>;

export interface RuntimePersistence {
  save(paper: ReturnType<PaperBroker["exportState"]>, control: ReturnType<ControlPlane["exportState"]>): void;
  saveWithScenarioEvent?(paper: ReturnType<PaperBroker["exportState"]>, control: ReturnType<ControlPlane["exportState"]>, event: ScenarioEvent): void;
  saveWithScenarioEvents?(paper: ReturnType<PaperBroker["exportState"]>, control: ReturnType<ControlPlane["exportState"]>, events: readonly ScenarioEvent[]): void;
}
export interface PaperCommandRiskGate {
  evaluate(command: Readonly<{
    path: "MANUAL" | "STRATEGY" | "IPC" | "RECONNECT_REPLAY" | "SHADOW";
    side: PaperSide;
    quantity: number;
    price: number;
    accountId?: string;
    strategyId?: string;
    approvalId?: string;
    commandId?: string;
    signalId?: string;
    clientOrderId?: string;
    nowMs?: number;
  }>): Readonly<{ status: "ALLOW" | "REJECT" | "HALT"; reasonCodes: readonly string[] }>;
  recordOrder?(order: Readonly<{ orderId: string; status: "OPEN" | "PENDING" | "FILLED" | "CANCELLED" | "REJECTED"; nowMs?: number }>): void;
}

export type AutomaticResult = { outcome: "SKIPPED" | "DUPLICATE" | "FILLED" | "REJECTED"; order?: PaperOrder; error?: string };
export const PERSISTENCE_RECOVERY_STEPS = Object.freeze([
  "Stop the application and preserve the failed database file unchanged.",
  "Restore a known-good backup to the original database location while the application is stopped.",
  "Restart and verify startup integrity checks pass; Paper automatic trading remains OFF.",
  "Review account, order, control, and audit state before manually resuming Paper operation."
] as const);
export const PERSISTENCE_REPAIR_MESSAGE = "Paper trading is unavailable. Stop the application, preserve the failed database, restore a verified backup, then restart and review state before manually resuming.";
export const PERSISTENCE_FAULT_MESSAGE = "Local Paper Trading storage failed. Trading was stopped to protect account consistency. Stop the application, preserve the failed database, restore a verified backup, then restart and review state before manually resuming.";

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
    private readonly riskGate: PaperCommandRiskGate,
    private readonly readiness?: () => OperationalReadinessDecision,
    private readonly evidence?: PaperScenarioEvidenceRecorder,
    private readonly onDiagnostic?: (diagnostic: RuntimeMutationDiagnostic) => void
  ) {}
  private requireRiskApproval(path: "MANUAL" | "STRATEGY" | "IPC" | "RECONNECT_REPLAY", side: PaperSide, quantity: number, price: number, metadata: Readonly<Partial<{ accountId: string; strategyId: string; approvalId: string; commandId: string; signalId: string; clientOrderId: string; nowMs: number }>> = {}): void {
    const decision = this.riskGate.evaluate(Object.freeze({ path, side, quantity, price, ...metadata }));
    if (decision.status !== "ALLOW") throw new Error(`paper risk ${decision.status}: ${decision.reasonCodes.join(",")}`);
  }

  /** Diagnostics must never affect the trading-safety path, so a broken callback is swallowed here. */
  private emit(diagnostic: RuntimeMutationDiagnostic): void {
    try { this.onDiagnostic?.(diagnostic); } catch { /* diagnostics are best-effort only */ }
  }

  isAvailable(): boolean { return this.available; }
  markUnavailable(): void { this.available = false; this.strategy.stop(); }

  manualOrder(side: PaperSide, quantity: number, price: number, metadata: Readonly<Partial<{ accountId: string; approvalId: string; commandId: string; signalId: string; clientOrderId: string; nowMs: number }>> = {}): PaperOrder {
    return this.commit("manual paper order", () => {
      this.requireRiskApproval("MANUAL", side, quantity, price, metadata);
      const order = this.broker.execute(side, quantity, price);
      this.riskGate.recordOrder?.({ orderId: order.id, status: "FILLED", nowMs: metadata.nowMs });
      this.control.record("ORDER", `manual ${side} filled`, order);
      return order;
    }, (order) => this.evidence?.bind({ eventId: order.id, type: "ORDER_COMPLETED", occurredAt: Date.parse(order.filledAt) }));
  }

  replayOrder(side: PaperSide, quantity: number, price: number, metadata: Readonly<Partial<{ accountId: string; approvalId: string; commandId: string; signalId: string; clientOrderId: string; nowMs: number }>> = {}): PaperOrder {
    return this.commit("reconnect paper order replay", () => {
      this.requireRiskApproval("RECONNECT_REPLAY", side, quantity, price, metadata);
      const order = this.broker.execute(side, quantity, price);
      this.riskGate.recordOrder?.({ orderId: order.id, status: "FILLED", nowMs: metadata.nowMs });
      this.control.record("ORDER", `reconnect replay ${side} filled`, order);
      return order;
    }, (order) => this.evidence?.bind({ eventId: order.id, type: "ORDER_COMPLETED", occurredAt: Date.parse(order.filledAt) }));
  }

  start(): void { this.commit("control start", () => { this.strategy.start(); this.control.start(); }); }
  stop(): void {
    this.commit("control stop", () => {
      this.strategy.stop();
      this.control.stop();
      const snapshot = this.control.snapshot();
      if (this.strategy.isRunning() || snapshot.status !== "STOPPED" || snapshot.autoTradeEnabled) throw new Error("kill switch did not reach a safe stopped state");
    }, () => this.evidence?.bind({
      eventId: `fault-kill-switch-${randomUUID()}`,
      type: "FAULT_SCENARIO_PASSED",
      occurredAt: Date.now(),
      scenario: "KILL_SWITCH"
    }));
  }
  setAutoTrade(enabled: boolean): void { this.commit("control auto", () => this.control.setAutoTrade(enabled)); }
  setOrderQuantity(quantity: number): void { this.commit("control quantity", () => this.control.setOrderQuantity(quantity)); }

  automaticSignal(market: string, price: number, positionQuantity: number, signal: StrategySignal, metadata: Readonly<Partial<{ accountId: string; approvalId: string }>> = {}): AutomaticResult {
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
      if (!this.control.claimAutomaticSignal(key)) {
        const suffix = randomUUID();
        const duplicateEvidence = this.evidence ? [
          this.evidence.bind({ eventId: `duplicate-${suffix}`, type: "DUPLICATE_ORDER_CHECKED", occurredAt: signal.timestamp }),
          this.evidence.bind({ eventId: `fault-duplicate-signal-${suffix}`, type: "FAULT_SCENARIO_PASSED", occurredAt: signal.timestamp, scenario: "DUPLICATE_SIGNAL" })
        ] : undefined;
        this.persist(duplicateEvidence);
        return { outcome: "DUPLICATE" };
      }
      if (signal.type === "SELL" && positionQuantity <= 0) {
        this.control.record("RISK", "insufficient paper position");
        this.persist();
        return { outcome: "REJECTED", error: "insufficient paper position" };
      }
      const regimeDecision = signal.regime === undefined ? undefined : evaluateStrategyRegime(this.strategy.getStrategyId(), signal.regime);
      if (signal.type === "BUY" && regimeDecision && !regimeDecision.allowNewExposure) {
        const message = `${regimeDecision.reason}:${regimeDecision.regime}`;
        this.control.record("RISK", message, regimeDecision);
        this.persist();
        return { outcome: "REJECTED", error: message };
      }
      const baseQuantity = signal.type === "SELL" ? Math.min(positionQuantity, this.control.getOrderQuantity()) : this.control.getOrderQuantity();
      const quantity = signal.type === "SELL" || regimeDecision === undefined
        ? baseQuantity
        : baseQuantity * regimeDecision.risk.positionSizeMultiplier;
      if (quantity <= 0) {
        const message = "regime risk profile reduced order quantity to zero";
        this.control.record("RISK", message, regimeDecision);
        this.persist();
        return { outcome: "REJECTED", error: message };
      }
      let order: PaperOrder;
      const signalId = `${market}:${signal.timestamp}:${signal.type}`;
      const commandId = `strategy:${signalId}`;
      const clientOrderId = `paper:${commandId}`;
      try { this.requireRiskApproval("STRATEGY", signal.type, quantity, price, { ...metadata, strategyId: this.strategy.getStrategyId(), signalId, commandId, clientOrderId, nowMs: signal.timestamp }); order = this.broker.execute(signal.type, quantity, price, new Date(), { strategyId: this.strategy.getStrategyId() }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.control.record("RISK", message);
        this.persist();
        return { outcome: "REJECTED", error: message };
      }
      this.riskGate.recordOrder?.({ orderId: order.id, status: "FILLED", nowMs: signal.timestamp });
      this.control.record("ORDER", `automatic ${signal.type} filled`, order);
      const orderEvidence = this.evidence?.bind({ eventId: order.id, type: "ORDER_COMPLETED", occurredAt: Date.parse(order.filledAt) });
      this.persist(orderEvidence);
      return { outcome: "FILLED", order };
    } catch (error) {
      this.emit(createPersistenceMutationFailedDiagnostic({ mutationName: "automatic signal" }));
      this.restoreAfterFailure(snapshot, "automatic signal");
      this.failClosed("automatic signal");
      this.emit(createAutomaticExecutionBlockedDiagnostic());
      return { outcome: "REJECTED", error: PERSISTENCE_REPAIR_MESSAGE };
    }
  }

  private commit<T>(name: string, mutation: () => T, evidenceFactory?: (result: T) => ScenarioEvent | readonly ScenarioEvent[] | undefined): T {
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
      this.emit(createPersistenceMutationFailedDiagnostic({ mutationName: name }));
      this.restoreAfterFailure(snapshot, name);
      this.failClosed(name);
      throw new Error(PERSISTENCE_REPAIR_MESSAGE, { cause: error });
    }
  }

  /**
   * Restoring after a persistence failure is itself not guaranteed to succeed (in
   * principle the snapshot being restored was valid when captured, but this must never
   * be assumed). Whether restore() succeeds or throws, the caller always proceeds to
   * failClosed() -- a restore failure must never leave `available` stuck true.
   */
  private restoreAfterFailure(snapshot: RuntimeSnapshot, mutationName: string): void {
    try {
      this.restore(snapshot);
      this.emit(createPersistenceRollbackCompletedDiagnostic({ mutationName }));
    } catch (restoreError) {
      this.emit(createPersistenceRollbackFailedDiagnostic({
        mutationName,
        restoreErrorMessage: restoreError instanceof Error ? restoreError.message : String(restoreError)
      }));
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
  private persist(evidence?: ScenarioEvent | readonly ScenarioEvent[]): void {
    const events = evidence == null ? [] : Array.isArray(evidence) ? evidence : [evidence];
    if (events.length > 1) {
      if (!this.persistence.saveWithScenarioEvents) throw new Error("atomic multi-event scenario persistence is unavailable");
      this.persistence.saveWithScenarioEvents(this.broker.exportState(), this.control.exportState(), events);
    } else if (events.length === 1 && this.persistence.saveWithScenarioEvent) {
      this.persistence.saveWithScenarioEvent(this.broker.exportState(), this.control.exportState(), events[0]!);
    } else {
      this.persistence.save(this.broker.exportState(), this.control.exportState());
    }
  }
  private failClosed(mutationName: string): void {
    this.available = false;
    this.strategy.stop();
    this.control.fault(PERSISTENCE_FAULT_MESSAGE);
    this.emit(createPaperTradingDisabledDiagnostic({ mutationName, controlStatus: this.control.snapshot().status }));
  }
}
