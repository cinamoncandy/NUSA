import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeNusaCiCriticalPathTelemetry, type GithubCiJobTimingReceipt } from "./nusaCiCriticalPathTelemetry";
import { assessNusaCiCriticalPathOutcome } from "./nusaEngineeringOutcomeFeedback";

const BASE = Date.parse("2026-08-27T14:00:00.000Z");
const FP = "1".repeat(64);
const POST_FP = "2".repeat(64);
const THIRD_FP = "3".repeat(64);
const receipt = (headSha: string, jobId: number, durationMs: number, sourceFingerprint = headSha === "a".repeat(40) ? FP : POST_FP): GithubCiJobTimingReceipt => ({
  jobId,
  runId: jobId,
  runAttempt: 1,
  name: "validation",
  headSha,
  status: "completed",
  conclusion: "success",
  startedAt: new Date(BASE).toISOString(),
  completedAt: new Date(BASE + durationMs).toISOString(),
  sourceFingerprint,
});

const telemetry = (headSha: string, jobId: number, durationMs: number, sourceFingerprint?: string) => analyzeNusaCiCriticalPathTelemetry([receipt(headSha, jobId, durationMs, sourceFingerprint)], headSha);

describe("assessNusaCiCriticalPathOutcome", () => {
  it("evaluates a real exact-head pre/post metric without inventing a result", () => {
    const result = assessNusaCiCriticalPathOutcome({
      baseline: telemetry("a".repeat(40), 1, 1_000),
      postMerge: telemetry("b".repeat(40), 2, 800),
      minimumMeaningfulChange: 100,
    });
    assert.equal(result.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.baselineHeadSha, "a".repeat(40));
    assert.equal(result.postMergeHeadSha, "b".repeat(40));
    assert.deepEqual(result.baselineSourceFingerprints, [FP]);
    assert.deepEqual(result.postMergeSourceFingerprints, [POST_FP]);
  });

  it("keeps a missing post-merge observation insufficient", () => {
    const result = assessNusaCiCriticalPathOutcome({
      baseline: telemetry("a".repeat(40), 1, 1_000),
      postMerge: null,
      minimumMeaningfulChange: 100,
    });
    assert.equal(result.classification, "INSUFFICIENT");
    assert.equal(result.delta, null);
    assert.equal(result.recommendation, "OBSERVE");
  });

  it("rejects same-head comparisons and provenance-free summaries", () => {
    const same = telemetry("a".repeat(40), 1, 1_000);
    assert.throws(() => assessNusaCiCriticalPathOutcome({ baseline: same, postMerge: same, minimumMeaningfulChange: 1 }), /OUTCOME_HEADS_NOT_DISTINCT/);
    assert.throws(() => assessNusaCiCriticalPathOutcome({
      baseline: { ...same, sourceFingerprints: [] },
      postMerge: telemetry("b".repeat(40), 2, 800),
      minimumMeaningfulChange: 1,
    }), /OUTCOME_BASELINE_PROVENANCE_INVALID/);
  });

  it("rejects a receipt fingerprint reused across pre and post observations", () => {
    assert.throws(() => assessNusaCiCriticalPathOutcome({
      baseline: telemetry("a".repeat(40), 1, 1_000, FP),
      postMerge: telemetry("b".repeat(40), 2, 800, FP),
      minimumMeaningfulChange: 100,
    }), /OUTCOME_PROVENANCE_NOT_DISTINCT/);
  });

  it("canonicalizes provenance ordering before returning an assessment", () => {
    const baseline = { ...telemetry("a".repeat(40), 1, 1_000), sourceFingerprints: [POST_FP, FP] };
    const postMerge = telemetry("b".repeat(40), 2, 800, THIRD_FP);
    const result = assessNusaCiCriticalPathOutcome({ baseline, postMerge, minimumMeaningfulChange: 100 });
    assert.deepEqual(result.baselineSourceFingerprints, [FP, POST_FP]);
  });

  it("classifies a measured regression as rollback or rework", () => {
    const result = assessNusaCiCriticalPathOutcome({
      baseline: telemetry("a".repeat(40), 1, 800),
      postMerge: telemetry("b".repeat(40), 2, 1_000),
      minimumMeaningfulChange: 100,
    });
    assert.equal(result.classification, "REGRESSION");
    assert.equal(result.recommendation, "ROLLBACK_OR_REWORK");
  });
});
