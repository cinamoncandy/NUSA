import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNusaWholeProgressSnapshot } from "./nusaWholeProgressSnapshot";
import type { ActualPaperRuntimeArtifactReceipt } from "./nusaProgressRuntimeEvidence";

const HEAD = "a".repeat(40);
const FP = "1".repeat(64);
const T0 = Date.parse("2026-08-27T00:00:00.000Z");

function artifact(): ActualPaperRuntimeArtifactReceipt {
  return {
    artifactId: 42,
    artifactDigest: `sha256:${"2".repeat(64)}`,
    headSha: HEAD,
    payload: JSON.stringify({
      schema_version: 1,
      evidence_type: "nusa.actual-paper-runtime-e2e",
      result: "PASS",
      source_commit: HEAD,
      completed_at: new Date(T0 + 2_000).toISOString(),
      authority: { mode: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
      market_data: { private_credentials_used: false },
      prohibited_capabilities: { upbit_private_credentials: false, live_order_endpoint: false, withdrawal_transfer: false, real_money_mutation: false },
    }),
  };
}

function input() {
  return {
    commit: { sha: HEAD, observedAt: T0, sourceFingerprint: FP },
    workflows: [{ runId: 7, name: "CI", headSha: HEAD, status: "completed" as const, conclusion: "success", observedAt: T0 + 1_000, sourceFingerprint: "3".repeat(64) }],
    requiredWorkflowNames: ["CI"],
    actualPaperArtifact: artifact(),
    policy: { asOf: T0 + 3_000, maximumEvidenceAgeMs: 60_000 },
  };
}

describe("buildNusaWholeProgressSnapshot", () => {
  it("keeps all six domains configured without crediting unadapted recovery evidence", () => {
    const result = buildNusaWholeProgressSnapshot(input());
    assert.equal(result.scope, "WHOLE_NUSA_EVIDENCE_BASELINE");
    assert.equal(result.scorecard.domains.length, 6);
    assert.equal(result.scorecard.items.length, 6);
    assert.equal(result.scorecard.overallProgressRatio, 0.1);
    assert.equal(result.assessment.level, 1);
  });

  it("keeps a clean Actual PAPER runtime PASS from masquerading as recovery acceptance", () => {
    const result = buildNusaWholeProgressSnapshot(input());
    const byId = new Map(result.scorecard.items.map((item) => [item.id, item]));
    assert.equal(byId.get("verified-economic-edge")?.status, "UNKNOWN");
    assert.equal(byId.get("autonomy-runtime")?.status, "UNKNOWN");
    assert.equal(byId.get("paper-recovery-acceptance")?.status, "UNKNOWN");
    assert.equal(byId.get("safety-research-integrity")?.status, "UNKNOWN");
    assert.equal(byId.get("product-physical-acceptance")?.status, "UNKNOWN");
    assert.equal(byId.get("exact-head-repository-ci")?.status, "PASS");
  });

  it("surfaces the missing stronger evidence classes as blockers", () => {
    const result = buildNusaWholeProgressSnapshot(input());
    assert.ok(result.blockers.includes("verified-economic-edge:MISSING_PAPER_EVIDENCE"));
    assert.ok(result.blockers.includes("autonomy-runtime:MISSING_RUNTIME_EVIDENCE"));
    assert.ok(result.blockers.includes("paper-recovery-acceptance:MISSING_PAPER_EVIDENCE"));
    assert.ok(result.blockers.includes("product-physical-acceptance:MISSING_DEVICE_EVIDENCE"));
    assert.ok(result.blockers.includes("product-physical-acceptance:MISSING_HUMAN_EVIDENCE"));
  });

  it("remains read-only and does not claim stronger acceptance than supplied evidence", () => {
    const result = buildNusaWholeProgressSnapshot(input());
    assert.equal(result.authority, "READ_ONLY");
    assert.equal(result.supervisor.authority, "READ_ONLY");
    assert.ok(result.assessment.reasons.includes("UNKNOWN_EVIDENCE_BLOCKS_HIGHER_LEVEL"));
  });
});
