import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCodingRunnerRequest, validateCodingExecutionEnvelope } from "./codingExecutionEnvelope";

const envelope = {
  cycleId: "cycle-905-1",
  workItemId: "issue-905-slice-a",
  executionId: "exec-905-a-1",
  dedupeKey: "nusa:905:slice-a:c17069d",
  origin: "AUTO_BACKGROUND" as const,
  repository: "cinamoncandy/NUSA",
  baseSha: "a".repeat(40),
  workflowRunId: 123,
  objective: "Add a bounded coding dispatch contract",
  acceptanceCriteria: ["reject unsafe authority", "preserve execution provenance"],
  evidenceRefs: ["issue:#905", "main:a"],
  allowedScope: ["apps/autopilot/src"],
  forbiddenScope: ["live-trading", "broker-mutation"],
  maxChangedFiles: 4,
  mutationAllowed: false as const,
  liveAuthority: "NONE" as const,
  productionMutationAllowed: false as const,
  aiAuthority: "ZERO_AUTHORITY" as const,
};

describe("coding execution envelope", () => {
  it("accepts a bounded evidence-backed execution contract", () => {
    assert.deepEqual(validateCodingExecutionEnvelope(envelope), envelope);
  });

  it("rejects missing evidence instead of inventing confidence", () => {
    assert.throws(() => validateCodingExecutionEnvelope({ ...envelope, evidenceRefs: [] }), /CODING_EXECUTION_EVIDENCE_REQUIRED/);
  });

  it("rejects unbounded file-change budgets", () => {
    assert.throws(() => validateCodingExecutionEnvelope({ ...envelope, maxChangedFiles: 0 }), /CODING_EXECUTION_CHANGE_BUDGET_INVALID/);
  });

  it("rejects unknown execution origins", () => {
    assert.throws(() => validateCodingExecutionEnvelope({ ...envelope, origin: "BACKGROUND" }), /CODING_EXECUTION_ORIGIN_INVALID/);
  });

  it("rejects production and AI authority escalation", () => {
    assert.throws(() => validateCodingExecutionEnvelope({ ...envelope, productionMutationAllowed: true }), /CODING_EXECUTION_PRODUCTION_MUTATION_FORBIDDEN/);
    assert.throws(() => validateCodingExecutionEnvelope({ ...envelope, aiAuthority: "WRITE" }), /CODING_EXECUTION_AI_AUTHORITY_INVALID/);
  });

  it("projects lifecycle identity onto the existing coding runner without creating a second executor", () => {
    assert.deepEqual(toCodingRunnerRequest(envelope), {
      kind: "REPOSITORY_AUTOPILOT",
      repository: envelope.repository,
      headSha: envelope.baseSha,
      workflowRunId: envelope.workflowRunId,
      reason: `work:${envelope.workItemId};execution:${envelope.executionId};origin:${envelope.origin};dedupe:${envelope.dedupeKey}`,
      executionId: envelope.executionId,
      dedupeKey: envelope.dedupeKey,
      mutationAllowed: false,
      liveAuthority: "NONE",
      productionMutationAllowed: false,
      aiAuthority: "ZERO_AUTHORITY",
    });
  });
});
