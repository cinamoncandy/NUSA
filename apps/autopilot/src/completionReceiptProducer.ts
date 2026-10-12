import type { AutopilotCompletionEvidence } from "./autopilotCompletionReceipt";
import type { CodingExecutionEvidence } from "./codingExecutionEvidence";
import type { GithubReleaseCompletionResolution } from "./githubReleaseCompletionResolver";
import { TRUSTED_RELEASE_AUTH_APP_ID } from "./githubReleaseCompletionResolver";

/**
 * Builds completion-receipt evidence from facts other components already verified; it classifies nothing and records
 * nothing (the coordinator does both). Returns null unless the release proof chain is complete AND the coding execution
 * evidence names the same pull request and head commit, which is the same identity rule the worker-outcome
 * verification already applies.
 *
 * What RELEASE_COMPLETE already proves (githubReleaseCompletionResolver + evaluateReleaseCompletion): the deterministic
 * Audit job succeeded, the trusted release app authorized the exact head, the canonical merge by the release creator
 * has parents (base, head), and CI plus convergence passed on the merge commit. The mapping below relies on that and on
 * the repository rule that the release authorization is only issued after exact-head CI and Audit; it does not
 * re-fetch them.
 */

// Mirrors scripts/autopilot-worker-deploy-scope.js (pinned by tests/autopilot-completion-receipt-producer.test.js).
const WORKER_RUNTIME_FILES = new Set(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "tsconfig.base.json"]);
const WORKER_RUNTIME_PREFIXES = ["apps/autopilot/", "packages/contracts/", "apps/cloud/"];

export function changesWorkerRuntime(files: readonly string[]): boolean {
  return files.some((file) => WORKER_RUNTIME_FILES.has(file) || WORKER_RUNTIME_PREFIXES.some((prefix) => file.startsWith(prefix)));
}

export interface RuntimeObservation {
  /** True only when the deployed Worker revision was shown to be the merge commit or a descendant of it. */
  readonly deployedRevisionIsDescendantOfMerged: boolean | null;
  /** True only when the running Worker reported a well-formed deployment revision with the fail-closed authority set. */
  readonly healthOk: boolean | null;
}

export const COMPLETION_MAX_ATTEMPTS = 3;

export function buildCompletionReceiptEvidence(
  coding: CodingExecutionEvidence,
  release: GithubReleaseCompletionResolution,
  runtime: RuntimeObservation | null,
): AutopilotCompletionEvidence | null {
  const { pullRequestNumber, commitSha, changedFiles } = coding.outcome;
  if (release.status !== "RELEASE_COMPLETE") return null;
  if (pullRequestNumber === null || commitSha === null) return null;
  if (release.pullRequestNumber !== pullRequestNumber || release.expectedHeadSha !== commitSha) return null;
  const required = changesWorkerRuntime(changedFiles);
  return Object.freeze({
    task: Object.freeze({ executionId: coding.request.executionId, dedupeKey: coding.request.dedupeKey }),
    // One recorded execution produced this change; the retry budget is the fixed policy constant.
    remediation: Object.freeze({ outcome: "CHANGE_PRODUCED" as const, attempts: 1, maxAttempts: COMPLETION_MAX_ATTEMPTS }),
    change: Object.freeze({ headSha: commitSha, changedFiles: Object.freeze([...changedFiles]), pullRequestNumber }),
    ci: Object.freeze({ conclusion: "success", headSha: release.expectedHeadSha }),
    audit: Object.freeze({ independentApproval: true, auditedHeadSha: release.expectedHeadSha, approvedByAppId: TRUSTED_RELEASE_AUTH_APP_ID }),
    release: Object.freeze({ status: release.status, mergedSha: release.mergedSha }),
    runtime: Object.freeze({
      required,
      deployedRevisionIsDescendantOfMerged: required ? (runtime?.deployedRevisionIsDescendantOfMerged ?? null) : null,
      healthOk: required ? (runtime?.healthOk ?? null) : null,
    }),
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

const SHA40 = /^[0-9a-f]{40}$/;

/**
 * Observes whether the running Worker revision is the merge commit or a descendant of it, using the GitHub compare API.
 * Any failure yields null (reported as missing evidence), never a guess.
 */
export async function observeWorkerRuntime(
  deployedRevision: string | undefined,
  mergedSha: string | null,
  config: { readonly token?: string; readonly allowedRepository: string; readonly apiBaseUrl?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<RuntimeObservation | null> {
  const revision = deployedRevision?.trim().toLowerCase() ?? "";
  const merged = mergedSha?.toLowerCase() ?? "";
  const token = config.token?.trim();
  if (!token || !SHA40.test(revision) || !SHA40.test(merged) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.allowedRepository)) return null;
  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  try {
    const response = await fetchImpl(`${base}/repos/${config.allowedRepository}/compare/${merged}...${revision}`, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "user-agent": "nusa-autopilot" },
    });
    if (!response.ok) return null;
    const body = await response.json() as { status?: unknown };
    return Object.freeze({
      deployedRevisionIsDescendantOfMerged: body.status === "ahead" || body.status === "identical",
      // This Worker is the runtime: it is serving with a well-formed revision and the fixed fail-closed authority set.
      healthOk: true,
    });
  } catch {
    return null;
  }
}
