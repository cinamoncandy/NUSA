import { describe, expect, it } from "vitest";
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
    expect(evaluateReleaseCompletion({ ...complete(), applicable: false, auditAuthority: "NONE", releaseJobConclusion: "skipped" })).toBe("RELEASE_NOT_APPLICABLE");
  });

  it("never treats outer SUCCESS plus failed or skipped Release as released", () => {
    expect(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "failure" })).toBe("NOT_RELEASED");
    expect(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "skipped" })).toBe("RELEASE_NOT_APPLICABLE");
  });

  it("does not release on Audit PASS alone", () => {
    expect(evaluateReleaseCompletion({ ...complete(), releaseJobConclusion: "unknown" })).toBe("NOT_RELEASED");
  });

  it("requires exact-head authorization bound to the expected App ID", () => {
    expect(evaluateReleaseCompletion({ ...complete(), authorization: { present: false, headSha: null, appId: null, expectedAppId: "4242" } })).toBe("RELEASE_PROVENANCE_MISSING");
    expect(evaluateReleaseCompletion({ ...complete(), authorization: { present: true, headSha: HEAD, appId: "9999", expectedAppId: "4242" } })).toBe("RELEASE_PROVENANCE_MISSING");
  });

  it("does not release authorization without the canonical expected-head/base merge", () => {
    expect(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, succeeded: false } })).toBe("NOT_RELEASED");
    expect(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, headSha: "d".repeat(40) } })).toBe("NOT_RELEASED");
    expect(evaluateReleaseCompletion({ ...complete(), merge: { ...complete().merge, baseSha: "e".repeat(40) } })).toBe("NOT_RELEASED");
  });

  it("keeps canonical merge incomplete until exact merged-SHA CI and runtime/deployment provenance exist", () => {
    expect(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, ciPassed: false } })).toBe("CONVERGENCE_INCOMPLETE");
    expect(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, runtimeDeploymentProvenanceComplete: false } })).toBe("CONVERGENCE_INCOMPLETE");
    expect(evaluateReleaseCompletion({ ...complete(), postMerge: { ...complete().postMerge, provenanceSha: "f".repeat(40) } })).toBe("CONVERGENCE_INCOMPLETE");
  });

  it("emits RELEASE_COMPLETE only for the full positive chain", () => {
    expect(evaluateReleaseCompletion(complete())).toBe("RELEASE_COMPLETE");
  });
});
