import { executeGithubDispatch } from "./githubExecutor";
import { prepareDiscoveredCodingRequest } from "./evolveCodingBridge";
import { deriveWorkflowFailureOpportunities, type WorkflowFailureEvidence } from "./evolveEvidenceOpportunitySource";
import { deriveGithubIssueBacklogSignals } from "./evolveGithubIssueBacklog";
import type { EvolutionDiscoverySignal } from "./evolveOpportunityDiscovery";
import { acquirePersistentExecution, admitActiveWip, completeActiveWip, readActiveWip, readPersistentExecution, releasePersistentExecution, type ExecutionCoordinatorNamespace } from "./executionCoordinator";

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
    if (conclusion !== "failure" && conclusion !== "timed_out") continue;
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
  // Issue state and open-PR evidence are independent reads. Fetch them in
  // parallel so a scheduled cycle does not pay two GitHub round trips before
  // it can decide whether the signal is still actionable.
  const issueUrl = `https://api.github.com/repos/${input.repository}/issues/${issueNumber}`;
  const query = new URLSearchParams({ q: `repo:${input.repository} is:pr is:open ${issueNumber}`, per_page: "100", page: "1" });
  const pullsUrl = `https://api.github.com/search/issues?${query.toString()}`;
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-autopilot-worker",
    "x-github-api-version": "2022-11-28",
  };
  let responses: readonly [Response, Response];
  try {
    responses = await Promise.all([
      fetchImpl(issueUrl, { headers }),
      fetchImpl(pullsUrl, { headers }),
    ]) as [Response, Response];
  } catch {
    return "UNAVAILABLE";
  }
  const [response, pullsResponse] = responses;
  if (!response.ok) return "UNAVAILABLE";
  let issue: unknown;
  let pullsPayload: unknown;
  try {
    issue = await response.json();
  } catch {
    return "UNAVAILABLE";
  }
  const issueRecord = object(issue);
  if (!issueRecord || text(issueRecord.state)?.toLowerCase() !== "open") return "STALE";
  if (!pullsResponse.ok) return "UNAVAILABLE";
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
  let activeWip;
  try {
    activeWip = await readActiveWip(coordinator);
  } catch {
    return result("ABSTAINED", "active-wip-state-unavailable", signals.map((signal) => signal.id));
  }
  const provisionalIdentity = logicalWorkIdentity(signals);
  if (signals[0]?.source === "github-issue-backlog") {
    const freshness = await revalidateBacklogSignal(signals[0], input, token, fetchImpl);
    if (freshness === "UNAVAILABLE") return result("ABSTAINED", "github-issue-actionability-revalidation-unavailable", signals.map((signal) => signal.id));
    if (freshness !== "ACTIONABLE") return result("ABSTAINED", "github-issue-no-longer-actionable", signals.map((signal) => signal.id));
  }
  const executionId = `evolve-coding:${input.mainSha.slice(0, 16)}:${provisionalIdentity.slice(0, 100)}`;
  const dedupeKey = `evolve-coding:${input.mainSha}:${provisionalIdentity}`;
  let currentExecution;
  try {
    currentExecution = await readPersistentExecution(coordinator, dedupeKey);
  } catch {
    return result("ABSTAINED", "persistent-execution-state-unavailable", signals.map((signal) => signal.id));
  }
  const activeExecutions = activeWip.activeExecutions;
  const elapsedSecondsSinceLastRun = currentExecution
    ? Math.max(0, Math.floor((input.now - currentExecution.updatedAt) / 1000))
    : Number.MAX_SAFE_INTEGER;
  const bridge = prepareDiscoveredCodingRequest({
    signals,
    now: new Date(input.now),
    repository: input.repository,
    headSha: input.mainSha,
    workflowRunId: input.workflowRunId,
    executionId,
    dedupeKey,
    circuit: freshFailureCount >= 3
      ? { state: "OPEN", consecutiveFailures: freshFailureCount, openedAt: new Date(input.now).toISOString() }
      : { state: "CLOSED", consecutiveFailures: freshFailureCount },
    schedulePolicy: { mode: "AUTONOMOUS", minIntervalSeconds: 60, maxConcurrent: 1 },
    activeExecutions,
    elapsedSecondsSinceLastRun,
  });
  if (bridge.status !== "READY" || !bridge.request || !bridge.selectedOpportunityId) return result("ABSTAINED", bridge.reason);
  const selectedSignal = signals.find((signal) => signal.id === bridge.selectedOpportunityId);
  if (!selectedSignal) return result("ABSTAINED", "selected-evolution-signal-unresolved", signals.map((signal) => signal.id));
  if (selectedSignal.source === "github-issue-backlog" && selectedSignal.id !== signals[0]?.id) {
    const freshness = await revalidateBacklogSignal(selectedSignal, input, token, fetchImpl);
    if (freshness === "UNAVAILABLE") return result("ABSTAINED", "github-issue-actionability-revalidation-unavailable", [selectedSignal.id]);
    if (freshness !== "ACTIONABLE") return result("ABSTAINED", "github-issue-no-longer-actionable", [selectedSignal.id]);
  }
  const selectedIdentity = logicalWorkIdentity([selectedSignal]);
  const selectedExecutionId = `evolve-coding:${input.mainSha.slice(0, 16)}:${selectedIdentity.slice(0, 100)}`;
  const selectedDedupeKey = `evolve-coding:${input.mainSha}:${selectedIdentity}`;
  const selectedRequest = Object.freeze({ ...bridge.request, executionId: selectedExecutionId, dedupeKey: selectedDedupeKey });
  const ownership = selectedRequest.canonicalOwner && selectedRequest.conflictKeys?.length
    ? { canonicalOwner: selectedRequest.canonicalOwner, conflictKeys: selectedRequest.conflictKeys }
    : null;
  if (!ownership) return result("ABSTAINED", "selected-evolution-ownership-required", [selectedSignal.id]);
  let admitted;
  try {
    admitted = await admitActiveWip(coordinator, {
      dedupeKey: selectedDedupeKey,
      executionId: selectedExecutionId,
      canonicalOwner: ownership.canonicalOwner,
      conflictKeys: ownership.conflictKeys,
      claimedAt: input.now,
      maxConcurrent: 1,
    });
  } catch {
    return result("ABSTAINED", "active-wip-admission-unavailable", [selectedSignal.id]);
  }
  if (!admitted.admitted) return result("DUPLICATE_SUPPRESSED", admitted.reason ?? "ACTIVE_WIP_REJECTED", [selectedSignal.id]);

  let persistent;
  try {
    persistent = await acquirePersistentExecution(coordinator, {
      dedupeKey: selectedDedupeKey,
      executionId: selectedExecutionId,
    now: input.now,
      leaseExpiresAt: input.now + CODING_LEASE_MS,
    });
  } catch {
    try { await completeActiveWip(coordinator, { dedupeKey: selectedDedupeKey, executionId: selectedExecutionId }); } catch {}
    return result("ABSTAINED", "persistent-execution-coordination-failed", [selectedSignal.id]);
  }
  if (!persistent.acquired) {
    try { await completeActiveWip(coordinator, { dedupeKey: selectedDedupeKey, executionId: selectedExecutionId }); } catch {
      return result("ABSTAINED", "active-wip-rollback-failed", [selectedSignal.id]);
    }
    return result("DUPLICATE_SUPPRESSED", persistent.reason ?? "DUPLICATE_EXECUTION", [selectedSignal.id]);
  }

  const dispatched = await executeGithubDispatch(selectedRequest, { token, allowedRepository: input.repository }, fetchImpl);
  if (dispatched.status === "DISPATCHED") return result("EXECUTION_ACCEPTED", "github-coding-dispatch-accepted", [selectedSignal.id]);

  try {
    await releasePersistentExecution(coordinator, { dedupeKey: selectedDedupeKey, executionId: selectedExecutionId, now: input.now });
    await completeActiveWip(coordinator, { dedupeKey: selectedDedupeKey, executionId: selectedExecutionId });
  } catch {
    return result("ABSTAINED", "coding-dispatch-rollback-failed", [selectedSignal.id]);
  }
  if (dispatched.status === "INTERFACE_READY") return result("INTERFACE_READY", dispatched.reason, [selectedSignal.id]);
  return result("EXECUTION_FAILED", dispatched.reason, [selectedSignal.id]);
}
