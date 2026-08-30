const fs = require("node:fs");

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 1_000;

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

function safeWorkerStatus(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : "UNKNOWN";
}

function attemptRecord({ request, attempt, decision, startedAt, status, workerStatus, failureClass, reason, now }) {
  return Object.freeze({
    schemaVersion: 1,
    execution_id: request.executionId,
    dedupe_key: request.dedupeKey,
    backend: "cloud-coding-runner",
    decision,
    attempt,
    latency_ms: Math.max(0, now() - startedAt),
    http_class: httpClass(status),
    checkpoint_id: null,
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
    response = await fetchImpl(requestUrl + "&audience=nusa-autopilot", {
      headers: { authorization: "Bearer " + requestToken },
    });
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
      attempts.push(attemptRecord({
        request, attempt, decision, startedAt, status: token.status, workerStatus: "OIDC_UNAVAILABLE",
        failureClass: fixedFailureClass(token.status), reason: token.reason, now,
      }));
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
      attempts.push(attemptRecord({
        request, attempt, decision, startedAt, status: null, workerStatus: "NETWORK_FAILURE",
        failureClass: "transient", reason: "coding-runner-network-failure", now,
      }));
      if (decision === "RETRY") {
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
        continue;
      }
      return resultSummary(request, attempts, "FAILED_CLOSED", "coding-runner-network-failure", null, "NETWORK_FAILURE");
    }

    if (response.ok) {
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      const workerStatus = safeWorkerStatus(payload && payload.status);
      if (["EXECUTION_ACCEPTED", "EXECUTION_DISPATCHED"].includes(workerStatus)) {
        attempts.push(attemptRecord({
          request, attempt, decision: "DISPATCHED", startedAt, status: response.status,
          workerStatus, failureClass: null, reason: null, now,
        }));
        return resultSummary(request, attempts, "DISPATCHED", null, response.status, workerStatus);
      }
      if (workerStatus === "DUPLICATE_EXECUTION_SUPPRESSED") {
        attempts.push(attemptRecord({
          request, attempt, decision: "NO_ACTION", startedAt, status: response.status,
          workerStatus, failureClass: "deterministic", reason: "duplicate-execution-suppressed", now,
        }));
        return resultSummary(request, attempts, "NO_ACTION", "duplicate-execution-suppressed", response.status, workerStatus);
      }
      attempts.push(attemptRecord({
        request, attempt, decision: "FAILED_CLOSED", startedAt, status: response.status,
        workerStatus, failureClass: "deterministic", reason: "cloud-coding-runtime-not-ready", now,
      }));
      return resultSummary(request, attempts, "FAILED_CLOSED", "cloud-coding-runtime-not-ready", response.status, workerStatus);
    }

    const decision = transientStatus(response.status) && attempt < maxAttempts ? "RETRY" : "FAILED_CLOSED";
    attempts.push(attemptRecord({
      request, attempt, decision, startedAt, status: response.status, workerStatus: "HTTP_REJECTED",
      failureClass: fixedFailureClass(response.status), reason: transientStatus(response.status) ? "external-coding-runner-transient-failure" : "external-coding-runner-rejected-request", now,
    }));
    if (decision === "RETRY") {
      await sleep(baseBackoffMs * 2 ** (attempt - 1));
      continue;
    }
    return resultSummary(
      request,
      attempts,
      "FAILED_CLOSED",
      transientStatus(response.status) ? "external-coding-runner-transient-failure" : "external-coding-runner-rejected-request",
      response.status,
      "HTTP_REJECTED",
    );
  }
  throw new Error("AUTOPILOT_RETRY_EXHAUSTED");
}

function readDispatchRequest() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (typeof eventPath !== "string" || !eventPath) throw new Error("GITHUB_EVENT_PATH_MISSING");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
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

async function main() {
  const request = readDispatchRequest();
  const result = await dispatchWithRetry({ request, url: process.env.NUSA_CODING_RUNNER_URL });
  const directory = "artifacts/autopilot-execution";
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + "/coding-runner-result.json", JSON.stringify({ ...result, request }, null, 2));
  fs.writeFileSync(directory + "/execution-attempts.json", JSON.stringify({
    schemaVersion: 1,
    attempts: result.attempts,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  }, null, 2));
  fs.writeFileSync(directory + "/execution-summary.json", JSON.stringify(result.summary, null, 2));
  console.log("execution=" + result.status + " attempts=" + result.summary.attempts + " retries=" + result.summary.retries);
}

if (require.main === module) {
  main().catch(() => {
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
};