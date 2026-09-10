import type { ModuleStage } from "./moduleLevel10";
import type { TenXSCertificationResult } from "./module10XS";

export type TenXSChallengerComparison = "BETTER" | "NOT_BETTER" | "UNVERIFIED";
export type TenXSModuleReplacementAction = "KEEP_INCUMBENT" | "PROMOTE_CANDIDATE" | "ROLLBACK_LKG";

export interface ModuleReplacementInput10XS {
  readonly stage: ModuleStage;
  readonly incumbentRef: string;
  readonly candidateRef: string;
  readonly lastKnownGoodRef: string;
  readonly incumbentCertification: TenXSCertificationResult;
  readonly candidateCertification: TenXSCertificationResult;
  readonly comparison: TenXSChallengerComparison;
}

export interface ModuleReplacementDecision10XS {
  readonly stage: ModuleStage;
  readonly action: TenXSModuleReplacementAction;
  readonly selectedRef: string;
  readonly authority: "SELECTION_ONLY";
  readonly productionMutationAllowed: false;
  readonly reasons: readonly string[];
}

const SHA40 = /^[0-9a-f]{40}$/;

function assertRef(name: string, value: string): void {
  if (!SHA40.test(value)) throw new Error(`${name} must be a 40-character commit SHA`);
}

export function selectModuleVersion10XS(input: ModuleReplacementInput10XS): ModuleReplacementDecision10XS {
  assertRef("incumbentRef", input.incumbentRef);
  assertRef("candidateRef", input.candidateRef);
  assertRef("lastKnownGoodRef", input.lastKnownGoodRef);
  if (input.incumbentCertification.stage !== input.stage) throw new Error("incumbent certification stage mismatch");
  if (input.candidateCertification.stage !== input.stage) throw new Error("candidate certification stage mismatch");

  if (input.incumbentCertification.status === "QUARANTINED") {
    return Object.freeze({
      stage: input.stage,
      action: "ROLLBACK_LKG",
      selectedRef: input.lastKnownGoodRef,
      authority: "SELECTION_ONLY",
      productionMutationAllowed: false,
      reasons: Object.freeze(["INCUMBENT_QUARANTINED", ...input.incumbentCertification.reasons].sort())
    });
  }

  const candidateCertified = input.candidateCertification.status === "CERTIFIED" && input.candidateCertification.effectiveTier === "10X-S";
  if (candidateCertified && input.comparison === "BETTER") {
    return Object.freeze({
      stage: input.stage,
      action: "PROMOTE_CANDIDATE",
      selectedRef: input.candidateRef,
      authority: "SELECTION_ONLY",
      productionMutationAllowed: false,
      reasons: Object.freeze(["CANDIDATE_10X_S_CERTIFIED", "CHALLENGER_PROVEN_BETTER"])
    });
  }

  const reasons = [
    ...(candidateCertified ? [] : ["CANDIDATE_NOT_10X_S_CERTIFIED"]),
    ...(input.comparison === "BETTER" ? [] : [`CHALLENGER_${input.comparison}`])
  ].sort();
  return Object.freeze({
    stage: input.stage,
    action: "KEEP_INCUMBENT",
    selectedRef: input.incumbentRef,
    authority: "SELECTION_ONLY",
    productionMutationAllowed: false,
    reasons: Object.freeze(reasons)
  });
}
