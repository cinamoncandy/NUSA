import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_GITHUB_API = "https://api.github.com";
const SHA40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const CANONICAL_CI = "CI";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const text = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const positiveInteger = (value) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;

function fail(message) {
  throw new Error(message);
}

function githubHeaders(token) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "nusa-audit-dispatch-fallback",
    "x-github-api-version": "2022-11-28",
  };
}

async function readJson(response, reason) {
  if (!response.ok) fail(`${reason}_HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    fail(`${reason}_INVALID_JSON`);
  }
}

async function githubGet(base, repository, suffix, token, fetchImpl, reason) {
  return readJson(await fetchImpl(`${base}/repos/${repository}${suffix}`, {
    method: "GET",
    headers: githubHeaders(token),
  }), reason);
}

function validateSafety(payload, prefix) {
  if (payload.liveAuthority !== "NONE") fail(`${prefix}_LIVE_AUTHORITY_INVALID`);
  if (payload.productionMutationAllowed !== false) fail(`${prefix}_PRODUCTION_MUTATION_INVALID`);
  if (payload.aiAuthority !== "ZERO_AUTHORITY") fail(`${prefix}_AI_AUTHORITY_INVALID`);
}

export function classifyCanonicalPrCiEvent(eventPayload, repository) {
  const event = object(eventPayload);
  const run = object(event?.workflow_run);
  if (!event || !run) return Object.freeze({ actionable: false, reason: "workflow-run-event-required" });
  if (text(object(event.repository)?.full_name) !== repository) fail("EVENT_REPOSITORY_MISMATCH");
  const runId = positiveInteger(run.id);
  const headSha = text(run.head_sha)?.toLowerCase() ?? null;
  if (
    text(event.action) !== "completed" ||
    text(run.name) !== CANONICAL_CI ||
    text(run.status) !== "completed" ||
    text(run.conclusion) !== "success" ||
    text(run.event) !== "pull_request"
  ) {
    return Object.freeze({ actionable: false, reason: "not-canonical-pr-ci-success" });
  }
  if (!runId || !headSha || !SHA40.test(headSha)) fail("EVENT_CI_IDENTITY_INVALID");
  return Object.freeze({ actionable: true, runId, headSha });
}

function matchingPrNumbers(run) {
  const values = Array.isArray(run.pull_requests) ? run.pull_requests : [];
  return [...new Set(values.map((value) => positiveInteger(object(value)?.number)).filter((value) => value !== null))];
}

function validatePullRequest(pr, repository, headSha) {
  const value = object(pr);
  if (!value || value.state !== "open") fail("AUDIT_FALLBACK_PR_NOT_OPEN");
  const number = positiveInteger(value.number);
  if (!number) fail("AUDIT_FALLBACK_PR_NUMBER_INVALID");
  if (text(object(value.head)?.sha)?.toLowerCase() !== headSha) fail("AUDIT_FALLBACK_STALE_PR_HEAD");
  const base = object(value.base);
  if (text(base?.ref) !== "main") fail("AUDIT_FALLBACK_PR_BASE_NOT_MAIN");
  if (text(object(base?.repo)?.full_name) !== repository) fail("AUDIT_FALLBACK_PR_BASE_REPOSITORY_MISMATCH");
  const baseSha = text(base?.sha)?.toLowerCase() ?? null;
  if (!baseSha || !SHA40.test(baseSha)) fail("AUDIT_FALLBACK_PR_BASE_SHA_INVALID");
  return Object.freeze({ number, baseSha });
}

async function resolvePullRequest({ apiBase, repository, run, headSha, token, fetchImpl }) {
  const fromRun = matchingPrNumbers(run);
  if (fromRun.length > 1) fail("AUDIT_FALLBACK_CI_PR_IDENTITY_AMBIGUOUS");
  if (fromRun.length === 1) {
    const pr = await githubGet(apiBase, repository, `/pulls/${fromRun[0]}`, token, fetchImpl, "AUDIT_FALLBACK_PR");
    return validatePullRequest(pr, repository, headSha);
  }

  const candidates = await githubGet(apiBase, repository, `/commits/${headSha}/pulls`, token, fetchImpl, "AUDIT_FALLBACK_HEAD_PRS");
  if (!Array.isArray(candidates)) fail("AUDIT_FALLBACK_HEAD_PRS_INVALID");
  const matching = candidates.filter((candidate) => {
    const pr = object(candidate);
    return pr?.state === "open" &&
      text(object(pr.head)?.sha)?.toLowerCase() === headSha &&
      text(object(pr.base)?.ref) === "main" &&
      text(object(object(pr.base)?.repo)?.full_name) === repository;
  });
  if (matching.length !== 1) fail(matching.length === 0 ? "AUDIT_FALLBACK_PR_IDENTITY_NOT_FOUND" : "AUDIT_FALLBACK_PR_IDENTITY_AMBIGUOUS");
  return validatePullRequest(matching[0], repository, headSha);
}

async function verifyCanonicalEvidence({ apiBase, repository, runId, headSha, token, fetchImpl }) {
  const run = object(await githubGet(apiBase, repository, `/actions/runs/${runId}`, token, fetchImpl, "AUDIT_FALLBACK_CI"));
  if (!run) fail("AUDIT_FALLBACK_CI_INVALID");
  if (positiveInteger(run.id) !== runId) fail("AUDIT_FALLBACK_CI_RUN_ID_MISMATCH");
  if (text(run.name) !== CANONICAL_CI || text(run.event) !== "pull_request" || text(run.status) !== "completed" || text(run.conclusion) !== "success") {
    fail("AUDIT_FALLBACK_CI_NOT_CANONICAL_SUCCESS");
  }
  if (text(run.head_sha)?.toLowerCase() !== headSha) fail("AUDIT_FALLBACK_CI_HEAD_MISMATCH");
  if (text(object(run.repository)?.full_name) !== repository) fail("AUDIT_FALLBACK_CI_REPOSITORY_MISMATCH");

  const pr = await resolvePullRequest({ apiBase, repository, run, headSha, token, fetchImpl });
  const main = object(await githubGet(apiBase, repository, "/branches/main", token, fetchImpl, "AUDIT_FALLBACK_MAIN"));
  const mainSha = text(object(main?.commit)?.sha)?.toLowerCase() ?? null;
  if (!mainSha || !SHA40.test(mainSha)) fail("AUDIT_FALLBACK_MAIN_SHA_INVALID");
  if (mainSha !== pr.baseSha) fail("AUDIT_FALLBACK_BASE_MAIN_MISMATCH");
  return Object.freeze({ prNumber: pr.number, baseSha: pr.baseSha, mainSha });
}

export async function runAuditDispatchFallback({
  eventPayload,
  repository,
  githubToken,
  bridgeEligibility,
  apiBase = DEFAULT_GITHUB_API,
  fetchImpl = fetch,
}) {
  if (!REPOSITORY.test(String(repository ?? ""))) fail("GITHUB_REPOSITORY_INVALID");
  const event = classifyCanonicalPrCiEvent(eventPayload, repository);
  if (!event.actionable) {
    return Object.freeze({ status: "NO_ACTION", reason: event.reason, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
  }

  if (String(bridgeEligibility ?? "").trim() !== "true") {
    return Object.freeze({
      status: "NO_ACTION",
      reason: "worker-event-did-not-explicitly-require-token-fallback",
      headSha: event.headSha,
      workflowRunId: event.runId,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  }

  const token = text(githubToken);
  if (!token) fail("AUDIT_FALLBACK_GITHUB_TOKEN_REQUIRED");
  const normalizedBase = String(apiBase ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(normalizedBase)) fail("GITHUB_API_BASE_INVALID");

  const evidence = await verifyCanonicalEvidence({
    apiBase: normalizedBase,
    repository,
    runId: event.runId,
    headSha: event.headSha,
    token,
    fetchImpl,
  });

  const clientPayload = Object.freeze({
    kind: "AUDIT_REQUEST",
    repository,
    head_sha: event.headSha,
    pr_number: evidence.prNumber,
    workflow_run_id: event.runId,
    reason: `audit:pr:${evidence.prNumber}:ci:${event.runId}:${event.headSha}`,
    execution_id: `audit:${evidence.prNumber}:${event.runId}`,
    dedupe_key: `audit:${evidence.prNumber}:${event.runId}:${event.headSha}`,
    live_authority: "NONE",
    production_mutation_allowed: false,
    ai_authority: "ZERO_AUTHORITY",
  });

  const response = await fetchImpl(`${normalizedBase}/repos/${repository}/dispatches`, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "content-type": "application/json",
    },
    body: JSON.stringify({ event_type: "nusa_autopilot_execution", client_payload: clientPayload }),
  });
  if (response.status !== 204) fail(`AUDIT_FALLBACK_DISPATCH_HTTP_${response.status}`);

  return Object.freeze({
    status: "FALLBACK_DISPATCHED",
    reason: "worker-event-explicit-token-fallback",
    prNumber: evidence.prNumber,
    headSha: event.headSha,
    baseSha: evidence.baseSha,
    workflowRunId: event.runId,
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
}

function writeSummary(result) {
  const destination = process.env.GITHUB_STEP_SUMMARY;
  if (!destination) return;
  fs.appendFileSync(destination, [
    "## NUSA Audit Dispatch Fallback",
    "",
    `- status: ${result.status}`,
    `- reason: ${result.reason}`,
    `- PR: ${result.prNumber ?? "none"}`,
    `- head: ${result.headSha ?? "none"}`,
    `- CI run: ${result.workflowRunId ?? "none"}`,
    "- liveAuthority: NONE",
    "- productionMutationAllowed: false",
    "- AI authority: ZERO_AUTHORITY",
    "",
  ].join("\n"));
}

async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail("GITHUB_EVENT_PATH_REQUIRED");
  const eventPayload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const result = await runAuditDispatchFallback({
    eventPayload,
    repository: process.env.GITHUB_REPOSITORY,
    githubToken: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
    bridgeEligibility: process.env.NUSA_AUDIT_FALLBACK_ELIGIBLE,
  });
  validateSafety(result, "AUDIT_FALLBACK_RESULT");
  writeSummary(result);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "FAILED_CLOSED", reason: error instanceof Error ? error.message : "AUDIT_FALLBACK_FAILED", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" }));
    process.exitCode = 1;
  });
}
