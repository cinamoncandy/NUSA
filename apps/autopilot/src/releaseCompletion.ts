export type ReleaseCompletionStatus =
  | "RELEASE_NOT_APPLICABLE"
  | "RELEASE_PROVENANCE_MISSING"
  | "NOT_RELEASED"
  | "CONVERGENCE_INCOMPLETE"
  | "RELEASE_COMPLETE";

export interface ReleaseCompletionEvidence {
  readonly outerWorkflowConclusion: string | null;
  readonly applicable: boolean;
  readonly auditAuthority: "DETERMINISTIC_AUDIT_PASS" | "NONE" | "UNKNOWN";
  readonly releaseJobConclusion: "success" | "failure" | "skipped" | "cancelled" | "unknown";
  readonly expectedHeadSha: string;
  readonly expectedBaseSha: string;
  readonly authorization: Readonly<{
    present: boolean;
    headSha: string | null;
    appId: string | null;
    expectedAppId: string | null;
  }>;
  readonly merge: Readonly<{
    succeeded: boolean;
    headSha: string | null;
    baseSha: string | null;
    mergedSha: string | null;
    parentsVerified: boolean;
  }>;
  readonly postMerge: Readonly<{
    ciPassed: boolean;
    provenanceSha: string | null;
    runtimeDeploymentProvenanceComplete: boolean;
  }>;
}

const SHA40 = /^[0-9a-f]{40}$/i;

export function evaluateReleaseCompletion(evidence: ReleaseCompletionEvidence): ReleaseCompletionStatus {
  if (!evidence.applicable || evidence.auditAuthority === "NONE" || evidence.releaseJobConclusion === "skipped") {
    return "RELEASE_NOT_APPLICABLE";
  }

  if (evidence.auditAuthority !== "DETERMINISTIC_AUDIT_PASS") return "NOT_RELEASED";
  if (evidence.releaseJobConclusion !== "success") return "NOT_RELEASED";

  const expectedHead = evidence.expectedHeadSha.toLowerCase();
  const expectedBase = evidence.expectedBaseSha.toLowerCase();
  const authorizationHead = evidence.authorization.headSha?.toLowerCase() ?? null;
  if (!SHA40.test(expectedHead) || !SHA40.test(expectedBase)
    || !evidence.authorization.present
    || authorizationHead !== expectedHead
    || !evidence.authorization.expectedAppId
    || evidence.authorization.appId !== evidence.authorization.expectedAppId) {
    return "RELEASE_PROVENANCE_MISSING";
  }

  if (!evidence.merge.succeeded
    || evidence.merge.headSha?.toLowerCase() !== expectedHead
    || evidence.merge.baseSha?.toLowerCase() !== expectedBase
    || !evidence.merge.mergedSha
    || !SHA40.test(evidence.merge.mergedSha)
    || !evidence.merge.parentsVerified) {
    return "NOT_RELEASED";
  }

  if (!evidence.postMerge.ciPassed
    || evidence.postMerge.provenanceSha?.toLowerCase() !== evidence.merge.mergedSha.toLowerCase()
    || !evidence.postMerge.runtimeDeploymentProvenanceComplete) {
    return "CONVERGENCE_INCOMPLETE";
  }

  return "RELEASE_COMPLETE";
}
