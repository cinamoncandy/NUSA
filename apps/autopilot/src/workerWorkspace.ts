import type { WorkerClaim } from "./worktreeWorkerPool";

/**
 * Binds an admitted #2128 claim to one real git worktree on one real branch.
 *
 * The admission boundary decides *whether* a worker may run and under which identity; this module
 * is the step that makes that decision physical. It deliberately takes an injected git runner
 * rather than importing `node:child_process`, because this package is deployed as a Cloudflare
 * Worker: the runtime that actually owns a checkout supplies the runner, and the boundary stays
 * testable against a real repository instead of a simulation.
 *
 * Everything here fails closed. No branch, no directory, and no worktree is created until every
 * precondition has been checked, because a half-provisioned workspace is worse than none: it
 * occupies a branch name and a path that the allocator believes are free.
 */

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `git <args>` with the repository root as the working directory. */
export type GitRunner = (args: readonly string[]) => GitResult;

export interface WorkerWorkspaceRequest {
  readonly claim: WorkerClaim;
  /** The exact commit the worker branches from. A ref name is refused: only an exact base is evidence. */
  readonly baseSha: string;
}

export interface WorkerWorkspace {
  readonly taskId: string;
  readonly executionId: string;
  readonly workerId: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseSha: string;
  readonly provisionedAt: number;
}

const EXACT_SHA = /^[0-9a-f]{40}$/;
const WORKTREE_ROOT = ".autopilot/worktrees/";
const RESERVED_BRANCHES = Object.freeze(["main", "master", "HEAD"]);

function requireExactBase(value: unknown): string {
  if (typeof value !== "string" || !EXACT_SHA.test(value)) throw new Error("WORKER_WORKSPACE_BASE_SHA_INVALID");
  return value;
}

/**
 * Re-checked here rather than trusted from admission. This module is exported and can be called
 * on its own, and these two values become a branch that gets pushed and a path that gets
 * `rm`-ed, so they are verified at the point of use as well as at the point of admission.
 */
function requireConfinedIdentity(claim: WorkerClaim): void {
  const branch = claim.task.branchName;
  const worktree = claim.task.worktreePath;
  if (RESERVED_BRANCHES.includes(branch) || branch.startsWith("refs/") || branch.split("/").includes("..")) {
    throw new Error("WORKER_WORKSPACE_BRANCH_FORBIDDEN");
  }
  if (!worktree.startsWith(WORKTREE_ROOT) || worktree.length === WORKTREE_ROOT.length || worktree.split("/").includes("..")) {
    throw new Error("WORKER_WORKSPACE_PATH_FORBIDDEN");
  }
}

function run(git: GitRunner, args: readonly string[], failure: string): GitResult {
  const result = git(args);
  if (result.status !== 0) throw new Error(`${failure}:${result.stderr.trim().split("\n")[0] ?? ""}`);
  return result;
}

function refExists(git: GitRunner, ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", ref]).status === 0;
}

/**
 * Creates the worker's branch at the exact base commit and checks it out in its own worktree.
 *
 * The branch is created by `git worktree add -b`, so branch creation and checkout are one
 * operation: there is no window in which the branch exists without the workspace that owns it.
 */
export function provisionWorkerWorkspace(request: WorkerWorkspaceRequest, git: GitRunner, now: number): WorkerWorkspace {
  const { claim } = request;
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("WORKER_WORKSPACE_NOW_INVALID");
  if (claim.state !== "CLAIMED" && claim.state !== "RUNNING") throw new Error("WORKER_WORKSPACE_CLAIM_NOT_ACTIVE");
  if (claim.leaseExpiresAt <= now) throw new Error("WORKER_WORKSPACE_LEASE_EXPIRED");
  requireConfinedIdentity(claim);
  const baseSha = requireExactBase(request.baseSha);

  // The base must be a commit this repository actually has, or the worker would branch from nothing.
  if (git(["cat-file", "-e", `${baseSha}^{commit}`]).status !== 0) throw new Error("WORKER_WORKSPACE_BASE_MISSING");
  // A branch that already exists belongs to some other execution, even if the allocator thinks the
  // name is free -- a previous worker may have crashed after creating it.
  if (refExists(git, `refs/heads/${claim.task.branchName}`)) throw new Error("WORKER_WORKSPACE_BRANCH_EXISTS");
  if (listWorkerWorktreePaths(git).includes(claim.task.worktreePath)) throw new Error("WORKER_WORKSPACE_PATH_EXISTS");

  run(git, ["worktree", "add", "-b", claim.task.branchName, claim.task.worktreePath, baseSha], "WORKER_WORKSPACE_PROVISION_FAILED");
  return Object.freeze({
    taskId: claim.task.taskId,
    executionId: claim.task.executionId,
    workerId: claim.workerId,
    branchName: claim.task.branchName,
    worktreePath: claim.task.worktreePath,
    baseSha,
    provisionedAt: now,
  });
}

/** Worker worktree paths git currently knows about, relative to the repository root. */
export function listWorkerWorktreePaths(git: GitRunner): readonly string[] {
  const listed = run(git, ["worktree", "list", "--porcelain"], "WORKER_WORKSPACE_LIST_FAILED").stdout;
  const root = listed.split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim();
  const paths: string[] = [];
  for (const line of listed.split("\n")) {
    if (!line.startsWith("worktree ")) continue;
    const absolute = line.slice("worktree ".length).trim();
    if (root == null || absolute === root) continue;
    const relative = absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute;
    if (relative.startsWith(WORKTREE_ROOT)) paths.push(relative);
  }
  return Object.freeze(paths);
}

/**
 * Removes the worktree and its branch.
 *
 * `--force` is used deliberately: a worker that failed mid-implementation leaves a dirty tree, and
 * refusing to clean that up would leak the slot forever. The work is not lost silently -- it was
 * never committed, and the branch is deleted with it.
 */
export function releaseWorkerWorkspace(workspace: WorkerWorkspace, git: GitRunner): void {
  if (listWorkerWorktreePaths(git).includes(workspace.worktreePath)) {
    run(git, ["worktree", "remove", "--force", workspace.worktreePath], "WORKER_WORKSPACE_RELEASE_FAILED");
  }
  if (refExists(git, `refs/heads/${workspace.branchName}`)) {
    run(git, ["branch", "-D", workspace.branchName], "WORKER_WORKSPACE_BRANCH_DELETE_FAILED");
  }
}

/**
 * Removes worker worktrees that no live claim owns, and returns what was removed.
 *
 * This is the physical half of lease recovery: `recoverExpiredWorkerClaims` frees the slot in the
 * allocator, but the crashed worker's checkout is still on disk holding the path and the branch.
 * Without this, a recovered task can never be re-admitted -- its own leftovers collide with it.
 */
export function reconcileWorkerWorkspaces(git: GitRunner, liveWorktreePaths: readonly string[]): readonly string[] {
  const live = new Set(liveWorktreePaths);
  const removed: string[] = [];
  for (const path of listWorkerWorktreePaths(git)) {
    if (live.has(path)) continue;
    run(git, ["worktree", "remove", "--force", path], "WORKER_WORKSPACE_RECONCILE_FAILED");
    removed.push(path);
  }
  run(git, ["worktree", "prune"], "WORKER_WORKSPACE_PRUNE_FAILED");
  return Object.freeze(removed);
}
