import test from "node:test";
import assert from "node:assert/strict";
import { deriveGithubIssueBacklogReadiness } from "./evolveGithubIssueBacklog";

const NOW = new Date("2026-09-12T05:00:00.000Z");
const SAFETY = "Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.";

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 903,
    title: "P1: Autonomous Development Control Plane for maximum verified merge throughput",
    body: `Implement bounded Autopilot control-plane work. ${SAFETY}`,
    state: "open",
    author_association: "OWNER",
    labels: [],
    updated_at: "2026-09-12T04:50:00.000Z",
    ...overrides,
  };
}

test("backlog readiness surfaces owner-authored safety-bounded P0/P1 Autopilot work", () => {
  const result = deriveGithubIssueBacklogReadiness([issue()], [], NOW);
  assert.equal(result.eligibleIssueCount, 1);
  assert.deepEqual(result.signals.map((signal) => signal.id), ["github-issue-903"]);
});

test("backlog readiness counts all eligible work but dispatch signal stays bounded to one", () => {
  const result = deriveGithubIssueBacklogReadiness([
    issue({ number: 903 }),
    issue({ number: 1900, title: "P0: AUTOPILOT exact-head recovery", updated_at: "2026-09-12T04:40:00.000Z" }),
  ], [], NOW);
  assert.equal(result.eligibleIssueCount, 2);
  assert.deepEqual(result.signals.map((signal) => signal.id), ["github-issue-1900"]);
});

test("backlog readiness excludes HOLD, BLOCKED_HUMAN and REWORK labels", () => {
  const blocked = [
    issue({ number: 1, labels: [{ name: "HOLD" }] }),
    issue({ number: 2, labels: [{ name: "BLOCKED_HUMAN" }] }),
    issue({ number: 3, labels: [{ name: "REWORK" }] }),
  ];
  assert.equal(deriveGithubIssueBacklogReadiness(blocked, [], NOW).eligibleIssueCount, 0);
});

test("backlog readiness excludes issue already represented by an open PR", () => {
  const pulls = [{ title: "fix: sticky hold", body: "Fixes #903" }];
  const result = deriveGithubIssueBacklogReadiness([issue()], pulls, NOW);
  assert.equal(result.eligibleIssueCount, 0);
  assert.deepEqual(result.signals, []);
});

test("backlog readiness fails closed for PR wrappers, untrusted authors, unsafe and unrelated work", () => {
  const unsafe = [
    issue({ pull_request: { url: "https://api.github.com/pulls/1" } }),
    issue({ author_association: "NONE" }),
    issue({ body: "Autopilot work without authority invariants." }),
    issue({ title: "P1: unrelated cloud deployment", body: SAFETY }),
    issue({ state: "closed" }),
    issue({ title: "P2: AUTOPILOT cleanup" }),
    issue({ body: `Autopilot work. ${SAFETY} productionMutationAllowed=true` }),
  ];
  assert.equal(deriveGithubIssueBacklogReadiness(unsafe, [], NOW).eligibleIssueCount, 0);
});
