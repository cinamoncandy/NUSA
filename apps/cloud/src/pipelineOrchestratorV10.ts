import {
  MODULE_STAGE_ORDER,
  runLevel10Module,
  type Level10Module,
  type ModuleExecutionContext,
  type ModuleExecutionEvidence,
  type ModuleStage
} from "./moduleLevel10";

export type Level10ModuleBundle = Readonly<Record<ModuleStage, Level10Module<unknown, unknown>>>;

export interface PipelineV10RunResult {
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly haltedAt?: ModuleStage;
  readonly output?: unknown;
  readonly evidence: readonly ModuleExecutionEvidence[];
}

export class PipelineOrchestratorV10 {
  public constructor(private readonly modules: Level10ModuleBundle) {
    for (const stage of MODULE_STAGE_ORDER) {
      const module = modules[stage];
      if (module.stage !== stage) throw new Error(`module stage mismatch: expected ${stage}, received ${module.stage}`);
      if (module.version !== "10") throw new Error(`${stage} module version must be 10`);
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
      const result = await runLevel10Module(this.modules[stage], value, stageContext);
      evidence.push(result.evidence);
      if (result.status !== "COMPLETED") {
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
