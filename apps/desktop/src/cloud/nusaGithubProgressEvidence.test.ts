import assert from "node:assert/strict";
import { test } from "node:test";
import { collectGithubProgressEvidence, NusaGithubProgressEvidenceError, type GithubCommitEvidenceReceipt, type GithubWorkflowEvidenceReceipt } from "./nusaGithubProgressEvidence";
import { computeNusaProgressScorecard } from "./nusaProgressScorecard";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const FP1 = "1".repeat(64);
const FP2 = "2".repeat(64);
const FP3 = "3".repeat(64);
const T0 = 1_800_000_000_000;

const commit = (overrides: Partial<GithubCommitEvidenceReceipt> = {}): GithubCommitEvidenceReceipt => ({
  sha: SHA,
  observedAt: T0,
  sourceFingerprint: FP1,
  ...overrides,
});

const workflow = (name: string, runId: number, overrides: Partial<GithubWorkflowEvidenceReceipt> = {}): GithubWorkflowEvidenceReceipt => ({
  runId,
  name,
  headSha: SHA,
  status: "completed",
  conclusion: "success",
  observedAt: T0 + 1,
  sourceFingerprint: runId % 2 === 0 ? FP2 : FP3,
  ...overrides,
});

test("collects exact-head repository and required CI evidence the scorecard accepts", () => {
  const evidence = collectGithubProgressEvidence(commit(), [workflow("CI", 1001), workflow("Actual PAPER Public-Market Runtime Evidence", 1002)], ["CI", "Actual PAPER Public-Market Runtime Evidence"]);
  assert.equal(evidence.repositoryEvidence.status, "PASS");
  assert.deepEqual(evidence.ciEvidence.map((item) => item.status), ["PASS", "PASS"]);

  const scorecard = computeNusaProgressScorecard([{
    id: "github-main",
    domain: "INFRASTRUCTURE_MODULE_HEALTH",
    weight: 1,
    requiredAcceptance: "CODE_COMPLETE",
    evidence: [evidence.repositoryEvidence, ...evidence.ciEvidence],
  }], { asOf: T0 + 2, maximumEvidenceAgeMs: 10_000 });
  assert.equal(scorecard.items[0]?.status, "PASS");
});

test("in-progress workflow remains UNKNOWN and cannot masquerade as completed CI", () => {
  const evidence = collectGithubProgressEvidence(commit(), [workflow("CI", 1001, { status: "in_progress", conclusion: null })], ["CI"]);
  assert.equal(evidence.ciEvidence[0]?.status, "UNKNOWN");
  const scorecard = computeNusaProgressScorecard([{
    id: "github-main",
    domain: "INFRASTRUCTURE_MODULE_HEALTH",
    weight: 1,
    requiredAcceptance: "CODE_COMPLETE",
    evidence: [evidence.repositoryEvidence, ...evidence.ciEvidence],
  }], { asOf: T0 + 2, maximumEvidenceAgeMs: 10_000 });
  assert.equal(scorecard.items[0]?.status, "UNKNOWN");
});

test("completed non-success conclusion is FAIL", () => {
  const evidence = collectGithubProgressEvidence(commit(), [workflow("CI", 1001, { conclusion: "failure" })], ["CI"]);
  assert.equal(evidence.ciEvidence[0]?.status, "FAIL");
});

test("missing required workflow fails closed instead of shrinking the required set", () => {
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("CI", 1001)], ["CI", "Read-only Broker Credential Integration"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "MISSING_REQUIRED_WORKFLOW",
  );
});

test("workflow receipt for another head cannot be reused", () => {
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("CI", 1001, { headSha: OTHER_SHA })], ["CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "WORKFLOW_HEAD_MISMATCH",
  );
});

test("duplicate workflow names and duplicate required names fail closed", () => {
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("CI", 1001), workflow("CI", 1002)], ["CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "DUPLICATE_WORKFLOW_RECEIPT",
  );
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("CI", 1001)], ["CI", "CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "DUPLICATE_REQUIRED_WORKFLOW",
  );
});

test("collector rejects fabricated fingerprints and impossible chronology", () => {
  assert.throws(
    () => collectGithubProgressEvidence(commit({ sourceFingerprint: "not-a-digest" }), [workflow("CI", 1001)], ["CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "INVALID_SOURCE_FINGERPRINT",
  );
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("CI", 1001, { observedAt: T0 - 1 })], ["CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "WORKFLOW_PREDATES_COMMIT",
  );
});

test("unrelated successful workflow cannot satisfy an explicitly required workflow", () => {
  assert.throws(
    () => collectGithubProgressEvidence(commit(), [workflow("Some Other Workflow", 1001)], ["CI"]),
    (error) => error instanceof NusaGithubProgressEvidenceError && error.code === "MISSING_REQUIRED_WORKFLOW",
  );
});
