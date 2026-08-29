import assert from "node:assert/strict";
import test from "node:test";
import { deriveWorkflowFailureOpportunities } from "./evolveEvidenceOpportunitySource";

const SHA = "3c62ade1c62444b7bdfd08bbade9c483be97d38f";
const base = () => ({
  observedAt: "2026-08-29T04:00:00.000Z",
  maxAgeSeconds: 3600,
  observations: [{
    workflowName: "CI",
    runId: 33231981419,
    headSha: SHA,
    conclusion: "failure" as const,
    completedAt: "2026-08-29T03:45:00.000Z",
  }],
});

test("derives a bounded evidence-backed opportunity without authority", () => {
  const result = deriveWorkflowFailureOpportunities(base());
  assert.equal(result.length, 1);
  assert.equal(result[0]?.source, "github-actions");
  assert.equal(result[0]?.status, "DISCOVERED");
  assert.equal(result[0]?.confidence, 1);
  assert.equal(result[0]?.evidence[0]?.quality, 1);
  assert.match(result[0]?.id ?? "", /^gha:ci:/);
});

test("drops stale evidence instead of inventing work", () => {
  const input = base();
  const result = deriveWorkflowFailureOpportunities({ ...input, maxAgeSeconds: 60 });
  assert.deepEqual(result, []);
});

test("drops future-dated evidence fail closed", () => {
  const input = base();
  const result = deriveWorkflowFailureOpportunities({
    ...input,
    observations: [{ ...input.observations[0], completedAt: "2026-08-29T04:00:01.000Z" }],
  });
  assert.deepEqual(result, []);
});

test("deduplicates identical workflow failure fingerprints", () => {
  const input = base();
  const result = deriveWorkflowFailureOpportunities({
    ...input,
    observations: [input.observations[0], { ...input.observations[0], runId: 33231981420 }],
  });
  assert.equal(result.length, 1);
});

test("rejects malformed evidence", () => {
  const input = base();
  assert.throws(() => deriveWorkflowFailureOpportunities({
    ...input,
    observations: [{ ...input.observations[0], headSha: "bad" }],
  }), /EVOLVE_WORKFLOW_EVIDENCE_SHA_INVALID/);
});

test("rejects unsupported workflow conclusions", () => {
  const input = base();
  assert.throws(() => deriveWorkflowFailureOpportunities({
    ...input,
    observations: [{ ...input.observations[0], conclusion: "success" as never }],
  }), /EVOLVE_WORKFLOW_EVIDENCE_CONCLUSION_INVALID/);
});
