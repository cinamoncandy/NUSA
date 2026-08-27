import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectActualPaperRuntimeProgressEvidence, NusaProgressRuntimeEvidenceError, type ActualPaperRuntimeArtifactReceipt } from "./nusaProgressRuntimeEvidence";

const HEAD = "def6c81c95c78598523e9356c6c6f9471b096639";

function payload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    evidence_type: "nusa.actual-paper-runtime-e2e",
    result: "PASS",
    source_commit: HEAD,
    completed_at: "2026-08-27T06:17:17.144Z",
    authority: { mode: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" },
    market_data: { private_credentials_used: false },
    prohibited_capabilities: { upbit_private_credentials: false, live_order_endpoint: false, withdrawal_transfer: false, real_money_mutation: false },
    ...overrides,
  });
}

function artifact(overrides: Partial<ActualPaperRuntimeArtifactReceipt> = {}): ActualPaperRuntimeArtifactReceipt {
  return {
    artifactId: 9635397556,
    artifactDigest: "sha256:b7b6885e12d3c0fab28623ea33acdb6ddd3e28b88df251b6edd54c62b3f26a00",
    headSha: HEAD,
    payload: payload(),
    ...overrides,
  };
}

describe("collectActualPaperRuntimeProgressEvidence", () => {
  it("emits independent RUNTIME and PAPER refs from immutable payload bytes", () => {
    const result = collectActualPaperRuntimeProgressEvidence(artifact(), HEAD);
    assert.equal(result.runtime.kind, "RUNTIME");
    assert.equal(result.paper.kind, "PAPER");
    assert.equal(result.runtime.status, "PASS");
    assert.equal(result.paper.status, "PASS");
    assert.equal(result.runtime.sourceFingerprint, result.paper.sourceFingerprint);
    assert.match(result.runtime.source, /^runtime:\/\/evidence\/github-actions-artifact\//);
    assert.match(result.paper.source, /^paper:\/\/evidence\/github-actions-artifact\//);
  });

  it("does not turn a failed operational payload into passing evidence", () => {
    const result = collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ result: "FAIL" }) }), HEAD);
    assert.equal(result.runtime.status, "FAIL");
    assert.equal(result.paper.status, "FAIL");
  });

  it("fails closed on cross-head artifact or payload reuse", () => {
    const other = "a".repeat(40);
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ headSha: other }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "RUNTIME_EVIDENCE_HEAD_MISMATCH");
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ source_commit: other }) }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "PAYLOAD_HEAD_MISMATCH");
  });

  it("fails closed if the receipt shows LIVE authority, private credentials, or money mutation", () => {
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ authority: { mode: "PAPER_ONLY", liveAuthority: "READ_WRITE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" } }) }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "UNSAFE_RUNTIME_AUTHORITY");
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ market_data: { private_credentials_used: true } }) }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "PROHIBITED_RUNTIME_CAPABILITY_PRESENT");
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ prohibited_capabilities: { upbit_private_credentials: false, live_order_endpoint: false, withdrawal_transfer: false, real_money_mutation: true } }) }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "PROHIBITED_RUNTIME_CAPABILITY_PRESENT");
  });

  it("rejects malformed artifact provenance and timestamps", () => {
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ artifactDigest: "sha256:bad" as `sha256:${string}` }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "INVALID_ARTIFACT_DIGEST");
    assert.throws(() => collectActualPaperRuntimeProgressEvidence(artifact({ payload: payload({ completed_at: "not-a-time" }) }), HEAD), (error) => error instanceof NusaProgressRuntimeEvidenceError && error.code === "INVALID_RUNTIME_EVIDENCE_TIMESTAMP");
  });
});
