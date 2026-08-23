import type { PersonalPaperOrderCommand } from "../../../packages/contracts/src/personalPaperOrderCommand";
import type { MobileDashboardApiInput } from "./mobileDashboardApi";
import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick,
  type PaperManualOrderContext
} from "./paperTradingExecutionLoop";
import type { CloudPaperRiskGate, CloudPaperRiskRequest } from "./cloudPaperCanonicalRiskGateway";

export interface CloudPaperExecutionBoundaryOptions {
  readonly loop: PaperTradingExecutionLoop;
  readonly riskGate: CloudPaperRiskGate;
  readonly readP0State: () => Readonly<{ openP0: boolean }>;
  readonly maximumMarketAgeMs?: number;
}

export type PaperManualOrderAllocationContext = PaperManualOrderContext & { readonly investmentPercent?: number };

const normalizedHealth = (value: MobileDashboardApiInput["overallHealth"]): CloudPaperRiskRequest["overallHealth"] => value === "HEALTHY" ? "HEALTHY" : "DEGRADED";

/**
 * The only production Cloud PAPER mutation boundary.
 * The underlying execution loop keeps its existing deterministic simulator semantics, but its
 * mutation methods are never invoked here until the canonical risk adapter returns ALLOW.
 */
export class CloudPaperExecutionBoundary {
  private readonly maximumMarketAgeMs: number;

  public constructor(private readonly options: CloudPaperExecutionBoundaryOptions) {
    this.maximumMarketAgeMs = options.maximumMarketAgeMs ?? 30_000;
    if (!Number.isSafeInteger(this.maximumMarketAgeMs) || this.maximumMarketAgeMs < 1_000) throw new Error("cloud PAPER maximum market age is invalid");
  }

  public submitManualOrder(approvedBy: string, command: PersonalPaperOrderCommand, context: PaperManualOrderAllocationContext): PaperExecutionResult {
    const state = this.options.loop.snapshot();
    if (!command.idempotencyKey.trim() || command.authority !== "PAPER_ONLY" || command.productionMutationAllowed !== false || !command.market.trim() || !Number.isFinite(command.quantity) || command.quantity <= 0) {
      return this.options.loop.submitManualOrder(command, context);
    }

    // Preserve the simulator's existing duplicate/conflict semantics without claiming a second
    // canonical idempotency record for a command the PAPER account has already resolved.
    if (state.orders.some((order) => order.idempotencyKey === command.idempotencyKey) || state.processedIdempotencyKeys.includes(command.idempotencyKey)) {
      return this.options.loop.submitManualOrder(command, context);
    }

    if (command.orderType === "LIMIT") {
      const limit = command.limitPrice;
      if (!Number.isFinite(limit) || (limit ?? 0) <= 0) return this.options.loop.submitManualOrder(command, context);
      const marketable = command.side === "BUY" ? context.marketPrice <= limit! : context.marketPrice >= limit!;
      if (!marketable) return this.options.loop.submitManualOrder(command, context);
    }

    if (command.side === "BUY") {
      const investmentPercent = context.investmentPercent ?? 100;
      if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) return this.blocked("INVALID_INVESTMENT_ALLOCATION");
      // Conservative 0.1% fee buffer keeps the protected cash envelope intact even though the
      // simulator's production fee is currently lower. SELL/exit paths are intentionally unaffected.
      const requiredCash = command.quantity * context.marketPrice * 1.001;
      const investableCash = state.cash * (investmentPercent / 100);
      if (!Number.isFinite(requiredCash) || requiredCash > investableCash + 1e-8) return this.blocked("PAPER_INVESTMENT_ALLOCATION_EXCEEDED");
    }

    const openP0 = this.readOpenP0();
    if (openP0 !== false) return this.blocked(openP0 === true ? "OPEN_P0_ALERT" : "P0_STATE_UNVERIFIABLE");
    const risk = this.options.riskGate.evaluate({
      path: "MANUAL",
      commandId: command.idempotencyKey,
      signalId: command.idempotencyKey,
      clientOrderId: command.idempotencyKey,
      strategyId: "MANUAL",
      market: command.market.trim().toUpperCase(),
      side: command.side,
      quantity: command.quantity,
      price: context.marketPrice,
      now: context.now,
      observedAt: context.observedAt,
      maximumMarketAgeMs: this.maximumMarketAgeMs,
      killSwitchActive: context.killSwitchActive,
      openP0,
      overallHealth: normalizedHealth(context.overallHealth),
      state,
      approvedBy
    });
    if (risk.status !== "ALLOW") return this.riskResult(risk.status, risk.reasonCodes);
    return this.withRisk(this.options.loop.submitManualOrder(command, context), risk);
  }

  public processTick(tick: PaperExecutionTick & { readonly investmentPercent?: number }): PaperExecutionResult {
    const actionable = tick.decisions
      .filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"))
      .sort((left, right) => left.symbol.localeCompare(right.symbol) || left.action.localeCompare(right.action));
    if (actionable.length === 0) return this.options.loop.processTick(tick);

    const openP0 = this.readOpenP0();
    if (openP0 !== false) return this.blocked(openP0 === true ? "OPEN_P0_ALERT" : "P0_STATE_UNVERIFIABLE");
    const state = this.options.loop.snapshot();
    const investmentPercent = tick.investmentPercent ?? 100;
    if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) return this.blocked("INVALID_INVESTMENT_ALLOCATION");
    for (const decision of actionable) {
      // Cloud automatic strategy authority is deliberately PAPER-only and spot-only. An actionable
      // CIO decision must be self-consistent before it is even presented to the canonical risk gate.
      if (tick.mode !== "PAPER" || decision.leverage !== 1 || decision.risk === "HIGH" || decision.risk === "CRITICAL" ||
          !Number.isFinite(decision.confidence) || decision.confidence < 0.55 || decision.confidence > 1 ||
          !Number.isFinite(decision.allocation) || decision.allocation < 0 || decision.allocation > 1 ||
          (decision.action === "BUY" && decision.allocation <= 0)) {
        return this.blocked("STRATEGY_APPROVAL_REJECTED");
      }

      const side = decision.action === "BUY" ? "BUY" as const : "SELL" as const;
      const position = state.positions.find((item) => item.market === tick.market);
      const quantity = Number((tick.quantity ?? (side === "SELL" ? position?.quantity ?? 0 : state.cash * (investmentPercent / 100) * decision.allocation / tick.price)).toFixed(8));
      if (!Number.isFinite(quantity) || quantity <= 0) return this.options.loop.processTick(tick);
      const key = `paper:${tick.market}:${tick.observedAt}:${decision.action}:${decision.decidedAt}`;
      const risk = this.options.riskGate.evaluate({
        path: "STRATEGY",
        commandId: key,
        signalId: key,
        clientOrderId: key,
        strategyId: "CIO_PAPER",
        market: tick.market,
        side,
        quantity,
        price: tick.price,
        now: tick.now,
        observedAt: tick.observedAt,
        maximumMarketAgeMs: this.maximumMarketAgeMs,
        killSwitchActive: tick.killSwitchActive,
        openP0,
        overallHealth: normalizedHealth(tick.overallHealth),
        state
      });
      if (risk.status !== "ALLOW") return this.riskResult(risk.status, risk.reasonCodes);
    }

    // Canonical risk ALLOW plus the deterministic PAPER-only strategy checks above form the
    // strategy approval boundary. LIVE/production mutation authority is still absent by design.
    return this.withRisk(this.options.loop.processTick(tick), { status: "ALLOW", reasonCodes: Object.freeze([]) });
  }

  private readOpenP0(): boolean | null {
    try { return this.options.readP0State().openP0; }
    catch { return null; }
  }

  private riskResult(status: "REJECT" | "HALT", reasonCodes: readonly string[]): PaperExecutionResult {
    return Object.freeze({
      status: status === "REJECT" ? "REJECTED" : "BLOCKED",
      reason: `PAPER_RISK_${status}:${reasonCodes.join(",") || "UNSPECIFIED"}`,
      orders: Object.freeze([]),
      fills: Object.freeze([]),
      state: this.options.loop.snapshot(),
      risk: Object.freeze({ status, reasonCodes: Object.freeze([...reasonCodes]) })
    });
  }

  private blocked(reason: string): PaperExecutionResult {
    return Object.freeze({ status: "BLOCKED", reason, orders: Object.freeze([]), fills: Object.freeze([]), state: this.options.loop.snapshot() });
  }

  private withRisk(result: PaperExecutionResult, risk: Readonly<{ readonly status: "ALLOW" | "REJECT" | "HALT"; readonly reasonCodes: readonly string[] }>): PaperExecutionResult {
    return Object.freeze({ ...result, risk: Object.freeze({ status: risk.status, reasonCodes: Object.freeze([...risk.reasonCodes]) }) });
  }
}
