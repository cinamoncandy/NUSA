import assert from "node:assert/strict";
import test from "node:test";
import { adaptRuntimeEvidenceToLifecycle } from "./evolveRuntimeEvidenceAdapter";

const SHA = "1234567890abcdef1234567890abcdef12345678";

function lifecycle() {
  return {
    execution: {
      executionId: "exec-1",
      dedupeKey: "dedupe-1",
      repository: "cinamoncandy/NUSA",
      headSha: SHA,
      authority: "ZERO_AUTHORITY" as const,
    },
    validation: {
      opportunityId: "gha:ci:failure",
      status: "PASS" as const,
      exactHeadSha: SHA,
      evidence: [{ check: "CI", reference: `workflow:1@${SHA}`, passed: true }],
      reason: "exact-head-validation-pass",
    },
    targetBranch: "main",
    observation: { revision: SHA, health: true, errors: 0, latencyMs: 20 },
    outcome: {
      expectedMetric: 1,
      actualMetric: 1,
      tolerance: 0,
      evidence: ["runtime:health"],
      observedAt: "2026-08-29T04:40:00.000Z",
    },
    changeReference: `commit:${SHA}`,
    rollbackReference: null,
    recovery: { failureClass: "KNOWN_TRANSIENT" as const, attempts: 0, rollbackEvidence: false },
    circuit: {
      state: { state: "CLOSED" as const, consecutiveFailures: 0 },
      policy: { maxFailures: 3, cooldownSeconds: 900 },
      now: "2026-08-29T04:40:00.000Z",
    },
    schedule: {
      policy: { mode: "AUTONOMOUS" as const, minIntervalSeconds: 900, maxConcurrent: 1 },
      activeExecutions: 0,
      elapsedSecondsSinceLastRun: 900,
      queuedOpportunities: 1,
      generatedAt: "2026-08-29T04:40:00.000Z",
    },
  };
}

test("accepts coherent observed lifecycle evidence without synthesizing fields", () => {
  const result = adaptRuntimeEvidenceToLifecycle({ lifecycle: lifecycle(), sources: ["github-actions:1", "worker:/health"] });
  assert.equal(result.status, "READY");
  if (result.status === "READY") assert.equal(result.lifecycle.execution.headSha, SHA);
});

test("fails closed when exact-head evidence disagrees", () => {
  const value = lifecycle();
  value.validation = { ...value.validation, exactHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  const result = adaptRuntimeEvidenceToLifecycle({ lifecycle: value, sources: ["github-actions:1"] });
  assert.deepEqual(result, {
    status: "ABSTAIN",
    reason: "runtime-exact-head-mismatch",
    sources: ["github-actions:1"],
  });
});

test("fails closed without outcome evidence", () => {
  const value = lifecycle();
  value.outcome = { ...value.outcome, evidence: [] };
  const result = adaptRuntimeEvidenceToLifecycle({ lifecycle: value, sources: ["github-actions:1"] });
  assert.equal(result.status, "ABSTAIN");
  if (result.status === "ABSTAIN") assert.equal(result.reason, "runtime-outcome-evidence-required");
});

test("fails closed without source provenance", () => {
  const result = adaptRuntimeEvidenceToLifecycle({ lifecycle: lifecycle(), sources: [] });
  assert.equal(result.status, "ABSTAIN");
  if (result.status === "ABSTAIN") assert.equal(result.reason, "runtime-evidence-sources-required");
});
