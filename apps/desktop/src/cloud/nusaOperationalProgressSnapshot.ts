import { collectGithubProgressEvidence, type GithubCommitEvidenceReceipt, type GithubWorkflowEvidenceReceipt } from "./nusaGithubProgressEvidence";
import { projectNusaEngineeringExecutionOrigin, type NusaEngineeringExecutionEvidence, type NusaEngineeringExecutionOriginProjection } from "./nusaEngineeringExecutionOrigin";
import { orchestrateNusaProgress, type NusaProgressOrchestrationResult } from "./nusaProgressOrchestration";
import { collectActualPaperRuntimeProgressEvidence, type ActualPaperRuntimeArtifactReceipt } from "./nusaProgressRuntimeEvidence";
import type { NusaProgressItemInput, NusaProgressScorecardPolicy } from "./nusaProgressScorecard";

export interface NusaOperationalProgressSnapshotInput {
  readonly commit: GithubCommitEvidenceReceipt;
  readonly workflows: readonly GithubWorkflowEvidenceReceipt[];
  readonly requiredWorkflowNames: readonly string[];
  readonly actualPaperArtifact: ActualPaperRuntimeArtifactReceipt;
  readonly executionEvidence: NusaEngineeringExecutionEvidence | null;
  readonly policy: NusaProgressScorecardPolicy;
}

export interface NusaOperationalProgressSnapshot extends NusaProgressOrchestrationResult {
  readonly scope: "OPERATIONAL_EVIDENCE_ONLY";
  readonly headSha: string;
  readonly blockers: readonly string[];
  readonly executionOrigin: NusaEngineeringExecutionOriginProjection;
}

const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

/**
 * Builds the evidence-backed operational slice of NUSA progress from canonical GitHub and Actual
 * PAPER receipts. This deliberately does not claim whole-product completion: DEVICE, HUMAN,
 * CONNECTED broker, research-edge, and other evidence classes remain outside this snapshot until
 * their own provenance adapters exist.
 */
export function buildNusaOperationalProgressSnapshot(input: NusaOperationalProgressSnapshotInput): NusaOperationalProgressSnapshot {
  const github = collectGithubProgressEvidence(input.commit, input.workflows, input.requiredWorkflowNames);
  const actualPaper = collectActualPaperRuntimeProgressEvidence(input.actualPaperArtifact, input.commit.sha);
  const executionOrigin = projectNusaEngineeringExecutionOrigin(input.executionEvidence);

  const items: readonly NusaProgressItemInput[] = freeze([
    freeze({
      id: "exact-head-repository-ci",
      domain: "INFRASTRUCTURE_MODULE_HEALTH",
      weight: 1,
      requiredAcceptance: "CODE_COMPLETE",
      evidence: freeze([github.repositoryEvidence, ...github.ciEvidence]),
    }),
    freeze({
      id: "actual-paper-runtime",
      domain: "RELIABILITY_RECOVERY",
      weight: 1,
      requiredAcceptance: "EVIDENCE_VERIFIED",
      evidence: freeze([actualPaper.runtime, actualPaper.paper]),
    }),
  ]);

  const result = orchestrateNusaProgress(items, input.policy);
  const blockers = freeze(result.scorecard.items
    .filter((item) => item.status !== "PASS")
    .flatMap((item) => item.reasons.map((reason) => `${item.id}:${reason}`))
    .concat(executionOrigin.status === "VERIFIED" ? [] : executionOrigin.reasons.map((reason) => `execution-origin:${reason}`))
    .sort());

  return freeze({
    ...result,
    scope: "OPERATIONAL_EVIDENCE_ONLY",
    headSha: input.commit.sha,
    blockers,
    executionOrigin,
  });
}
