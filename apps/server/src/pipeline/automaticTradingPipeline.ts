import { ControlPlane, type ControlPlaneRuntimeState } from "../../../desktop/src/controlPlane";
import { PaperBroker, type PaperBrokerState, type PaperOrder } from "../../../desktop/src/paperBroker";
import { StrategyEngine } from "../../../desktop/src/strategyEngine";
import { OrderPlanner } from "./orderPlanner";
import { RiskEngine } from "./riskEngine";
import { PaperExecutor } from "./paperExecutor";
import type { TradingIntent } from "./tradingIntent";

export interface AutomaticTradingResult {
  readonly outcome: "SKIPPED" | "REJECTED" | "DUPLICATE" | "FILLED";
  readonly order?: PaperOrder;
  readonly reason?: string;
}

interface RuntimeSnapshot {
  readonly paper: PaperBrokerState;
  readonly control: ControlPlaneRuntimeState;
  readonly strategyRunning: boolean;
}

/**
 * Composes the automatic (candle-driven) trading path exactly as:
 *   TradingIntent -> RiskEngine -> OrderPlanner -> PaperExecutor -> Position/Portfolio
 * with the same atomic snapshot/rollback/fail-closed shell already proven in
 * apps/desktop/src/runtimeCommandService.ts's commit()/automaticSignal() -- reimplemented
 * here (not imported) so this pipeline can pass OrderPlanner's planned quantity through to
 * PaperExecutor, which RuntimeCommandService's own automaticSignal() does not expose a way
 * to do. Manual orders are unaffected: they still go through RuntimeCommandService.manualOrder(),
 * unchanged.
 */
export class AutomaticTradingPipeline {
  constructor(
    private readonly broker: PaperBroker,
    private readonly control: ControlPlane,
    private readonly strategyEngine: StrategyEngine,
    private readonly riskEngine: RiskEngine,
    private readonly orderPlanner: OrderPlanner,
    private readonly executor: PaperExecutor,
    private readonly persist: (paper: PaperBrokerState, control: ReturnType<ControlPlane["exportState"]>) => void,
    private readonly onPersistenceFailure: () => void
  ) {}

  process(intent: TradingIntent, market: string, price: number, equity: number): AutomaticTradingResult {
    const snapshot = this.capture();
    try {
      this.control.record("SIGNAL", `${intent.type}: ${intent.reason}`, intent);
      const positionQuantity = this.broker.snapshot(price).position.quantity;
      const decision = this.riskEngine.evaluate(intent, { autoTradeAllowed: this.control.canAutoTrade(), positionQuantity });
      if (!decision.approved) {
        this.persistNow();
        return { outcome: decision.reason === "HOLD" ? "SKIPPED" : "REJECTED", ...(decision.reason && decision.reason !== "HOLD" ? { reason: decision.reason } : {}) };
      }

      const key = `${market}:${intent.timestamp}:${intent.type}`;
      if (!this.control.claimAutomaticSignal(key)) {
        this.persistNow();
        return { outcome: "DUPLICATE" };
      }

      const plan = this.orderPlanner.plan(intent, { equity, price, positionQuantity, fixedOrderQuantity: this.control.getOrderQuantity() });
      if (!plan) {
        this.persistNow();
        return { outcome: "SKIPPED" };
      }

      let order: PaperOrder;
      try {
        order = this.executor.execute(plan, price);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.control.record("RISK", message);
        this.persistNow();
        return { outcome: "REJECTED", reason: message };
      }
      this.control.record("ORDER", `automatic ${plan.side} filled`, order);
      this.persistNow();
      return { outcome: "FILLED", order };
    } catch {
      this.restore(snapshot);
      this.onPersistenceFailure();
      return { outcome: "REJECTED", reason: "persistence failure" };
    }
  }

  private persistNow(): void { this.persist(this.broker.exportState(), this.control.exportState()); }

  private capture(): RuntimeSnapshot {
    return { paper: this.broker.exportState(), control: this.control.exportRuntimeState(), strategyRunning: this.strategyEngine.isRunning() };
  }

  private restore(snapshot: RuntimeSnapshot): void {
    this.broker.restoreState(snapshot.paper);
    this.control.restoreRuntimeState(snapshot.control);
    this.strategyEngine.restoreRunning(snapshot.strategyRunning);
  }
}
