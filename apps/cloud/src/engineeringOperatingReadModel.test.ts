import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzeNusaCiCriticalPathTelemetry, type GithubCiJobTimingReceipt } from "../../desktop/src/cloud/nusaCiCriticalPathTelemetry";
import { createNusaDevelopmentQueue } from "../../desktop/src/cloud/nusaDevelopmentControlPlane";
import {
  buildNusaEngineeringOperatingSnapshot,
  createNusaEngineeringOperatingReadModel,
  validateNusaEngineeringOperatingSnapshot,
  type NusaEngineeringOperatingInput,
} from "./engineeringOperatingReadModel";

const BASE = Date.parse("2026-08-29T00:00:00.000Z");
const FP = "1".repeat(64);
const receipt = (headSha: string, jobId: number, durationMs: number): GithubCiJobTimingReceipt => ({
  jobId,
  runId: jobId,
  runAttempt: 1,
  name: "validation",
  headSha,
  status: "completed",
  conclusion: "success",
  startedAt: new Date(BASE).toISOString(),
  completedAt: new Date(BASE + durationMs).toISOString(),
  sourceFingerprint: FP,
});

function input(overrides: Partial<NusaEngineeringOperatingInput> = {}): NusaEngineeringOperatingInput {
  const baselineHead = "a".repeat(40);
  const postHead = "b".repeat(40);
  return {
    observedAt: BASE + 2_000,
    currentHeadSha: postHead,
    opportunities: [{
      opportunityId: "ci-latency",
      expectedProductValue: 80,
      riskReduction: 60,
      evidenceGain: 70,
      criticalPathUnlock: 90,
      effortCost: 20,
      dependencyFanOut: 10,
      uncertainty: 10,
    }],
    selfOptimizer: {
      observationCount: 4,
      ciP95Normalized: 0.8,
      conflictRate: 0.1,
      reworkRate: 0.1,
      idleRatio: 0.2,
      blockedTimeRatio: 0.3,
    },
    concurrency: {
      mergedWorkCount: 4,
      reworkCount: 0,
      conflictCount: 0,
      ciCapacitySlots: 2,
      ciPeakConcurrentJobs: 1,
    },
    executionEvidence: {
      schemaVersion: 1,
      executionId: "owner-request-1",
      event: "OWNER_REQUEST",
      sourceRef: "control://request/owner-request-1",
      sourceFingerprint: FP,
      observedAt: BASE + 1_000,
      workflowRunId: null,
      evidenceRefs: ["control://request/owner-request-1"],
    },
    outcomeEvidence: {
      baseline: analyzeNusaCiCriticalPathTelemetry([receipt(baselineHead, 1, 1_000)], baselineHead),
      postMerge: analyzeNusaCiCriticalPathTelemetry([receipt(postHead, 2, 800)], postHead),
      minimumMeaningfulChange: 100,
    },
    queue: createNusaDevelopmentQueue([{
      id: "ci-latency",
      state: "MERGE_READY",
      priority: "P1",
      dependencies: [],
      canonicalOwner: "nusa",
      touchedFiles: ["apps/cloud/src/runtime.ts"],
      evidenceRequirements: ["exact-head"],
      nextAction: "merge",
      createdAt: BASE,
      claim: null,
    }]),
    ...overrides,
  };
}

describe("NUSA Engineering OS production read model", () => {
  it("composes existing evidence engines into a verified read-only projection", () => {
    const result = buildNusaEngineeringOperatingSnapshot(input());
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.scope, "ENGINEERING_OPERATIONS_READ_ONLY");
    assert.equal(result.selfOptimizer.classification, "MEASURED");
    assert.equal(result.adaptiveConcurrency.classification, "MEASURED");
    assert.equal(result.outcome.classification, "VERIFIED_IMPROVEMENT");
    assert.equal(result.executionOrigin.origin, "USER_TRIGGERED");
    assert.deepEqual(result.sourceFingerprints, [FP]);
    assert.deepEqual(result.queue, { status: "AVAILABLE", revision: 0, totalItems: 1, activeItems: 1, mergeReadyItems: 1 });
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.authority, { liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY", mutationAllowed: false });
    assert.equal(validateNusaEngineeringOperatingSnapshot(result), result);
  });

  it("keeps unknown telemetry insufficient instead of creating a green optimization claim", () => {
    const result = buildNusaEngineeringOperatingSnapshot(input({
      selfOptimizer: { ...input().selfOptimizer, conflictRate: "UNKNOWN" },
      outcomeEvidence: { baseline: null, postMerge: null, minimumMeaningfulChange: 100 },
    }));
    assert.equal(result.status, "INSUFFICIENT");
    assert.equal(result.outcome.classification, "INSUFFICIENT");
    assert.ok(result.blockers.some((reason) => reason.startsWith("OUTCOME:")));
    assert.ok(result.blockers.some((reason) => reason.startsWith("SELF_OPTIMIZER:")));
    assert.equal(validateNusaEngineeringOperatingSnapshot(result), result);
  });

  it("projects unavailable production sources without mutating the queue or inventing metrics", () => {
    const unavailable = createNusaEngineeringOperatingReadModel().getSnapshot();
    assert.equal(unavailable.status, "UNAVAILABLE");
    assert.equal(unavailable.selfOptimizer.classification, "INSUFFICIENT");
    assert.equal(unavailable.adaptiveConcurrency.classification, "CONSERVATIVE");
    assert.equal(unavailable.outcome.classification, "INSUFFICIENT");
    assert.equal(unavailable.queue.status, "UNAVAILABLE");
    assert.equal(unavailable.authority.productionMutationAllowed, false);
    assert.equal(validateNusaEngineeringOperatingSnapshot(unavailable), unavailable);

    let reads = 0;
    const model = createNusaEngineeringOperatingReadModel(() => { reads += 1; return input(); });
    const first = model.getSnapshot();
    const second = model.getSnapshot();
    assert.equal(reads, 2);
    assert.deepEqual(first, second);
    assert.equal(first.queue.revision, 0);
  });

  it("fails closed when the canonical source throws", () => {
    const result = createNusaEngineeringOperatingReadModel(() => { throw new Error("source unavailable"); }).getSnapshot();
    assert.equal(result.status, "UNAVAILABLE");
    assert.deepEqual(result.blockers, ["ENGINEERING_SOURCE_UNAVAILABLE"]);
  });

  it("rejects incomplete or internally inconsistent snapshots instead of trusting the top-level status", () => {
    const verified = buildNusaEngineeringOperatingSnapshot(input());
    const { queue: _queue, ...missingQueue } = verified;
    assert.throws(
      () => validateNusaEngineeringOperatingSnapshot(missingQueue),
      /ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INVALID/,
    );
    assert.throws(
      () => validateNusaEngineeringOperatingSnapshot({ ...verified, blockers: ["FORGED_BLOCKER"] }),
      /ENGINEERING_OPERATIONS_SNAPSHOT_VERIFIED_INCONSISTENT/,
    );
    assert.throws(
      () => validateNusaEngineeringOperatingSnapshot({
        ...verified,
        queue: { ...verified.queue, totalItems: 1, activeItems: 2 },
      }),
      /ENGINEERING_OPERATIONS_SNAPSHOT_QUEUE_INCONSISTENT/,
    );
  });
});
