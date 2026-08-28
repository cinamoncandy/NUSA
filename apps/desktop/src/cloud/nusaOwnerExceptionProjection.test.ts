import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NusaEngineeringExecutionEvidence } from "./nusaEngineeringExecutionOrigin";
import { projectOwnerException, projectOwnerExceptions } from "./nusaOwnerExceptionProjection";

const originEvidence = (event: "SCHEDULE" | "OWNER_REQUEST" = "SCHEDULE"): NusaEngineeringExecutionEvidence => event === "SCHEDULE"
  ? {
      schemaVersion: 1,
      executionId: "execution-1",
      event,
      sourceRef: "github://actions/run/7",
      sourceFingerprint: "a".repeat(64),
      observedAt: 100,
      workflowRunId: 7,
      evidenceRefs: ["github://actions/run/7"],
    }
  : {
      schemaVersion: 1,
      executionId: "execution-1",
      event,
      sourceRef: "control://request/execution-1",
      sourceFingerprint: "a".repeat(64),
      observedAt: 100,
      workflowRunId: null,
      evidenceRefs: ["control://request/execution-1"],
    };

describe("owner exception projection", () => {
  it("surfaces human-only blockers with origin and evidence", () => {
    const result = projectOwnerException({
      workId: "runner-setup",
      originEvidence: originEvidence(),
      kind: "HUMAN_ONLY_BLOCKER",
      summary: "External coding runner credentials are not configured",
      evidenceRefs: ["run:42", "run:42", "pr:930"],
    });
    assert.equal(result.visibleToOwner, true);
    assert.equal(result.priority, "EXCEPTION");
    assert.equal(result.origin, "AUTO_BACKGROUND");
    assert.equal(result.originStatus, "VERIFIED");
    assert.deepEqual(result.evidenceRefs, ["pr:930", "run:42"]);
  });

  it("suppresses routine autonomous progress", () => {
    const result = projectOwnerException({
      workId: "queue-advance",
      originEvidence: originEvidence(),
      kind: "ROUTINE_AUTONOMOUS_PROGRESS",
      summary: "Advanced one ready queue item",
      evidenceRefs: [],
    });
    assert.equal(result.visibleToOwner, false);
    assert.equal(result.priority, "SUPPRESSED");
  });

  it("keeps user-triggered provenance explicit", () => {
    const result = projectOwnerException({
      workId: "manual-check",
      originEvidence: originEvidence("OWNER_REQUEST"),
      kind: "MEANINGFUL_OUTCOME",
      summary: "Exact-head verification completed",
      evidenceRefs: ["sha:abc"],
    });
    assert.equal(result.origin, "USER_TRIGGERED");
    assert.equal(result.originStatus, "VERIFIED");
    assert.equal(result.priority, "OUTCOME");
  });

  it("fails closed when a surfaced claim lacks evidence", () => {
    assert.throws(
      () => projectOwnerException({
        workId: "unsafe-claim",
        originEvidence: originEvidence(),
        kind: "MEANINGFUL_OUTCOME",
        summary: "Speed improved",
        evidenceRefs: [],
      }),
      /OWNER_EXCEPTION_MISSING_EVIDENCE/,
    );
  });

  it("orders exceptions before outcomes and suppressed progress deterministically", () => {
    const results = projectOwnerExceptions([
      { workId: "z", originEvidence: originEvidence(), kind: "ROUTINE_AUTONOMOUS_PROGRESS", summary: "routine", evidenceRefs: [] },
      { workId: "b", originEvidence: originEvidence("OWNER_REQUEST"), kind: "MEANINGFUL_OUTCOME", summary: "outcome", evidenceRefs: ["run:2"] },
      { workId: "a", originEvidence: originEvidence(), kind: "STRATEGIC_PRODUCT_CHOICE", summary: "choice", evidenceRefs: ["issue:1"] },
    ]);
    assert.deepEqual(results.map((result) => result.workId), ["a", "b", "z"]);
  });

  it("keeps an owner-visible exception truthful when origin evidence is unavailable", () => {
    const result = projectOwnerException({
      workId: "unknown-origin",
      originEvidence: null,
      kind: "HUMAN_ONLY_BLOCKER",
      summary: "Human action is required",
      evidenceRefs: ["issue:905"],
    });
    assert.equal(result.visibleToOwner, true);
    assert.equal(result.origin, null);
    assert.equal(result.originStatus, "UNKNOWN");
    assert.ok(result.reasons.includes("EXECUTION_ORIGIN_UNKNOWN"));
  });

  it("does not trust an ambiguous execution receipt for owner origin", () => {
    const result = projectOwnerException({
      workId: "ambiguous-origin",
      originEvidence: {
        schemaVersion: 1,
        executionId: "execution-1",
        event: "PUSH",
        sourceRef: "control://request/execution-1",
        sourceFingerprint: "a".repeat(64),
        observedAt: 100,
        workflowRunId: null,
        evidenceRefs: ["control://request/execution-1"],
      },
      kind: "MEANINGFUL_OUTCOME",
      summary: "Measured outcome",
      evidenceRefs: ["issue:905"],
    });
    assert.equal(result.origin, null);
    assert.equal(result.originStatus, "UNKNOWN");
    assert.ok(result.reasons.includes("EXECUTION_ORIGIN_UNKNOWN"));
  });
});
