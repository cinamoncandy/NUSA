import { executeGithubDispatch } from "./githubExecutor";
import { prepareDiscoveredCodingRequest } from "./evolveCodingBridge";
import { deriveWorkflowFailureOpportunities, type WorkflowFailureEvidence } from "./evolveEvidenceOpportunitySource";
import { deriveGithubIssueBacklogSignals } from "./evolveGithubIssueBacklog";
import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";
import { acquirePersistentExecution, markPersistentExecutionDispatched, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

export interface ScheduledEvolutionCodingEnv {
  readonly NUSA_GITHUB_TOKEN?: string;
  readonly NUSA_EXECUTION_COORDINATOR?: ExecutionCoordinatorNamespace;
}

export interface ScheduledEvolutionCodingResult {
  readonly status: "ABSTAINED" | "DUPLICATE_SUPPRESSED" | "INTERFACE_READY" | "EXECUTION_ACCEPTED" | "EXECUTION_FAILED";
  readonly reason: string;
  readonly selectedSignalIds: readonly string[];
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

const SHA40 = /^[0-9a-f]{40}$/i;
const MAX_SOURCE_AGE_SECONDS = 24 * 60 * 60;
const DISCOVERY_MAX_AGE_MS = 60 * 60 * 1000;
const DISCOVERY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const CODING_LEASE_MS = 5 * 60 * 1000;
const AUTHORITY = Object.freeze({ liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

function result(status: ScheduledEvolutionCodingResult["status"], reason: string, selectedSignalIds: readonly string[] = []): ScheduledEvolutionCodingResult {
  return Object.freeze({ status, reason, selectedSignalIds: Object.freeze([...selectedSignalIds]), ...AUTHORITY });
}

function workflowCompletedAt(run: JsonObject): string | null {
  const completedAt = text(run.completed_at);
  if (completedAt && Number.isFinite(Date.parse(completedAt))) return completedAt;
  if (text(run.status) !== "completed") return null;
  const updatedAt = text(run.updated_at);
  return updatedAt && Number.isFinite(Date.parse(updatedAt)) ? updatedAt : null;
}

function evidenceFromRuns(candidates: readonly unknown[]): readonly WorkflowFailureEvidence[] {
  const evidence: WorkflowFailureEvidence[] = [];
  for (const candidate of candidates.slice(0, 50)) {
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
    evidence.push(Object.freeze({ workflowName, runId, headSha: headSha.toLowerCase(), conclusion, completedAt }));
  }
  return Object.freeze(evidence);
}

function signalsFromRuns(candidates: readonly unknown[], now: number): readonly EvolutionDiscoverySignal[] {
  const opportunities = deriveWorkflowFailureOpportunities({
    observations: evidenceFromRuns(candidates),
    observedAt: new Date(now).toISOString(),
    maxAgeSeconds: MAX_SOURCE_AGE_SECONDS,
  });
  return Object.freeze(opportunities.map((opportunity) => Object.freeze({
    id: opportunity.id,
    source: opportunity.source,
    reference: opportunity.evidence[0]?.reference ?? "",
    problem: opportunity.problem,
    observedAt: opportunity.createdAt,
    evidenceQuality: opportunity.evidence[0]?.quality ?? 0,
    impact: opportunity.impact,
    confidence: opportunity.confidence,
    risk: opportunity.risk,
    reversibility: opportunity.reversibility,
  })));
}

function freshDiscoverySignals(signals: readonly EvolutionDiscoverySignal[], now: number): readonly EvolutionDiscoverySignal[] {
  return Object.freeze(signals.filter((signal) => {
    const observedAt = Date.parse(signal.observedAt);
    if (!Number.isFinite(observedAt)) return false;
    const age = now - observedAt;
    return age <= DISCOVERY_MAX_AGE_MS && age >= -DISCOVERY_MAX_FUTURE_SKEW_MS;
  }));
}

function logicalWorkIdentity(signals: readonly EvolutionDiscoverySignal[]): string {
  const selected = signals[0]?.id ?? "no-signal";
  return selected.replace(/[^A-Za-z0-9_.:-]+/g, "-").slice(0, 180) || "no-signal";
}

function backlogIssueNumber(signal: EvolutionDiscoverySignal | undefined): number | null {
  if (signal?.source !== "github-issue-backlog") return null;
  const match = signal.id.match(/^github-issue-([1-9][0-9]*)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function revalidateBacklogSignal(
  signal: EvolutionDiscoverySignal | undefined,
  input: { readonly repository: string; readonly openPulls?: readonly unknown[]; readonly now: number },
  token: string,
  fetchImpl: typeof fetch,
): Promise<"ACTIONABLE" | "STALE" | "UNAVAILABLE"> {
  const issueNumber = backlogIssueNumber(signal);
  if (issueNumber === null) return signal?.source === "github-issue-backlog" ? "STALE" : "ACTIONABLE";
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${input.repository}/issues/${issueNumber}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "nusa-autopilot-worker",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch {
    return "UNAVAILABLE";
  }
  if (!response.ok) return "UNAVAILABLE";
  let issue: unknown;
  try {
    issue = await response.json();
  } catch {
    return "UNAVAILABLE";
  }
  const issueRecord = object(issue);
  if (!issueRecord || text(issueRecord.state)?.toLowerCase() !== "open") return "STALE";

  const query = new URLSearchParams({ q: `repo:${input.repository} is:pr is:open ${issueNumber}`, per_page: "100", page: "1" });
  let pullsResponse: Response;
  try {
    pullsResponse = await fetchImpl(`https://api.github.com/search/issues?${query.toString()}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "nusa-autopilot-worker",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch {
    return "UNAVAILABLE";
  }
  if (!pullsResponse.ok) return "UNAVAILABLE";
  let pullsPayload: unknown;
  try {
    pullsPayload = await pullsResponse.json();
  } catch {
    return "UNAVAILABLE";
  }
  const pullsBody = object(pullsPayload);
  const items = pullsBody?.items;
  const totalCount = pullsBody?.total_count;
  if (!Array.isArray(items) || !Number.isSafeInteger(totalCount) || Number(totalCount) < 0 || Number(totalCount) > items.length) return "UNAVAILABLE";

  const current = deriveGithubIssueBacklogSignals([issue], items, new Date(input.now));
  return current.some((candidate) => candidate.id === signal?.id) ? "ACTIONABLE" : "STALE";
}

/**
 * Existing #903/#905 composition: read-only repository evidence -> existing
 * discovery/selector -> existing CodingRunner dispatch spine. Fresh workflow
 * failures keep priority. When main is healthy, one proven-ready canonical issue
 * may flow into the same selector. No second queue/scheduler/orchestrator exists.
 */
export async function runScheduledEvolutionCoding(
  env: ScheduledEvolutionCodingEnv,
  input: {
    readonly candidates: readonly unknown[];
    readonly backlogIssues?: readonly unknown[];
    readonly openPulls?: readonly unknown[];
    readonly now: number;
    readonly repository: string;
    readonly mainSha: string;
    readonly workflowRunId: number;
    /** Exact-main successful canonical CI run, cited by non-repair (e.g. backlog issue) work. */
    readonly successWorkflowRunId?: number | null;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduledEvolutionCodingResult> {
  const token = env.NUSA_GITHUB_TOKEN?.trim();
  if (!token) return result("ABSTAINED", "github-token-not-configured");
  const coordinator = env.NUSA_EXECUTION_COORDINATOR;
  if (!coordinator) return result("ABSTAINED", "persistent-execution-coordinator-required");
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !SHA40.test(input.mainSha) || !Number.isSafeInteger(input.workflowRunId) || input.workflowRunId <= 0) {
    return result("ABSTAINED", "scheduled-coding-input-invalid");
  }

  const failureSignals = freshDiscoverySignals(signalsFromRuns(input.candidates, input.now), input.now);
  const backlogSignals = failureSignals.length === 0
    ? deriveGithubIssueBacklogSignals(input.backlogIssues ?? [], input.openPulls ?? [], new Date(input.now))
    : Object.freeze([] as EvolutionDiscoverySignal[]);
  const signals = failureSignals.length > 0 ? failureSignals : backlogSignals;
  const freshFailureCount = failureSignals.length;
  const workIdentity = logicalWorkIdentity(signals);
  if (signals[0]?.source === "github-issue-backlog") {
    const freshness = await revalidateBacklogSignal(signals[0], input, token, fetchImpl);
    if (freshness === "UNAVAILABLE") return result("ABSTAINED", "github-issue-actionability-revalidation-unavailable", signals.map((signal) => signal.id));
    if (freshness !== "ACTIONABLE") return result("ABSTAINED", "github-issue-no-longer-actionable", signals.map((signal) => signal.id));
  }
  const executionId = `evolve-coding:${input.mainSha.slice(0, 16)}:${workIdentity.slice(0, 100)}`;
  const dedupeKey = `evolve-coding:${input.mainSha}:${workIdentity}`;
  const bridge = prepareDiscoveredCodingRequest({
    signals,
    now: new Date(input.now),
    repository: input.repository,
    headSha: input.mainSha,
    workflowRunId: input.workflowRunId,
    successWorkflowRunId: input.successWorkflowRunId ?? null,
    executionId,
    dedupeKey,
    circuit: freshFailureCount >= 3
      ? { state: "OPEN", consecutiveFailures: freshFailureCount, openedAt: new Date(input.now).toISOString() }
      : { state: "CLOSED", consecutiveFailures: freshFailureCount },
    schedulePolicy: { mode: "AUTONOMOUS", minIntervalSeconds: 60, maxConcurrent: 1 },
    activeExecutions: 0,
    elapsedSecondsSinceLastRun: 60,
  });
  if (bridge.status !== "READY" || !bridge.request) return result("ABSTAINED", bridge.reason);

  const persistent = await acquirePersistentExecution(coordinator, {
    dedupeKey: bridge.request.dedupeKey,
    executionId: bridge.request.executionId,
    now: input.now,
    leaseExpiresAt: input.now + CODING_LEASE_MS,
  });
  if (!persistent.acquired) return result("DUPLICATE_SUPPRESSED", persistent.reason ?? "DUPLICATE_EXECUTION", signals.map((signal) => signal.id));

  const dispatched = await executeGithubDispatch(bridge.request, { token, allowedRepository: input.repository }, fetchImpl);
  if (dispatched.status === "DISPATCHED") {
    await markPersistentExecutionDispatched(coordinator, { dedupeKey: bridge.request.dedupeKey, executionId: bridge.request.executionId, now: input.now });
    return result("EXECUTION_ACCEPTED", "github-coding-dispatch-accepted", signals.map((signal) => signal.id));
  }
  if (dispatched.status === "INTERFACE_READY") return result("INTERFACE_READY", dispatched.reason, signals.map((signal) => signal.id));
  return result("EXECUTION_FAILED", dispatched.reason, signals.map((signal) => signal.id));
}
