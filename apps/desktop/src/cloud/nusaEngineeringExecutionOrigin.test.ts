import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectNusaEngineeringExecutionOrigin,
  type NusaEngineeringExecutionEvidence,
} from "./nusaEngineeringExecutionOrigin";

const FP = "a".repeat(64);

function evidence(overrides: Partial<NusaEngineeringExecutionEvidence> = {}): NusaEngineeringExecutionEvidence {
  const base: NusaEngineeringExecutionEvidence = {
    schemaVersion: 1,
    executionId: "execution-1",
    event: "SCHEDULE",
    sourceRef: "github://actions/run/7",
    sourceFingerprint: FP,
    observedAt: 100,
    workflowRunId: 7,
    evidenceRefs: ["github://actions/run/7"],
  };
  return { ...base, ...overrides };
}

describe("projectNusaEngineeringExecutionOrigin", () => {
  it("derives AUTO_BACKGROUND from a scheduled GitHub run", () => {
    const result = projectNusaEngineeringExecutionOrigin(evidence());
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.origin, "AUTO_BACKGROUND");
    assert.equal(result.event, "SCHEDULE");
  });

  it("derives USER_TRIGGERED from an explicit owner request without exposing identity", () => {
    const result = projectNusaEngineeringExecutionOrigin(projectNusaEngineeringExecutionOriginInput("OWNER_REQUEST"));
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.origin, "USER_TRIGGERED");
    assert.equal("actorRef" in result, false);
  });

  it("does not infer an origin from push or pull-request execution", () => {
    for (const event of ["PUSH", "PULL_REQUEST"] as const) {
      const result = projectNusaEngineeringExecutionOrigin(evidence({ event, sourceRef: "evidence://execution/execution-1", workflowRunId: null, evidenceRefs: ["evidence://execution/execution-1"] }));
      assert.equal(result.status, "UNKNOWN");
      assert.equal(result.origin, null);
      assert.ok(result.reasons.includes("EXECUTION_EVENT_AMBIGUOUS"));
    }
  });

  it("rejects unbound or malformed receipts fail-closed", () => {
    const result = projectNusaEngineeringExecutionOrigin(evidence({ sourceRef: "github://actions/run/8" }));
    assert.equal(result.status, "UNKNOWN");
    assert.ok(result.reasons.includes("EXECUTION_SOURCE_REF_UNBOUND"));
    assert.ok(result.reasons.includes("EXECUTION_GITHUB_SOURCE_REF_INVALID"));
  });

  it("does not echo untrusted identifiers or references from an invalid receipt", () => {
    const result = projectNusaEngineeringExecutionOrigin(evidence({
      executionId: "authorization=secret-token",
      sourceRef: "https://example.invalid/secret-token",
      evidenceRefs: ["https://example.invalid/secret-token"],
    }));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.executionId, null);
    assert.equal(result.sourceRef, null);
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  });

  it("is deterministic and does not mutate the receipt", () => {
    const input = evidence({ evidenceRefs: ["github://actions/run/7", "evidence://receipt/7"] });
    const before = JSON.stringify(input);
    assert.deepEqual(projectNusaEngineeringExecutionOrigin(input), projectNusaEngineeringExecutionOrigin(input));
    assert.equal(JSON.stringify(input), before);
  });
});

function projectNusaEngineeringExecutionOriginInput(event: "OWNER_REQUEST"): NusaEngineeringExecutionEvidence {
  return evidence({
    event,
    sourceRef: "control://request/execution-1",
    workflowRunId: null,
    evidenceRefs: ["control://request/execution-1"],
  });
}
