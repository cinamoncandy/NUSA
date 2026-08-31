import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bindNusaMergeEvidenceToGithubObservation,
  buildNusaMergeReworkTelemetry,
  classifyNusaMergeReworkObservation,
  type NusaGithubMergeReworkObservation,
} from "./nusaDevelopmentMergeReworkTelemetry";
import type { NusaExactHeadMergeEvidence } from "./nusaDevelopmentMergeTrain";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);
const FINGERPRINT = "c".repeat(64);

function observation(overrides: Partial<NusaGithubMergeReworkObservation> = {}): NusaGithubMergeReworkObservation {
  return {
    observationId: overrides.observationId ?? "github-run-101:pr-42",
    workItemId: overrides.workItemId ?? "work-42",
    pullRequestNumber: overrides.pullRequestNumber ?? 42,
    currentHeadSha: overrides.currentHeadSha ?? HEAD_A,
    validatedHeadSha: overrides.validatedHeadSha ?? HEAD_A,
    workflowRunId: overrides.workflowRunId ?? 101,
    workflowHeadSha: overrides.workflowHeadSha ?? HEAD_A,
    sourceFingerprint: overrides.sourceFingerprint ?? FINGERPRINT,
    observedAt: overrides.observedAt ?? 1_000,
  };
}

describe("NUSA merge rework telemetry", () => {
  it("classifies independently bound exact-head evidence as ready", () => {
    assert.equal(classifyNusaMergeReworkObservation(observation()), "EXACT_HEAD_READY");
  });

  it("classifies a moved PR head as stale and requiring revalidation", () => {
    assert.equal(
      classifyNusaMergeReworkObservation(observation({ currentHeadSha: HEAD_B })),
      "STALE_HEAD_REVALIDATION_REQUIRED",
    );
  });

  it("reports UNKNOWN when the workflow receipt is not bound to the validated head", () => {
    assert.equal(classifyNusaMergeReworkObservation(observation({ workflowHeadSha: HEAD_B })), "UNKNOWN");
  });

  it("deduplicates the same immutable observation without inflating counters", () => {
    const value = observation();
    const telemetry = buildNusaMergeReworkTelemetry([value, value]);
    assert.deepEqual(telemetry.totals, {
      total: 1,
      exactHeadReady: 1,
      staleHeadRevalidationRequired: 0,
      unknown: 0,
    });
  });

  it("rejects an observation identity reused with a different payload", () => {
    const first = observation();
    const conflict = observation({ currentHeadSha: HEAD_B });
    assert.throws(
      () => buildNusaMergeReworkTelemetry([first, conflict]),
      /OBSERVATION_ID_CONFLICT/,
    );
  });

  it("fails closed on malformed GitHub provenance", () => {
    assert.throws(
      () => classifyNusaMergeReworkObservation(observation({ workflowRunId: 0 })),
      /INVALID_WORKFLOW_RUN_ID/,
    );
    assert.throws(
      () => classifyNusaMergeReworkObservation(observation({ sourceFingerprint: "not-a-sha256" })),
      /INVALID_SOURCE_FINGERPRINT/,
    );
    assert.throws(
      () => classifyNusaMergeReworkObservation(observation({ currentHeadSha: "short" })),
      /INVALID_COMMIT_SHA/,
    );
    assert.throws(
      () => classifyNusaMergeReworkObservation(observation({ observedAt: -1 })),
      /INVALID_OBSERVED_AT/,
    );
  });

  it("binds canonical merge evidence without inventing GitHub provenance", () => {
    const evidence: NusaExactHeadMergeEvidence = {
      workItemId: "work-7",
      headSha: HEAD_B,
      validatedHeadSha: HEAD_A,
      requiredChecksPassed: true,
      safetyChecksPassed: true,
      unresolvedReviewThreads: 0,
      observedAt: 1_500,
    };
    const bound = bindNusaMergeEvidenceToGithubObservation(evidence, {
      observationId: "github-run-202:pr-7",
      pullRequestNumber: 7,
      workflowRunId: 202,
      workflowHeadSha: HEAD_A,
      sourceFingerprint: FINGERPRINT,
    });
    assert.equal(bound.currentHeadSha, HEAD_B);
    assert.equal(bound.validatedHeadSha, HEAD_A);
    assert.equal(bound.workflowRunId, 202);
    assert.equal(classifyNusaMergeReworkObservation(bound), "STALE_HEAD_REVALIDATION_REQUIRED");
  });

  it("never translates an exact-head ready observation into an avoided-rework claim", () => {
    const telemetry = buildNusaMergeReworkTelemetry([observation()]);
    assert.equal(telemetry.observations[0]?.classification, "EXACT_HEAD_READY");
    assert.equal("avoidedRework" in telemetry.totals, false);
  });
});
