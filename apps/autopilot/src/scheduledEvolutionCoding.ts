import { executeGithubDispatch } from "./githubExecutor";
import { prepareDiscoveredCodingRequest } from "./evolveCodingBridge";
import { deriveWorkflowFailureOpportunities, type WorkflowFailureEvidence } from "./evolveEvidenceOpportunitySource";
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
const CODING_LEASE_MS = 5 * 60 * 1000;
const AUTHORITY = Object.freeze({ liveAuthority: "NONE" as const, productionMutationAllowed: false as const, aiAuthority: "ZERO_AUTHORITY" as const });
const TRUSTED_CI_WORKFLOW = ".github/workflows/ci.yml";

type JsonObject = Record<string, unknown>;
type WorkflowActionability = "CODE_ACTIONABLE" | "DEPENDENCY_WAIT" | "EVIDENCE_MISSING" | "INFRA" | "CREDENTIAL" | "EXTERNAL" | "HUMAN_ONLY" | "UNKNOWN";
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

function classifyFailedStepNames(names: readonly string[]): WorkflowActionability {
  if (names.length === 0) return "UNKNOWN";
  const normalized = names.map((name) => name.toLowerCase());
  if (normalized.some((name) => /credential|secret|token|account|authenticat|authoriz|permission|github app|app id|private key/.test(name))) return "HUMAN_ONLY";
  if (normalized.some((name) => /exact-main|deployment|runtime verification|live worker revision|provenance|evidence/.test(name))) return "EVIDENCE_MISSING";
  if (normalized.some((name) => /dependency wait|waiting for|upstream|prerequisite/.test(name))) return "DEPENDENCY_WAIT";
  if (normalized.some((name) => /runner|network|service outage|rate limit|download artifact|upload artifact/.test(name))) return "INFRA";
  if (normalized.some((name) => /external/.test(name))) return "EXTERNAL";
  return "UNKNOWN";
}

function stepConclusion(job: JsonObject, stepName: string): string | null {
  if (!Array.isArray(job.steps)) return null;
  for (const candidate of job.steps) {
    const step = object(candidate);
    if (step && text(step.name) === stepName) return text(step.conclusion);
  }
  return null;
}

function hasTrustedCodeFailure(workflowPath: string | null, jobs: readonly unknown[]): boolean {
  if (workflowPath !== TRUSTED_CI_WORKFLOW) return false;

  for (const candidate of jobs) {
    const job = object(candidate);
    if (!job) continue;
    const jobName = text(job.name);
    if (!jobName) continue;

    if (jobName === "validation") {
      const prerequisites = ["Install locked dependencies", "Preflight", "Build"];
      const prerequisitesPassed = prerequisites.every((name) => stepConclusion(job, name) === "success");
      if (prerequisitesPassed && stepConclusion(job, "Read-only MCP gateway regression") === "failure") return true;
    }

    if (/^coverage-core-[0-3]$/.test(jobName)) {
      const prerequisites = ["Install locked dependencies", "Preflight", "Build for core coverage"];
      const prerequisitesPassed = prerequisites.every((name) => stepConclusion(job, name) === "success");
      if (prerequisitesPassed && stepConclusion(job, "Core isolated coverage shard") === "failure") return true;
    }
  }
  return false;
}

async function githubJson(url: string, token: string, fetchImpl: typeof fetch): Promise<JsonObject | null> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "user-agent": "nusa-autopilot-actionability",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  return object(await response.json().catch(() => null));
}

async function classifyWorkflowActionability(
  repository: string,
  workflowRunId: number,
  token: string,
  fetchImpl: typeof fetch,
): Promise<WorkflowActionability> {
  const run = await githubJson(`https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}`, token, fetchImpl);
  if (!run) return "UNKNOWN";
  const workflowPath = text(run.path);
  if (text(run.head_branch) !== "main" || text(run.event) === "repository_dispatch") return "UNKNOWN";

  const payload = await githubJson(`https://api.github.com/repos/${repository}/actions/runs/${workflowRunId}/jobs?per_page=100`, token, fetchImpl);
  if (!payload) return "UNKNOWN";
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const failedStepNames: string[] = [];
  for (const candidate of jobs) {
    const job = object(candidate);
    if (!job || !Array.isArray(job.steps)) continue;
    for (const stepCandidate of job.steps) {
      const step = object(stepCandidate);
      if (!step || text(step.conclusion) !== "failure") continue;
      const name = text(step.name);
      if (name) failedStepNames.push(name);
    }
  }

  const negative = classifyFailedStepNames(failedStepNames);
  if (negative !== "UNKNOWN") return negative;
  return hasTrustedCodeFailure(workflowPath, jobs) ? "CODE_ACTIONABLE" : "UNKNOWN";
}

/**
 * Thin scheduled composition: authenticated read-only workflow evidence -> existing
 * discovery/selector bridge -> existing GitHub dispatch spine. Coding is delegated to
 * the single repository_dispatch consumer, which may use a configured external runner
 * or the bounded provider-neutral Workers AI runtime. No direct production mutation authority exists.
 */
export async function runScheduledEvolutionCoding(
  env: ScheduledEvolutionCodingEnv,
  input: { readonly candidates: readonly unknown[]; readonly now: number; readonly repository: string; readonly mainSha: string; readonly workflowRunId: number },
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduledEvolutionCodingResult> {
  const token = env.NUSA_GITHUB_TOKEN?.trim();
  if (!token) return result("ABSTAINED", "github-token-not-configured");
  const coordinator = env.NUSA_EXECUTION_COORDINATOR;
  if (!coordinator) return result("ABSTAINED", "persistent-execution-coordinator-required");
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !SHA40.test(input.mainSha) || !Number.isSafeInteger(input.workflowRunId) || input.workflowRunId <= 0) {
    return result("ABSTAINED", "scheduled-coding-input-invalid");
  }

  const signals = signalsFromRuns(input.candidates, input.now);
  const freshSignalCount = signals.filter((signal) => input.now - Date.parse(signal.observedAt) <= 60 * 60 * 1000).length;
  const executionId = `evolve-coding:${input.workflowRunId}:${input.mainSha.slice(0, 16)}`;
  const dedupeKey = `evolve-coding:${input.workflowRunId}:${input.mainSha}`;
  const bridge = prepareDiscoveredCodingRequest({
    signals,
    now: new Date(input.now),
    repository: input.repository,
    headSha: input.mainSha,
    workflowRunId: input.workflowRunId,
    executionId,
    dedupeKey,
    circuit: freshSignalCount >= 3
      ? { state: "OPEN", consecutiveFailures: freshSignalCount, openedAt: new Date(input.now).toISOString() }
      : { state: "CLOSED", consecutiveFailures: freshSignalCount },
    schedulePolicy: { mode: "AUTONOMOUS", minIntervalSeconds: 60, maxConcurrent: 1 },
    activeExecutions: 0,
    elapsedSecondsSinceLastRun: 60,
  });
  if (bridge.status !== "READY" || !bridge.request) return result("ABSTAINED", bridge.reason);

  const actionability = await classifyWorkflowActionability(input.repository, input.workflowRunId, token, fetchImpl);
  if (actionability !== "CODE_ACTIONABLE") {
    return result("ABSTAINED", `workflow-not-code-actionable:${actionability}`, signals.map((signal) => signal.id));
  }

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
