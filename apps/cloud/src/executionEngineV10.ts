import type {
  PaperExecutionResult,
  PaperExecutionTick,
  PaperTradingExecutionLoop
} from "./paperTradingExecutionLoop";

export type PaperExecutionTickV10 = PaperExecutionTick & { readonly investmentPercent?: number };

export interface CanonicalPaperExecutionBoundaryV10 {
  readonly processTick: (tick: PaperExecutionTickV10) => PaperExecutionResult;
}

export interface ExecutionEngineV10Input {
  /** Canonical risk-enforcing mutation boundary. The raw loop is intentionally not accepted. */
  readonly boundary: CanonicalPaperExecutionBoundaryV10;
  readonly readState: () => ReturnType<PaperTradingExecutionLoop["snapshot"]>;
  readonly tick: PaperExecutionTickV10;
}

export interface ExecutionEngineV10Output {
  readonly authority: "PAPER_ONLY";
  readonly productionMutationAllowed: false;
  readonly result: PaperExecutionResult;
}

export function blockNonPaperExecutionV10(
  tick: PaperExecutionTickV10,
  readState: () => ReturnType<PaperTradingExecutionLoop["snapshot"]>
): PaperExecutionResult | undefined {
  if (tick.mode === "PAPER") return undefined;
  return Object.freeze({
    status: "BLOCKED",
    reason: "LEVEL10_EXECUTION_PAPER_ONLY",
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    state: readState()
  });
}

export function runExecutionEngineV10(input: ExecutionEngineV10Input): ExecutionEngineV10Output {
  const blocked = blockNonPaperExecutionV10(input.tick, input.readState);
  const result = blocked ?? input.boundary.processTick(input.tick);
  return Object.freeze({
    authority: "PAPER_ONLY",
    productionMutationAllowed: false,
    result
  });
}
