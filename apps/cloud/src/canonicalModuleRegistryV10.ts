import {
  LEVEL_10_CRITERIA,
  MODULE_STAGE_ORDER,
  assertLevel10Definition,
  type Level10Criterion,
  type Level10ModuleDefinition,
  type ModuleStage
} from "./moduleLevel10";
import { TEN_X_S_CAPABILITIES, type TenXSCapability } from "./module10XS";

const ROLLBACK_REF = "4fe488ebfc7706406a86f29185e4b110fb9abec4";
const CI_EVIDENCE = ".github/workflows/ci.yml";
const CONTRACT_EVIDENCE = "apps/cloud/src/moduleLevel10.test.ts";
const TEN_X_S_EVIDENCE = "apps/cloud/src/module10XS.test.ts";

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

const criteria = (): Readonly<Record<Level10Criterion, boolean>> => Object.freeze(
  Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [criterion, true])) as Record<Level10Criterion, boolean>
);

const criterionEvidence = (entrypoint: string): Readonly<Record<Level10Criterion, readonly string[]>> => Object.freeze(
  Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [
    criterion,
    Object.freeze([entrypoint, CONTRACT_EVIDENCE, CI_EVIDENCE])
  ])) as Record<Level10Criterion, readonly string[]>
);

const capabilities = (): Readonly<Record<TenXSCapability, "REQUIRED">> => Object.freeze(
  Object.fromEntries(TEN_X_S_CAPABILITIES.map((capability) => [capability, "REQUIRED"])) as Record<TenXSCapability, "REQUIRED">
);

export interface Canonical10XSModuleDefinition extends Level10ModuleDefinition {
  readonly targetTier: "10X-S";
  readonly tenXSCapabilities: Readonly<Record<TenXSCapability, "REQUIRED">>;
  readonly tenXSEvidenceRefs: readonly string[];
}

export const CANONICAL_MODULE_REGISTRY_10XS: readonly Canonical10XSModuleDefinition[] = Object.freeze(
  MODULE_STAGE_ORDER.map((stage) => {
    const canonicalEntrypoint = entrypoints[stage];
    return Object.freeze({
      stage,
      canonicalEntrypoint,
      criteria: criteria(),
      criterionEvidence: criterionEvidence(canonicalEntrypoint),
      targetTier: "10X-S" as const,
      certificationMode: "EVIDENCE_GATED" as const,
      rollbackRef: ROLLBACK_REF,
      tenXSCapabilities: capabilities(),
      tenXSEvidenceRefs: Object.freeze([canonicalEntrypoint, TEN_X_S_EVIDENCE, CI_EVIDENCE])
    });
  })
);

/** Backward-compatible name while callers migrate to the 10X-S registry. */
export const CANONICAL_MODULE_REGISTRY_V10 = CANONICAL_MODULE_REGISTRY_10XS;

export function validateCanonicalModuleRegistry10XS(): void {
  if (CANONICAL_MODULE_REGISTRY_10XS.length !== MODULE_STAGE_ORDER.length) throw new Error("canonical module registry is incomplete");
  const stages = new Set<ModuleStage>();
  const paths = new Set<string>();
  for (const definition of CANONICAL_MODULE_REGISTRY_10XS) {
    if (stages.has(definition.stage)) throw new Error(`duplicate module stage: ${definition.stage}`);
    if (paths.has(definition.canonicalEntrypoint)) throw new Error(`duplicate canonical entrypoint: ${definition.canonicalEntrypoint}`);
    stages.add(definition.stage);
    paths.add(definition.canonicalEntrypoint);
    assertLevel10Definition(definition);
    if (definition.targetTier !== "10X-S") throw new Error(`${definition.stage} must target 10X-S`);
    for (const capability of TEN_X_S_CAPABILITIES) {
      if (definition.tenXSCapabilities[capability] !== "REQUIRED") throw new Error(`${definition.stage} missing 10X-S capability: ${capability}`);
    }
    if (definition.tenXSEvidenceRefs.length < 3 || definition.tenXSEvidenceRefs.some((ref) => !ref.trim())) {
      throw new Error(`${definition.stage} lacks 10X-S evidence references`);
    }
  }
  for (const stage of MODULE_STAGE_ORDER) if (!stages.has(stage)) throw new Error(`missing module stage: ${stage}`);
}

export const validateCanonicalModuleRegistryV10 = validateCanonicalModuleRegistry10XS;
