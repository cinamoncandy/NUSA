import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectOwnerException, projectOwnerExceptions } from "./nusaOwnerExceptionProjection";

describe("owner exception projection", () => {
  it("surfaces human-only blockers with origin and evidence", () => {
    const result = projectOwnerException({
      workId: "runner-setup",
      origin: "AUTO_BACKGROUND",
      kind: "HUMAN_ONLY_BLOCKER",
      summary: "External coding runner credentials are not configured",
      evidenceRefs: ["run:42", "run:42", "pr:930"],
    });
    assert.equal(result.visibleToOwner, true);
    assert.equal(result.priority, "EXCEPTION");
    assert.equal(result.origin, "AUTO_BACKGROUND");
    assert.deepEqual(result.evidenceRefs, ["pr:930", "run:42"]);
  });

  it("suppresses routine autonomous progress", () => {
    const result = projectOwnerException({
      workId: "queue-advance",
      origin: "AUTO_BACKGROUND",
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
      origin: "USER_TRIGGERED",
      kind: "MEANINGFUL_OUTCOME",
      summary: "Exact-head verification completed",
      evidenceRefs: ["sha:abc"],
    });
    assert.equal(result.origin, "USER_TRIGGERED");
    assert.equal(result.priority, "OUTCOME");
  });

  it("fails closed when a surfaced claim lacks evidence", () => {
    assert.throws(
      () => projectOwnerException({
        workId: "unsafe-claim",
        origin: "AUTO_BACKGROUND",
        kind: "MEANINGFUL_OUTCOME",
        summary: "Speed improved",
        evidenceRefs: [],
      }),
      /OWNER_EXCEPTION_MISSING_EVIDENCE/,
    );
  });

  it("orders exceptions before outcomes and suppressed progress deterministically", () => {
    const results = projectOwnerExceptions([
      { workId: "z", origin: "AUTO_BACKGROUND", kind: "ROUTINE_AUTONOMOUS_PROGRESS", summary: "routine", evidenceRefs: [] },
      { workId: "b", origin: "USER_TRIGGERED", kind: "MEANINGFUL_OUTCOME", summary: "outcome", evidenceRefs: ["run:2"] },
      { workId: "a", origin: "AUTO_BACKGROUND", kind: "STRATEGIC_PRODUCT_CHOICE", summary: "choice", evidenceRefs: ["issue:1"] },
    ]);
    assert.deepEqual(results.map((result) => result.workId), ["a", "b", "z"]);
  });
});
