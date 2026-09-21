import { createHash } from "node:crypto";
import type { PreTradeRiskDecision, PreTradeRiskRequest } from "../../../packages/contracts/src/riskGateway";
import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick
} from "./paperTradingExecutionLoop";

export interface RiskApprovedPaperExecution {
  readonly tick: PaperExecutionTick;
  readonly riskRequest: PreTradeRiskRequest;
  readonly riskDecision: PreTradeRiskDecision;
}

const requestSha256 = (request: PreTradeRiskRequest): string => createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
const sameNumber = (left: number, right: number): boolean => Math.abs(left - right) <= Math.max(1e-8, Math.abs(right) * 1e-10);

/**
 * The only execution port accepted by the 10X-S execution engine.
 * A raw PaperTradingExecutionLoop is deliberately not assignable to this boundary.
 * The exact symbol, side, quantity and price evaluated by risk are hash-bound to the
 * execution tick so sizing cannot be changed after an ALLOW decision.
 */
export class RiskEnforcingPaperExecutionPort {
  public constructor(private readonly loop: PaperTradingExecutionLoop) {}

  public snapshot(): ReturnType<PaperTradingExecutionLoop["snapshot"]> {
    return this.loop.snapshot();
  }

  public executeApproved(input: RiskApprovedPaperExecution): PaperExecutionResult {
    if (input.riskDecision.productionMutationAllowed !== false) {
      return this.blocked("LEVEL10_EXECUTION_PRODUCTION_AUTHORITY_FORBIDDEN");
    }
    if (input.riskDecision.status !== "ALLOW") {
      return this.blocked(`LEVEL10_EXECUTION_RISK_${input.riskDecision.status}`);
    }
    if (requestSha256(input.riskRequest) !== input.riskDecision.requestSha256) {
      return this.blocked("LEVEL10_EXECUTION_RISK_REQUEST_BINDING_MISMATCH");
    }
    const tickQuantity = input.tick.quantity;
    const actionable = input.tick.decisions.filter((decision) =>
      decision.symbol === input.tick.market && (decision.action === "BUY" || decision.action === "SELL")
    );
    if (
      input.tick.market !== input.riskRequest.symbol ||
      actionable.length !== 1 ||
      actionable[0]?.action !== input.riskRequest.side ||
      tickQuantity == null ||
      !sameNumber(tickQuantity, input.riskRequest.quantity) ||
      !sameNumber(input.tick.price, input.riskRequest.referencePrice)
    ) {
      return this.blocked("LEVEL10_EXECUTION_SIZED_INTENT_MISMATCH");
    }
    return this.loop.processTick(input.tick);
  }

  private blocked(reason: string): PaperExecutionResult {
    return Object.freeze({
      status: "BLOCKED",
      reason,
      orders: Object.freeze([]),
      fills: Object.freeze([]),
      state: this.loop.snapshot()
    });
  }
}

export interface ExecutionEngineV10Input {
  readonly port: RiskEnforcingPaperExecutionPort;
  readonly approved: RiskApprovedPaperExecution;
}

export interface ExecutionEngineV10Output {
  readonly authority: "PAPER_ONLY";
  readonly productionMutationAllowed: false;
  readonly riskBoundaryEnforced: true;
  readonly result: PaperExecutionResult;
}

export function runExecutionEngineV10(input: ExecutionEngineV10Input): ExecutionEngineV10Output {
  if (input.approved.tick.mode !== "PAPER") {
    return Object.freeze({
      authority: "PAPER_ONLY",
      productionMutationAllowed: false,
      riskBoundaryEnforced: true,
      result: Object.freeze({
        status: "BLOCKED",
        reason: "LEVEL10_EXECUTION_PAPER_ONLY",
        orders: Object.freeze([]),
        fills: Object.freeze([]),
        state: input.port.snapshot()
      })
    });
  }

  const result = input.port.executeApproved(input.approved);
  return Object.freeze({
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    riskBoundaryEnforced: true,
    result
  });
}
