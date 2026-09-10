import {
  MODULE_STAGE_ORDER,
  runLevel10Module,
  type Level10Module,
  type ModuleExecutionContext,
  type ModuleExecutionEvidence,
  type ModuleStage
} from "./moduleLevel10";

type NonCriticalStage = Exclude<ModuleStage, "DECISION" | "PORTFOLIO" | "RISK" | "EXECUTION">;

type NonCriticalModuleBundle = Readonly<Record<NonCriticalStage, Level10Module<unknown, unknown>>>;

/**
 * The decision -> portfolio/sizing -> risk -> execution seam is intentionally
 * typed. In particular, RISK consumes the exact PORTFOLIO output, so a caller
 * cannot insert a post-risk sizing transformation into the canonical V10 path.
 */
export type Level10ModuleBundle<DecisionOutput, PortfolioOutput, RiskOutput, ExecutionOutput> = NonCriticalModuleBundle & Readonly<{
  DECISION: Level10Module<unknown, DecisionOutput>;
  PORTFOLIO: Level10Module<DecisionOutput, PortfolioOutput>;
  RISK: Level10Module<PortfolioOutput, RiskOutput>;
  EXECUTION: Level10Module<RiskOutput, ExecutionOutput>;
}>;

export interface PipelineV10RunResult {
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly haltedAt?: ModuleStage;
  readonly output?: unknown;
  readonly evidence: readonly ModuleExecutionEvidence[];
}

export class PipelineOrchestratorV10<DecisionOutput, PortfolioOutput, RiskOutput, ExecutionOutput> {
  public constructor(private readonly modules: Level10ModuleBundle<DecisionOutput, PortfolioOutput, RiskOutput, ExecutionOutput>) {
    for (const stage of MODULE_STAGE_ORDER) {
      const module = modules[stage] as Level10Module<unknown, unknown>;
      if (module.stage !== stage) throw new Error(`module stage mismatch: expected ${stage}, received ${module.stage}`);
      if (module.version !== "10") throw new Error(`${stage} module version must be 10`);
      if (module.tier !== "10X-S") throw new Error(`${stage} module must be certified for 10X-S orchestration`);
    }
  }

  public async run(initialInput: unknown, context: ModuleExecutionContext): Promise<PipelineV10RunResult> {
    const evidence: ModuleExecutionEvidence[] = [];
    let value: unknown = initialInput;

    for (const stage of MODULE_STAGE_ORDER) {
      const stageContext: ModuleExecutionContext = Object.freeze({
        ...context,
        idempotencyKey: `${context.idempotencyKey}:${stage}`
      });
      const module = this.modules[stage] as Level10Module<unknown, unknown>;
      const result = await runLevel10Module(module, value, stageContext);
      evidence.push(result.evidence);
      if (result.status !== "COMPLETED" || result.evidence.moduleTier !== "10X-S") {
        return Object.freeze({
          status: "FAILED_CLOSED",
          haltedAt: stage,
          evidence: Object.freeze(evidence)
        });
      }
      value = result.output;
    }

    return Object.freeze({
      status: "COMPLETED",
      output: value,
      evidence: Object.freeze(evidence)
    });
  }
}
