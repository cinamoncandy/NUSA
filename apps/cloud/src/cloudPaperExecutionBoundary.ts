import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick
} from "./paperTradingExecutionLoop";
import type { CloudPaperRiskGate, CloudPaperRiskRequest } from "./cloudPaperCanonicalRiskGateway";

export interface CloudPaperExecutionBoundaryOptions {
  readonly loop: PaperTradingExecutionLoop;
  readonly riskGate: CloudPaperRiskGate;
  readonly readP0State: () => Readonly<{ openP0: boolean }>;
  readonly maximumMarketAgeMs?: number;
}

const normalizedHealth = (value: PaperExecutionTick["overallHealth"]): CloudPaperRiskRequest["overallHealth"] =>
  value === "HEALTHY" ? "HEALTHY" : value === "DOWN" ? "CRITICAL" : "DEGRADED";

/**
 * Single production Cloud PAPER mutation boundary.
 * It never calls the simulator mutation method before every actionable decision has an
 * ALLOW decision from the canonical risk adapter. REJECT/HALT/P0 uncertainty are zero-side-effect.
 */
export class CloudPaperExecutionBoundary {
  private readonly maximumMarketAgeMs: number;

  public constructor(private readonly options: CloudPaperExecutionBoundaryOptions) {
    this.maximumMarketAgeMs = options.maximumMarketAgeMs ?? 30_000;
    if (!Number.isSafeInteger(this.maximumMarketAgeMs) || this.maximumMarketAgeMs < 1_000) {
      throw new Error("cloud PAPER maximum market age is invalid");
    }
  }

  public processTick(tick: PaperExecutionTick): PaperExecutionResult {
    const actionable = tick.decisions
      .filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"))
      .sort((left, right) => left.symbol.localeCompare(right.symbol) || left.action.localeCompare(right.action));

    if (actionable.length === 0) return this.options.loop.processTick(tick);

    const openP0 = this.readOpenP0();
    if (openP0 !== false) return this.blocked(openP0 === true ? "OPEN_P0_ALERT" : "P0_STATE_UNVERIFIABLE");

    const investmentPercent = tick.investmentPercent ?? 100;
    if (!Number.isFinite(investmentPercent) || investmentPercent < 0 || investmentPercent > 100) {
      return this.options.loop.processTick(tick);
    }

    let workingState = this.options.loop.snapshot();
    for (const decision of actionable) {
      const side = decision.action === "BUY" ? "BUY" as const : "SELL" as const;
      const position = workingState.positions.find((item) => item.market === tick.market);
      const quantity = Number((tick.quantity ?? (
        side === "SELL"
          ? position?.quantity ?? 0
          : workingState.cash * (investmentPercent / 100) * decision.allocation / tick.price
      )).toFixed(8));

      if (!Number.isFinite(quantity) || quantity <= 0) return this.options.loop.processTick(tick);

      const commandId = `paper:${tick.market}:${tick.observedAt}:${decision.action}:${decision.decidedAt}`;
      const risk = this.options.riskGate.evaluate({
        commandId,
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
        state: workingState
      });
      if (risk.status !== "ALLOW") return this.riskResult(risk.status, risk.reasonCodes);

      if (actionable.length > 1) return this.blocked("MULTI_DECISION_RISK_PROJECTION_UNAVAILABLE");
    }

    return this.options.loop.processTick(tick);
  }

  private readOpenP0(): boolean | null {
    try {
      return this.options.readP0State().openP0;
    } catch {
      return null;
    }
  }

  private riskResult(status: "REJECT" | "HALT", reasonCodes: readonly string[]): PaperExecutionResult {
    return Object.freeze({
      status: status === "REJECT" ? "REJECTED" : "BLOCKED",
      reason: `PAPER_RISK_${status}:${reasonCodes.join(",") || "UNSPECIFIED"}`,
      orders: Object.freeze([]),
      fills: Object.freeze([]),
      state: this.options.loop.snapshot()
    });
  }

  private blocked(reason: string): PaperExecutionResult {
    return Object.freeze({
      status: "BLOCKED",
      reason,
      orders: Object.freeze([]),
      fills: Object.freeze([]),
      state: this.options.loop.snapshot()
    });
  }
}
