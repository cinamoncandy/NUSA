const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1_000;
const MAX_PATCH_BYTES = 24_000;
const MAX_VALIDATED_FILE_BYTES = 128_000;
const PATCH_PATH = ".nusa-autopilot.patch";
const GENERATED_WORKSPACE_ARTIFACTS = new Set([
  "artifacts/autopilot-execution/repository-dispatch.json",
  "artifacts/autopilot-execution/coding-runner-request.json",
]);
const SAFE_PROPOSAL_FAILURE_CODES = new Set([
  "CODING_PROPOSAL_AUTHORITY_SURFACE_FORBIDDEN",
  "CODING_PROPOSAL_FAILED_CLOSED",
  "CODING_PROPOSAL_INVALID",
  "CODING_PROPOSAL_JSON_INVALID",
  "CODING_PROPOSAL_PATCH_REQUIRED",
  "CODING_PROPOSAL_PATH_FORBIDDEN",
  "CODING_PROPOSAL_PATH_INVALID",
  "CODING_PROPOSAL_RESPONSE_INVALID",
  "CODING_PROPOSAL_SHAPE_INVALID",
  "CODING_PROPOSAL_TOO_LARGE",
  "CODING_PROPOSAL_UNAVAILABLE",
  "SANDBOX_PATCH_APPLY_CHECK_FAILED",
  "SANDBOX_PATCH_FILE_COUNT_INVALID",
  "SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE",
  "SANDBOX_PATCH_PATH_FORBIDDEN",
  "SANDBOX_PATCH_PATH_OUTSIDE_ALLOWED_SCOPE",
  "SANDBOX_PATCH_REQUIRED",
  "SANDBOX_PATCH_TOO_LARGE",
]);

function transientStatus(status) {
  return status === 429 || (Number.isInteger(status) && status >= 500 && status <= 599);
}

function httpClass(status) {
  if (status === null || status === undefined) return "NETWORK";
  return String(Math.floor(Number(status) / 100)) + "xx";
}

function fixedFailureClass(status) {
  return transientStatus(status) ? "transient" : "deterministic";
}

function proposalFailureCode(reason) {
  const text = String(reason || "");
  const match = text.match(/^(CODING_PROPOSAL_[A-Z0-9_]+|SANDBOX_PATCH_[A-Z0-9_]+)/);
  const code = match?.[1];
  if (!code || !SAFE_PROPOSAL_FAILURE_CODES.has(code)) return null;
  if (code.startsWith("CODING_PROPOSAL_")) return text === code ? code : null;
  return text === code || text.startsWith(`${code}:`) ? code : null;
}

function safeWorkerStatus(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : "UNKNOWN";
}

function attemptRecord({ request, attempt, decision, startedAt, status, workerStatus, failureClass, reason, now }) {
  return Object.freeze({
    schemaVersion: 1,
    execution_id: request.executionId,
    dedupe_key: request.dedupeKey,
    backend: "github-actions-runner",
    decision,
    attempt,
    latency_ms: Math.max(0, now() - startedAt),
    http_class: httpClass(status),
    checkpoint_id: request.headSha,
    resumed: false,
    worker_status: workerStatus,
    failure_class: failureClass,
    reason,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function resultSummary(request, attempts, status, reason, httpStatus, workerStatus) {
  const counts = attempts.reduce((summary, attempt) => {
    summary.attempts += 1;
    if (attempt.decision === "RETRY") summary.retries += 1;
    if (attempt.decision === "DISPATCHED") summary.dispatched += 1;
    if (attempt.decision === "NO_ACTION") summary.noAction += 1;
    if (attempt.decision === "FAILED_CLOSED") summary.failedClosed += 1;
    return summary;
  }, { attempts: 0, retries: 0, dispatched: 0, noAction: 0, failedClosed: 0 });
  return {
    status,
    reason,
    httpStatus,
    workerStatus,
    attempts,
    summary: {
      schemaVersion: 1,
      execution_id: request.executionId,
      dedupe_key: request.dedupeKey,
      backend: "github-actions-runner",
      checkpoint_id: request.headSha,
      ...counts,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    },
  };
}

async function oidcToken({ fetchImpl, requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN }) {
  if (typeof requestUrl !== "string" || !requestUrl || typeof requestToken !== "string" || !requestToken) {
    return { ok: false, status: null, reason: "github-oidc-not-configured", retryable: false };
  }
  let response;
  try {
    const tokenUrl = new URL(requestUrl);
    tokenUrl.searchParams.set("audience", "nusa-autopilot");
    response = await fetchImpl(tokenUrl, { headers: { authorization: "Bearer " + requestToken } });
  } catch {
    return { ok: false, status: null, reason: "github-oidc-network-failure", retryable: true };
  }
  if (!response.ok) return { ok: false, status: response.status, reason: "github-oidc-request-failed", retryable: transientStatus(response.status) };
  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: response.status, reason: "github-oidc-token-missing", retryable: false };
  }
  if (!payload || typeof payload.value !== "string" || !payload.value) return { ok: false, status: response.status, reason: "github-oidc-token-missing", retryable: false };
  return { ok: true, status: response.status, value: payload.value };
}

async function dispatchWithRetry({
  request,
  url,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseBackoffMs = DEFAULT_BACKOFF_MS,
  oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new Error("AUTOPILOT_RETRY_LIMIT_INVALID");
  if (!Number.isSafeInteger(baseBackoffMs) || baseBackoffMs < 0 || baseBackoffMs > 30_000) throw new Error("AUTOPILOT_BACKOFF_INVALID");

  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = now();
    const token = await oidcToken({ fetchImpl, requestUrl: oidcRequestUrl, requestToken: oidcRequestToken });
    if (!token.ok) {
      const decision = token.retryable && attempt < maxAttempts ? "RETRY" : "FAILED_CLOSED";
      attempts.push(attemptRecord({ request, attempt, decision, startedAt, status: token.status, workerStatus: "OIDC_UNAVAILABLE", failureClass: fixedFailureClass(token.status), reason: token.reason, now }));
      if (decision === "RETRY") {
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }
      return resultSummary(request, attempts, "FAILED_CLOSED", token.reason, token.status, "OIDC_UNAVAILABLE");
    }

    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          authorization: "Bearer " + token.value,
          "content-type": "application/json",
          "x-nusa-execution-id": request.executionId,
          "x-nusa-dedupe-key": request.dedupeKey,
        },
        body: JSON.stringify(request),
      });
    } catch {
      const decision = attempt < maxAttempts ? "RETRY" : "FAILED_CLOSED";
      attempts.push(attemptRecord({ request, attempt, decision, startedAt, status: null, workerStatus: "NETWORK_FAILURE", failureClass: "transient", reason: "coding-runner-network-failure", now }));
      if (decision === "RETRY") {
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }
      return resultSummary(request, attempts, "FAILED_CLOSED", "coding-runner-network-failure", null, "NETWORK_FAILURE");
    }

    if (response.ok) {
      let payload;
      try { payload = await response.json(); } catch { payload = {}; }
      const workerStatus = safeWorkerStatus(payload && payload.status);
      if (["EXECUTION_ACCEPTED", "EXECUTION_DISPATCHED"].includes(workerStatus)) {
        attempts.push(attemptRecord({ request, attempt, decision: "DISPATCHED", startedAt, status: response.status, workerStatus, failureClass: null, reason: null, now }));
        return resultSummary(request, attempts, "DISPATCHED", null, response.status, workerStatus);
      }
      if (workerStatus === "DUPLICATE_EXECUTION_SUPPRESSED") {
        attempts.push(attemptRecord({ request, attempt, decision: "NO_ACTION", startedAt, status: response.status, workerStatus, failureClass: "deterministic", reason: "duplicate-execution-suppressed", now }));
        return resultSummary(request, attempts, "NO_ACTION", "duplicate-execution-suppressed", response.status, workerStatus);
      }
      attempts.push(attemptRecord({ request, attempt, decision: "FAILED_CLOSED", startedAt, status: response.status, workerStatus, failureClass: "deterministic", reason: "cloud-coding-runtime-not-ready", now }));
      return resultSummary(request, attempts, "FAILED_CLOSED", "cloud-coding-runtime-not-ready", response.status, workerStatus);
    }

    const decision = transientStatus(response.status) && attempt < maxAttempts ? "RETRY" : "FAILED_CLOSED";
    attempts.push(attemptRecord({ request, attempt, decision, startedAt, status: response.status, workerStatus: "HTTP_REJECTED", failureClass: fixedFailureClass(response.status), reason: transientStatus(response.status) ? "external-coding-runner-transient-failure" : "external-coding-runner-rejected-request", now }));
    if (decision === "RETRY") {
      await sleep(baseBackoffMs * 2 ** (attempt - 1));
      continue;
    }
    return resultSummary(request, attempts, "FAILED_CLOSED", transientStatus(response.status) ? "external-coding-runner-transient-failure" : "external-coding-runner-rejected-request", response.status, "HTTP_REJECTED");
  }
  throw new Error("AUTOPILOT_RETRY_EXHAUSTED");
}

function readDispatchRequest() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (typeof eventPath !== "string" || !eventPath) throw new Error("GITHUB_EVENT_PATH_MISSING");
  let contents;
  try {
    contents = fs.readFileSync(eventPath, "utf8");
  } catch {
    throw new Error("GITHUB_EVENT_FILE_UNREADABLE");
  }
  let event;
  try {
    event = JSON.parse(contents.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("GITHUB_EVENT_JSON_INVALID");
  }
  const payload = event.client_payload || {};
  return {
    kind: payload.kind,
    repository: payload.repository,
    headSha: payload.head_sha,
    workflowRunId: payload.workflow_run_id,
    reason: payload.reason,
    executionId: payload.execution_id,
    dedupeKey: payload.dedupe_key,
    mutationAllowed: false,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  };
}

function writeFailureArtifact(reason) {
  const directory = "artifacts/autopilot-execution";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + "/coding-runner-result.json", JSON.stringify({
    schemaVersion: 1,
    status: "FAILED_CLOSED",
    reason,
    workerStatus: "FAILED_CLOSED",
    request: null,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, null, 2));
}

function endpointFor(runnerUrl, suffix) {
  const url = new URL(runnerUrl);
  if (!url.pathname.endsWith("/coding/execute")) throw new Error("AUTOPILOT_CODING_RUNNER_URL_INVALID");
  url.pathname = `/coding/${suffix}`;
  url.search = "";
  return url.toString();
}

async function authorizedJsonPost(url, body, fetchImpl = fetch) {
  const token = await oidcToken({ fetchImpl });
  if (!token.ok) throw new Error(token.reason);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await response.json(); } catch { /* fail below */ }
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `AUTOPILOT_WORKER_HTTP_${response.status}`);
  return payload;
}

function assertBoundedPatch(patch) {
  if (typeof patch !== "string" || !patch.trim()) throw new Error("SANDBOX_PATCH_REQUIRED");
  if (Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) throw new Error("SANDBOX_PATCH_TOO_LARGE");
  if (/liveAuthority|productionMutationAllowed|aiAuthority|NUSA_|wrangler|\.github\//i.test(patch)) {
    throw new Error("SANDBOX_PATCH_FORBIDDEN_AUTHORITY_SURFACE");
  }
  const paths = [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1].trim());
  const unique = [...new Set(paths)];
  if (unique.length !== 1) throw new Error("SANDBOX_PATCH_FILE_COUNT_INVALID");
  const path = unique[0];
  if (!path.startsWith("apps/autopilot/") || path.startsWith("/") || path.split("/").includes("..")) throw new Error(`SANDBOX_PATCH_PATH_OUTSIDE_ALLOWED_SCOPE:${path}`);
  if (path === "apps/autopilot/src/index.ts" || path === "apps/autopilot/src/worker.ts" || /(?:^|\/)(?:live|live-trading|broker|order|credential|secret|secrets|withdraw|transfer|production-authority)(?:\/|$)/i.test(path)) throw new Error(`SANDBOX_PATCH_PATH_FORBIDDEN:${path}`);
  return path;
}

function run(command, args, label, timeout = 300_000) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new Error(`${label}:${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}:${result.status}:${String(result.stderr || result.stdout || "").slice(-1200)}`);
  return String(result.stdout || "");
}

function isGeneratedWorkspaceArtifact(path) {
  return GENERATED_WORKSPACE_ARTIFACTS.has(path);
}

function filterGithubRunnerWorkspacePaths(paths) {
  return paths.filter((path) => path && path !== PATCH_PATH && !isGeneratedWorkspaceArtifact(path));
}

function assertGithubRunnerWorkspaceClean(statusOutput) {
  const unexpected = String(statusOutput || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => {
      const status = line.slice(0, 2);
      const path = line.slice(3).trim();
      return status !== "??" || !isGeneratedWorkspaceArtifact(path);
    });
  if (unexpected.length > 0) throw new Error("CODING_RUNTIME_WORKSPACE_DIRTY");
}

function validatePatchOnGithubRunner(request, patch) {
  const expectedPath = assertBoundedPatch(patch);
  if (run("git", ["rev-parse", "HEAD"], "GITHUB_RUNNER_HEAD_FAILED").trim().toLowerCase() !== request.headSha.toLowerCase()) {
    throw new Error("CODING_RUNTIME_HEAD_MISMATCH");
  }
  assertGithubRunnerWorkspaceClean(run("git", ["status", "--porcelain", "--untracked-files=all"], "GITHUB_RUNNER_STATUS_FAILED"));

  fs.writeFileSync(PATCH_PATH, `${patch.trim()}\n`);
  run("git", ["apply", "--check", PATCH_PATH], "SANDBOX_PATCH_APPLY_CHECK_FAILED");
  run("git", ["apply", PATCH_PATH], "SANDBOX_PATCH_APPLY_FAILED");
  run("git", ["diff", "--check"], "SANDBOX_PATCH_DIFF_CHECK_FAILED");

  const tracked = run("git", ["diff", "--name-only"], "SANDBOX_PATCH_DIFF_LIST_FAILED").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const untracked = filterGithubRunnerWorkspacePaths(run("git", ["ls-files", "--others", "--exclude-standard"], "SANDBOX_PATCH_UNTRACKED_LIST_FAILED")
    .split(/\r?\n/)
    .map((value) => value.trim()));
  const changed = [...new Set([...tracked, ...untracked])];
  if (changed.length !== 1 || changed[0] !== expectedPath) throw new Error("SANDBOX_PATCH_CHANGED_FILES_MISMATCH");

  run("corepack", ["enable"], "GITHUB_RUNNER_COREPACK_ENABLE_FAILED");
  run("corepack", ["prepare", "pnpm@11.7.0", "--activate"], "GITHUB_RUNNER_PNPM_ACTIVATE_FAILED");
  run("pnpm", ["install", "--frozen-lockfile"], "SANDBOX_INSTALL_FAILED", 480_000);
  run("pnpm", ["run", "build"], "SANDBOX_BUILD_FAILED", 480_000);
  run("pnpm", ["run", "architecture:check"], "SANDBOX_ARCHITECTURE_FAILED", 300_000);
  run("pnpm", ["run", "safety:invariants"], "SANDBOX_SAFETY_FAILED", 300_000);
  run("pnpm", ["run", "ai:architecture"], "SANDBOX_AI_ARCHITECTURE_FAILED", 300_000);

  const content = fs.readFileSync(expectedPath, "utf8");
  if (Buffer.byteLength(content, "utf8") > MAX_VALIDATED_FILE_BYTES) throw new Error("CODING_PUBLISH_CONTENT_INVALID");
  return [{ path: expectedPath, content }];
}

async function executeGithubActionsRunner(request, runnerUrl, fetchImpl = fetch) {
  const startedAt = Date.now();
  const proposalUrl = endpointFor(runnerUrl, "propose");
  const publishUrl = endpointFor(runnerUrl, "publish");
  const proposal = await authorizedJsonPost(proposalUrl, request, fetchImpl);
  if (proposal.status !== "PROPOSAL_READY" || typeof proposal.patch !== "string") throw new Error("CODING_PROPOSAL_UNAVAILABLE");
  const validatedFiles = validatePatchOnGithubRunner(request, proposal.patch);
  const published = await authorizedJsonPost(publishUrl, { request, validatedFiles }, fetchImpl);
  if (published.status !== "EXECUTION_ACCEPTED" || published.proposalValidated !== true) throw new Error("CODING_PUBLISH_VALIDATION_REQUIRED");

  const attempts = [attemptRecord({
    request,
    attempt: 1,
    decision: "DISPATCHED",
    startedAt,
    status: 200,
    workerStatus: "EXECUTION_ACCEPTED",
    failureClass: null,
    reason: null,
    now: () => Date.now(),
  })];
  return {
    ...resultSummary(request, attempts, "DISPATCHED", null, 200, "EXECUTION_ACCEPTED"),
    backend: "github-actions-runner",
    checkpointId: request.headSha,
    workspaceVerified: true,
    proposalValidated: true,
    changedFiles: validatedFiles.map((file) => file.path),
    publisher: published.publisher,
    branch: published.branch,
    commitSha: published.commitSha,
    pullRequestNumber: published.pullRequestNumber,
    pullRequestUrl: published.pullRequestUrl,
  };
}

function writeArtifacts(request, result) {
  const directory = "artifacts/autopilot-execution";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + "/coding-runner-result.json", JSON.stringify({ ...result, request }, null, 2));
  fs.writeFileSync(directory + "/execution-attempts.json", JSON.stringify({
    schemaVersion: 1,
    attempts: result.attempts || [],
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, null, 2));
  fs.writeFileSync(directory + "/execution-summary.json", JSON.stringify(result.summary || {
    schemaVersion: 1,
    execution_id: request.executionId,
    dedupe_key: request.dedupeKey,
    backend: "github-actions-runner",
    attempts: 1,
    retries: 0,
    dispatched: 0,
    noAction: 0,
    failedClosed: 1,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, null, 2));
}

async function main() {
  const startedAt = Date.now();
  let request;
  try {
    request = readDispatchRequest();
    const runnerUrl = process.env.NUSA_CODING_RUNNER_URL;
    if (typeof runnerUrl !== "string" || !runnerUrl) throw new Error("AUTOPILOT_CODING_RUNNER_URL_MISSING");
    const result = await executeGithubActionsRunner(request, runnerUrl);
    writeArtifacts(request, result);
    console.log(`execution=${result.status} backend=github-actions-runner changed=${(result.changedFiles || []).join(",")}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "AUTOPILOT_GITHUB_RUNNER_FAILED";
    if (!request) {
      try { writeFailureArtifact(reason); } catch { /* preserve the original bounded failure below */ }
      console.error(reason);
      process.exitCode = 1;
      return;
    }
    const safeProposalFailure = proposalFailureCode(reason);
    const attempts = [attemptRecord({
      request,
      attempt: 1,
      decision: safeProposalFailure ? "NO_ACTION" : "FAILED_CLOSED",
      startedAt,
      status: null,
      workerStatus: safeProposalFailure ? "PROPOSAL_REJECTED" : "FAILED_CLOSED",
      failureClass: "deterministic",
      reason: safeProposalFailure || reason,
      now: () => Date.now(),
    })];
    const result = resultSummary(request, attempts, safeProposalFailure ? "NO_ACTION" : "FAILED_CLOSED", safeProposalFailure || reason, null, safeProposalFailure ? "PROPOSAL_REJECTED" : "FAILED_CLOSED");
    writeArtifacts(request, result);
    if (safeProposalFailure) {
      console.log(`execution=NO_ACTION backend=github-actions-runner reason=${safeProposalFailure}`);
      return;
    }
    console.error(reason);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "AUTOPILOT_GITHUB_RUNNER_UNHANDLED");
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  dispatchWithRetry,
  transientStatus,
  httpClass,
  resultSummary,
  assertBoundedPatch,
  proposalFailureCode,
  readDispatchRequest,
  assertGithubRunnerWorkspaceClean,
  filterGithubRunnerWorkspacePaths,
  validatePatchOnGithubRunner,
  endpointFor,
};