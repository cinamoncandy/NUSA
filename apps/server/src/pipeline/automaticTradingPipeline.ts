import { ControlPlane, type ControlPlaneRuntimeState } from "../../../desktop/src/controlPlane";
import { PaperBroker, type PaperBrokerState, type PaperOrder } from "../../../desktop/src/paperBroker";
import { StrategyEngine } from "../../../desktop/src/strategyEngine";
import {
  DefaultRiskEngine as ValueRiskEngine,
  type RiskPolicy as ValueRiskPolicy
} from "../../../../packages/core/src/risk/riskEngine";
import {
  DefaultOrderPlanner as ValueOrderPlanner,
  type ExecutionPolicy
} from "../../../../packages/core/src/order/orderPlanner";
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
 *   TradingIntent -> RiskEngine -> OrderPlanner -> RiskEngine (value-based) -> PaperExecutor
 *   -> Position/Portfolio
 * with the same atomic snapshot/rollback/fail-closed shell already proven in
 * apps/desktop/src/runtimeCommandService.ts's commit()/automaticSignal() -- reimplemented
 * here (not imported) so this pipeline can pass OrderPlanner's planned quantity through to
 * PaperExecutor, which RuntimeCommandService's own automaticSignal() does not expose a way
 * to do. Manual orders are unaffected: they still go through RuntimeCommandService.manualOrder(),
 * unchanged.
 *
 * Two RiskEngines run at two different points, deliberately: the state-based one
 * (./riskEngine.ts) gates the raw TradingIntent before any quantity is known (auto-trade
 * enabled? HOLD? open position to sell?); the value-based one
 * (packages/core/src/risk/riskEngine.ts, E02-T002) runs once OrderPlanner has produced a
 * concrete quantity, checking it against the same notional/position limits PaperBroker
 * itself enforces (RISK_POLICY.minOrderNotional/maxPositionQuantity in
 * apps/server/src/paperRuntime.ts) -- so this is an earlier, additional check using
 * already-agreed limits, not a new invented threshold, and PaperBroker's own checks remain
 * the final word regardless.
 *
 * The value-based OrderPlanner (packages/core/src/order/orderPlanner.ts, E02-T003) runs
 * right after that, once the value RiskDecision it requires exists: it computes a formal
 * PlannedOrder (executionPrice/orderValue/estimatedFee/estimatedSlippage) from the same
 * ExecutionPolicy the dashboard already reports (apps/server/src/paperRuntime.ts's
 * executionCostBps), and that PlannedOrder is recorded for audit purposes only -- the
 * actual fill still comes from PaperBroker's own, more detailed fill model (spread +
 * slippage + order-size market impact) inside PaperExecutor, so this never changes what
 * price an order actually fills at, only what gets recorded as the pre-trade estimate. A
 * FAILED PlannerResult (e.g. an edge-case slippageRate driving executionPrice to zero)
 * still rejects the trade, since a plan this pipeline cannot even describe should not be
 * executed.
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
    private readonly onPersistenceFailure: () => void,
    /** Optional: when both are provided, every planned order also passes through the
     * value-based RiskEngine before execution. Omitting them skips that extra check
     * entirely (never a silent "always allow" default), matching this constructor's own
     * existing tests that don't need to care about it. */
    private readonly valueRiskEngine?: ValueRiskEngine,
    private readonly policyFor?: (price: number) => ValueRiskPolicy,
    /** Optional, same opt-in shape as valueRiskEngine/policyFor above: when both are
     * provided, every value-risk-approved plan is also run through the value-based
     * OrderPlanner and the resulting PlannedOrder is recorded (audit-only, does not affect
     * the actual fill -- see class doc comment). */
    private readonly valueOrderPlanner?: ValueOrderPlanner,
    private readonly executionPolicy?: ExecutionPolicy
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

      if (this.valueRiskEngine && this.policyFor) {
        const availableQuoteBalance = this.broker.snapshot(price).cash;
        const currentPositionValue = positionQuantity * price;
        const valueDecision = this.valueRiskEngine.evaluate(
          plan,
          { marketPrice: price, availableQuoteBalance, currentPositionValue },
          this.policyFor(price)
        );
        if (valueDecision.outcome === "BLOCK") {
          this.control.record("RISK", `${valueDecision.code}: ${valueDecision.reason}`);
          this.persistNow();
          return { outcome: "REJECTED", reason: valueDecision.reason };
        }

        if (this.valueOrderPlanner && this.executionPolicy) {
          const plannerResult = this.valueOrderPlanner.plan(plan, valueDecision, price, this.executionPolicy);
          if (plannerResult.status === "FAILED") {
            this.control.record("RISK", `${plannerResult.code}: ${plannerResult.reason}`);
            this.persistNow();
            return { outcome: "REJECTED", reason: plannerResult.reason };
          }
          this.control.record("SYSTEM", "planned order computed", plannerResult.order);
        }
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
