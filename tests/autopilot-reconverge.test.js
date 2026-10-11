const test = require("node:test");
const assert = require("node:assert/strict");

const MAIN = "a".repeat(40);
const repo = "o/r";
const pr = (over = {}) => ({ state: "open", draft: false, labels: [], mergeable: true,
  head: { ref: "autopilot/codex/issue-1-2", sha: "b".repeat(40), repo: { full_name: repo } },
  base: { ref: "main", sha: "c".repeat(40), repo: { full_name: repo } }, ...over });
const decide = async (over, extra = {}) => (await import("../scripts/autopilot-reconverge.mjs")).decideReconverge({ pr: pr(over), mainSha: MAIN, repository: repo, ciSuccessOnHead: true, ...extra });

test("merges main into a stale autopilot PR whose head CI passed", async () => assert.equal((await decide()).action, "MERGE_MAIN"));
test("does nothing when already on current main", async () => assert.equal((await decide({ base: { ref: "main", sha: MAIN, repo: { full_name: repo } } })).reason, "UP_TO_DATE"));
test("waits until head CI succeeded (no churn while CI runs)", async () => assert.equal((await decide({}, { ciSuccessOnHead: false })).reason, "HEAD_CI_NOT_SUCCESS"));
test("never touches non-autopilot, fork, draft, held, closed or conflicting PRs", async () => {
  assert.equal((await decide({ head: { ref: "claude/x", sha: "b".repeat(40), repo: { full_name: repo } } })).reason, "NOT_AUTOPILOT_BRANCH");
  assert.equal((await decide({ head: { ref: "autopilot/x", sha: "b".repeat(40), repo: { full_name: "evil/r" } } })).reason, "FORK");
  assert.equal((await decide({ draft: true })).reason, "DRAFT");
  assert.equal((await decide({ labels: [{ name: "Hold" }] })).reason, "HOLD_OR_INVALID_LABELS");
  assert.equal((await decide({ labels: "x" })).reason, "HOLD_OR_INVALID_LABELS");
  assert.equal((await decide({ state: "closed" })).reason, "NOT_OPEN");
  assert.equal((await decide({ mergeable: false })).reason, "CONFLICT_NEEDS_HUMAN");
});
test("fails closed on unknown main", async () => assert.equal((await decide({}, { mainSha: "x" })).reason, "MAIN_UNKNOWN"));
