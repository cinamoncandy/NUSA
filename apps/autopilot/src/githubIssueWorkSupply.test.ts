import test from "node:test";
import assert from "node:assert/strict";
import { deriveGithubIssueWorkSupply, unknownGithubIssueWorkSupply } from "./githubIssueWorkSupply";

test("observed GitHub backlog preserves a real zero only when GitHub reports zero", () => {
  const supply = deriveGithubIssueWorkSupply({ total_count: 0 });
  assert.equal(supply.status, "OBSERVED");
  assert.equal(supply.rawOpenIssueCount, 0);
  assert.equal(supply.readyWorkCount, null);
  assert.equal(supply.readyWorkStatus, "UNKNOWN");
});

test("observed nonzero backlog is not collapsed to zero or READY", () => {
  const supply = deriveGithubIssueWorkSupply({ total_count: 60 });
  assert.equal(supply.status, "OBSERVED");
  assert.equal(supply.rawOpenIssueCount, 60);
  assert.equal(supply.readyWorkCount, null);
  assert.equal(supply.reason, "github-open-issue-backlog-observed-readiness-not-proven");
});

test("missing or malformed supply is UNKNOWN instead of fabricated zero", () => {
  assert.deepEqual(deriveGithubIssueWorkSupply({}), {
    status: "UNKNOWN",
    rawOpenIssueCount: null,
    readyWorkCount: null,
    readyWorkStatus: "UNKNOWN",
    reason: "github-open-issue-count-invalid",
  });
  const unavailable = unknownGithubIssueWorkSupply("GITHUB_HTTP_503");
  assert.equal(unavailable.status, "UNKNOWN");
  assert.equal(unavailable.rawOpenIssueCount, null);
  assert.equal(unavailable.reason, "GITHUB_HTTP_503");
});
