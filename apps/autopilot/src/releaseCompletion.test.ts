import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReleaseCompletion, type ReleaseCompletionEvidence } from "./releaseCompletion";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGED = "c".repeat(40);

const complete = (): ReleaseCompletionEvidence => ({
  outerWorkflowConclusion: "success",
  applicable: true,
  auditAuthority: "DETERMINISTIC_AUDIT_PASS",
  releaseJobConclusion: "success",
  expectedHeadSha: HEAD,
  expectedBaseSha: BASE,
  authorization: { present: true, headSha: HEAD, appId: "4242", expectedAppId: "4242" },
  merge: { succeeded: true, headSha: HEAD, baseSha: BASE, mergedSha: MERGED, parentsVerified: true },
  postMerge: { ciPassed: true, provenanceSha: MERGED, runtimeDeploymentProvenanceComplete: true },
});

describe("evaluateReleaseCompletion", () => {
  it("classifies the #720 shape as RELEASE_NOT_APPLICABLE despite outer SUCCESS", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), applicable: false, auditAuthority: "NONE", releaseJobConclusion: "skipped" }), "RELEASE_NOT_APPLICABLE");
  });

  it("never treats outer SUCCESS plus failed or skipped Release as released", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "failure" }), "NOT_RELEASED");
    assert.equal(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "skipped" }), "NOT_RELEASED");
  });

  it("does not release on Audit PASS alone", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "unknown" }), "NOT_RELEASED");
  });

  it("requires exact-head authorization bound to the expected App ID", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), authorization: { present: false, headSha: null, appId: null, expectedAppId: "4242" } }), "RELEASE_PROVENANCE_MISSING");
    assert.equal(evaluateReleaseCompletion({ ...complete(), authorization: { present: true, headSha: HEAD, appId: "9999", expectedAppId: "4242" } }), "RELEASE_PROVENANCE_MISSING");
  });

  it("does not release authorization without the canonical expected-head/base merge", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, succeeded: false } }), "NOT_RELEASED");
    assert.equal(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, headSha: "d".repeat(40) } }), "NOT_RELEASED");
    assert.equal(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, baseSha: "e".repeat(40) } }), "NOT_RELEASED");
  });

  it("keeps canonical merge incomplete until exact merged-SHA CI and runtime/deployment provenance exist", () => {
    assert.equal(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, ciPassed: false } }), "CONVERGENCE_INCOMPLETE");
    assert.equal(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, runtimeDeploymentProvenanceComplete: false } }), "CONVERGENCE_INCOMPLETE");
    assert.equal(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, provenanceSha: "f".repeat(40) } }), "CONVERGENCE_INCOMPLETE");
  });

  it("emits RELEASE_COMPLETE only for the full positive chain", () => {
    assert.equal(evaluateReleaseCompletion(complete()), "RELEASE_COMPLETE");
  });
});
