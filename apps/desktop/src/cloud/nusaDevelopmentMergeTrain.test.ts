import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNusaDevelopmentQueue, type NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";
import {
  assessNusaDevelopmentMainMovement,
  planNusaDevelopmentMergeTrain,
  type NusaExactHeadMergeEvidence,
  type NusaMainMovementEvidence,
} from "./nusaDevelopmentMergeTrain";

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
    auditedHeadSha: overrides.auditedHeadSha ?? overrides.headSha ?? `${workItemId}-head`,
    auditVerdict: overrides.auditVerdict ?? "PASS",
    auditMergeAllowed: overrides.auditMergeAllowed ?? true,
    auditObservedAt: overrides.auditObservedAt ?? 9,
    unresolvedReviewThreads: overrides.unresolvedReviewThreads ?? 0,
    observedAt: overrides.observedAt ?? 10,
  };
}

function movement(workItemId: string, overrides: Partial<NusaMainMovementEvidence> = {}): NusaMainMovementEvidence {
  return {
    workItemId,
    validatedBaseSha: overrides.validatedBaseSha ?? "base-a",
    currentBaseSha: overrides.currentBaseSha ?? "base-b",
    changedFilesSinceValidation: overrides.changedFilesSinceValidation === undefined
      ? ["apps/desktop/src/other.ts"]
      : overrides.changedFilesSinceValidation,
    mergedWorkItemIdsSinceValidation: overrides.mergedWorkItemIdsSinceValidation === undefined
      ? []
      : overrides.mergedWorkItemIdsSinceValidation,
    crossCuttingImpact: overrides.crossCuttingImpact ?? "NONE",
    observedAt: overrides.observedAt ?? 11,
  };
}

function unchanged(workItemId: string): NusaMainMovementEvidence {
  return movement(workItemId, {
    currentBaseSha: "base-a",
    changedFilesSinceValidation: null,
    mergedWorkItemIdsSinceValidation: null,
    crossCuttingImpact: "UNKNOWN",
  });
}

describe("planNusaDevelopmentMergeTrain", () => {
  it("orders merge-ready work by priority only after exact-head CI, safety, and Audit gates pass", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "p1", priority: "P1" }),
      work({ id: "p0", priority: "P0" }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("p1"), evidence("p0")], {
      mainMovementEvidence: [unchanged("p1"), unchanged("p0")],
    });
    assert.equal(plan.status, "READY");
    assert.deepEqual(plan.entries.map((entry) => entry.workItemId), ["p0", "p1"]);
  });

  it("fails closed on stale head, failed safety, or unresolved review threads", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "stale" }), work({ id: "unsafe" }), work({ id: "review" })]);
    const plan = planNusaDevelopmentMergeTrain(queue, [
      evidence("stale", { validatedHeadSha: "old-head" }),
      evidence("unsafe", { safetyChecksPassed: false }),
      evidence("review", { unresolvedReviewThreads: 1 }),
    ], {
      mainMovementEvidence: [unchanged("stale"), unchanged("unsafe"), unchanged("review")],
    });
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked.stale, ["EXACT_HEAD_MISMATCH"]);
    assert.deepEqual(plan.blocked.unsafe, ["SAFETY_CHECKS_NOT_PASSED"]);
    assert.deepEqual(plan.blocked.review, ["UNRESOLVED_REVIEW_THREADS"]);
    assert.equal(plan.entries.length, 0);
  });

  it("requires an Audit verdict bound to the current exact head", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "missing-audit" }),
      work({ id: "stale-audit" }),
      work({ id: "failed-audit" }),
      work({ id: "notes-not-mergeable" }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [
      evidence("missing-audit", { auditedHeadSha: "" }),
      evidence("stale-audit", { auditedHeadSha: "prior-head" }),
      evidence("failed-audit", { auditVerdict: "FAIL" }),
      evidence("notes-not-mergeable", { auditVerdict: "PASS_WITH_NOTES", auditMergeAllowed: false }),
    ], {
      mainMovementEvidence: [
        unchanged("missing-audit"),
        unchanged("stale-audit"),
        unchanged("failed-audit"),
        unchanged("notes-not-mergeable"),
      ],
    });
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked["missing-audit"], ["AUDIT_HEAD_SHA_MISSING"]);
    assert.deepEqual(plan.blocked["stale-audit"], ["AUDIT_HEAD_MISMATCH"]);
    assert.deepEqual(plan.blocked["failed-audit"], ["AUDIT_NOT_PASSED"]);
    assert.deepEqual(plan.blocked["notes-not-mergeable"], ["AUDIT_MERGE_NOT_ALLOWED"]);
    assert.equal(plan.entries.length, 0);
  });

  it("accepts PASS_WITH_NOTES only when Audit explicitly allows merge on the exact head", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "notes" })]);
    const plan = planNusaDevelopmentMergeTrain(queue, [
      evidence("notes", { auditVerdict: "PASS_WITH_NOTES", auditMergeAllowed: true }),
    ], {
      mainMovementEvidence: [unchanged("notes")],
    });
    assert.equal(plan.status, "READY");
    assert.deepEqual(plan.entries.map((entry) => entry.workItemId), ["notes"]);
  });

  it("fails closed on invalid Audit evidence timestamp", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "audit-time" })]);
    const plan = planNusaDevelopmentMergeTrain(queue, [
      evidence("audit-time", { auditObservedAt: -1 }),
    ], {
      mainMovementEvidence: [unchanged("audit-time")],
    });
    assert.deepEqual(plan.blocked["audit-time"], ["AUDIT_EVIDENCE_TIMESTAMP_INVALID"]);
  });

  it("never schedules a dependent item before its canonical dependency is merged", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "base", state: "CI" }),
      work({ id: "dependent", dependencies: ["base"] }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("dependent")], {
      mainMovementEvidence: [unchanged("dependent")],
    });
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked.dependent, ["DEPENDENCY_NOT_MERGED:base"]);
  });

  it("fails closed when the planning context is omitted", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "missing-context" })]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("missing-context")]);
    assert.equal(plan.status, "BLOCKED");
    assert.deepEqual(plan.blocked["missing-context"], ["MAIN_MOVEMENT_PROVENANCE_UNKNOWN"]);
    assert.equal(plan.entries.length, 0);
  });

  it("rejects duplicate evidence identities instead of choosing one", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "same" })]);
    assert.throws(() => planNusaDevelopmentMergeTrain(queue, [evidence("same"), evidence("same")]), /MERGE_EVIDENCE_DUPLICATE:same/);
  });

  it("keeps exact-head evidence when main movement is proven non-material", () => {
    const item = work({ id: "safe", touchedFiles: ["apps/desktop/src/cloud/nusaDevelopmentMergeTrain.ts"] });
    const queue = createNusaDevelopmentQueue([item]);
    const movementEvidence = movement("safe");
    assert.equal(assessNusaDevelopmentMainMovement(item, movementEvidence), "NON_MATERIAL");
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("safe")], { mainMovementEvidence: [movementEvidence] });
    assert.equal(plan.status, "READY");
    assert.deepEqual(plan.entries.map((entry) => entry.workItemId), ["safe"]);
  });

  it("requires revalidation when main movement overlaps touched files", () => {
    const path = "apps/desktop/src/cloud/nusaDevelopmentMergeTrain.ts";
    const item = work({ id: "overlap", touchedFiles: [path] });
    const queue = createNusaDevelopmentQueue([item]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("overlap")], {
      mainMovementEvidence: [movement("overlap", { changedFilesSinceValidation: [path] })],
    });
    assert.deepEqual(plan.blocked.overlap, ["MAIN_MOVEMENT_REVALIDATION_REQUIRED"]);
  });

  it("requires revalidation when a dependency merged after validation", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "base", state: "MERGED" }),
      work({ id: "dependent", dependencies: ["base"], touchedFiles: ["apps/desktop/src/cloud/nusaDevelopmentMergeTrain.ts"] }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("dependent")], {
      mainMovementEvidence: [movement("dependent", { mergedWorkItemIdsSinceValidation: ["base"] })],
    });
    assert.deepEqual(plan.blocked.dependent, ["MAIN_MOVEMENT_REVALIDATION_REQUIRED"]);
  });

  it("fails closed when main movement provenance or cross-cutting impact is unknown", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "unknown", touchedFiles: ["apps/desktop/src/cloud/nusaDevelopmentMergeTrain.ts"] }),
    ]);
    const missing = planNusaDevelopmentMergeTrain(queue, [evidence("unknown")], { mainMovementEvidence: [] });
    assert.deepEqual(missing.blocked.unknown, ["MAIN_MOVEMENT_PROVENANCE_UNKNOWN"]);
    const uncertain = planNusaDevelopmentMergeTrain(queue, [evidence("unknown")], {
      mainMovementEvidence: [movement("unknown", { crossCuttingImpact: "UNKNOWN" })],
    });
    assert.deepEqual(uncertain.blocked.unknown, ["MAIN_MOVEMENT_PROVENANCE_UNKNOWN"]);
  });

  it("treats explicit cross-cutting main movement as material", () => {
    const queue = createNusaDevelopmentQueue([
      work({ id: "global", touchedFiles: ["apps/desktop/src/cloud/nusaDevelopmentMergeTrain.ts"] }),
    ]);
    const plan = planNusaDevelopmentMergeTrain(queue, [evidence("global")], {
      mainMovementEvidence: [movement("global", { crossCuttingImpact: "MATERIAL", changedFilesSinceValidation: null })],
    });
    assert.deepEqual(plan.blocked.global, ["MAIN_MOVEMENT_REVALIDATION_REQUIRED"]);
  });

  it("accepts an unchanged validated base without requiring movement projections", () => {
    const item = work({ id: "unchanged" });
    const queue = createNusaDevelopmentQueue([item]);
    const unchangedEvidence = unchanged("unchanged");
    assert.equal(assessNusaDevelopmentMainMovement(item, unchangedEvidence), "UNCHANGED");
    assert.equal(planNusaDevelopmentMergeTrain(queue, [evidence("unchanged")], { mainMovementEvidence: [unchangedEvidence] }).status, "READY");
  });

  it("rejects duplicate main-movement evidence identities", () => {
    const queue = createNusaDevelopmentQueue([work({ id: "same", touchedFiles: ["apps/a.ts"] })]);
    assert.throws(
      () => planNusaDevelopmentMergeTrain(queue, [evidence("same")], {
        mainMovementEvidence: [movement("same"), movement("same")],
      }),
      /MAIN_MOVEMENT_EVIDENCE_DUPLICATE:same/,
    );
  });
});
