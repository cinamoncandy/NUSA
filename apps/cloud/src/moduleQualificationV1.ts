import {
  LEVEL_10_CRITERIA,
  type Level10Criterion,
  type ModuleStage
} from "./moduleLevel10";
import { MODULE_RUNTIME_BINDING_BY_STAGE_10XS } from "./moduleRuntimeManifest10XS";

export type ModuleCriterionVerification = "VERIFIED" | "UNVERIFIED" | "FAILED";

export interface ModuleCriterionQualificationV1 {
  readonly status: ModuleCriterionVerification;
  readonly evidenceRefs: readonly string[];
  readonly reason: string;
}

export interface ModuleQualificationV1 {
  readonly schemaVersion: 1;
  readonly stage: ModuleStage;
  readonly sourceCommitSha: string;
  readonly sourceRef: string;
  readonly verificationAuthority: "INDEPENDENT_EVIDENCE_REQUIRED";
  readonly criteria: Readonly<Record<Level10Criterion, ModuleCriterionQualificationV1>>;
}

// Exact repository snapshot audited by module management. A later source change must be
// re-qualified rather than inheriting this record by name or target tier.
export const MODULE_QUALIFICATION_SOURCE_COMMIT_V1 = "c8095fe38d2ea097fbe167819ccf19f4260a7271";

const entrypointEvidence = (stage: ModuleStage): readonly string[] => Object.freeze([
  MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].canonicalEntrypoint,
  MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].runtimeEntrypoint,
  "apps/cloud/src/moduleRuntimeManifest10XS.test.ts"
]);

function criteriaFor(stage: ModuleStage): Readonly<Record<Level10Criterion, ModuleCriterionQualificationV1>> {
  return Object.freeze(Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => {
    if (criterion === "CANONICAL_ENTRYPOINT") {
      return [criterion, Object.freeze({
        status: "VERIFIED" as const,
        evidenceRefs: entrypointEvidence(stage),
        reason: "canonical and runtime entrypoints are repository-bound and covered by runtime-truth validation"
      })];
    }
    return [criterion, Object.freeze({
      status: "UNVERIFIED" as const,
      evidenceRefs: Object.freeze([]),
      reason: "independent exact-source criterion evidence has not been attached"
    })];
  })) as Record<Level10Criterion, ModuleCriterionQualificationV1>);
}

export const MODULE_QUALIFICATION_RECORDS_V1: Readonly<Record<ModuleStage, ModuleQualificationV1>> = Object.freeze(
  Object.fromEntries((Object.keys(MODULE_RUNTIME_BINDING_BY_STAGE_10XS) as ModuleStage[]).map((stage) => [stage, Object.freeze({
    schemaVersion: 1 as const,
    stage,
    sourceCommitSha: MODULE_QUALIFICATION_SOURCE_COMMIT_V1,
    sourceRef: MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].canonicalEntrypoint,
    verificationAuthority: "INDEPENDENT_EVIDENCE_REQUIRED" as const,
    criteria: criteriaFor(stage)
  })])) as Record<ModuleStage, ModuleQualificationV1>
);

export function isLevel10Qualified(record: ModuleQualificationV1): boolean {
  if (!/^[0-9a-f]{40}$/.test(record.sourceCommitSha)) return false;
  if (!record.sourceRef.trim() || record.verificationAuthority !== "INDEPENDENT_EVIDENCE_REQUIRED") return false;
  return LEVEL_10_CRITERIA.every((criterion) => {
    const qualification = record.criteria[criterion];
    return qualification.status === "VERIFIED"
      && qualification.evidenceRefs.length > 0
      && qualification.evidenceRefs.every((ref) => ref.trim().length > 0);
  });
}

export function qualificationBooleans(record: ModuleQualificationV1): Readonly<Record<Level10Criterion, boolean>> {
  return Object.freeze(Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [
    criterion,
    record.criteria[criterion].status === "VERIFIED"
  ])) as Record<Level10Criterion, boolean>);
}

export function qualificationEvidence(record: ModuleQualificationV1): Readonly<Record<Level10Criterion, readonly string[]>> {
  return Object.freeze(Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => [
    criterion,
    record.criteria[criterion].evidenceRefs
  ])) as Record<Level10Criterion, readonly string[]>);
}
