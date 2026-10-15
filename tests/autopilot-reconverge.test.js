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

test("updates another stale PR only when Audit already tried to release its current head", async () => {
  const claude = { head: { ref: "claude/x", sha: "b".repeat(40), repo: { full_name: repo } } };
  assert.equal((await decide(claude, { recentAuditForHead: true })).action, "MERGE_MAIN");
  assert.equal((await decide(claude, { recentAuditForHead: false })).reason, "NOT_AUTOPILOT_BRANCH");
  // The other guards still apply to these PRs.
  assert.equal((await decide({ ...claude, draft: true }, { recentAuditForHead: true })).reason, "DRAFT");
  assert.equal((await decide({ ...claude, labels: [{ name: "HOLD" }] }, { recentAuditForHead: true })).reason, "HOLD_OR_INVALID_LABELS");
  assert.equal((await decide({ ...claude, mergeable: false }, { recentAuditForHead: true })).reason, "CONFLICT_NEEDS_HUMAN");
  assert.equal((await decide(claude, { recentAuditForHead: true, ciSuccessOnHead: false })).reason, "HEAD_CI_NOT_SUCCESS");
});

test("recent audited heads come only from audit runs for that head within the window", async () => {
  const { recentAuditedHeads, RECENT_AUDIT_WINDOW_MS } = await import("../scripts/autopilot-reconverge.mjs");
  const now = Date.parse("2026-10-13T09:00:00Z");
  const sha = "d".repeat(40);
  const heads = recentAuditedHeads([
    { display_title: `audit:2651:38340732576:${sha}`, created_at: "2026-10-13T03:19:46Z" },
    { display_title: `audit:1900:1:${"e".repeat(40)}`, created_at: new Date(now - RECENT_AUDIT_WINDOW_MS - 1).toISOString() },
    { display_title: "invalid-audit-identity", created_at: "2026-10-13T08:00:00Z" },
    { display_title: `audit:7:1:${"f".repeat(40)}`, created_at: "2026-10-14T00:00:00Z" },
  ], now);
  assert.deepEqual([...heads], [`2651:${sha}`]);
});
