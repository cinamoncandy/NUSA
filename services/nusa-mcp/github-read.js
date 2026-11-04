"use strict";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_ITEMS = 30;
const REPOSITORY = "cinamoncandy/NUSA";

const GITHUB_TOOL_DEFINITIONS = Object.freeze([
  { name: "github_repo_status", description: "Read NUSA GitHub repository/default branch status. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "github_pull_requests", description: "List bounded open pull requests for NUSA. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "github_ci_runs", description: "Read bounded recent GitHub Actions runs for NUSA. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
].map((tool) => Object.freeze({ ...tool, annotations: Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true }) })));

const GITHUB_TOOL_NAMES = new Set(GITHUB_TOOL_DEFINITIONS.map((tool) => tool.name));

function githubError(code) { return Object.assign(new Error(code), { code }); }

async function githubJson(path, { token, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof token !== "string" || token.trim().length < 32) throw githubError("UNAUTHORIZED");
  if (typeof path !== "string" || !path.startsWith(`/repos/${REPOSITORY}/`)) throw githubError("INVALID_ARGUMENT");
  let response;
  try {
    response = await fetchImpl(new URL(path, "https://api.github.com"), {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token.trim()}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "nusa-read-only-mcp"
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch { throw githubError("UPSTREAM_UNAVAILABLE"); }
  if (response.status === 401 || response.status === 403) throw githubError("UNAUTHORIZED");
  if (response.status === 429) throw githubError("RATE_LIMITED");
  if (!response.ok) throw githubError("UPSTREAM_UNAVAILABLE");
  try { return await response.json(); } catch { throw githubError("UPSTREAM_UNAVAILABLE"); }
}

async function callGithubReadTool(name, { token, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!GITHUB_TOOL_NAMES.has(name)) throw githubError("UNKNOWN_TOOL");
  if (name === "github_repo_status") {
    const repo = await githubJson(`/repos/${REPOSITORY}/`, { token, fetchImpl });
    const branch = await githubJson(`/repos/${REPOSITORY}/branches/${encodeURIComponent(repo.default_branch)}`, { token, fetchImpl });
    return Object.freeze({ source: "GITHUB_READ_ONLY", repository: repo.full_name, defaultBranch: repo.default_branch, mainSha: branch.commit.sha, liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", readAt: new Date(now()).toISOString() });
  }
  if (name === "github_pull_requests") {
    const pulls = await githubJson(`/repos/${REPOSITORY}/pulls?state=open&per_page=${MAX_ITEMS}`, { token, fetchImpl });
    if (!Array.isArray(pulls)) throw githubError("UPSTREAM_UNAVAILABLE");
    return Object.freeze({ source: "GITHUB_READ_ONLY", pullRequests: pulls.slice(0, MAX_ITEMS).map((pr) => Object.freeze({ number: pr.number, title: pr.title, head: pr.head?.ref, base: pr.base?.ref, draft: pr.draft === true, url: pr.html_url })), readAt: new Date(now()).toISOString() });
  }
  const runs = await githubJson(`/repos/${REPOSITORY}/actions/runs?per_page=${MAX_ITEMS}`, { token, fetchImpl });
  if (!Array.isArray(runs?.workflow_runs)) throw githubError("UPSTREAM_UNAVAILABLE");
  return Object.freeze({ source: "GITHUB_READ_ONLY", runs: runs.workflow_runs.slice(0, MAX_ITEMS).map((run) => Object.freeze({ name: run.name, event: run.event, status: run.status, conclusion: run.conclusion, headBranch: run.head_branch, headSha: run.head_sha, url: run.html_url })), readAt: new Date(now()).toISOString() });
}

module.exports = { REPOSITORY, GITHUB_TOOL_DEFINITIONS, GITHUB_TOOL_NAMES, callGithubReadTool };
