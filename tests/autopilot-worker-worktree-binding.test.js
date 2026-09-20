"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const {
  provisionWorkerWorkspace,
  releaseWorkerWorkspace,
  reconcileWorkerWorkspaces,
  listWorkerWorktreePaths,
} = require("../dist/apps/autopilot/src/workerWorkspace.js");

/**
 * These run against a real git repository in a temp directory, not a stubbed runner.
 *
 * #2117 asks for parallel non-conflicting tasks to execute in isolated worktrees without
 * cross-contamination. A mock git cannot answer that question: it would only prove this module
 * emits the argv someone expected. Real worktrees, real files, real isolation.
 */

function gitRunnerFor(root) {
  return (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  };
}

function newRepository() {
  const root = mkdtempSync(join(tmpdir(), "nusa-worker-ws-"));
  const git = gitRunnerFor(root);
  for (const args of [
    ["init", "--initial-branch=main"],
    ["config", "user.email", "worker@example.invalid"],
    ["config", "user.name", "NUSA Worker Test"],
    ["config", "commit.gpgsign", "false"],
  ]) {
    const result = git(args);
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  }
  writeFileSync(join(root, "shared.txt"), "base\n");
  assert.equal(git(["add", "shared.txt"]).status, 0);
  assert.equal(git(["commit", "-m", "base"]).status, 0);
  const baseSha = git(["rev-parse", "HEAD"]).stdout.trim();
  assert.match(baseSha, /^[0-9a-f]{40}$/);
  return { root, git, baseSha, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function claim(id, overrides = {}) {
  return {
    task: {
      taskId: id,
      issueNumber: 2117,
      dedupeKey: `dedupe:${id}`,
      executionId: `execution:${id}`,
      branchName: `codex/${id}`,
      worktreePath: `.autopilot/worktrees/${id}`,
      canonicalOwner: "autopilot.control-plane",
      conflictKeys: [`issue:${id}`],
      dependencies: [],
      priority: 0.9,
      queuedAt: 100,
      ...(overrides.task ?? {}),
    },
    workerId: overrides.workerId ?? `worker-${id}`,
    state: overrides.state ?? "RUNNING",
    claimedAt: 200,
    leaseExpiresAt: overrides.leaseExpiresAt ?? 10_000,
    startedAt: 205,
  };
}

test("two non-conflicting workers get genuinely isolated checkouts", () => {
  const repo = newRepository();
  try {
    const a = provisionWorkerWorkspace({ claim: claim("alpha"), baseSha: repo.baseSha }, repo.git, 1_000);
    const b = provisionWorkerWorkspace({ claim: claim("bravo"), baseSha: repo.baseSha }, repo.git, 1_000);

    assert.notEqual(a.worktreePath, b.worktreePath);
    assert.notEqual(a.branchName, b.branchName);

    const fileIn = (ws) => join(repo.root, ws.worktreePath, "shared.txt");
    assert.ok(existsSync(fileIn(a)) && existsSync(fileIn(b)), "each worker has its own checkout of the tree");

    // Each worker edits the same tracked path. This is the cross-contamination question.
    writeFileSync(fileIn(a), "written by alpha\n");
    writeFileSync(fileIn(b), "written by bravo\n");

    assert.equal(readFileSync(fileIn(a), "utf8"), "written by alpha\n");
    assert.equal(readFileSync(fileIn(b), "utf8"), "written by bravo\n");
    assert.equal(readFileSync(join(repo.root, "shared.txt"), "utf8"), "base\n", "the primary checkout must not see worker edits");

    // And a commit in one is invisible to the other.
    const gitIn = (ws) => gitRunnerFor(join(repo.root, ws.worktreePath));
    assert.equal(gitIn(a)(["commit", "-am", "alpha work"]).status, 0);
    assert.equal(readFileSync(fileIn(b), "utf8"), "written by bravo\n");
    assert.notEqual(
      gitIn(a)(["rev-parse", "HEAD"]).stdout.trim(),
      gitIn(b)(["rev-parse", "HEAD"]).stdout.trim(),
      "committing in one worktree must not move the other",
    );
  } finally {
    repo.cleanup();
  }
});

test("each workspace starts from the exact base commit it was given", () => {
  const repo = newRepository();
  try {
    const workspace = provisionWorkerWorkspace({ claim: claim("exact"), baseSha: repo.baseSha }, repo.git, 1_000);
    assert.equal(workspace.baseSha, repo.baseSha);
    const head = gitRunnerFor(join(repo.root, workspace.worktreePath))(["rev-parse", "HEAD"]).stdout.trim();
    assert.equal(head, repo.baseSha, "the worker branch must start at the exact audited base, not at whatever main is");
  } finally {
    repo.cleanup();
  }
});

test("the workspace carries the claim's execution identity, so evidence is attributable", () => {
  const repo = newRepository();
  try {
    const workspace = provisionWorkerWorkspace({ claim: claim("ident"), baseSha: repo.baseSha }, repo.git, 1_000);
    assert.deepEqual(
      { taskId: workspace.taskId, executionId: workspace.executionId, workerId: workspace.workerId },
      { taskId: "ident", executionId: "execution:ident", workerId: "worker-ident" },
    );
  } finally {
    repo.cleanup();
  }
});

test("a colliding branch or path is refused instead of half-provisioned", () => {
  const repo = newRepository();
  try {
    provisionWorkerWorkspace({ claim: claim("first"), baseSha: repo.baseSha }, repo.git, 1_000);

    // Same branch, different path.
    assert.throws(
      () => provisionWorkerWorkspace({ claim: claim("second", { task: { branchName: "codex/first" } }), baseSha: repo.baseSha }, repo.git, 1_000),
      /WORKER_WORKSPACE_BRANCH_EXISTS/,
    );
    // Same path, different branch.
    assert.throws(
      () => provisionWorkerWorkspace({ claim: claim("third", { task: { worktreePath: ".autopilot/worktrees/first" } }), baseSha: repo.baseSha }, repo.git, 1_000),
      /WORKER_WORKSPACE_PATH_EXISTS/,
    );
    // Neither refusal may have left anything behind.
    assert.deepEqual([...listWorkerWorktreePaths(repo.git)], [".autopilot/worktrees/first"]);
    assert.equal(repo.git(["rev-parse", "--verify", "--quiet", "refs/heads/codex/second"]).status, 1);
    assert.equal(repo.git(["rev-parse", "--verify", "--quiet", "refs/heads/codex/third"]).status, 1);
  } finally {
    repo.cleanup();
  }
});

test("a crashed worker's leftovers do not block the task from being re-admitted", () => {
  const repo = newRepository();
  try {
    // Worker crashes mid-implementation: dirty tree, uncommitted work, lease then expires.
    const crashed = provisionWorkerWorkspace({ claim: claim("recover"), baseSha: repo.baseSha }, repo.git, 1_000);
    writeFileSync(join(repo.root, crashed.worktreePath, "shared.txt"), "half-finished\n");

    // The allocator recovered the lease, so no live claim owns this path any more.
    const removed = reconcileWorkerWorkspaces(repo.git, []);
    assert.deepEqual([...removed], [".autopilot/worktrees/recover"]);
    assert.equal(existsSync(join(repo.root, crashed.worktreePath)), false);

    // The branch outlives the worktree, which is exactly what would collide on re-admission.
    assert.equal(repo.git(["rev-parse", "--verify", "--quiet", "refs/heads/codex/recover"]).status, 0);
    assert.throws(
      () => provisionWorkerWorkspace({ claim: claim("recover", { workerId: "worker-2" }), baseSha: repo.baseSha }, repo.git, 2_000),
      /WORKER_WORKSPACE_BRANCH_EXISTS/,
      "a leftover branch must fail closed rather than be silently reused by a different worker",
    );

    // Full release clears both, and the task is then re-admissible under a new worker.
    releaseWorkerWorkspace(crashed, repo.git);
    const retried = provisionWorkerWorkspace({ claim: claim("recover", { workerId: "worker-2" }), baseSha: repo.baseSha }, repo.git, 2_000);
    assert.equal(retried.workerId, "worker-2");
    assert.equal(readFileSync(join(repo.root, retried.worktreePath, "shared.txt"), "utf8"), "base\n", "the retry must not inherit the crashed worker's dirty state");
  } finally {
    repo.cleanup();
  }
});

test("reconcile keeps workspaces a live claim still owns", () => {
  const repo = newRepository();
  try {
    provisionWorkerWorkspace({ claim: claim("keep"), baseSha: repo.baseSha }, repo.git, 1_000);
    provisionWorkerWorkspace({ claim: claim("drop"), baseSha: repo.baseSha }, repo.git, 1_000);
    const removed = reconcileWorkerWorkspaces(repo.git, [".autopilot/worktrees/keep"]);
    assert.deepEqual([...removed], [".autopilot/worktrees/drop"]);
    assert.deepEqual([...listWorkerWorktreePaths(repo.git)], [".autopilot/worktrees/keep"]);
  } finally {
    repo.cleanup();
  }
});

test("release is idempotent and leaves the repository clean", () => {
  const repo = newRepository();
  try {
    const workspace = provisionWorkerWorkspace({ claim: claim("clean"), baseSha: repo.baseSha }, repo.git, 1_000);
    releaseWorkerWorkspace(workspace, repo.git);
    assert.doesNotThrow(() => releaseWorkerWorkspace(workspace, repo.git), "a second release must not fail the recovery path");
    assert.deepEqual([...listWorkerWorktreePaths(repo.git)], []);
    assert.equal(repo.git(["rev-parse", "--verify", "--quiet", "refs/heads/codex/clean"]).status, 1);
    assert.equal(repo.git(["status", "--porcelain"]).stdout.trim(), "", "the primary checkout must be left clean");
  } finally {
    repo.cleanup();
  }
});

test("nothing is provisioned for an expired lease, an inactive claim, or an inexact base", () => {
  const repo = newRepository();
  try {
    const cases = [
      [claim("late", { leaseExpiresAt: 500 }), repo.baseSha, /WORKER_WORKSPACE_LEASE_EXPIRED/],
      [claim("done", { state: "COMPLETED" }), repo.baseSha, /WORKER_WORKSPACE_CLAIM_NOT_ACTIVE/],
      [claim("ref"), "main", /WORKER_WORKSPACE_BASE_SHA_INVALID/],
      [claim("short"), "abc123", /WORKER_WORKSPACE_BASE_SHA_INVALID/],
      [claim("ghost"), "0".repeat(40), /WORKER_WORKSPACE_BASE_MISSING/],
      [claim("protected", { task: { branchName: "main" } }), repo.baseSha, /WORKER_WORKSPACE_BRANCH_FORBIDDEN/],
      [claim("symbolic", { task: { branchName: "refs/heads/main" } }), repo.baseSha, /WORKER_WORKSPACE_BRANCH_FORBIDDEN/],
      [claim("escape", { task: { worktreePath: "../../../tmp/evil" } }), repo.baseSha, /WORKER_WORKSPACE_PATH_FORBIDDEN/],
      [claim("absolute", { task: { worktreePath: "/etc/nusa" } }), repo.baseSha, /WORKER_WORKSPACE_PATH_FORBIDDEN/],
      [claim("traverse", { task: { worktreePath: ".autopilot/worktrees/../../../root" } }), repo.baseSha, /WORKER_WORKSPACE_PATH_FORBIDDEN/],
    ];
    for (const [c, baseSha, expected] of cases) {
      assert.throws(() => provisionWorkerWorkspace({ claim: c, baseSha }, repo.git, 1_000), expected, c.task.taskId);
    }
    // A refusal must never be a partial provision.
    assert.deepEqual([...listWorkerWorktreePaths(repo.git)], []);
    assert.equal(repo.git(["branch", "--list"]).stdout.replace(/[*\s]/g, ""), "main");
    // The traversal cases are not hypothetical: with the confinement guard removed, git really does
    // create the worktree outside the repository. Verified once by mutation, asserted here as the
    // absence of any provisioning rather than against a global path, which would be flaky.
  } finally {
    repo.cleanup();
  }
});
