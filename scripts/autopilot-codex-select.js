"use strict";

/**
 * Selects the next owner backlog issue for the Codex coding engine and writes it as GitHub Actions
 * step outputs (autopilot-codex-coding.yml). Read-only: it only lists issues and pull requests.
 */
const fs = require("node:fs");
const { selectCodexBacklogTask } = require("../dist/apps/autopilot/src/evolveGithubIssueBacklog.js");

const CONTRACT = [
  "NUSA AUTOPILOT CODEX CONTRACT:",
  "- Read and obey AGENTS.md, the AIPOS recovery protocol and docs/NUSA_CORE_MASTER_INSTRUCTIONS.md before editing.",
  "- Implement only the next smallest verifiable increment of the issue below, with tests, and update the AIPOS work order/state it needs.",
  "- Preserve PAPER-only operation, liveAuthority=NONE, productionMutationAllowed=false and aiAuthority=ZERO_AUTHORITY.",
  "- Never touch LIVE trading, broker/exchange credentials, secrets, .github/workflows or deploy/ files.",
  "- Do not commit, push, open a PR, merge, deploy or trigger CI. Leave changes uncommitted; the workflow validates and publishes them.",
  "- Run the relevant local validation (pnpm run build, typecheck, validate and the affected tests) and report truthfully what ran.",
].join("\n");

async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nusa-autopilot-codex" },
  });
  if (!response.ok) throw new Error(`GitHub ${path} failed: ${response.status}`);
  return response.json();
}

function buildPrompt(task) {
  return `${CONTRACT}\n\nOWNER ISSUE #${task.issueNumber} (${task.capability}): ${task.title}\n\n${task.body}`;
}

async function main(env = process.env) {
  const token = env.GITHUB_TOKEN;
  const repository = env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const [issues, pulls] = await Promise.all([
    github(`/repos/${repository}/issues?state=open&per_page=100`, token),
    github(`/repos/${repository}/pulls?state=open&per_page=100`, token),
  ]);
  const task = selectCodexBacklogTask(issues, pulls);
  const lines = task == null
    ? ["has_task=false"]
    : ["has_task=true", `issue=${task.issueNumber}`, `task=issue-${task.issueNumber}`];
  if (task != null) fs.writeFileSync(env.NUSA_CODEX_PROMPT_FILE || "codex-prompt.txt", buildPrompt(task));
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  console.log(task == null ? "no eligible owner backlog issue for Codex" : `selected issue #${task.issueNumber}: ${task.title}`);
}

if (require.main === module) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

module.exports = { buildPrompt, CONTRACT };
