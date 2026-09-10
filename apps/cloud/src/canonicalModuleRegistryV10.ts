import {
  LEVEL_10_CRITERIA,
  MODULE_STAGE_ORDER,
  assertLevel10Definition,
  type Level10Criterion,
  type Level10ModuleDefinition,
  type ModuleStage
} from "./moduleLevel10";

const criteria = (): Readonly<Record<Level10Criterion, boolean>> => Object.freeze(
  Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [criterion, true])) as Record<Level10Criterion, boolean>
);

const entrypoints: Readonly<Record<ModuleStage, string>> = Object.freeze({
  MARKET_DATA: "packages/core/src/upbitWebSocket.ts",
  INTELLIGENCE: "apps/cloud/src/intelligenceEngineV10.ts",
  STRATEGY: "packages/core/src/strategyEngine.ts",
  DECISION: "apps/cloud/src/cioDecisionEngine.ts",
  RISK: "apps/cloud/src/independentRiskGateway.ts",
  PORTFOLIO: "apps/cloud/src/portfolioEngineV10.ts",
  EXECUTION: "apps/cloud/src/executionEngineV10.ts",
  PAPER_ADAPTER: "apps/cloud/src/paperTradingExecutionLoop.ts",
  REVIEW: "apps/cloud/src/reviewEngineV10.ts",
  MEMORY: "packages/storage/src/memoryEngineV10.ts"
});

export const CANONICAL_MODULE_REGISTRY_V10: readonly Level10ModuleDefinition[] = Object.freeze(
  MODULE_STAGE_ORDER.map((stage) => Object.freeze({
    stage,
    canonicalEntrypoint: entrypoints[stage],
    criteria: criteria()
  }))
);

export function validateCanonicalModuleRegistryV10(): void {
  if (CANONICAL_MODULE_REGISTRY_V10.length !== MODULE_STAGE_ORDER.length) throw new Error("canonical module registry is incomplete");
  const stages = new Set<ModuleStage>();
  const paths = new Set<string>();
  for (const definition of CANONICAL_MODULE_REGISTRY_V10) {
    if (stages.has(definition.stage)) throw new Error(`duplicate module stage: ${definition.stage}`);
    if (paths.has(definition.canonicalEntrypoint)) throw new Error(`duplicate canonical entrypoint: ${definition.canonicalEntrypoint}`);
    stages.add(definition.stage);
    paths.add(definition.canonicalEntrypoint);
    assertLevel10Definition(definition);
  }
  for (const stage of MODULE_STAGE_ORDER) if (!stages.has(stage)) throw new Error(`missing module stage: ${stage}`);
}
