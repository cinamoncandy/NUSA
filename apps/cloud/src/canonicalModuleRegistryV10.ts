import {
  LEVEL_10_CRITERIA,
  MODULE_STAGE_ORDER,
  assertLevel10Definition,
  type Level10Criterion,
  type Level10ModuleDefinition,
  type ModuleStage
} from "./moduleLevel10";
import { TEN_X_S_CAPABILITIES, type TenXSCapability } from "./module10XS";
import { MODULE_RUNTIME_BINDING_BY_STAGE_10XS } from "./moduleRuntimeManifest10XS";

const criteria = (): Readonly<Record<Level10Criterion, boolean>> => Object.freeze(
  Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [criterion, true])) as Record<Level10Criterion, boolean>
);

const criterionEvidence = (stage: ModuleStage): Readonly<Record<Level10Criterion, readonly string[]>> => {
  const binding = MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage];
  return Object.freeze(
    Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [criterion, binding.evidenceRefs])) as Record<Level10Criterion, readonly string[]>
  );
};

const capabilities = (): Readonly<Record<TenXSCapability, "REQUIRED">> => Object.freeze(
  Object.fromEntries(TEN_X_S_CAPABILITIES.map((capability) => [capability, "REQUIRED"])) as Record<TenXSCapability, "REQUIRED">
);

export interface Canonical10XSModuleDefinition extends Level10ModuleDefinition {
  readonly targetTier: "10X-S";
  readonly runtimeEntrypoint: string;
  readonly tenXSCapabilities: Readonly<Record<TenXSCapability, "REQUIRED">>;
  readonly tenXSEvidenceRefs: readonly string[];
}

export const CANONICAL_MODULE_REGISTRY_10XS: readonly Canonical10XSModuleDefinition[] = Object.freeze(
  MODULE_STAGE_ORDER.map((stage) => {
    const binding = MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage];
    return Object.freeze({
      stage,
      canonicalEntrypoint: binding.canonicalEntrypoint,
      runtimeEntrypoint: binding.runtimeEntrypoint,
      criteria: criteria(),
      criterionEvidence: criterionEvidence(stage),
      targetTier: "10X-S" as const,
      certificationMode: "EVIDENCE_GATED" as const,
      rollbackRef: binding.lastKnownGoodRef,
      tenXSCapabilities: capabilities(),
      tenXSEvidenceRefs: binding.evidenceRefs
    });
  })
);

/** Backward-compatible name while callers migrate to the 10X-S registry. */
export const CANONICAL_MODULE_REGISTRY_V10 = CANONICAL_MODULE_REGISTRY_10XS;

export function validateCanonicalModuleRegistry10XS(): void {
  if (CANONICAL_MODULE_REGISTRY_10XS.length !== MODULE_STAGE_ORDER.length) throw new Error("canonical module registry is incomplete");
  const stages = new Set<ModuleStage>();
  const canonicalPaths = new Set<string>();
  for (const definition of CANONICAL_MODULE_REGISTRY_10XS) {
    if (stages.has(definition.stage)) throw new Error(`duplicate module stage: ${definition.stage}`);
    if (canonicalPaths.has(definition.canonicalEntrypoint)) throw new Error(`duplicate canonical entrypoint: ${definition.canonicalEntrypoint}`);
    stages.add(definition.stage);
    canonicalPaths.add(definition.canonicalEntrypoint);
    assertLevel10Definition(definition);
    if (!definition.runtimeEntrypoint.trim()) throw new Error(`${definition.stage} runtime entrypoint is required`);
    if (definition.targetTier !== "10X-S") throw new Error(`${definition.stage} must target 10X-S`);
    for (const capability of TEN_X_S_CAPABILITIES) {
      if (definition.tenXSCapabilities[capability] !== "REQUIRED") throw new Error(`${definition.stage} missing 10X-S capability: ${capability}`);
    }
    if (definition.tenXSEvidenceRefs.length < 3 || definition.tenXSEvidenceRefs.some((ref) => !ref.trim())) {
      throw new Error(`${definition.stage} lacks 10X-S evidence references`);
    }
    if (!definition.tenXSEvidenceRefs.includes(definition.canonicalEntrypoint)) {
      throw new Error(`${definition.stage} evidence does not include canonical entrypoint`);
    }
    if (!definition.tenXSEvidenceRefs.includes(definition.runtimeEntrypoint)) {
      throw new Error(`${definition.stage} evidence does not include runtime entrypoint`);
    }
  }
  for (const stage of MODULE_STAGE_ORDER) if (!stages.has(stage)) throw new Error(`missing module stage: ${stage}`);
}

export const validateCanonicalModuleRegistryV10 = validateCanonicalModuleRegistry10XS;
