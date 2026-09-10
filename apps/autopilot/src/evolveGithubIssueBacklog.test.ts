import test from "node:test";
import assert from "node:assert/strict";
import { deriveGithubIssueBacklogSignals } from "./evolveGithubIssueBacklog";

const NOW = new Date("2026-09-10T03:00:00.000Z");
const SAFETY = "Safety invariants: liveAuthority=NONE, productionMutationAllowed=false, aiAuthority=ZERO_AUTHORITY. No LIVE activation or real broker mutation.";

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 903,
    title: "P1: Autonomous Development Control Plane for maximum verified merge throughput",
    body: `Implement bounded Autopilot control-plane work. ${SAFETY}`,
    state: "open",
    author_association: "OWNER",
    updated_at: "2026-09-10T02:50:00.000Z",
    ...overrides,
  };
}

test("GitHub issue backlog surfaces one owner-authored safety-bounded P0/P1 Autopilot issue", () => {
  const signals = deriveGithubIssueBacklogSignals([issue()], NOW);
  assert.equal(signals.length, 1);
  assert.equal(signals[0]?.id, "github-issue-903");
  assert.equal(signals[0]?.source, "github-issue-backlog");
  assert.equal(signals[0]?.reference, "github://issue/903");
  assert.match(signals[0]?.problem ?? "", /apps\/autopilot\/src/);
});

test("GitHub issue backlog prefers P0 and remains bounded to one signal", () => {
  const signals = deriveGithubIssueBacklogSignals([
    issue({ number: 903 }),
    issue({ number: 1001, title: "P0: AUTOPILOT exact-head recovery", updated_at: "2026-09-10T02:40:00.000Z" }),
  ], NOW);
  assert.deepEqual(signals.map((signal) => signal.id), ["github-issue-1001"]);
});

test("GitHub issue backlog fails closed for PRs, untrusted authors, missing safety contract, and non-Autopilot work", () => {
  const unsafe = [
    issue({ pull_request: { url: "https://api.github.com/pulls/1" } }),
    issue({ author_association: "NONE" }),
    issue({ body: "Autopilot work without authority invariants." }),
    issue({ title: "P1: unrelated cloud deployment", body: SAFETY }),
    issue({ state: "closed" }),
    issue({ title: "P2: AUTOPILOT cleanup" }),
    issue({ body: `Autopilot work. ${SAFETY} productionMutationAllowed=true` }),
  ];
  assert.deepEqual(deriveGithubIssueBacklogSignals(unsafe, NOW), []);
});
