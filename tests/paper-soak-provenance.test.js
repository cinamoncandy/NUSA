const assert = require("node:assert/strict");
const test = require("node:test");
const { buildGitHubProvenance, bindReceipt } = require("../scripts/bind-paper-soak-provenance.js");

const env = {
  GITHUB_REPOSITORY: "cinamoncandy/NUSA",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "123456",
  GITHUB_RUN_ATTEMPT: "2",
  GITHUB_WORKFLOW_REF: "cinamoncandy/NUSA/.github/workflows/paper-real-elapsed-soak.yml@refs/heads/main",
  GITHUB_EVENT_NAME: "schedule",
  GITHUB_SERVER_URL: "https://github.com",
};

test("binds exact GitHub Actions identity without self-promoting to VERIFIED", () => {
  const provenance = buildGitHubProvenance(env);
  assert.equal(provenance.verificationStatus, "BOUND_UNVERIFIED");
  assert.equal(provenance.sourceCommit, "a".repeat(40));
  assert.equal(provenance.runUrl, "https://github.com/cinamoncandy/NUSA/actions/runs/123456");
});

test("rejects malformed or untrusted run identity", () => {
  assert.throws(() => buildGitHubProvenance({ ...env, GITHUB_SHA: "fake" }), /40-hex/);
  assert.throws(() => buildGitHubProvenance({ ...env, GITHUB_SERVER_URL: "https://example.com" }), /untrusted/);
  assert.throws(() => buildGitHubProvenance({ ...env, GITHUB_RUN_ID: "0" }), /RUN_ID/);
});

test("binds only the canonical PAPER real elapsed receipt with safety invariants intact", () => {
  const base = { evidenceType: "PAPER_REAL_ELAPSED_SOAK", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" };
  const bound = bindReceipt(base, env);
  assert.equal(bound.sourceProvenance.repository, "cinamoncandy/NUSA");
  assert.throws(() => bindReceipt({ ...base, liveAuthority: "LIVE" }, env), /authority invariant/);
  assert.throws(() => bindReceipt({ ...base, evidenceType: "OTHER" }, env), /unexpected soak receipt/);
});
