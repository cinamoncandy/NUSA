import type { AutopilotDispatchPlan } from "./dispatchPlanner";
import { executeGithubDispatch, type GithubExecutorResult } from "./githubExecutor";
import { prepareProductionExecution } from "./productionExecutionSpine";
import {
  acquirePersistentExecution,
  markPersistentExecutionDispatched,
  type ExecutionCoordinatorNamespace,
} from "./executionCoordinator";

export interface ScheduledRuntimeEnv {
  readonly NUSA_GITHUB_TOKEN?: string;
  readonly NUSA_GITHUB_REPOSITORY?: string;
  readonly NUSA_EXECUTION_COORDINATOR?: ExecutionCoordinatorNamespace;
}

export interface ScheduledRuntimeResult {
  readonly status:
    | "ABSTAINED"
    | "DUPLICATE_EXECUTION_SUPPRESSED"
    | "EXECUTION_DISPATCHED"
    | "EXECUTION_NOT_DISPATCHED";
  readonly reason: string;
  readonly headSha: string | null;
  readonly workflowRunId: number | null;
  readonly executor: GithubExecutorResult | null;
  readonly liveAuthority: "NONE";
  readonly productionMutationAllowed: false;
  readonly aiAuthority: "ZERO_AUTHORITY";
}

type JsonObject = Record<string, unknown>;

const DEFAULT_REPOSITORY = "cinamoncandy/NUSA";
const SHA40 = /^[0-9a-f]{40}$/i;
const object = (value: unknown): JsonObject | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const positiveInteger = (value: unknown): number | null => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
const authority = {
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

function result(
  status: ScheduledRuntimeResult["status"],
  reason: string,
  headSha: string | null = null,
  workflowRunId: number | null = null,
  executor: GithubExecutorResult | null = null,
): ScheduledRuntimeResult {
  return Object.freeze({ status, reason, headSha, workflowRunId, executor, ...authority });
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

export async function runScheduledAutopilot(
  env: ScheduledRuntimeEnv,
  now: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ScheduledRuntimeResult> {
  const token = env.NUSA_GITHUB_TOKEN?.trim();
  if (!token) return result("ABSTAINED", "github-token-not-configured");
  const coordinator = env.NUSA_EXECUTION_COORDINATOR;
  if (!coordinator) return result("ABSTAINED", "persistent-execution-coordinator-required");
  if (!Number.isFinite(now)) return result("ABSTAINED", "scheduled-time-invalid");

  const repository = env.NUSA_GITHUB_REPOSITORY?.trim() || DEFAULT_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return result("ABSTAINED", "repository-invalid");

  let mainSha: string;
  let workflowRunId: number;
  try {
    const main = await githubJson(`https://api.github.com/repos/${repository}/branches/main`, token, fetchImpl);
    const commit = object(main.commit);
    const resolvedMainSha = text(commit?.sha);
    if (!resolvedMainSha || !SHA40.test(resolvedMainSha)) return result("ABSTAINED", "main-sha-invalid");
    mainSha = resolvedMainSha;

    const runs = await githubJson(
      `https://api.github.com/repos/${repository}/actions/runs?branch=main&status=completed&per_page=50`,
      token,
      fetchImpl,
    );
    const candidates = Array.isArray(runs.workflow_runs) ? runs.workflow_runs : [];
    const canonical = candidates
      .map(object)
      .filter((run): run is JsonObject => run !== null)
      .find((run) =>
        text(run.name) === "CI"
        && text(run.conclusion) === "success"
        && text(run.head_branch) === "main"
        && text(run.head_sha) === mainSha
        && text(run.event) !== "repository_dispatch"
      );
    const resolvedRunId = positiveInteger(canonical?.id);
    if (!canonical || !resolvedRunId) return result("ABSTAINED", "exact-main-canonical-ci-not-found", mainSha);
    workflowRunId = resolvedRunId;
  } catch (error) {
    return result("ABSTAINED", error instanceof Error ? error.message : "scheduled-evidence-query-failed");
  }

  const dispatch: AutopilotDispatchPlan = Object.freeze({
    kind: "CI_SUCCEEDED",
    repository,
    headSha: mainSha,
    prNumber: null,
    workflowRunId,
    reason: "scheduled-exact-main-ci-replay",
    mutationAllowed: false,
  });
  const prepared = prepareProductionExecution(dispatch, {
    deliveryId: `scheduled:${workflowRunId}:${mainSha}`,
    origin: "AUTO_BACKGROUND",
    now,
    allowedRepository: repository,
  });
  if (!prepared?.state.lease) return result("ABSTAINED", "production-execution-boundary-unavailable", mainSha, workflowRunId);

  const persistent = await acquirePersistentExecution(coordinator, {
    dedupeKey: prepared.envelope.dedupeKey,
    executionId: prepared.envelope.executionId,
    now,
    leaseExpiresAt: prepared.state.lease.expiresAt,
  });
  if (!persistent.acquired) {
    return result("DUPLICATE_EXECUTION_SUPPRESSED", persistent.reason ?? "DUPLICATE_EXECUTION", mainSha, workflowRunId);
  }

  const executor = await executeGithubDispatch(prepared.request, { token, allowedRepository: repository }, fetchImpl);
  if (executor.status === "DISPATCHED") {
    await markPersistentExecutionDispatched(coordinator, {
      dedupeKey: prepared.envelope.dedupeKey,
      executionId: prepared.envelope.executionId,
      now,
    });
    return result("EXECUTION_DISPATCHED", executor.reason, mainSha, workflowRunId, executor);
  }
  return result("EXECUTION_NOT_DISPATCHED", executor.reason, mainSha, workflowRunId, executor);
}
