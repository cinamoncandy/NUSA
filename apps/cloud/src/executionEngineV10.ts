import type { PreTradeRiskDecision } from "../../../packages/contracts/src/riskGateway";
import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick
} from "./paperTradingExecutionLoop";

export interface RiskApprovedPaperExecution {
  readonly tick: PaperExecutionTick;
  readonly riskDecision: PreTradeRiskDecision;
}

/**
 * The only execution port accepted by the 10X-S execution engine.
 * A raw PaperTradingExecutionLoop is deliberately not assignable to this boundary.
 */
export class RiskEnforcingPaperExecutionPort {
  public constructor(private readonly loop: PaperTradingExecutionLoop) {}

  public snapshot(): ReturnType<PaperTradingExecutionLoop["snapshot"]> {
    return this.loop.snapshot();
  }

  public executeApproved(input: RiskApprovedPaperExecution): PaperExecutionResult {
    if (input.riskDecision.productionMutationAllowed !== false) {
      throw new Error("risk decision attempted to grant production mutation authority");
    }
    if (input.riskDecision.status !== "ALLOW") {
      return Object.freeze({
        status: "BLOCKED",
        reason: `LEVEL10_EXECUTION_RISK_${input.riskDecision.status}`,
        orders: Object.freeze([]),
        fills: Object.freeze([]),
        state: this.loop.snapshot()
      });
    }
    return this.loop.processTick(input.tick);
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
