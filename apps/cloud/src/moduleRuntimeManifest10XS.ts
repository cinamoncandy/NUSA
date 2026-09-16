import { MODULE_STAGE_ORDER, type ModuleStage } from "./moduleLevel10";

export interface ModuleRuntimeBinding10XS {
  readonly stage: ModuleStage;
  readonly canonicalEntrypoint: string;
  readonly runtimeEntrypoint: string;
  readonly lastKnownGoodRef: string;
  readonly evidenceRefs: readonly string[];
}

const LKG = "1d538db896e9db58f925ebade464f2d8be7ae13e";
const RUNTIME_TRUTH_TEST = "apps/cloud/src/moduleRuntimeManifest10XS.test.ts";
const CI = ".github/workflows/ci.yml";

const bindings: Readonly<Record<ModuleStage, Omit<ModuleRuntimeBinding10XS, "stage">>> = Object.freeze({
  MARKET_DATA: Object.freeze({
    canonicalEntrypoint: "packages/core/src/upbitWebSocket.ts",
    runtimeEntrypoint: "apps/cloud/src/upbitWebSocket.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["packages/core/src/upbitWebSocket.ts", "apps/cloud/src/upbitWebSocket.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  INTELLIGENCE: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/intelligenceEngineV10.ts",
    runtimeEntrypoint: "apps/cloud/src/cloudRuntimeDashboardHydrator.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/intelligenceEngineV10.ts", "apps/cloud/src/cloudRuntimeDashboardHydrator.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  STRATEGY: Object.freeze({
    canonicalEntrypoint: "packages/core/src/strategyEngine.ts",
    runtimeEntrypoint: "apps/cloud/src/paperCandidateStrategy.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["packages/core/src/strategyEngine.ts", "apps/cloud/src/paperCandidateStrategy.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  DECISION: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/cioDecisionEngine.ts",
    runtimeEntrypoint: "apps/cloud/src/cioDecisionEngine.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/cioDecisionEngine.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  RISK: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/cloudPaperCanonicalRiskGateway.ts",
    runtimeEntrypoint: "apps/cloud/src/cloudPaperExecutionBoundary.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/cloudPaperCanonicalRiskGateway.ts", "apps/cloud/src/cloudPaperExecutionBoundary.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  PORTFOLIO: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/portfolioEngineV10.ts",
    runtimeEntrypoint: "apps/cloud/src/cloudRuntimeDashboardHydrator.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/portfolioEngineV10.ts", "apps/cloud/src/cloudRuntimeDashboardHydrator.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  EXECUTION: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/cloudPaperExecutionBoundary.ts",
    runtimeEntrypoint: "apps/cloud/src/runtime.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/cloudPaperExecutionBoundary.ts", "apps/cloud/src/runtime.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  PAPER_ADAPTER: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/paperTradingExecutionLoop.ts",
    runtimeEntrypoint: "apps/cloud/src/cloudPaperExecutionBoundary.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/paperTradingExecutionLoop.ts", "apps/cloud/src/cloudPaperExecutionBoundary.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  REVIEW: Object.freeze({
    canonicalEntrypoint: "apps/cloud/src/paperLearningObservability.ts",
    runtimeEntrypoint: "apps/cloud/src/runtime.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["apps/cloud/src/paperLearningObservability.ts", "apps/cloud/src/runtime.ts", RUNTIME_TRUTH_TEST, CI])
  }),
  MEMORY: Object.freeze({
    canonicalEntrypoint: "packages/storage/src/memoryEngineV10.ts",
    runtimeEntrypoint: "packages/storage/src/evolutionLearningLedger.ts",
    lastKnownGoodRef: LKG,
    evidenceRefs: Object.freeze(["packages/storage/src/memoryEngineV10.ts", "packages/storage/src/evolutionLearningLedger.ts", RUNTIME_TRUTH_TEST, CI])
  })
});

export const MODULE_RUNTIME_MANIFEST_10XS: readonly ModuleRuntimeBinding10XS[] = Object.freeze(
  MODULE_STAGE_ORDER.map((stage) => Object.freeze({ stage, ...bindings[stage] }))
);

export const MODULE_RUNTIME_BINDING_BY_STAGE_10XS: Readonly<Record<ModuleStage, ModuleRuntimeBinding10XS>> = Object.freeze(
  Object.fromEntries(MODULE_RUNTIME_MANIFEST_10XS.map((binding) => [binding.stage, binding])) as Record<ModuleStage, ModuleRuntimeBinding10XS>
);
