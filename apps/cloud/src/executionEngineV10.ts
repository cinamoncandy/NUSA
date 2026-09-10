import type { CloudPaperExecutionBoundary } from "./cloudPaperExecutionBoundary";
import type {
  PaperExecutionResult,
  PaperExecutionTick,
  PaperTradingExecutionLoop
} from "./paperTradingExecutionLoop";

export interface ExecutionEngineV10Input {
  /** Canonical risk-enforcing mutation boundary. The raw loop is intentionally not accepted. */
  readonly boundary: Pick<CloudPaperExecutionBoundary, "processTick">;
  readonly readState: () => ReturnType<PaperTradingExecutionLoop["snapshot"]>;
  readonly tick: PaperExecutionTick & { readonly investmentPercent?: number };
}

export interface ExecutionEngineV10Output {
  readonly authority: "PAPER_ONLY";
  readonly productionMutationAllowed: false;
  readonly result: PaperExecutionResult;
}

export function runExecutionEngineV10(input: ExecutionEngineV10Input): ExecutionEngineV10Output {
  if (input.tick.mode !== "PAPER") {
    return Object.freeze({
      authority: "PAPER_ONLY",
      productionMutationAllowed: false,
      result: Object.freeze({
        status: "BLOCKED",
        reason: "LEVEL10_EXECUTION_PAPER_ONLY",
        orders: Object.freeze([]),
        fills: Object.freeze([]),
        state: input.readState()
      })
    });
  }

  const result = input.boundary.processTick(input.tick);
  return Object.freeze({
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    result
  });
}
