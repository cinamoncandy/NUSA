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
import { filledExecutionReport, rejectedExecutionReport, type ExecutionReport } from "../../../../packages/core/src/execution/executionReport";
import type { Portfolio, PortfolioLedger } from "../../../../packages/core/src/portfolio/portfolio";
import type { PnLCalculator } from "../../../../packages/core/src/pnl/pnl";
import { reconcileReferenceAccounting } from "../referenceReconciliation";
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
 * Optional, audit-only parallel bookkeeping via packages/core's Portfolio/PnL modules
 * (E02-T006/T007). getPortfolio/setPortfolio let the caller (PaperRuntime) own where this
 * reference state actually lives; this pipeline never reads it back to make a decision --
 * it only feeds ExecutionReports in and records the resulting Portfolio/PnL for audit.
 */
export interface ReferenceAccounting {
  readonly ledger: PortfolioLedger;
  readonly pnlCalculator: PnLCalculator;
  readonly getPortfolio: () => Portfolio;
  readonly setPortfolio: (portfolio: Portfolio) => void;
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
 *
 * Finally, whatever PaperExecutor actually does (fill or throw) is recorded as a formal
 * ExecutionReport (packages/core/src/execution/executionReport.ts, E02-T005) -- a
 * FilledExecutionReport built from the real order PaperBroker returned, or a
 * RejectedExecutionReport built from the thrown error. Audit-only, same as the
 * value-based OrderPlanner's PlannedOrder above: it does not change the FILLED/REJECTED
 * outcome already decided by PaperExecutor's own result.
 *
 * If referenceAccounting is supplied, that same ExecutionReport is also folded into a
 * parallel Portfolio via packages/core/src/portfolio/portfolio.ts's PortfolioLedger
 * (E02-T006), and the resulting Portfolio/PnL (packages/core/src/pnl/pnl.ts, E02-T007) is
 * recorded too. This reference Portfolio is a formally testable reimplementation of
 * PaperBroker's own bookkeeping arithmetic for audit/cross-check purposes -- PaperBroker
 * (via broker.exportState()/persist()) remains the single source of truth for the real
 * account; the reference Portfolio is never read back into this pipeline's own decisions.
 * Every fold also reconciles the resulting reference Portfolio against PaperBroker's real
 * account (referenceReconciliation.ts); a detected divergence is recorded as a RISK event
 * for the operator to notice, but is never auto-corrected and never changes the real outcome.
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
    private readonly executionPolicy?: ExecutionPolicy,
    /** Optional (E02-T006/T007): when provided, every ExecutionReport is also folded into
     * a parallel reference Portfolio/PnL, recorded for audit -- never used to decide the
     * real outcome, which PaperBroker (via PaperExecutor) already fully determined. */
    private readonly referenceAccounting?: ReferenceAccounting
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
        this.recordExecutionReport(rejectedExecutionReport(message), price);
        this.persistNow();
        return { outcome: "REJECTED", reason: message };
      }
      this.control.record("ORDER", `automatic ${plan.side} filled`, order);
      this.recordExecutionReport(filledExecutionReport({
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        fee: order.fee,
        symbol: market
      }), price);
      this.persistNow();
      return { outcome: "FILLED", order };
    } catch {
      this.restore(snapshot);
      this.onPersistenceFailure();
      return { outcome: "REJECTED", reason: "persistence failure" };
    }
  }

  private recordExecutionReport(report: ExecutionReport, price: number): void {
    this.control.record("SYSTEM", "execution report", report);
    if (!this.referenceAccounting) return;
    const updateResult = this.referenceAccounting.ledger.apply(this.referenceAccounting.getPortfolio(), report);
    if (updateResult.status !== "UPDATED") return;
    this.referenceAccounting.setPortfolio(updateResult.portfolio);
    const pnlResult = this.referenceAccounting.pnlCalculator.calculate(updateResult.portfolio, price);
    if (pnlResult.status === "CALCULATED") {
      this.control.record("SYSTEM", "reference portfolio", { portfolio: updateResult.portfolio, pnl: pnlResult.pnl });
    }
    const reconciliation = reconcileReferenceAccounting(this.broker.snapshot(price), updateResult.portfolio);
    if (!reconciliation.consistent) {
      this.control.record("RISK", `reference accounting diverged from the real account: ${reconciliation.discrepancies.join(", ")}`);
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
