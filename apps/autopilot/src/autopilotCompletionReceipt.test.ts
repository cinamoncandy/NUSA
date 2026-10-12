import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAutopilotCompletion, type AutopilotCompletionEvidence } from "./autopilotCompletionReceipt";

const HEAD = "a".repeat(40);
const MERGED = "c".repeat(40);
const POLICY = Object.freeze({ releaseAppId: "4242" });

const complete = (): AutopilotCompletionEvidence => ({
  task: { executionId: "exec-1", dedupeKey: "dedupe-1" },
  remediation: { outcome: "CHANGE_PRODUCED", attempts: 1, maxAttempts: 3 },
  change: { headSha: HEAD, changedFiles: ["apps/autopilot/src/x.ts"], pullRequestNumber: 7 },
  ci: { conclusion: "success", headSha: HEAD },
  audit: { independentApproval: true, auditedHeadSha: HEAD, approvedByAppId: "4242" },
  release: { status: "RELEASE_COMPLETE", mergedSha: MERGED },
  runtime: { required: true, deployedRevisionIsDescendantOfMerged: true, healthOk: true },
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  aiAuthority: "ZERO_AUTHORITY",
});

const classify = (evidence: AutopilotCompletionEvidence) => classifyAutopilotCompletion(evidence, POLICY);

describe("classifyAutopilotCompletion", () => {
  it("verifies a complete chain and derives a stable receipt id", () => {
    const first = classify(complete());
    assert.equal(first.classification, "VERIFIED_USEFUL_COMPLETION");
    assert.deepEqual(first.missing, []);
    assert.match(first.receiptId ?? "", /^[0-9a-f]{64}$/);
    assert.equal(classify(complete()).receiptId, first.receiptId);
    assert.notEqual(classify({ ...complete(), task: { executionId: "exec-1", dedupeKey: "dedupe-2" } }).receiptId, first.receiptId);
  });

  it("never counts a no-action outcome as productive, whatever else is present", () => {
    for (const outcome of ["VALID_NO_ACTION", "FAILED_TO_REMEDIATE"] as const) {
      const r = classify({ ...complete(), remediation: { outcome, attempts: 3, maxAttempts: 3 } });
      assert.equal(r.classification, outcome);
      assert.equal(r.receiptId, null);
    }
    assert.equal(classify({ ...complete(), remediation: { outcome: "FAILED_CLOSED", attempts: 0, maxAttempts: 3 } }).classification, "BLOCKED");
  });

  it("blocks on any authority invariant that is not fail-closed", () => {
    assert.equal(classify({ ...complete(), liveAuthority: "LIVE" }).classification, "BLOCKED");
    assert.equal(classify({ ...complete(), productionMutationAllowed: true as unknown as false }).classification, "BLOCKED");
    assert.equal(classify({ ...complete(), aiAuthority: "FULL" }).classification, "BLOCKED");
  });

  it("names each missing piece and does not infer it", () => {
    const cases: ReadonlyArray<readonly [string, Partial<AutopilotCompletionEvidence>]> = [
      ["ci.success", { ci: { conclusion: "failure", headSha: HEAD } }],
      ["ci.headShaMatch", { ci: { conclusion: "success", headSha: "d".repeat(40) } }],
      ["audit.independentApproval", { audit: { independentApproval: false, auditedHeadSha: HEAD, approvedByAppId: "4242" } }],
      ["audit.headShaMatch", { audit: { independentApproval: true, auditedHeadSha: "d".repeat(40), approvedByAppId: "4242" } }],
      ["audit.trustedApp", { audit: { independentApproval: true, auditedHeadSha: HEAD, approvedByAppId: "9999" } }],
      ["release.complete", { release: { status: "CONVERGENCE_INCOMPLETE", mergedSha: MERGED } }],
      ["release.mergedSha", { release: { status: "RELEASE_COMPLETE", mergedSha: null } }],
      ["change.changedFiles", { change: { headSha: HEAD, changedFiles: [], pullRequestNumber: 7 } }],
      ["change.pullRequestNumber", { change: { headSha: HEAD, changedFiles: ["a.ts"], pullRequestNumber: null } }],
      ["runtime.verified", { runtime: { required: true, deployedRevisionIsDescendantOfMerged: true, healthOk: false } }],
    ];
    for (const [name, patch] of cases) {
      const r = classify({ ...complete(), ...patch });
      assert.equal(r.classification, "INCOMPLETE", name);
      assert.ok(r.missing.includes(name), `${name} in ${r.missing.join(",")}`);
      assert.equal(r.receiptId, null);
    }
  });

  it("does not demand a deployment check when the change does not affect Worker runtime", () => {
    const r = classify({ ...complete(), runtime: { required: false, deployedRevisionIsDescendantOfMerged: null, healthOk: null } });
    assert.equal(r.classification, "VERIFIED_USEFUL_COMPLETION");
  });

  it("rejects an invalid trusted app policy instead of trusting caller evidence", () => {
    assert.throws(() => classifyAutopilotCompletion(complete(), { releaseAppId: "" }), /AUTOPILOT_COMPLETION_POLICY_APP_ID_INVALID/);
  });

  it("treats a rejected approval from the wrong app as unverified even with a matching head", () => {
    const r = classify({ ...complete(), audit: { independentApproval: true, auditedHeadSha: HEAD, approvedByAppId: null } });
    assert.equal(r.classification, "INCOMPLETE");
    assert.ok(r.missing.includes("audit.trustedApp"));
  });
});
