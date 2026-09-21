const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/oracle-codex-dev.yml"), "utf8");
const bootstrap = fs.readFileSync(path.join(root, "scripts/oracle/bootstrap-codex-dev-runner.sh"), "utf8");

test("Oracle Codex runner bootstrap supports the current X64 Oracle host without excluding ARM64", () => {
  assert.match(bootstrap, /x86_64\|amd64\) RUNNER_ARCH=x64/);
  assert.match(bootstrap, /aarch64\|arm64\) RUNNER_ARCH=arm64/);
  assert.match(bootstrap, /actions-runner-linux-\$\{RUNNER_ARCH\}-\$\{version\}\.tar\.gz/);
  assert.match(bootstrap, /RUNNER_ROOT="\$\{NUSA_RUNNER_ROOT:-\/opt\/actions-runner-nusa-codex\}"/);
  assert.doesNotMatch(bootstrap, /actions-runner-linux-arm64-\$\{version\}\.tar\.gz/);
});

test("Oracle Codex task execution uses one isolated branch and git worktree", () => {
  assert.match(workflow, /runs-on: \[self-hosted, Linux, nusa-codex-dev\]/);
  assert.doesNotMatch(workflow, /runs-on: \[[^\n]*ARM64/);
  assert.match(workflow, /git worktree add -b "\$worker_branch" "\$worker_path" "\$GITHUB_SHA"/);
  assert.match(workflow, /worker_branch="autopilot\/codex\/\$\{safe_task\}-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(workflow, /codex exec -s workspace-write -C "\$worktree"/);
  assert.doesNotMatch(workflow, /codex exec[^\n]*-C "\$GITHUB_WORKSPACE"/);
  assert.match(workflow, /git worktree remove --force "\$NUSA_WORKTREE"/);
  assert.match(workflow, /git branch -D "\$NUSA_WORKER_BRANCH"/);
  assert.match(workflow, /git worktree prune/);
});

test("Oracle Codex concurrency isolates distinct task IDs while deduplicating the same task", () => {
  assert.match(workflow, /group: oracle-codex-dev-\$\{\{ inputs\.mode \}\}-\$\{\{ inputs\.task \|\| 'none' \}\}/);
  assert.doesNotMatch(workflow, /group: oracle-codex-dev-runner/);
});
