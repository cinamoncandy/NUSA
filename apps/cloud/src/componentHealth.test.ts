import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateComponentHealth, type ComponentHealthEvidence } from "./componentHealth";

const now = 1_789_800_000_000;
const policy = { staleAfterMs: 10_000 };
const evidence = (signal: ComponentHealthEvidence["signal"], observedAt = now, evidenceId = signal): ComponentHealthEvidence => ({
  componentId: "PAPER_EXECUTION",
  signal,
  observedAt,
  provenance: "paperLearningObservability",
  evidenceId
});

describe("evaluateComponentHealth", () => {
  it("never treats missing telemetry as healthy", () => {
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy }).state, "UNKNOWN");
  });

  it("maps fresh PASS, DEGRADED and FAIL deterministically", () => {
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("PASS") }).state, "HEALTHY");
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("DEGRADED") }).state, "DEGRADED");
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("FAIL") }).state, "FAILED");
  });

  it("marks old evidence stale before trusting its signal", () => {
    const value = evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("PASS", now - 10_001) });
    assert.equal(value.state, "STALE");
    assert.equal(value.reasonCode, "EVIDENCE_STALE");
  });

  it("fails closed on future or mismatched evidence", () => {
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("PASS", now + 1) }).state, "UNKNOWN");
    assert.equal(evaluateComponentHealth({ componentId: "MARKET_DATA", now, policy, latest: evidence("PASS") }).state, "UNKNOWN");
  });

  it("requires evidence newer than the previous failure to verify recovery", () => {
    const failure = evidence("FAIL", now - 100, "failure");
    const sameTimePass = evidence("PASS", failure.observedAt, "pass");
    const recovered = evidence("PASS", failure.observedAt + 1, "recovered");
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: sameTimePass, previousFailure: failure }).reasonCode, "RECOVERY_NOT_VERIFIED");
    assert.equal(evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: recovered, previousFailure: failure }).state, "HEALTHY");
  });

  it("produces the same fingerprint for identical inputs", () => {
    const input = { componentId: "PAPER_EXECUTION", now, policy, latest: evidence("PASS") } as const;
    assert.equal(evaluateComponentHealth(input).fingerprint, evaluateComponentHealth(input).fingerprint);
  });

  it("preserves provenance in the result", () => {
    const value = evaluateComponentHealth({ componentId: "PAPER_EXECUTION", now, policy, latest: evidence("PASS") });
    assert.equal(value.provenance, "paperLearningObservability");
    assert.equal(value.evidenceId, "PASS");
  });
});
