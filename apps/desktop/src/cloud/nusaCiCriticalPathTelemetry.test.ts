import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeNusaCiCriticalPathTelemetry, NusaCiTelemetryError, type GithubCiJobTimingReceipt } from "./nusaCiCriticalPathTelemetry";

const HEAD = "a".repeat(40);
const FP = "1".repeat(64);
const BASE = Date.parse("2026-08-27T14:00:00.000Z");

function receipt(name: string, jobId: number, startOffsetMs: number, durationMs: number, overrides: Partial<GithubCiJobTimingReceipt> = {}): GithubCiJobTimingReceipt {
  return {
    jobId,
    runId: 100,
    runAttempt: 1,
    name,
    headSha: HEAD,
    status: "completed",
    conclusion: "success",
    startedAt: new Date(BASE + startOffsetMs).toISOString(),
    completedAt: new Date(BASE + startOffsetMs + durationMs).toISOString(),
    sourceFingerprint: FP,
    ...overrides,
  };
}

describe("analyzeNusaCiCriticalPathTelemetry", () => {
  it("derives wall-clock critical path and core shard imbalance from exact GitHub timestamps", () => {
    const result = analyzeNusaCiCriticalPathTelemetry([
      receipt("validation", 1, 0, 10_000),
      receipt("coverage-core-0", 2, 1_000, 20_000),
      receipt("coverage-core-1", 3, 1_000, 10_000),
      receipt("coverage-core-2", 4, 1_000, 15_000),
      receipt("coverage-core-3", 5, 1_000, 12_000),
    ], HEAD);
    assert.equal(result.runs.length, 1);
    assert.equal(result.runs[0]?.wallClockDurationMs, 21_000);
    assert.equal(result.runs[0]?.coreShardImbalanceRatio, 2);
    assert.equal(result.workflowP50Ms, 21_000);
    assert.equal(result.workflowP95Ms, 21_000);
    assert.deepEqual(result.sourceFingerprints, [FP]);
  });

  it("computes deterministic nearest-rank p50/p95 per job across real observations", () => {
    const observations = [10_000, 20_000, 30_000, 40_000, 50_000].map((duration, index) => receipt("validation", index + 1, 0, duration, {
      runId: 200 + index,
      sourceFingerprint: `${index + 1}`.repeat(64),
    }));
    const result = analyzeNusaCiCriticalPathTelemetry(observations, HEAD);
    const validation = result.jobTimings.find((item) => item.name === "validation");
    assert.equal(validation?.p50DurationMs, 30_000);
    assert.equal(validation?.p95DurationMs, 50_000);
    assert.equal(validation?.sampleCount, 5);
  });

  it("reports retry observations per run attempt without job-count skew", () => {
    const result = analyzeNusaCiCriticalPathTelemetry([
      receipt("validation", 1, 0, 10_000),
      receipt("coverage-core-0", 2, 0, 8_000, { runId: 101, runAttempt: 2, sourceFingerprint: "2".repeat(64) }),
      receipt("coverage-core-1", 3, 0, 9_000, { runId: 101, runAttempt: 2, sourceFingerprint: "3".repeat(64) }),
    ], HEAD);
    assert.equal(result.runs.length, 2);
    assert.equal(result.retryObservationRate, 0.5);
  });

  it("keeps cache and duplicate-work metrics explicitly insufficient without stronger receipts", () => {
    const result = analyzeNusaCiCriticalPathTelemetry([receipt("validation", 1, 0, 10_000)], HEAD);
    assert.equal(result.cacheEffectiveness, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.duplicateBuildTestWork, "INSUFFICIENT_EVIDENCE");
    assert.ok(result.reasons.includes("CACHE_EFFECTIVENESS_REQUIRES_STRONGER_EVIDENCE"));
  });

  it("fails closed on cross-head, malformed fingerprint, incomplete jobs, and impossible chronology", () => {
    assert.throws(() => analyzeNusaCiCriticalPathTelemetry([receipt("validation", 1, 0, 1_000, { headSha: "b".repeat(40) })], HEAD), (error) => error instanceof NusaCiTelemetryError && error.code === "JOB_HEAD_MISMATCH");
    assert.throws(() => analyzeNusaCiCriticalPathTelemetry([receipt("validation", 1, 0, 1_000, { sourceFingerprint: "bad" })], HEAD), (error) => error instanceof NusaCiTelemetryError && error.code === "INVALID_SOURCE_FINGERPRINT");
    assert.throws(() => analyzeNusaCiCriticalPathTelemetry([receipt("validation", 1, 0, 1_000, { status: "in_progress" as "completed" })], HEAD), (error) => error instanceof NusaCiTelemetryError && error.code === "INCOMPLETE_JOB_RECEIPT");
    assert.throws(() => analyzeNusaCiCriticalPathTelemetry([receipt("validation", 1, 1_000, -1)], HEAD), (error) => error instanceof NusaCiTelemetryError && error.code === "NEGATIVE_JOB_DURATION");
  });

  it("rejects duplicate job receipts rather than double-counting telemetry", () => {
    const duplicated = receipt("validation", 1, 0, 1_000);
    assert.throws(() => analyzeNusaCiCriticalPathTelemetry([duplicated, duplicated], HEAD), (error) => error instanceof NusaCiTelemetryError && error.code === "DUPLICATE_JOB_RECEIPT");
  });
});
