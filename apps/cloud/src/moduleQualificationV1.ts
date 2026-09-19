import {
  LEVEL_10_CRITERIA,
  MODULE_STAGE_ORDER,
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
  readonly sourceBlobSha: string;
  readonly sourceRef: string;
  readonly verificationAuthority: "INDEPENDENT_EVIDENCE_REQUIRED";
  readonly criteria: Readonly<Record<Level10Criterion, ModuleCriterionQualificationV1>>;
}

// Exact repository snapshot audited by module management. A later source change must be
// re-qualified rather than inheriting this record by name or target tier.
export const MODULE_QUALIFICATION_SOURCE_COMMIT_V1 = "70bb76cb51c567bbc9f6131e78551add2a20809e";

export const MODULE_QUALIFICATION_SOURCE_BLOB_BY_STAGE_V1: Readonly<Record<ModuleStage, string>> = Object.freeze({
  MARKET_DATA: "6b64eeb212895e5d65fc0a6b3d01ce542914119d",
  INTELLIGENCE: "c0286d1056d554e1a9be604c2b9fe1eb02a9f8d9",
  STRATEGY: "6f7395f2e37db73df42bc33d0a697020d38b8d7c",
  DECISION: "904b3e78562ca3f2350133942d2743ac49babd51",
  RISK: "6855fa2d6427d3f4dd43c3ad8d6ffab15d3f81dd",
  PORTFOLIO: "8da5e80589e03004c3d4147528b97da5c473c40a",
  EXECUTION: "ba7fcec8f1421f5fd20d755d9f91804ad02b8da3",
  PAPER_ADAPTER: "bb53855ac6c2e8339e36007fab4e72b495ccc968",
  REVIEW: "675b11025fda5678f152f98277a2b527141c8b7c",
  MEMORY: "70bf43e419fb36b453f634505cd09bb0ca50343c"
});

const entrypointEvidence = (stage: ModuleStage, sourceBlobSha: string): readonly string[] => Object.freeze([
  MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].canonicalEntrypoint,
  MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].runtimeEntrypoint,
  `gitblob:${sourceBlobSha}:${MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].canonicalEntrypoint}`,
  "apps/cloud/src/moduleRuntimeManifest10XS.test.ts"
]);

function criteriaFor(stage: ModuleStage, sourceBlobSha: string): Readonly<Record<Level10Criterion, ModuleCriterionQualificationV1>> {
  return Object.freeze(Object.fromEntries(LEVEL_10_CRITERIA.map((criterion) => {
    if (criterion === "CANONICAL_ENTRYPOINT") {
      return [criterion, Object.freeze({
        status: "VERIFIED" as const,
        evidenceRefs: entrypointEvidence(stage, sourceBlobSha),
        reason: "canonical and runtime entrypoints are repository-bound, source-fingerprinted, and covered by runtime-truth validation"
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
  Object.fromEntries(MODULE_STAGE_ORDER.map((stage) => {
    const sourceBlobSha = MODULE_QUALIFICATION_SOURCE_BLOB_BY_STAGE_V1[stage];
    return [stage, Object.freeze({
      schemaVersion: 1 as const,
      stage,
      sourceCommitSha: MODULE_QUALIFICATION_SOURCE_COMMIT_V1,
      sourceBlobSha,
      sourceRef: MODULE_RUNTIME_BINDING_BY_STAGE_10XS[stage].canonicalEntrypoint,
      verificationAuthority: "INDEPENDENT_EVIDENCE_REQUIRED" as const,
      criteria: criteriaFor(stage, sourceBlobSha)
    })];
  })) as Record<ModuleStage, ModuleQualificationV1>
);

export function isLevel10Qualified(record: ModuleQualificationV1): boolean {
  if (!/^[0-9a-f]{40}$/.test(record.sourceCommitSha)) return false;
  if (!/^[0-9a-f]{40}$/.test(record.sourceBlobSha)) return false;
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
