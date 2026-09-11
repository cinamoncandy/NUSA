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
import {
  MODULE_QUALIFICATION_RECORDS_V1,
  isLevel10Qualified,
  qualificationBooleans,
  qualificationEvidence,
  type ModuleQualificationV1
} from "./moduleQualificationV1";

const capabilities = (): Readonly<Record<TenXSCapability, "REQUIRED">> => Object.freeze(
  Object.fromEntries(TEN_X_S_CAPABILITIES.map((capability) => [capability, "REQUIRED"])) as Record<TenXSCapability, "REQUIRED">
);

export interface Canonical10XSModuleDefinition extends Level10ModuleDefinition {
  readonly targetTier: "10X-S";
  readonly runtimeEntrypoint: string;
  readonly qualificationStatus: "QUALIFIED" | "TARGET_ONLY";
  readonly qualification: ModuleQualificationV1;
  readonly tenXSCapabilities: Readonly<Record<TenXSCapability, "REQUIRED">>;
  readonly tenXSEvidenceRefs: readonly string[];
}

export const CANONICAL_MODULE_REGISTRY_10XS: readonly Canonical10XSModuleDefinition[] = Object.freeze(
  MODULE_STAGE_ORDER.map((stage) => {
    const binding = MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage];
    const qualification = MODULE_QUALIFICATION_RECORDS_V1[stage];
    const qualified = isLevel10Qualified(qualification);
    return Object.freeze({
      stage,
      canonicalEntrypoint: binding.canonicalEntrypoint,
      runtimeEntrypoint: binding.runtimeEntrypoint,
      criteria: qualificationBooleans(qualification),
      criterionEvidence: qualificationEvidence(qualification),
      targetTier: "10X-S" as const,
      certificationMode: "EVIDENCE_GATED" as const,
      rollbackRef: binding.lastKnownGoodRef,
      qualificationStatus: qualified ? "QUALIFIED" as const : "TARGET_ONLY" as const,
      qualification,
      tenXSCapabilities: capabilities(),
      tenXSEvidenceRefs: binding.evidenceRefs
    });
  })
);

/** Backward-compatible name while callers migrate to the 10X-S target registry. */
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

    if (!definition.canonicalEntrypoint.trim()) throw new Error(`${definition.stage} canonical entrypoint is required`);
    if (!definition.runtimeEntrypoint.trim()) throw new Error(`${definition.stage} runtime entrypoint is required`);
    if (!definition.rollbackRef.trim()) throw new Error(`${definition.stage} rollback ref is required`);
    if (definition.certificationMode !== "EVIDENCE_GATED") throw new Error(`${definition.stage} certification must be evidence-gated`);
    if (definition.targetTier !== "10X-S") throw new Error(`${definition.stage} must target 10X-S`);
    if (definition.qualification.stage !== definition.stage) throw new Error(`${definition.stage} qualification stage mismatch`);
    if (definition.qualification.sourceRef !== definition.canonicalEntrypoint) throw new Error(`${definition.stage} qualification source mismatch`);

    const actuallyQualified = isLevel10Qualified(definition.qualification);
    if (definition.qualificationStatus === "QUALIFIED") {
      if (!actuallyQualified) throw new Error(`${definition.stage} cannot claim QUALIFIED without complete independent evidence`);
      assertLevel10Definition(definition);
    } else if (actuallyQualified) {
      throw new Error(`${definition.stage} has complete evidence but remains TARGET_ONLY`);
    }

    for (const criterion of LEVEL_10_CRITERIA) {
      const expected = definition.qualification.criteria[criterion];
      if (definition.criteria[criterion] !== (expected.status === "VERIFIED")) throw new Error(`${definition.stage} criterion truth drift: ${criterion}`);
      if (JSON.stringify(definition.criterionEvidence[criterion]) !== JSON.stringify(expected.evidenceRefs)) throw new Error(`${definition.stage} criterion evidence drift: ${criterion}`);
    }
    for (const capability of TEN_X_S_CAPABILITIES) {
      if (definition.tenXSCapabilities[capability] !== "REQUIRED") throw new Error(`${definition.stage} missing 10X-S target capability: ${capability}`);
    }
    if (definition.tenXSEvidenceRefs.length < 3 || definition.tenXSEvidenceRefs.some((ref) => !ref.trim())) {
      throw new Error(`${definition.stage} lacks 10X-S target evidence references`);
    }
    if (!definition.tenXSEvidenceRefs.includes(definition.canonicalEntrypoint)) {
      throw new Error(`${definition.stage} target evidence does not include canonical entrypoint`);
    }
    if (!definition.tenXSEvidenceRefs.includes(definition.runtimeEntrypoint)) {
      throw new Error(`${definition.stage} target evidence does not include runtime entrypoint`);
    }
  }
  for (const stage of MODULE_STAGE_ORDER) if (!stages.has(stage)) throw new Error(`missing module stage: ${stage}`);
}

export const validateCanonicalModuleRegistryV10 = validateCanonicalModuleRegistry10XS;
