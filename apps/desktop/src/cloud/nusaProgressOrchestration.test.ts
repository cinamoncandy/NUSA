import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orchestrateNusaProgress } from "./nusaProgressOrchestration";
import type { NusaProgressEvidenceRef, NusaProgressItemInput } from "./nusaProgressScorecard";

const AS_OF = 1_787_830_000_000;
const FP = "a".repeat(64);

function evidence(kind: NusaProgressEvidenceRef["kind"], source: string, status: NusaProgressEvidenceRef["status"] = "PASS"): NusaProgressEvidenceRef {
  return { id: `${kind}-${status}`, kind, status, observedAt: AS_OF - 1_000, source, sourceFingerprint: FP };
}

function item(evidenceRefs: readonly NusaProgressEvidenceRef[]): NusaProgressItemInput {
  return { id: "runtime", domain: "RELIABILITY_RECOVERY", weight: 1, requiredAcceptance: "RUNTIME_VERIFIED", evidence: evidenceRefs };
}

describe("orchestrateNusaProgress", () => {
  it("computes scorecard, semantic level, and read-only projection from the same canonical evidence", () => {
    const result = orchestrateNusaProgress(
      [item([evidence("RUNTIME", "runtime://evidence/github-actions-artifact/1")])],
      { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 },
    );
    assert.equal(result.scorecard.items[0]?.status, "PASS");
    assert.equal(result.assessment.level, 1);
    assert.equal(result.supervisor.level, result.assessment.level);
    assert.equal(result.supervisor.overallProgressRatio, result.scorecard.overallProgressRatio);
    assert.equal(result.authority, "READ_ONLY");
    assert.equal(result.supervisor.authority, "READ_ONLY");
  });

  it("does not upgrade CI evidence into runtime evidence", () => {
    const result = orchestrateNusaProgress(
      [item([evidence("CI", "github://actions/run/1")])],
      { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 },
    );
    assert.equal(result.scorecard.items[0]?.status, "UNKNOWN");
    assert.equal(result.assessment.level, 0);
    assert.ok(result.assessment.reasons.includes("UNKNOWN_EVIDENCE_BLOCKS_HIGHER_LEVEL"));
  });

  it("demotes immediately when runtime evidence fails", () => {
    const result = orchestrateNusaProgress(
      [item([evidence("RUNTIME", "runtime://evidence/github-actions-artifact/1", "FAIL")])],
      { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 },
    );
    assert.equal(result.scorecard.items[0]?.status, "FAIL");
    assert.equal(result.assessment.level, 0);
    assert.ok(result.assessment.reasons.includes("FAILED_EVIDENCE_DEMOTES_LEVEL"));
  });

  it("does not preserve stale evidence as historical progress", () => {
    const stale = { ...evidence("RUNTIME", "runtime://evidence/github-actions-artifact/1"), observedAt: AS_OF - 120_000 };
    const result = orchestrateNusaProgress([item([stale])], { asOf: AS_OF, maximumEvidenceAgeMs: 60_000 });
    assert.equal(result.scorecard.items[0]?.status, "UNKNOWN");
    assert.equal(result.assessment.level, 0);
  });
});
