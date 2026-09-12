import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateReleaseCompletion, type ReleaseCompletionEvidence, type TrustedReleaseAuthorityPolicy } from "./releaseCompletion";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MERGED = "c".repeat(40);
const POLICY: TrustedReleaseAuthorityPolicy = Object.freeze({ appId: "4242" });
const evaluate = (evidence: ReleaseCompletionEvidence) => evaluateReleaseCompletion(evidence, POLICY);

const complete = (): ReleaseCompletionEvidence => ({
  outerWorkflowConclusion: "success",
  applicable: true,
  auditAuthority: "DETERMINISTIC_AUDIT_PASS",
  releaseJobConclusion: "success",
  expectedHeadSha: HEAD,
  expectedBaseSha: BASE,
  authorization: { present: true, headSha: HEAD, appId: "4242" },
  merge: { succeeded: true, headSha: HEAD, baseSha: BASE, mergedSha: MERGED, parentsVerified: true },
  postMerge: { ciPassed: true, provenanceSha: MERGED, runtimeDeploymentProvenanceComplete: true },
});

describe("evaluateReleaseCompletion", () => {
  it("classifies the #720 shape as RELEASE_NOT_APPLICABLE despite outer SUCCESS", () => {
    assert.equal(evaluate({ ...complete(), applicable: false, auditAuthority: "NONE", releaseJobConclusion: "skipped" }), "RELEASE_NOT_APPLICABLE");
  });

  it("never treats outer SUCCESS plus failed or skipped Release as released", () => {
    assert.equal(evaluate({ ...complete(), releaseJobConclusion: "failure" }), "NOT_RELEASED");
    assert.equal(evaluate({ ...complete(), releaseJobConclusion: "skipped" }), "NOT_RELEASED");
  });

  it("does not release on Audit PASS alone", () => {
    assert.equal(evaluate({ ...complete(), releaseJobConclusion: "unknown" }), "NOT_RELEASED");
  });

  it("requires exact-head authorization bound to the expected App ID", () => {
    assert.equal(evaluate({ ...complete(), authorization: { present: false, headSha: null, appId: null } }), "RELEASE_PROVENANCE_MISSING");
    assert.equal(evaluate({ ...complete(), authorization: { present: true, headSha: HEAD, appId: "9999" } }), "RELEASE_PROVENANCE_MISSING");
  });

  it("does not release authorization without the canonical expected-head/base merge", () => {
    assert.equal(evaluate({ ...complete(), merge: { ...complete().merge, succeeded: false } }), "NOT_RELEASED");
    assert.equal(evaluate({ ...complete(), merge: { ...complete().merge, headSha: "d".repeat(40) } }), "NOT_RELEASED");
    assert.equal(evaluate({ ...complete(), merge: { ...complete().merge, baseSha: "e".repeat(40) } }), "NOT_RELEASED");
  });

  it("keeps canonical merge incomplete until exact merged-SHA CI and runtime/deployment provenance exist", () => {
    assert.equal(evaluate({ ...complete(), postMerge: { ...complete().postMerge, ciPassed: false } }), "CONVERGENCE_INCOMPLETE");
    assert.equal(evaluate({ ...complete(), postMerge: { ...complete().postMerge, runtimeDeploymentProvenanceComplete: false } }), "CONVERGENCE_INCOMPLETE");
    assert.equal(evaluate({ ...complete(), postMerge: { ...complete().postMerge, provenanceSha: "f".repeat(40) } }), "CONVERGENCE_INCOMPLETE");
  });


  it("classifies the #1895 noncanonical merge as not released even when downstream runtime later converges", () => {
    const recurrence: ReleaseCompletionEvidence = {
      ...complete(),
      outerWorkflowConclusion: "success",
      auditAuthority: "DETERMINISTIC_AUDIT_PASS",
      releaseJobConclusion: "failure",
      authorization: { present: false, headSha: null, appId: null },
      merge: { succeeded: true, headSha: HEAD, baseSha: BASE, mergedSha: MERGED, parentsVerified: true },
      postMerge: { ciPassed: true, provenanceSha: MERGED, runtimeDeploymentProvenanceComplete: true },
    };
    assert.equal(evaluate(recurrence), "NOT_RELEASED");
  });

  it("does not trust an App ID supplied only by evidence", () => {
    assert.equal(evaluateReleaseCompletion(complete(), { appId: "9999" }), "RELEASE_PROVENANCE_MISSING");
    assert.equal(evaluateReleaseCompletion(complete(), { appId: "caller-controlled" }), "RELEASE_PROVENANCE_MISSING");
  });

  it("emits RELEASE_COMPLETE only for the full positive chain", () => {
    assert.equal(evaluate(complete()), "RELEASE_COMPLETE");
  });
});
