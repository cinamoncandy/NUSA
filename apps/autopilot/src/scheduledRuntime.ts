import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { executeGithubDispatch, type GithubExecutorResult } from "./githubExecutor";
import { prepareProductionExecution } from "./productionExecutionSpine";
import { deriveWorkflowFailureOpportunities, type WorkflowFailureEvidence } from "./evolveEvidenceOpportunitySource";
import { deriveGithubIssueBacklogReadiness } from "./evolveGithubIssueBacklog";
import { runScheduledEvolutionCoding } from "./scheduledEvolutionCoding";
import {
  UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY,
  deriveGithubIssueWorkSupply,
  unknownGithubIssueWorkSupply,
  withObservedReadyWork,
  type GithubIssueWorkSupplySnapshot,
} from "./githubIssueWorkSupply";
import {
  acquirePersistentExecution,
  markPersistentExecutionDispatched,
  readScheduledRuntimeReceipt,
  type ExecutionCoordinatorNamespace,
  type ScheduledRuntimeReceipt,
} from "./executionCoordinator";

export interface ScheduledRuntimeEnv {
  readonly NUSA_GITHUB_TOKEN?: string;
  readonly NUSA_GITHUB_REPOSITORY?: string;
  readonly NUSA_AI_CODING_ENDPOINT?: string;
  readonly NUSA_AI_CODING_TOKEN?: string;
  readonly NUSA_EXECUTION_COORDINATOR?: ExecutionCoordinatorNamespace;
}

export interface ScheduledRuntimeResult {
  readonly status: "ABSTAINED" | "DUPLICATE_EXECUTION_SUPPRESSED" | "EXECUTION_DISPATCHED" | "EXECUTION_NOT_DISPATCHED";
  readonly reason: string;
  readonly headSha: string | null;
  readonly workflowRunId: number | null;
  readonly executor: GithubExecutorResult | null;
  readonly discoveredOpportunityIds: readonly string[];
  readonly workflowFailureOpportunityCount: number;
  readonly workSupply: GithubIssueWorkSupplySnapshot;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

type JsonObject = Record<string, unknown>;
type BacklogEvidence = Readonly<{
  issues: readonly unknown[];
  openPulls: readonly unknown[];
  workSupply: GithubIssueWorkSupplySnapshot;
}>;

const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";
const WORKFLOW_FAILURE_MAX_AGE_SECONDS = 24 * 60 * 60;
const SHA40 = /^[0-9a-f]{40}$/i;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const safeTimestamp = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const authority = { liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const };

function result(
  status: ScheduledRuntimeResult["status"],
  reason: string,
  headSha: string | null = null,
  workflowRunId: number | null = null,
  executor: GithubExecutorResult | null = null,
  discoveredOpportunityIds: readonly string[] = Object.freeze([]),
  workSupply: GithubIssueWorkSupplySnapshot = UNKNOWN_GITHUB_ISSUE_WORK_SUPPLY,
): ScheduledRuntimeResult {
  return Object.freeze({
    status,
    reason,
    headSha,
    workflowRunId,
    executor,
    discoveredOpportunityIds: Object.freeze([...discoveredOpportunityIds]),
    workflowFailureOpportunityCount: discoveredOpportunityIds.length,
    workSupply,
    ...authority,
  });
}

async function githubJson(url: string, token: string, fetchImpl: typeof fetch): Promise<JsonObject> {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "user-agent": "nusa-autopilot-scheduler",
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  const body = object(await response.json());
  if (!body) throw new Error("GITHUB_JSON_INVALID");
  return body;
}

function completeSearchItems(value: JsonObject): readonly unknown[] | null {
  const totalCount = Number.isSafeInteger(value.total_count) && Number(value.total_count) >= 0 ? Number(value.total_count) : null;
  const items = Array.isArray(value.items) ? value.items : null;
  if (totalCount === null || !items || totalCount > items.length) return null;
  return Object.freeze([...items]);
}

async function observeGithubBacklogEvidence(
  repository: string,
  token: string,
  now: number,
  fetchImpl: typeof fetch,
): Promise<BacklogEvidence> {
  let issueSearch: JsonObject;
  try {
    const issueQuery = encodeURIComponent(`repo:${repository} is:issue is:open`);
    issueSearch = await githubJson(`https://api.github.com/search/issues?q=${issueQuery}&per_page=100&sort=updated&order=desc`, token, fetchImpl);
  } catch (error) {
    return Object.freeze({
      issues: Object.freeze([]),
      openPulls: Object.freeze([]),
      workSupply: unknownGithubIssueWorkSupply(error instanceof Error ? error.message : "github-open-issue-search-failed"),
    });
  }

  const rawSupply = deriveGithubIssueWorkSupply(issueSearch);
  const issues = completeSearchItems(issueSearch);
  if (!issues) return Object.freeze({ issues: Object.freeze([]), openPulls: Object.freeze([]), workSupply: rawSupply });

  let pullSearch: JsonObject;
  try {
    const pullQuery = encodeURIComponent(`repo:${repository} is:pr is:open`);
    pullSearch = await githubJson(`https://api.github.com/search/issues?q=${pullQuery}&per_page=100&sort=updated&order=desc`, token, fetchImpl);
  } catch {
    return Object.freeze({ issues, openPulls: Object.freeze([]), workSupply: rawSupply });
  }
  const openPulls = completeSearchItems(pullSearch);
  if (!openPulls) return Object.freeze({ issues, openPulls: Object.freeze([]), workSupply: rawSupply });

  const readiness = deriveGithubIssueBacklogReadiness(issues, openPulls, new Date(now));
  return Object.freeze({ issues, openPulls, workSupply: withObservedReadyWork(rawSupply, readiness.eligibleIssueCount) });
}

function workflowCompletedAt(run: JsonObject): string | null {
  const completedAt = text(run.completed_at);
  if (completedAt && Number.isFinite(Date.parse(completedAt))) return completedAt;
  if (text(run.status) !== "completed") return null;
  const updatedAt = text(run.updated_at);
  return updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null;
}

function discoverWorkflowFailureOpportunityIds(candidates: readonly unknown[], now: number): readonly string[] {
  const observations: WorkflowFailureEvidence[] = [];
  for (const candidate of candidates) {
    const run = object(candidate);
    if (!run) continue;
    const conclusion = text(run.conclusion);
    if (conclusion !== "failure" && conclusion !== "cancelled" && conclusion !== "timed_out") continue;
    if (text(run.head_branch) !== "main" || text(run.event) === "repository_dispatch") continue;
    const workflowName = text(run.name);
    const runId = positiveInteger(run.id);
    const headSha = text(run.head_sha);
    const completedAt = workflowCompletedAt(run);
    if (!workflowName || !runId || !headSha || !SHA40.test(headSha) || !completedAt) continue;
    observations.push(Object.freeze({ workflowName, runId, headSha: headSha.toLowerCase(), conclusion, completedAt }));
  }
  const opportunities = deriveWorkflowFailureOpportunities({ observations, observedAt: new Date(now).toISOString(), maxAgeSeconds: WORKFLOW_FAILURE_MAX_AGE_SECONDS });
  return Object.freeze(opportunities.map((opportunity) => opportunity.id));
}

function currentMainFailureRunId(candidates: readonly unknown[], mainSha: string, now: number): number | null {
  for (const candidate of candidates) {
    const run = object(candidate);
    if (!run) continue;
    const conclusion = text(run.conclusion);
    if (conclusion !== "failure" && conclusion !== "cancelled" && conclusion !== "timed_out") continue;
    if (text(run.head_branch) !== "main" || text(run.event) === "repository_dispatch") continue;
    if (text(run.head_sha)?.toLowerCase() !== mainSha.toLowerCase()) continue;
    const runId = positiveInteger(run.id);
    const completedAt = workflowCompletedAt(run);
    if (!runId || !completedAt) continue;
    const ageSeconds = (now - Date.parse(completedAt)) / 1000;
    if (ageSeconds < 0 || ageSeconds > WORKFLOW_FAILURE_MAX_AGE_SECONDS) continue;
    return runId;
  }
  return null;
}

function hasFreshWorkflowFailureSince(candidates: readonly unknown[], observedAt: number): boolean {
  if (!safeTimestamp(observedAt)) return true;
  for (const candidate of candidates) {
    const run = object(candidate);
    if (!run) continue;
    const conclusion = text(run.conclusion);
    if (conclusion !== "failure" && conclusion !== "cancelled" && conclusion !== "timed_out") continue;
    if (text(run.head_branch) !== "main" || text(run.event) === "repository_dispatch") continue;
    const completedAt = workflowCompletedAt(run);
    if (completedAt && Date.parse(completedAt) >= observedAt) return true;
  }
  return false;
}

function codingResult(
  coding: Awaited<ReturnType<typeof runScheduledEvolutionCoding>>,
  mainSha: string,
  workflowRunId: number,
  discoveredOpportunityIds: readonly string[],
  workSupply: GithubIssueWorkSupplySnapshot,
): ScheduledRuntimeResult | null {
  if (coding.status === "EXECUTION_ACCEPTED") return result("EXECUTION_DISPATCHED", coding.reason, mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);
  if (coding.status === "DUPLICATE_SUPPRESSED") return result("DUPLICATE_EXECUTION_SUPPRESSED", coding.reason, mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);
  if (coding.status === "INTERFACE_READY" || coding.status === "EXECUTION_FAILED") return result("EXECUTION_NOT_DISPATCHED", coding.reason, mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);
  return null;
}

export async function runScheduledAutopilot(env: ScheduledRuntimeEnv, now: number, fetchImpl: typeof fetch = fetch): Promise<ScheduledRuntimeResult> {
  const token = env.NUSA_GITHUB_TOKEN?.trim();
  if (!token) return result("ABSTAINED", "github-token-not-configured");
  const coordinator = env.NUSA_EXECUTION_COORDINATOR;
  if (!coordinator) return result("ABSTAINED", "persistent-execution-coordinator-required");
  if (!safeTimestamp(now)) return result("ABSTAINED", "scheduled-time-invalid");

  const repository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return result("ABSTAINED", "repository-invalid");

  const backlog = await observeGithubBacklogEvidence(repository, token, now, fetchImpl);
  const workSupply = backlog.workSupply;

  let previousReceipt: ScheduledRuntimeReceipt | null = null;
  try { previousReceipt = await readScheduledRuntimeReceipt(coordinator); } catch { previousReceipt = null; }

  let mainSha: string;
  let workflowRunId: number;
  let discoveredOpportunityIds: readonly string[] = Object.freeze([]);
  try {
    const main = await githubJson(`https://api.github.com/repos/${repository}/branches/main`, token, fetchImpl);
    const commit = object(main.commit);
    const resolvedMainSha = text(commit?.sha);
    if (!resolvedMainSha || !SHA40.test(resolvedMainSha)) return result("ABSTAINED", "main-sha-invalid", null, null, null, discoveredOpportunityIds, workSupply);
    mainSha = resolvedMainSha;

    const runs = await githubJson(`https://api.github.com/repos/${repository}/actions/runs?branch=main&status=completed&per_page=50`, token, fetchImpl);
    const candidates = Array.isArray(runs.workflow_runs) ? runs.workflow_runs : [];
    discoveredOpportunityIds = discoverWorkflowFailureOpportunityIds(candidates, now);

    const failedRunId = currentMainFailureRunId(candidates, mainSha, now);
    if (failedRunId) {
      try {
        const coding = await runScheduledEvolutionCoding(env, { candidates, backlogIssues: backlog.issues, openPulls: backlog.openPulls, now, repository, mainSha, workflowRunId: failedRunId }, fetchImpl);
        console.log(JSON.stringify({ event: "NUSA_SCHEDULED_EVOLVE_CODING", ...coding }));
        return codingResult(coding, mainSha, failedRunId, discoveredOpportunityIds, workSupply)
          ?? result("ABSTAINED", coding.reason, mainSha, failedRunId, null, discoveredOpportunityIds, workSupply);
      } catch (error) {
        return result("EXECUTION_NOT_DISPATCHED", error instanceof Error ? error.message : "scheduled-evolve-coding-failed", mainSha, failedRunId, null, discoveredOpportunityIds, workSupply);
      }
    }

    const canonical = candidates
      .map(object)
      .filter((run): run is JsonObject => run !== null)
      .find((run) => text(run.name) === "CI" && text(run.conclusion) === "success" && text(run.head_branch) === "main" && text(run.head_sha) === mainSha && text(run.event) !== "repository_dispatch");
    const resolvedRunId = positiveInteger(canonical?.id);
    if (!canonical || !resolvedRunId) return result("ABSTAINED", "exact-main-canonical-ci-not-found", mainSha, null, null, discoveredOpportunityIds, workSupply);
    workflowRunId = resolvedRunId;

    try {
      const coding = await runScheduledEvolutionCoding(env, { candidates, backlogIssues: backlog.issues, openPulls: backlog.openPulls, now, repository, mainSha, workflowRunId }, fetchImpl);
      console.log(JSON.stringify({ event: "NUSA_SCHEDULED_EVOLVE_CODING", ...coding }));
      const handled = codingResult(coding, mainSha, workflowRunId, discoveredOpportunityIds, workSupply);
      if (handled) return handled;
    } catch (error) {
      console.error(JSON.stringify({ event: "NUSA_SCHEDULED_EVOLVE_CODING_FAILED", reason: error instanceof Error ? error.message : "UNKNOWN", ...authority }));
    }

    if (previousReceipt && previousReceipt.headSha === mainSha && previousReceipt.workflowRunId === workflowRunId && !hasFreshWorkflowFailureSince(candidates, previousReceipt.observedAt)) {
      return result("DUPLICATE_EXECUTION_SUPPRESSED", "scheduled-state-unchanged", mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);
    }
  } catch (error) {
    return result("ABSTAINED", error instanceof Error ? error.message : "scheduled-evidence-query-failed", null, null, null, discoveredOpportunityIds, workSupply);
  }

  const dispatch: AutopilotDispatchPlan = Object.freeze({ kind: "CI_SUCCEEDED", repository, headSha: mainSha, prNumber: null, workflowRunId, reason: "scheduled-exact-main-ci-replay", mutationAllowed: false });
  const prepared = prepareProductionExecution(dispatch, { deliveryId: `scheduled:${workflowRunId}:${mainSha}`, origin: "AUTO_BACKGROUND", now, allowedRepository: repository });
  if (!prepared?.state.lease) return result("ABSTAINED", "production-execution-boundary-unavailable", mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);

  const persistent = await acquirePersistentExecution(coordinator, { dedupeKey: prepared.envelope.dedupeKey, executionId: prepared.envelope.executionId, now, leaseExpiresAt: prepared.state.lease.expiresAt });
  if (!persistent.acquired) return result("DUPLICATE_EXECUTION_SUPPRESSED", persistent.reason ?? "DUPLICATE_EXECUTION", mainSha, workflowRunId, null, discoveredOpportunityIds, workSupply);

  const executor = await executeGithubDispatch(prepared.request, { token, allowedRepository: repository }, fetchImpl);
  if (executor.status === "DISPATCHED") {
    await markPersistentExecutionDispatched(coordinator, { dedupeKey: prepared.envelope.dedupeKey, executionId: prepared.envelope.executionId, now });
    return result("EXECUTION_DISPATCHED", executor.reason, mainSha, workflowRunId, executor, discoveredOpportunityIds, workSupply);
  }
  return result("EXECUTION_NOT_DISPATCHED", executor.reason, mainSha, workflowRunId, executor, discoveredOpportunityIds, workSupply);
}
