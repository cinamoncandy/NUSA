/**
 * What is actually reached at runtime in the level-10 pipeline, as a declaration a test checks
 * against the source tree rather than a claim in a document.
 *
 * `docs/PIPELINE_TO_CODE.md` maps ten stages onto canonical entrypoints and is careful to say
 * "runtime callers still provide the concrete stage adapters". That sentence is easy to lose,
 * and once it is lost the table reads as a description of a running system. It is not one yet:
 * every V10 engine has exactly one non-test caller, the V10 registry, and
 * `pipelineOrchestratorV10.ts` has none at all. The retained implementations underneath are
 * genuinely on the runtime path -- `paperTradingExecutionLoop` has seventeen callers,
 * `cioDecisionEngine` fifteen -- so the pipeline runs; it runs *below* the V10 layer, which
 * currently sits beside it rather than in front of it.
 *
 * One stage is weaker than "not yet called". `intelligenceEngineV10` abstains on
 * `regime.confidence`, `regime.stability` and `strategyPolicy.allowNewExposure`, all read from
 * `marketRegimeEngine`, and nothing in the tree constructs a `MarketRegimeFeatures` from live
 * data. Wiring the orchestrator in would not make that gate work: it has no producer to fail
 * closed against, and its stage would abstain on every tick for want of an input, or worse,
 * be fed a hand-built literal at the call site and appear to pass.
 *
 * The failure mode this guards is a module carrying tests, a registry entry and a row in an
 * architecture table while nothing calls it and nothing feeds it -- the same failure
 * `alphaReadiness.ts` guards for strategies, one layer up. Every field below is a claim;
 * `tests/pipeline-wiring-v10.test.js` checks the checkable ones against the tree.
 */

/** Whether anything outside the V10 declaration layer calls this entrypoint. */
export type StageReach =
  /** Called by code that is not a test and not the V10 registry or orchestrator. */
  | "ON_RUNTIME_PATH"
  /** Registered and tested, but reached only from the V10 layer's own files. */
  | "REGISTRY_ONLY";

/** Whether the stage's declared inputs can be produced from live data today. */
export type StageInputAvailability = "PRODUCED_IN_TREE" | "NO_PRODUCER_IN_TREE";

export interface StageWiring {
  readonly stage: string;
  /** Repo-relative path, without extension, of the entrypoint `docs/PIPELINE_TO_CODE.md` names. */
  readonly canonicalEntrypoint: string;
  readonly reach: StageReach;
  readonly inputs: StageInputAvailability;
  /**
   * A type or symbol the stage cannot run without, whose producers the test counts.
   * Empty when the stage's inputs are ordinary values rather than a named contract.
   */
  readonly requiredInputType: string;
  /** What stands between this stage and the runtime path. Empty only when `reach` is ON_RUNTIME_PATH. */
  readonly blocker: string;
}

/** Files that may reference a V10 engine without that counting as runtime wiring. */
export const V10_DECLARATION_FILES: readonly string[] = Object.freeze([
  "apps/cloud/src/canonicalModuleRegistryV10.ts",
  "apps/cloud/src/pipelineOrchestratorV10.ts",
  "apps/cloud/src/moduleLevel10.ts"
]);

export const PIPELINE_WIRING_V10: readonly StageWiring[] = Object.freeze([
  Object.freeze({
    stage: "Market Data",
    canonicalEntrypoint: "packages/core/src/upbitWebSocket",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Intelligence",
    canonicalEntrypoint: "apps/cloud/src/intelligenceEngineV10",
    reach: "ON_RUNTIME_PATH",
    inputs: "NO_PRODUCER_IN_TREE",
    requiredInputType: "MarketRegimeFeatures",
    blocker: ""
  }),
  Object.freeze({
    stage: "Strategy",
    canonicalEntrypoint: "packages/core/src/strategyEngine",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Decision",
    canonicalEntrypoint: "apps/cloud/src/cioDecisionEngine",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Risk",
    canonicalEntrypoint: "packages/core/src/independentRiskGateway",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Portfolio",
    canonicalEntrypoint: "apps/cloud/src/portfolioEngineV10",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Execution",
    canonicalEntrypoint: "apps/cloud/src/executionEngineV10",
    reach: "REGISTRY_ONLY",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker:
      "The runtime drives paperTradingExecutionLoop directly, so the PAPER-only mode check in " +
      "this wrapper does not sit in front of any live call site."
  }),
  Object.freeze({
    stage: "Paper Adapter",
    canonicalEntrypoint: "apps/cloud/src/paperTradingExecutionLoop",
    reach: "ON_RUNTIME_PATH",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: ""
  }),
  Object.freeze({
    stage: "Review",
    canonicalEntrypoint: "apps/cloud/src/reviewEngineV10",
    reach: "REGISTRY_ONLY",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker: "No caller outside the V10 registry."
  }),
  Object.freeze({
    stage: "Memory",
    canonicalEntrypoint: "packages/storage/src/memoryEngineV10",
    reach: "REGISTRY_ONLY",
    inputs: "PRODUCED_IN_TREE",
    requiredInputType: "",
    blocker:
      "A facade over four persistent memories the runtime still opens individually; nothing " +
      "outside the V10 registry goes through the facade."
  })
]);

/** Stages the V10 layer declares but no runtime code reaches. Empty means the layer is in front of the pipeline. */
export function stagesNotOnRuntimePath(): readonly StageWiring[] {
  return PIPELINE_WIRING_V10.filter(entry => entry.reach !== "ON_RUNTIME_PATH");
}

/** Stages that would abstain or run on a hand-built literal because nothing produces their input. */
export function stagesWithoutInputProducer(): readonly StageWiring[] {
  return PIPELINE_WIRING_V10.filter(entry => entry.inputs === "NO_PRODUCER_IN_TREE");
}

/**
 * True only when every stage is both reached by runtime code and fed by a producer in the tree.
 * Fails closed: a stage added without a declaration cannot make this true.
 */
export function isPipelineFullyWiredV10(): boolean {
  return stagesNotOnRuntimePath().length === 0 && stagesWithoutInputProducer().length === 0;
}
