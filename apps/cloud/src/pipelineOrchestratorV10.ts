import {
  MODULE_STAGE_ORDER,
  runLevel10Module,
  type Level10Module,
  type ModuleExecutionContext,
  type ModuleExecutionEvidence,
  type ModuleExecutionResult,
  type ModuleStage
} from "./moduleLevel10";
import type {
  DecisionExecutionIntentV10,
  RiskApprovedExecutionIntentV10,
  SizedExecutionIntentV10
} from "./pipelineRiskContractsV10";

/**
 * The decision -> portfolio/sizing -> risk -> execution path is intentionally explicit.
 * A risk module cannot receive an unsized decision and execution cannot receive an
 * unapproved sized intent. The remaining seams stay generic until their domain contracts
 * are promoted independently.
 */
export interface Level10ModuleBundle {
  readonly MARKET_DATA: Level10Module<unknown, unknown>;
  readonly INTELLIGENCE: Level10Module<unknown, unknown>;
  readonly STRATEGY: Level10Module<unknown, unknown>;
  readonly DECISION: Level10Module<unknown, DecisionExecutionIntentV10>;
  readonly PORTFOLIO: Level10Module<DecisionExecutionIntentV10, SizedExecutionIntentV10>;
  readonly RISK: Level10Module<SizedExecutionIntentV10, RiskApprovedExecutionIntentV10>;
  readonly EXECUTION: Level10Module<RiskApprovedExecutionIntentV10, unknown>;
  readonly PAPER_ADAPTER: Level10Module<unknown, unknown>;
  readonly REVIEW: Level10Module<unknown, unknown>;
  readonly MEMORY: Level10Module<unknown, unknown>;
}

export interface PipelineV10RunResult {
  readonly status: "COMPLETED" | "FAILED_CLOSED";
  readonly haltedAt?: ModuleStage;
  readonly output?: unknown;
  readonly evidence: readonly ModuleExecutionEvidence[];
}

type StageRun<Output> =
  | Readonly<{ status: "COMPLETED"; output: Output }>
  | Readonly<{ status: "FAILED_CLOSED"; haltedAt: ModuleStage }>;

async function executeStage<Input, Output>(
  stage: ModuleStage,
  module: Level10Module<Input, Output>,
  input: Input,
  context: ModuleExecutionContext,
  evidence: ModuleExecutionEvidence[]
): Promise<StageRun<Output>> {
  const stageContext: ModuleExecutionContext = Object.freeze({
    ...context,
    idempotencyKey: `${context.idempotencyKey}:${stage}`
  });
  const result: ModuleExecutionResult<Output> = await runLevel10Module(module, input, stageContext);
  evidence.push(result.evidence);
  if (result.status !== "COMPLETED" || result.evidence.moduleTier !== "10X-S" || result.output === undefined) {
    return Object.freeze({ status: "FAILED_CLOSED", haltedAt: stage });
  }
  return Object.freeze({ status: "COMPLETED", output: result.output });
}

export class PipelineOrchestratorV10 {
  public constructor(private readonly modules: Level10ModuleBundle) {
    for (const stage of MODULE_STAGE_ORDER) {
      const module = modules[stage];
      if (module.stage !== stage) throw new Error(`module stage mismatch: expected ${stage}, received ${module.stage}`);
      if (module.version !== "10") throw new Error(`${stage} module version must be 10`);
      if (module.tier !== "10X-S") throw new Error(`${stage} module must be certified for 10X-S orchestration`);
    }
  }

  public async run(initialInput: unknown, context: ModuleExecutionContext): Promise<PipelineV10RunResult> {
    const evidence: ModuleExecutionEvidence[] = [];
    let genericValue: unknown = initialInput;

    for (const stage of ["MARKET_DATA", "INTELLIGENCE", "STRATEGY"] as const) {
      const result = await executeStage(stage, this.modules[stage], genericValue, context, evidence);
      if (result.status === "FAILED_CLOSED") return this.failed(result.haltedAt, evidence);
      genericValue = result.output;
    }

    const decision = await executeStage("DECISION", this.modules.DECISION, genericValue, context, evidence);
    if (decision.status === "FAILED_CLOSED") return this.failed(decision.haltedAt, evidence);

    const portfolio = await executeStage("PORTFOLIO", this.modules.PORTFOLIO, decision.output, context, evidence);
    if (portfolio.status === "FAILED_CLOSED") return this.failed(portfolio.haltedAt, evidence);

    const risk = await executeStage("RISK", this.modules.RISK, portfolio.output, context, evidence);
    if (risk.status === "FAILED_CLOSED") return this.failed(risk.haltedAt, evidence);

    const execution = await executeStage("EXECUTION", this.modules.EXECUTION, risk.output, context, evidence);
    if (execution.status === "FAILED_CLOSED") return this.failed(execution.haltedAt, evidence);
    genericValue = execution.output;

    for (const stage of ["PAPER_ADAPTER", "REVIEW", "MEMORY"] as const) {
      const result = await executeStage(stage, this.modules[stage], genericValue, context, evidence);
      if (result.status === "FAILED_CLOSED") return this.failed(result.haltedAt, evidence);
      genericValue = result.output;
    }

    return Object.freeze({
      status: "COMPLETED",
      output: genericValue,
      evidence: Object.freeze(evidence)
    });
  }

  private failed(haltedAt: ModuleStage, evidence: ModuleExecutionEvidence[]): PipelineV10RunResult {
    return Object.freeze({
      status: "FAILED_CLOSED",
      haltedAt,
      evidence: Object.freeze(evidence)
    });
  }
}
