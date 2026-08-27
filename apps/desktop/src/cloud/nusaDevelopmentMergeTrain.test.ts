import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNusaDevelopmentQueue, type NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";
import { planNusaDevelopmentMergeTrain, type NusaExactHeadMergeEvidence } from "./nusaDevelopmentMergeTrain";

function work(overrides: Partial<NusaDevelopmentWorkItem> & Pick<NusaDevelopmentWorkItem, "id">): NusaDevelopmentWorkItem {
  return {
    id: overrides.id,
    state: overrides.state ?? "MERGE_READY",
    priority: overrides.priority ?? "P1",
    dependencies: overrides.dependencies ?? [],
    canonicalOwner: overrides.canonicalOwner ?? "development",
    touchedFiles: overrides.touchedFiles ?? [],
    evidenceRequirements: overrides.evidenceRequirements ?? ["exact-head-ci"],
    nextAction: overrides.nextAction ?? "merge",
    createdAt: overrides.createdAt ?? 1,
    claim: overrides.claim ?? null,
  };
}

function evidence(workItemId: string, overrides: Partial<NusaExactHeadMergeEvidence> = {}): NusaExactHeadMergeEvidence {
  return {
    workItemId,
    headSha: overrides.headSha ?? `${workItemId}-head`,
    validatedHeadSha: overrides.validatedHeadSha ?? overrides.headSha ?? `${workItemId}-head`,
    requiredChecksPassed: overrides.requiredChecksPassed ?? true,
    safetyChecksPassed: overrides.safetyChecksPassed ?? true,
    unresolvedReviewThreads: overrides.unresolvedReviewThreads ?? 0,
    observedAt: overrides.observedAt ?? 10,
  };
}

describe("planNusaDevelopmentMergeTrain", () => {
  it("orders merge-ready work by priority only after exact-head gates pass", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "p1", priority: "P1" }),
      work({ id: "p0", priority: "P0" }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("p1"), evidence("p0")]);
    assert.equal(plan.status, "READY");
    assert.deepEqual(plan.entries.map((entry) => entry.workItemId), ["p0", "p1"]);
  });

  it("fails closed on stale head, failed safety, or unresolved review threads", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "stale" }), work({ id: "unsafe" }), work({ id: "review" })]);
    const plan = planNusaDevelopmentMergeTrain(queue, [
      evidence("stale", { validatedHeadSha: "old-head" }),
      evidence("unsafe", { safetyChecksPassed: false }),
      evidence("review", { unresolvedReviewThreads: 1 }),
    ]);
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked.stale, ["EXACT_HEAD_MISMATCH"]);
    assert.deepEqual(plan.blocked.unsafe, ["SAFETY_CHECKS_NOT_PASSED"]);
    assert.deepEqual(plan.blocked.review, ["UNRESOLVED_REVIEW_THREADS"]);
    assert.equal(plan.entries.length, 0);
  });

  it("never schedules a dependent item before its canonical dependency is merged", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "base", state: "CI" }),
      work({ id: "dependent", dependencies: ["base"] }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("dependent")]);
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked.dependent, ["DEPENDENCY_NOT_MERGED:base"]);
  });

  it("rejects duplicate evidence identities instead of choosing one", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "same" })]);
    assert.throws(() => planNusaDevelopmentMergeTrain(queue, [evidence("same"), evidence("same")]), /MERGE_EVIDENCE_DUPLICATE:same/);
  });
});
