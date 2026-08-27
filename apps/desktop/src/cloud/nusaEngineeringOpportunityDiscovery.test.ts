import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverNusaEngineeringOpportunities,
  type NusaEngineeringOpportunitySignal,
} from "./nusaEngineeringOpportunityDiscovery";

const T0 = Date.parse("2026-08-28T00:00:00.000Z");
const FP = (char: string) => char.repeat(64);

function signal(overrides: Partial<NusaEngineeringOpportunitySignal> & Pick<NusaEngineeringOpportunitySignal, "signalId" | "kind" | "subject">): NusaEngineeringOpportunitySignal {
  return {
    signalId: overrides.signalId,
    kind: overrides.kind,
    subject: overrides.subject,
    observedAt: overrides.observedAt ?? T0,
    evidenceState: overrides.evidenceState ?? "VERIFIED",
    occurrences: overrides.occurrences ?? 1,
    sourceFingerprint: overrides.sourceFingerprint ?? FP("a"),
    existingIssueNumber: overrides.existingIssueNumber ?? null,
    existingWorkId: overrides.existingWorkId ?? null,
  };
}

describe("discoverNusaEngineeringOpportunities", () => {
  it("groups equivalent verified signals deterministically and preserves audit evidence", () => {
    const result = discoverNusaEngineeringOpportunities([
      signal({ signalId: "sig-a", kind: "CI_FAILURE_FAMILY", subject: " Coverage Core 0 ", occurrences: 2, sourceFingerprint: FP("a") }),
      signal({ signalId: "sig-b", kind: "CI_FAILURE_FAMILY", subject: "coverage   core 0", observedAt: T0 + 1, occurrences: 3, sourceFingerprint: FP("b") }),
    ]);
    assert.equal(result.discoveredCount, 1);
    assert.equal(result.deduplicatedCount, 0);
    assert.equal(result.heldCount, 0);
    assert.deepEqual(result.candidates[0], {
      candidateId: "CI_FAILURE_FAMILY:coverage core 0",
      kind: "CI_FAILURE_FAMILY",
      subject: "coverage core 0",
      signalIds: ["sig-a", "sig-b"],
      evidenceState: "VERIFIED",
      totalOccurrences: 5,
      latestObservedAt: T0 + 1,
      existingIssueNumber: null,
      existingWorkId: null,
      action: "CREATE_CANDIDATE",
      auditReasons: ["SIGNALS:2", "OCCURRENCES:5", "EVIDENCE:VERIFIED", "VERIFIED_NEW_OPPORTUNITY"],
    });
  });

  it("deduplicates against existing canonical issue or work instead of creating duplicate activity", () => {
    const result = discoverNusaEngineeringOpportunities([
      signal({ signalId: "sig-c", kind: "RECOVERY_GAP", subject: "restart replay", existingIssueNumber: 882, sourceFingerprint: FP("c") }),
      signal({ signalId: "sig-d", kind: "UI_FRICTION", subject: "dead control", existingWorkId: "ux-14", sourceFingerprint: FP("d") }),
    ]);
    assert.equal(result.discoveredCount, 0);
    assert.equal(result.deduplicatedCount, 2);
    assert.ok(result.candidates.every((candidate) => candidate.action === "DEDUPLICATED"));
  });

  it("never promotes UNKNOWN or INSUFFICIENT evidence into a new candidate", () => {
    const result = discoverNusaEngineeringOpportunities([
      signal({ signalId: "sig-e", kind: "CI_LONG_TAIL", subject: "coverage merge", evidenceState: "UNKNOWN", sourceFingerprint: FP("e") }),
      signal({ signalId: "sig-f", kind: "PAPER_EVIDENCE_GAP", subject: "longitudinal periods", evidenceState: "INSUFFICIENT", sourceFingerprint: FP("f") }),
    ]);
    assert.equal(result.discoveredCount, 0);
    assert.equal(result.heldCount, 2);
    assert.ok(result.candidates.every((candidate) => candidate.action === "HOLD_INSUFFICIENT_EVIDENCE"));
  });

  it("uses VERIFIED evidence when a group contains weaker observations but keeps them visible", () => {
    const result = discoverNusaEngineeringOpportunities([
      signal({ signalId: "sig-g", kind: "DEPENDENCY_BOTTLENECK", subject: "merge train", evidenceState: "UNKNOWN", sourceFingerprint: FP("1") }),
      signal({ signalId: "sig-h", kind: "DEPENDENCY_BOTTLENECK", subject: "merge train", evidenceState: "VERIFIED", observedAt: T0 + 2, sourceFingerprint: FP("2") }),
    ]);
    assert.equal(result.candidates[0]?.evidenceState, "VERIFIED");
    assert.equal(result.candidates[0]?.action, "CREATE_CANDIDATE");
    assert.deepEqual(result.candidates[0]?.signalIds, ["sig-g", "sig-h"]);
  });

  it("fails closed on duplicate identities, reused fingerprints, malformed evidence, and conflicting canonical identity", () => {
    const base = signal({ signalId: "sig-i", kind: "ARCHITECTURE_DRIFT", subject: "duplicate engine", sourceFingerprint: FP("9") });
    assert.throws(() => discoverNusaEngineeringOpportunities([base, { ...base }]), /OPPORTUNITY_SIGNAL_ID_DUPLICATE/);
    assert.throws(() => discoverNusaEngineeringOpportunities([
      base,
      signal({ signalId: "sig-j", kind: "UI_FRICTION", subject: "tap", sourceFingerprint: FP("9") }),
    ]), /OPPORTUNITY_SOURCE_FINGERPRINT_REUSED/);
    assert.throws(() => discoverNusaEngineeringOpportunities([{ ...base, observedAt: Number.MAX_VALUE }]), /OPPORTUNITY_OBSERVED_AT_INVALID/);
    assert.throws(() => discoverNusaEngineeringOpportunities([{ ...base, sourceFingerprint: "bad" }]), /OPPORTUNITY_SOURCE_FINGERPRINT_INVALID/);
    assert.throws(() => discoverNusaEngineeringOpportunities([
      { ...base, existingIssueNumber: 903 },
      signal({ signalId: "sig-k", kind: "ARCHITECTURE_DRIFT", subject: "duplicate engine", existingIssueNumber: 905, sourceFingerprint: FP("a") }),
    ]), /OPPORTUNITY_ISSUE_IDENTITY_CONFLICT/);
  });
});
