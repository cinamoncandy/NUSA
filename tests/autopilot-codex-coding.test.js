"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { selectCodexBacklogTask } = require("../dist/apps/autopilot/src/evolveGithubIssueBacklog.js");
const { buildPrompt } = require("../scripts/autopilot-codex-select.js");

const SAFE = "liveAuthority=NONE\nproductionMutationAllowed=false\naiAuthority=ZERO_AUTHORITY";
const issue = (number, title, body, extra = {}) => ({ number, title, body, state: "open", author_association: "OWNER", updated_at: "2026-09-29T00:00:00Z", labels: [], ...extra });

test("Codex takes the research and general issues the Workers AI runner cannot, highest priority first", () => {
  const issues = [
    issue(10, "P1: research walk-forward gate", `Improve research OOS.\n${SAFE}`),
    issue(11, "P0: mobile UI polish", `Mobile UI.\n${SAFE}`),
    issue(12, "P0: something vague", `No domain words.\n${SAFE}`),
  ];
  const task = selectCodexBacklogTask(issues, []);
  assert.equal(task.issueNumber, 11);
  assert.equal(task.capability, "GENERAL");
});

test("unsafe, non-owner, blocked or already-linked issues are never selected", () => {
  const issues = [
    issue(20, "P0: research without contract", "research"),
    issue(21, "P0: research by outsider", `research\n${SAFE}`, { author_association: "CONTRIBUTOR" }),
    issue(22, "P0: research on hold", `research\n${SAFE}`, { labels: [{ name: "hold" }] }),
    issue(23, "P0: research linked", `research\n${SAFE}`),
    issue(24, "P0: live enabling", `research\n${SAFE}\nliveAuthority=LIVE`),
  ];
  assert.equal(selectCodexBacklogTask(issues, [{ title: "fix", body: "Refs #23" }]), null);
});

test("the Codex prompt carries the CORE/AIPOS contract and forbids commit, push and protected paths", () => {
  const prompt = buildPrompt({ issueNumber: 5, capability: "RESEARCH", title: "P1: research", body: "details" });
  assert.match(prompt, /AGENTS\.md/);
  assert.match(prompt, /NUSA_CORE_MASTER_INSTRUCTIONS/);
  assert.match(prompt, /Do not commit, push, open a PR/);
  assert.match(prompt, /liveAuthority=NONE/);
  assert.match(prompt, /OWNER ISSUE #5/);
});

test("the workflow pins Codex to the single dedicated-account runner and publishes only after validation", () => {
  const workflow = fs.readFileSync(".github/workflows/autopilot-codex-coding.yml", "utf8");
  assert.match(workflow, /runs-on: \[self-hosted, Linux, nusa-codex-autopilot\]/, "only the runner labelled for the dedicated ChatGPT account");
  assert.doesNotMatch(workflow, /nusa-codex-dev\]/, "never the shared Codex runner label");
  const codexJob = workflow.slice(workflow.indexOf("  codex:"), workflow.indexOf("  publish:"));
  assert.doesNotMatch(codexJob, /git push|gh pr create|NUSA_AUTOPILOT_GITHUB_TOKEN/, "Codex has no commit or push authority");
  assert.match(codexJob, /usage limit/, "a ChatGPT usage limit is a wait, not a fallback to another account");
  assert.match(codexJob, /set \+e -uo pipefail/, "the default bash -e must not end the step before the usage-limit check");
  const publish = workflow.slice(workflow.indexOf("  publish:"));
  const order = ["protected path", "pnpm run build", "pnpm run typecheck", "pnpm run validate", "node --test tests/*.test.js", "gh pr create"].map((marker) => publish.indexOf(marker));
  assert.ok(order.every((index) => index > 0), "every gate is present");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "validation gates run before the PR is created");
  assert.match(workflow, /group: autopilot-codex-coding/);
  assert.match(workflow, /head:autopilot\/codex\//, "one open autopilot Codex PR at a time");
});
