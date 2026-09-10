"use strict";
/**
 * Classifies every remote branch by whether its work is already in main, so cleanup is a
 * decision about a measured list rather than about a branch name.
 *
 * The policy in BRANCH_CLEANUP_POLICY.md counted 556 branches in August and planned to reach
 * ~100. There are now far more, and the count in that document has been stale ever since, which
 * is what happens to a number written into prose. This regenerates it.
 *
 * The judgement that matters is `git cherry origin/main <branch>`: it compares patch identity,
 * not ancestry, so it recognizes work that reached main through a squash merge or a cherry-pick
 * and would otherwise look unmerged. A branch every one of whose commits is already upstream can
 * be deleted without losing anything.
 *
 * Two weaker signals are deliberately NOT trusted on their own:
 *   - a merge commit in main naming the branch. Branches here get reused across pull requests,
 *     so a branch merged once can carry unmerged work now. Checking this against `git cherry`
 *     found nine such branches, one of them the branch this script was written on, with
 *     twenty-four unmerged commits.
 *   - the `merged` field from the pull request list API, which is not populated there. Every one
 *     of the hundred most recent closed pull requests reports `merged: false`, including ones
 *     whose merge commit is visibly in main.
 *
 * Usage: node scripts/branch-cleanup-report.js [--list]
 *   --list  print the deletable branch names, one per line, instead of the summary
 */
const { execFileSync } = require("node:child_process");

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function remoteBranches() {
  return git("branch", "-r", "--format=%(refname:short)")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "origin/HEAD" && line !== "origin/main" && !line.startsWith("origin/HEAD"));
}

/** Branches with an open pull request must never be proposed for deletion. */
function openPullRequestBranches() {
  const raw = process.env.NUSA_OPEN_PR_BRANCHES ?? "";
  return new Set(raw.split(",").map((name) => name.trim()).filter(Boolean));
}

function classify(ref) {
  let cherry = "";
  try {
    cherry = git("cherry", "origin/main", ref);
  } catch {
    return { verdict: "UNREADABLE", unique: 0 };
  }
  const lines = cherry.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { verdict: "CONTAINED", unique: 0 };
  const unique = lines.filter((line) => line.startsWith("+")).length;
  return unique === 0 ? { verdict: "PATCH_UPSTREAM", unique: 0 } : { verdict: "UNIQUE", unique };
}

function ageDays(ref) {
  const committed = Number(git("log", "-1", "--format=%ct", ref).trim());
  return Math.floor((Date.now() / 1000 - committed) / 86400);
}

function main() {
  const protectedBranches = openPullRequestBranches();
  const rows = remoteBranches().map((ref) => {
    const branch = ref.replace(/^origin\//, "");
    return { branch, ...classify(ref), age: ageDays(ref) };
  });

  const deletable = rows
    .filter((row) => (row.verdict === "CONTAINED" || row.verdict === "PATCH_UPSTREAM") && !protectedBranches.has(row.branch))
    .map((row) => row.branch)
    .sort();

  if (process.argv.includes("--list")) {
    for (const branch of deletable) console.log(branch);
    return;
  }

  const counts = rows.reduce((totals, row) => ({ ...totals, [row.verdict]: (totals[row.verdict] ?? 0) + 1 }), {});
  const stale = rows.filter((row) => row.verdict === "UNIQUE" && row.age >= 30 && !protectedBranches.has(row.branch)).length;

  console.log(JSON.stringify({
    total: rows.length,
    verdicts: counts,
    protectedByOpenPullRequest: [...protectedBranches].length,
    deletableNow: deletable.length,
    remainingAfterDeletion: rows.length - deletable.length,
    unmergedAndStale30Days: stale,
    oldestBranchDays: rows.reduce((oldest, row) => Math.max(oldest, row.age), 0)
  }, null, 2));
}

main();
