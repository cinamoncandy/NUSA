import { collectGithubProgressEvidence, type GithubCommitEvidenceReceipt, type GithubWorkflowEvidenceReceipt } from "./nusaGithubProgressEvidence";
import { orchestrateNusaProgress, type NusaProgressOrchestrationResult } from "./nusaProgressOrchestration";
import { collectActualPaperRuntimeProgressEvidence, type ActualPaperRuntimeArtifactReceipt } from "./nusaProgressRuntimeEvidence";
import type { NusaProgressItemInput, NusaProgressScorecardPolicy } from "./nusaProgressScorecard";

export interface NusaWholeProgressSnapshotInput {
  readonly commit: GithubCommitEvidenceReceipt;
  readonly workflows: readonly GithubWorkflowEvidenceReceipt[];
  readonly requiredWorkflowNames: readonly string[];
  readonly actualPaperArtifact: ActualPaperRuntimeArtifactReceipt;
  readonly policy: NusaProgressScorecardPolicy;
}

export interface NusaWholeProgressSnapshot extends NusaProgressOrchestrationResult {
  readonly scope: "WHOLE_NUSA_EVIDENCE_BASELINE";
  readonly headSha: string;
  readonly blockers: readonly string[];
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Canonical whole-NUSA baseline. Only evidence classes with provenance adapters are allowed to
 * pass. Domains whose acceptance evidence does not yet have a canonical adapter are configured
 * explicitly with empty evidence and therefore remain UNKNOWN instead of disappearing from the
 * denominator or inheriting credit from weaker operational evidence.
 */
export function buildNusaWholeProgressSnapshot(input: NusaWholeProgressSnapshotInput): NusaWholeProgressSnapshot {
  const github = collectGithubProgressEvidence(input.commit, input.workflows, input.requiredWorkflowNames);
  const actualPaper = collectActualPaperRuntimeProgressEvidence(input.actualPaperArtifact, input.commit.sha);

  const items: readonly NusaProgressItemInput[] = freeze([
    freeze({ id: "verified-economic-edge", domain: "VERIFIED_ECONOMIC_EDGE", weight: 1, requiredAcceptance: "EVIDENCE_VERIFIED", evidence: freeze([]) }),
    freeze({ id: "autonomy-runtime", domain: "AUTONOMY", weight: 1, requiredAcceptance: "RUNTIME_VERIFIED", evidence: freeze([]) }),
    freeze({ id: "actual-paper-runtime", domain: "RELIABILITY_RECOVERY", weight: 1, requiredAcceptance: "EVIDENCE_VERIFIED", evidence: freeze([actualPaper.runtime, actualPaper.paper]) }),
    freeze({ id: "safety-research-integrity", domain: "SAFETY_RESEARCH_INTEGRITY", weight: 1, requiredAcceptance: "EVIDENCE_VERIFIED", evidence: freeze([]) }),
    freeze({ id: "product-physical-acceptance", domain: "PRODUCT_UX", weight: 1, requiredAcceptance: "PRODUCT_ACCEPTED", evidence: freeze([]) }),
    freeze({ id: "exact-head-repository-ci", domain: "INFRASTRUCTURE_MODULE_HEALTH", weight: 1, requiredAcceptance: "CODE_COMPLETE", evidence: freeze([github.repositoryEvidence, ...github.ciEvidence]) }),
  ]);

  const result = orchestrateNusaProgress(items, input.policy);
  const blockers = freeze(result.scorecard.items
    .filter((item) => item.status !== "PASS")
    .flatMap((item) => item.reasons.map((reason) => `${item.id}:${reason}`))
    .sort());

  return freeze({ ...result, scope: "WHOLE_NUSA_EVIDENCE_BASELINE", headSha: input.commit.sha, blockers });
}
