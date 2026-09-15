import { evaluateReleaseCompletion, type ReleaseCompletionEvidence, type ReleaseCompletionStatus } from "./releaseCompletion";

export const TRUSTED_RELEASE_AUTH_APP_ID = "4935691";
const RELEASE_CONTEXT = "nusa/release-authorized";
const RELEASE_CREATOR = "nusa-release-authority[bot]";
const RELEASE_WORKFLOW = "Autopilot Deterministic Audit Release";
const RELEASE_WORKFLOW_PATH = ".github/workflows/autopilot-deterministic-audit-release.yml";
const CONVERGENCE_WORKFLOW = "Deployment Convergence Receipt";
const CI_WORKFLOW = "CI";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const SHA40 = /^[0-9a-f]{40}$/i;

export interface GithubReleaseCompletionConfig {
  readonly token?: string;
  readonly allowedRepository: string;
  readonly apiBaseUrl?: string;
}

export interface GithubReleaseCompletionResolution {
  readonly status: ReleaseCompletionStatus;
  readonly reason: string;
  readonly pullRequestNumber: number;
  readonly releaseWorkflowRunId: number | null;
  readonly expectedHeadSha: string | null;
  readonly expectedBaseSha: string | null;
  readonly mergedSha: string | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

type JsonObject = Record<string, unknown>;
type FetchImpl = typeof fetch;

const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 ? value : null;
const bool = (value: unknown): boolean => value === true;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

function resolution(
  pullRequestNumber: number,
  status: ReleaseCompletionStatus,
  reason: string,
  details: Partial<Pick<GithubReleaseCompletionResolution, "releaseWorkflowRunId" | "expectedHeadSha" | "expectedBaseSha" | "mergedSha">> = {},
): GithubReleaseCompletionResolution {
  return Object.freeze({
    status,
    reason,
    pullRequestNumber,
    releaseWorkflowRunId: details.releaseWorkflowRunId ?? null,
    expectedHeadSha: details.expectedHeadSha ?? null,
    expectedBaseSha: details.expectedBaseSha ?? null,
    mergedSha: details.mergedSha ?? null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function headers(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-autopilot-release-provenance",
    "x-github-api-version": "2022-11-28",
  };
}

async function githubJson(base: string, path: string, token: string, fetchImpl: FetchImpl): Promise<unknown> {
  const response = await fetchImpl(`${base}${path}`, { headers: headers(token) });
  if (!response.ok) throw new Error(`GITHUB_RELEASE_PROVENANCE_HTTP_${response.status}`);
  return response.json();
}

function releaseStatusBinding(branch: JsonObject): boolean {
  const checks = array(object(object(branch.protection)?.required_status_checks)?.checks);
  return checks.some((value) => {
    const check = object(value);
    return check?.context === RELEASE_CONTEXT && positiveInteger(check.app_id) === Number(TRUSTED_RELEASE_AUTH_APP_ID);
  });
}

function parseAuthorizationDescription(description: string | null, prNumber: number): string | null {
  if (!description) return null;
  const match = description.match(/^canonical Audit PASS; pr=(\d+); base=([0-9a-f]{40})$/i);
  if (!match || Number(match[1]) !== prNumber) return null;
  return match[2]!.toLowerCase();
}

function parseReleaseRunId(targetUrl: string | null): number | null {
  if (!targetUrl) return null;
  const match = targetUrl.match(/\/actions\/runs\/(\d+)\/?$/);
  return match ? positiveInteger(Number(match[1])) : null;
}

function latestReleaseAuthorization(statusesPayload: unknown): JsonObject | null {
  const statuses = array(statusesPayload)
    .map(object)
    .filter((value): value is JsonObject => value !== null && value.context === RELEASE_CONTEXT)
    .sort((left, right) => {
      const leftTime = Date.parse(text(left.updated_at) ?? text(left.created_at) ?? "") || 0;
      const rightTime = Date.parse(text(right.updated_at) ?? text(right.created_at) ?? "") || 0;
      return rightTime - leftTime || (positiveInteger(right.id) ?? 0) - (positiveInteger(left.id) ?? 0);
    });
  return statuses[0] ?? null;
}

function jobConclusion(jobsPayload: unknown, name: string): ReleaseCompletionEvidence["releaseJobConclusion"] {
  const job = array(object(jobsPayload)?.jobs).map(object).find((value) => value?.name === name);
  const conclusion = text(job?.conclusion);
  if (conclusion === "success" || conclusion === "failure" || conclusion === "skipped" || conclusion === "cancelled") return conclusion;
  return "unknown";
}

function workflowSuccess(runsPayload: unknown, name: string, path: string | null, sha: string): boolean {
  return array(object(runsPayload)?.workflow_runs).map(object).some((run) =>
    run?.name === name
    && (path === null || run?.path === path)
    && text(run?.head_sha)?.toLowerCase() === sha
    && run?.status === "completed"
    && run?.conclusion === "success");
}

export async function resolveGithubReleaseCompletion(
  pullRequestNumber: number,
  config: GithubReleaseCompletionConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<GithubReleaseCompletionResolution> {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-pr-number-invalid");
  }
  const token = config.token?.trim();
  if (!token) return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-github-token-not-configured");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.allowedRepository)) {
    return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-repository-allowlist-invalid");
  }

  const base = (config.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const repo = config.allowedRepository;
  try {
    const [branchValue, pullValue] = await Promise.all([
      githubJson(base, `/repos/${repo}/branches/main`, token, fetchImpl),
      githubJson(base, `/repos/${repo}/pulls/${pullRequestNumber}`, token, fetchImpl),
    ]);
    const branch = object(branchValue);
    const pull = object(pullValue);
    if (!branch || !pull || !releaseStatusBinding(branch)) {
      return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-required-app-binding-missing");
    }

    const expectedHead = text(object(pull.head)?.sha)?.toLowerCase() ?? null;
    const mergedSha = text(pull.merge_commit_sha)?.toLowerCase() ?? null;
    if (!expectedHead || !SHA40.test(expectedHead)) {
      return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-pr-head-invalid");
    }
    if (!bool(pull.merged) || pull.state !== "closed" || !mergedSha || !SHA40.test(mergedSha)) {
      return resolution(pullRequestNumber, "NOT_RELEASED", "release-pr-not-canonically-merged", { expectedHeadSha: expectedHead, mergedSha });
    }

    const statusesValue = await githubJson(base, `/repos/${repo}/commits/${expectedHead}/statuses?per_page=100`, token, fetchImpl);
    const authorization = latestReleaseAuthorization(statusesValue);
    const creator = text(object(authorization?.creator)?.login);
    const expectedBase = parseAuthorizationDescription(text(authorization?.description), pullRequestNumber);
    const releaseWorkflowRunId = parseReleaseRunId(text(authorization?.target_url));
    if (!authorization || authorization.state !== "success" || creator !== RELEASE_CREATOR || !expectedBase || !releaseWorkflowRunId) {
      return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", "release-app-authorization-missing-or-invalid", {
        expectedHeadSha: expectedHead,
        expectedBaseSha: expectedBase,
        releaseWorkflowRunId,
        mergedSha,
      });
    }

    const [releaseRunValue, jobsValue, mergeCommitValue, mergedRunsValue] = await Promise.all([
      githubJson(base, `/repos/${repo}/actions/runs/${releaseWorkflowRunId}`, token, fetchImpl),
      githubJson(base, `/repos/${repo}/actions/runs/${releaseWorkflowRunId}/jobs?per_page=100`, token, fetchImpl),
      githubJson(base, `/repos/${repo}/commits/${mergedSha}`, token, fetchImpl),
      githubJson(base, `/repos/${repo}/actions/runs?head_sha=${mergedSha}&status=completed&per_page=100`, token, fetchImpl),
    ]);
    const releaseRun = object(releaseRunValue);
    const mergeCommit = object(mergeCommitValue);
    const auditConclusion = jobConclusion(jobsValue, "audit");
    const releaseConclusion = jobConclusion(jobsValue, "release");
    const releaseRunTrusted = releaseRun?.name === RELEASE_WORKFLOW
      && releaseRun?.path === RELEASE_WORKFLOW_PATH
      && releaseRun?.event === "repository_dispatch"
      && releaseRun?.status === "completed"
      && releaseRun?.conclusion === "success"
      && object(releaseRun?.repository)?.full_name === repo;
    const parents = array(mergeCommit?.parents).map((value) => text(object(value)?.sha)?.toLowerCase()).filter((value): value is string => value !== null);
    const parentsVerified = parents.includes(expectedHead) && parents.includes(expectedBase);
    const ciPassed = workflowSuccess(mergedRunsValue, CI_WORKFLOW, CI_WORKFLOW_PATH, mergedSha);
    const convergenceComplete = workflowSuccess(mergedRunsValue, CONVERGENCE_WORKFLOW, null, mergedSha);

    const evidence: ReleaseCompletionEvidence = {
      outerWorkflowConclusion: releaseRunTrusted ? "success" : text(releaseRun?.conclusion),
      applicable: auditConclusion === "success",
      auditAuthority: auditConclusion === "success" ? "DETERMINISTIC_AUDIT_PASS" : auditConclusion === "skipped" ? "NONE" : "UNKNOWN",
      releaseJobConclusion: releaseConclusion,
      expectedHeadSha: expectedHead,
      expectedBaseSha: expectedBase,
      authorization: { present: true, headSha: expectedHead, appId: TRUSTED_RELEASE_AUTH_APP_ID },
      merge: {
        succeeded: bool(pull.merged) && releaseRunTrusted && releaseConclusion === "success",
        headSha: expectedHead,
        baseSha: expectedBase,
        mergedSha,
        parentsVerified,
      },
      postMerge: {
        ciPassed,
        provenanceSha: ciPassed ? mergedSha : null,
        runtimeDeploymentProvenanceComplete: convergenceComplete,
      },
    };
    const status = evaluateReleaseCompletion(evidence, { appId: TRUSTED_RELEASE_AUTH_APP_ID });
    return resolution(pullRequestNumber, status, status === "RELEASE_COMPLETE" ? "canonical-release-proof-chain-complete" : "canonical-release-proof-chain-incomplete", {
      expectedHeadSha: expectedHead,
      expectedBaseSha: expectedBase,
      releaseWorkflowRunId,
      mergedSha,
    });
  } catch (error) {
    return resolution(pullRequestNumber, "RELEASE_PROVENANCE_MISSING", error instanceof Error ? error.message : "release-provenance-read-failed");
  }
}
