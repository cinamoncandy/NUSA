import type { CanonicalRiskDecision } from "../../execution/src/risk-safety-integration";
import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick,
  type PaperTradingExecutionLoopOptions
} from "./paperTradingExecutionLoop";

export interface OracleCanonicalRiskEvaluationInput {
  readonly nowMs: number;
  readonly observedAt: number;
  readonly market: string;
  readonly side: "BUY" | "SELL";
  readonly strategyDecisionAt: number;
  readonly idempotencyKey: string;
  readonly currentEquity: number;
  readonly marketDataFresh: boolean;
  readonly marketHealthy: boolean;
  readonly killSwitchActive: boolean;
}

export interface OracleCanonicalRiskGate {
  evaluate(input: OracleCanonicalRiskEvaluationInput): CanonicalRiskDecision;
}

export interface OraclePaperTradingExecutionLoopOptions extends PaperTradingExecutionLoopOptions {
  readonly canonicalRiskGate: OracleCanonicalRiskGate;
}

/**
 * Oracle's PAPER runtime is deliberately stricter than the generic Cloud PAPER loop.
 * It performs the generic loop's non-mutating preflight first, obtains a canonical risk
 * decision, and only then delegates to the existing fill/persistence implementation.
 *
 * The canonical gate is mandatory here. No approval is minted or inferred by this class.
 */
export class OraclePaperTradingExecutionLoop extends PaperTradingExecutionLoop {
  private readonly canonicalRiskGate: OracleCanonicalRiskGate;
  private readonly oracleReadP0State?: OraclePaperTradingExecutionLoopOptions["readP0State"];
  private readonly oracleFeeRate: number;
  private readonly oracleStaleWindowMs: number;

  public constructor(options: OraclePaperTradingExecutionLoopOptions) {
    super(options);
    this.canonicalRiskGate = options.canonicalRiskGate;
    this.oracleReadP0State = options.readP0State;
    this.oracleFeeRate = options.feeRate ?? 0.0005;
    this.oracleStaleWindowMs = options.staleWindowMs ?? 30_000;
  }

  public processTick(tick: PaperExecutionTick): PaperExecutionResult {
    if (!Number.isSafeInteger(tick.now) || tick.now < 0 || !Number.isFinite(tick.price) || tick.price <= 0) {
      return this.blocked("invalid tick", "FAILED");
    }
    if (tick.mode === "PAPER" && this.oracleReadP0State != null) {
      try {
        if (this.oracleReadP0State().openP0) return this.blocked("OPEN_P0_ALERT");
      } catch {
        return this.blocked("P0_STATE_UNVERIFIABLE");
      }
    }
    if (tick.mode !== "PAPER" || tick.killSwitchActive || !tick.tradingAllowed || tick.overallHealth !== "HEALTHY") {
      return this.blocked("paper execution gate is closed");
    }
    if (!Number.isSafeInteger(tick.observedAt) || tick.observedAt < 0 || tick.observedAt > tick.now || tick.now - tick.observedAt >= this.oracleStaleWindowMs) {
      return this.blocked("market data is stale");
    }
    if (tick.quantity !== undefined && (!Number.isFinite(tick.quantity) || tick.quantity <= 0)) {
      return this.blocked("invalid order quantity", "FAILED");
    }

    const actionable = tick.decisions
      .filter((decision) => decision.symbol === tick.market && (decision.action === "BUY" || decision.action === "SELL"))
      .sort((left, right) => left.symbol.localeCompare(right.symbol) || left.action.localeCompare(right.action));
    if (actionable.length === 0) return super.processTick(tick);
    if (actionable.length !== 1) return this.blocked("MULTIPLE_ACTIONABLE_DECISIONS_REQUIRE_REVIEW");

    const decision = actionable[0];
    const side: "BUY" | "SELL" = decision.action === "BUY" ? "BUY" : "SELL";
    const state = this.snapshot();
    const idempotencyKey = `paper:${tick.market}:${tick.observedAt}:${side}:${decision.decidedAt}`;
    if (state.processedIdempotencyKeys.includes(idempotencyKey)) {
      return Object.freeze({ status: "DUPLICATE", reason: idempotencyKey, orders: Object.freeze([]), fills: Object.freeze([]), state });
    }

    const position = state.positions.find((item) => item.market === tick.market);
    const quantity = Number((tick.quantity ?? (side === "SELL"
      ? position?.quantity ?? 0
      : state.cash * decision.allocation / tick.price)).toFixed(8));
    if (quantity <= 0) {
      return this.blocked(side === "SELL" ? "insufficient paper position" : "decision allocation is zero", "REJECTED");
    }
    const notional = Number((quantity * tick.price).toFixed(8));
    const fee = Number((notional * this.oracleFeeRate).toFixed(8));
    if (side === "BUY" && notional + fee > state.cash + Number.EPSILON) {
      return this.blocked("insufficient paper cash", "REJECTED");
    }
    if (side === "SELL" && quantity > (position?.quantity ?? 0) + Number.EPSILON) {
      return this.blocked("insufficient paper position", "REJECTED");
    }

    let canonical: CanonicalRiskDecision;
    try {
      canonical = this.canonicalRiskGate.evaluate(Object.freeze({
        nowMs: tick.now,
        observedAt: tick.observedAt,
        market: tick.market,
        side,
        strategyDecisionAt: decision.decidedAt,
        idempotencyKey,
        currentEquity: state.equity,
        marketDataFresh: true,
        marketHealthy: tick.tradingAllowed && tick.overallHealth === "HEALTHY",
        killSwitchActive: tick.killSwitchActive
      }));
    } catch {
      return this.blocked("CANONICAL_RISK_UNVERIFIABLE");
    }
    if (canonical.productionMutationAllowed !== false) return this.blocked("CANONICAL_RISK_INVALID");
    if (canonical.status !== "APPROVED") {
      const reason = canonical.reasonCodes.length > 0 ? canonical.reasonCodes.join(",") : canonical.reason || "CANONICAL_RISK_BLOCKED";
      return this.blocked(reason, canonical.status === "REJECTED" ? "REJECTED" : "BLOCKED");
    }

    return super.processTick(tick);
  }

  private blocked(reason: string, status: "BLOCKED" | "REJECTED" | "FAILED" = "BLOCKED"): PaperExecutionResult {
    return Object.freeze({ status, reason, orders: Object.freeze([]), fills: Object.freeze([]), state: this.snapshot() });
  }
}
