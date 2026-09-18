import test from "node:test";
import assert from "node:assert/strict";
import { deriveGithubIssueWorkSupply, unknownGithubIssueWorkSupply, withObservedReadyWork } from "./githubIssueWorkSupply";

test("observed GitHub backlog preserves a real zero only when GitHub reports zero", () => {
  const supply = deriveGithubIssueWorkSupply({ total_count: 0 });
  assert.equal(supply.status, "OBSERVED");
  assert.equal(supply.rawOpenIssueCount, 0);
  assert.equal(supply.readyWorkCount, null);
  assert.equal(supply.readyWorkStatus, "UNKNOWN");
  assert.equal(supply.readyWorkScope, "UNKNOWN");
});

test("observed nonzero backlog is not collapsed to zero or READY", () => {
  const supply = deriveGithubIssueWorkSupply({ total_count: 60 });
  assert.equal(supply.status, "OBSERVED");
  assert.equal(supply.rawOpenIssueCount, 60);
  assert.equal(supply.readyWorkCount, null);
  assert.equal(supply.readyWorkScope, "UNKNOWN");
});

test("READY count is explicitly bound to the current Autopilot coding executor", () => {
  const supply = withObservedReadyWork(deriveGithubIssueWorkSupply({ total_count: 60 }), 3);
  assert.equal(supply.readyWorkCount, 3);
  assert.equal(supply.readyWorkStatus, "OBSERVED");
  assert.equal(supply.readyWorkScope, "AUTOPILOT_CODING_RUNNER");
});

test("missing or malformed supply is UNKNOWN instead of fabricated zero", () => {
  assert.equal(deriveGithubIssueWorkSupply({}).status, "UNKNOWN");
  const unavailable = unknownGithubIssueWorkSupply("GITHUB_HTTP_503");
  assert.equal(unavailable.rawOpenIssueCount, null);
  assert.equal(unavailable.readyWorkCount, null);
  assert.equal(unavailable.reason, "GITHUB_HTTP_503");
});
