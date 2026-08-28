import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NusaEngineeringExecutionEvidence } from "./nusaEngineeringExecutionOrigin";
import { buildNusaOperationalProgressSnapshot } from "./nusaOperationalProgressSnapshot";
import type { ActualPaperRuntimeArtifactReceipt } from "./nusaProgressRuntimeEvidence";

const HEAD = "a".repeat(40);
const FP = "1".repeat(64);
const T0 = Date.parse("2026-08-27T00:00:00.000Z");

function artifact(result: "PASS" | "FAIL" = "PASS"): ActualPaperRuntimeArtifactReceipt {
  return {
    artifactId: 42,
    artifactDigest: `sha256:${"2".repeat(64)}`,
    headSha: HEAD,
    payload: JSON.stringify({
      schema_version: 1,
      evidence_type: "nusa.actual-paper-runtime-e2e",
      result,
      source_commit: HEAD,
      completed_at: new Date(T0 + 2_000).toISOString(),
      authority: { mode: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
      market_data: { private_credentials_used: false },
      prohibited_capabilities: { upbit_private_credentials: false, live_order_endpoint: false, withdrawal_transfer: false, real_money_mutation: false },
    }),
  };
}

function executionEvidence(event: NusaEngineeringExecutionEvidence["event"] = "SCHEDULE"): NusaEngineeringExecutionEvidence {
  const executionId = "run-42";
  const sourceRef = event === "OWNER_REQUEST" ? `control://request/${executionId}` : "github://actions/run/42";
  return {
    schemaVersion: 1,
    executionId,
    event,
    sourceRef,
    sourceFingerprint: "4".repeat(64),
    observedAt: T0 + 1_500,
    workflowRunId: event === "OWNER_REQUEST" ? null : 42,
    evidenceRefs: [sourceRef],
  };
}

function input(runtimeResult: "PASS" | "FAIL" = "PASS") {
  return {
    commit: { sha: HEAD, observedAt: T0, sourceFingerprint: FP },
    workflows: [{ runId: 7, name: "CI", headSha: HEAD, status: "completed" as const, conclusion: "success", observedAt: T0 + 1_000, sourceFingerprint: "3".repeat(64) }],
    requiredWorkflowNames: ["CI"],
    actualPaperArtifact: artifact(runtimeResult),
    executionEvidence: executionEvidence(),
    policy: { asOf: T0 + 3_000, maximumEvidenceAgeMs: 60_000 },
  };
}

describe("buildNusaOperationalProgressSnapshot", () => {
  it("composes exact-head repository/CI and immutable PAPER runtime evidence", () => {
    const result = buildNusaOperationalProgressSnapshot(input());
    assert.equal(result.scope, "OPERATIONAL_EVIDENCE_ONLY");
    assert.equal(result.headSha, HEAD);
    assert.equal(result.authority, "READ_ONLY");
    assert.equal(result.scorecard.items.length, 2);
    assert.deepEqual(result.scorecard.items.map((item) => item.status), ["PASS", "PASS"]);
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.executionOrigin, {
      schemaVersion: 1,
      status: "VERIFIED",
      origin: "AUTO_BACKGROUND",
      event: "SCHEDULE",
      executionId: "run-42",
      observedAt: T0 + 1_500,
      sourceRef: "github://actions/run/42",
      sourceFingerprint: "4".repeat(64),
      evidenceRefs: ["github://actions/run/42"],
      reasons: [],
    });
  });

  it("surfaces a failed PAPER runtime receipt as a blocker instead of preserving progress", () => {
    const result = buildNusaOperationalProgressSnapshot(input("FAIL"));
    const runtime = result.scorecard.items.find((item) => item.id === "actual-paper-runtime");
    assert.equal(runtime?.status, "FAIL");
    assert.ok(result.blockers.some((blocker) => blocker.startsWith("actual-paper-runtime:")));
  });

  it("fails closed when the PAPER artifact belongs to another head", () => {
    const bad = input();
    assert.throws(() => buildNusaOperationalProgressSnapshot({ ...bad, actualPaperArtifact: { ...bad.actualPaperArtifact, headSha: "b".repeat(40) } }));
  });

  it("labels the result as operational-only so it cannot masquerade as whole-product acceptance", () => {
    const result = buildNusaOperationalProgressSnapshot(input());
    assert.equal(result.scope, "OPERATIONAL_EVIDENCE_ONLY");
    assert.ok(!JSON.stringify(result).includes("PRODUCT_ACCEPTED"));
    assert.ok(!JSON.stringify(result).includes("HUMAN_ONLY"));
  });

  it("distinguishes user-triggered execution from background execution using the trigger receipt", () => {
    const result = buildNusaOperationalProgressSnapshot({ ...input(), executionEvidence: executionEvidence("OWNER_REQUEST") });
    assert.equal(result.executionOrigin.status, "VERIFIED");
    assert.equal(result.executionOrigin.origin, "USER_TRIGGERED");
    assert.equal(result.executionOrigin.sourceRef, "control://request/run-42");
  });

  it("keeps missing or ambiguous execution provenance UNKNOWN and reports a blocker", () => {
    const missing = buildNusaOperationalProgressSnapshot({ ...input(), executionEvidence: null });
    assert.equal(missing.executionOrigin.status, "UNKNOWN");
    assert.equal(missing.executionOrigin.origin, null);
    assert.ok(missing.blockers.includes("execution-origin:EXECUTION_EVIDENCE_MISSING"));

    const ambiguous = buildNusaOperationalProgressSnapshot({ ...input(), executionEvidence: executionEvidence("PUSH") });
    assert.equal(ambiguous.executionOrigin.status, "UNKNOWN");
    assert.equal(ambiguous.executionOrigin.origin, null);
    assert.ok(ambiguous.blockers.includes("execution-origin:EXECUTION_EVENT_AMBIGUOUS"));
  });
});
