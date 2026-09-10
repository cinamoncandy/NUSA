import {
  PaperTradingExecutionLoop,
  type PaperExecutionResult,
  type PaperExecutionTick
} from "./paperTradingExecutionLoop";

export interface ExecutionEngineV10Input {
  readonly loop: PaperTradingExecutionLoop;
  readonly tick: PaperExecutionTick;
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
        state: input.loop.snapshot()
      })
    });
  }

  const result = input.loop.processTick(input.tick);
  return Object.freeze({
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    result
  });
}
