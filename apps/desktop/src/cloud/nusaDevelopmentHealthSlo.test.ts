import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NusaCiCriticalPathTelemetry } from "./nusaCiCriticalPathTelemetry";
import { createNusaDevelopmentQueue, type NusaDevelopmentWorkItem } from "./nusaDevelopmentControlPlane";
import type { NusaDevelopmentEvent } from "./nusaDevelopmentEventOrchestrator";
import {
  buildNusaDevelopmentHealthSlo,
  type NusaAgentHeartbeatReceipt,
  type NusaDevelopmentHealthSloInput,
  type NusaEventToNextActionReceipt,
} from "./nusaDevelopmentHealthSlo";
import type { NusaMergeReworkTelemetrySnapshot } from "./nusaDevelopmentMergeReworkTelemetry";
import { buildEngineeringWorkPortfolio, type EngineeringWorkPackageInput } from "./nusaEngineeringPortfolioScheduler";

const SHA = "a".repeat(40);
const FP = "b".repeat(64);

function work(overrides: Partial<NusaDevelopmentWorkItem> & Pick<NusaDevelopmentWorkItem, "id">): NusaDevelopmentWorkItem {
  return {
    id: overrides.id,
    state: overrides.state ?? "READY",
    priority: overrides.priority ?? "P1",
    dependencies: overrides.dependencies ?? [],
    canonicalOwner: overrides.canonicalOwner ?? null,
    touchedFiles: overrides.touchedFiles ?? ["apps/desktop/src/example.ts"],
    evidenceRequirements: overrides.evidenceRequirements ?? ["exact-head-ci"],
    nextAction: overrides.nextAction ?? "claim",
    createdAt: overrides.createdAt ?? 0,
    claim: overrides.claim ?? null,
  };
}

function event(eventId: string, type: NusaDevelopmentEvent["type"], workId: string, occurredAt: number): NusaDevelopmentEvent {
  return { eventId, type, workId, expectedRevision: 0, occurredAt };
}

function ciTelemetry(): NusaCiCriticalPathTelemetry {
  return {
    schemaVersion: 1,
    headSha: SHA,
    sourceFingerprints: [FP],
    jobSampleCount: 2,
    jobTimings: [],
    runs: [],
    workflowP50Ms: 100,
    workflowP95Ms: 200,
    retryObservationRate: 0,
    cacheEffectiveness: "INSUFFICIENT_EVIDENCE",
    duplicateBuildTestWork: "INSUFFICIENT_EVIDENCE",
    reasons: [],
  };
}

function reworkTelemetry(unknown = 0): NusaMergeReworkTelemetrySnapshot {
  return {
    schemaVersion: 1,
    observations: [],
    totals: {
      total: 2,
      exactHeadReady: unknown === 0 ? 1 : 0,
      staleHeadRevalidationRequired: 1,
      unknown,
    },
  };
}

function packageInput(packageId: string, touchedFiles: readonly string[]): EngineeringWorkPackageInput {
  return {
    packageId,
    opportunityId: `op-${packageId}`,
    priority: "P1",
    incident: false,
    lane: "FAST",
    evidenceState: "VERIFIED",
    repositoryControlled: true,
    dependencies: [],
    touchedFiles,
    evidenceRequirements: ["repository"],
    estimatedEffort: 10,
    risk: 10,
    blastRadius: 10,
    validationRequirements: ["test"],
  };
}

function fullInput(): NusaDevelopmentHealthSloInput {
  const queue = createNusaDevelopmentQueue([
    work({ id: "merged", state: "MERGED", createdAt: 0, touchedFiles: ["apps/a.ts"] }),
    work({ id: "blocked", state: "BLOCKED_HUMAN", priority: "P0", createdAt: 1_000, touchedFiles: ["apps/b.ts"] }),
    work({
      id: "claimed",
      state: "CLAIMED",
      createdAt: 2_000,
      canonicalOwner: "core",
      touchedFiles: ["apps/c.ts"],
      claim: { owner: "core", requestId: "claim-1", claimedAt: 2_000, leaseExpiresAt: 5_000 },
    }),
  ]);
  const workPortfolio = buildEngineeringWorkPortfolio([
    packageInput("a", ["apps/shared.ts"]),
    packageInput("b", ["apps/shared.ts"]),
  ]);
  const eventLatencyReceipts: readonly NusaEventToNextActionReceipt[] = [
    { receiptId: "latency-1", sourceEventId: "source-1", sourceOccurredAt: 1_000, nextActionObservedAt: 1_003, sourceFingerprint: FP },
    { receiptId: "latency-2", sourceEventId: "source-2", sourceOccurredAt: 2_000, nextActionObservedAt: 2_004, sourceFingerprint: "c".repeat(64) },
  ];
  const agentHeartbeatReceipts: readonly NusaAgentHeartbeatReceipt[] = [
    { agentId: "core", lastHeartbeatAt: 9_500, heartbeatTtlMs: 1_000, sourceFingerprint: "d".repeat(64) },
    { agentId: "audit", lastHeartbeatAt: 1_000, heartbeatTtlMs: 1_000, sourceFingerprint: "e".repeat(64) },
  ];
  return {
    queue,
    eventHistory: [
      event("merge-1", "PR_MERGED", "merged", 4_000),
      event("block-1", "HUMAN_BLOCKED", "blocked", 5_000),
    ],
    eventHistoryStartedAt: 0,
    ciTelemetry: ciTelemetry(),
    mergeReworkTelemetry: reworkTelemetry(),
    workPortfolio,
    eventLatencyReceipts,
    agentHeartbeatReceipts,
    windowStartedAt: 0,
    asOf: 10_000,
  };
}

describe("buildNusaDevelopmentHealthSlo", () => {
  it("projects a complete #903 health SLO only from explicit evidence", () => {
    const snapshot = buildNusaDevelopmentHealthSlo(fullInput());
    assert.equal(snapshot.status, "MEASURED");
    assert.deepEqual(snapshot.reasons, []);
    assert.deepEqual(snapshot.metrics.queueAgeMs, { status: "MEASURED", value: 9_000 });
    assert.deepEqual(snapshot.metrics.oldestP0P1WaitMs, { status: "MEASURED", value: 9_000 });
    assert.deepEqual(snapshot.metrics.ciP50Ms, { status: "MEASURED", value: 100 });
    assert.deepEqual(snapshot.metrics.ciP95Ms, { status: "MEASURED", value: 200 });
    assert.deepEqual(snapshot.metrics.eventToNextActionP50Ms, { status: "MEASURED", value: 3 });
    assert.deepEqual(snapshot.metrics.eventToNextActionP95Ms, { status: "MEASURED", value: 4 });
    assert.deepEqual(snapshot.metrics.stalledClaimCount, { status: "MEASURED", value: 1 });
    assert.deepEqual(snapshot.metrics.stalledAgentCount, { status: "MEASURED", value: 1 });
    assert.deepEqual(snapshot.metrics.duplicateWorkRate, { status: "MEASURED", value: 0 });
    assert.deepEqual(snapshot.metrics.conflictRate, { status: "MEASURED", value: 1 });
    assert.deepEqual(snapshot.metrics.staleHeadReworkRate, { status: "MEASURED", value: 0.5 });
    assert.equal(snapshot.metrics.mergeThroughputPerHour.status, "MEASURED");
    assert.equal(snapshot.metrics.blockedTimeRatio.status, "MEASURED");
    if (snapshot.metrics.blockedTimeRatio.status === "MEASURED") {
      assert.equal(snapshot.metrics.blockedTimeRatio.value, 5_000 / 21_000);
    }
  });

  it("keeps unsupported or missing evidence UNKNOWN instead of estimating it", () => {
    const base = fullInput();
    const snapshot = buildNusaDevelopmentHealthSlo({
      ...base,
      eventHistoryStartedAt: null,
      ciTelemetry: null,
      mergeReworkTelemetry: null,
      workPortfolio: null,
      eventLatencyReceipts: [],
      agentHeartbeatReceipts: [],
    });
    assert.equal(snapshot.status, "PARTIAL");
    assert.equal(snapshot.metrics.queueAgeMs.status, "MEASURED");
    assert.equal(snapshot.metrics.stalledClaimCount.status, "MEASURED");
    assert.equal(snapshot.metrics.ciP50Ms.status, "UNKNOWN");
    assert.equal(snapshot.metrics.eventToNextActionP50Ms.status, "UNKNOWN");
    assert.equal(snapshot.metrics.mergeThroughputPerHour.status, "UNKNOWN");
    assert.equal(snapshot.metrics.blockedTimeRatio.status, "UNKNOWN");
    assert.equal(snapshot.metrics.stalledAgentCount.status, "UNKNOWN");
    assert.equal(snapshot.metrics.duplicateWorkRate.status, "UNKNOWN");
    assert.equal(snapshot.metrics.staleHeadReworkRate.status, "UNKNOWN");
  });

  it("refuses to publish a stale-head rework rate while UNKNOWN observations remain", () => {
    const base = fullInput();
    const snapshot = buildNusaDevelopmentHealthSlo({ ...base, mergeReworkTelemetry: reworkTelemetry(1) });
    assert.deepEqual(snapshot.metrics.staleHeadReworkRate, {
      status: "UNKNOWN",
      value: null,
      reason: "MERGE_REWORK_UNKNOWN_OBSERVATIONS_PRESENT",
    });
  });

  it("fails closed on negative event-to-next-action latency", () => {
    const base = fullInput();
    assert.throws(() => buildNusaDevelopmentHealthSlo({
      ...base,
      eventLatencyReceipts: [{
        receiptId: "bad-latency",
        sourceEventId: "source",
        sourceOccurredAt: 2_000,
        nextActionObservedAt: 1_999,
        sourceFingerprint: FP,
      }],
    }), /SLO_EVENT_LATENCY_NEGATIVE:bad-latency/);
  });

  it("does not fabricate blocked time when a blocked queue item lacks its transition event", () => {
    const base = fullInput();
    const snapshot = buildNusaDevelopmentHealthSlo({
      ...base,
      eventHistory: base.eventHistory.filter((entry) => entry.type !== "HUMAN_BLOCKED"),
    });
    assert.deepEqual(snapshot.metrics.blockedTimeRatio, {
      status: "UNKNOWN",
      value: null,
      reason: "HUMAN_BLOCK_EVENT_MISSING:blocked",
    });
  });

  it("rejects duplicate agent heartbeat identities", () => {
    const base = fullInput();
    const first = base.agentHeartbeatReceipts[0]!;
    assert.throws(() => buildNusaDevelopmentHealthSlo({
      ...base,
      agentHeartbeatReceipts: [first, { ...first, sourceFingerprint: "f".repeat(64) }],
    }), /SLO_AGENT_HEARTBEAT_DUPLICATE:core/);
  });

  it("rejects event history that contradicts its declared completeness boundary", () => {
    const base = fullInput();
    assert.throws(() => buildNusaDevelopmentHealthSlo({
      ...base,
      eventHistoryStartedAt: 4_500,
    }), /SLO_EVENT_PRECEDES_HISTORY_START:merge-1/);
  });

  it("rejects queue chronology that would produce a negative age", () => {
    const base = fullInput();
    const queue = createNusaDevelopmentQueue([work({ id: "future", createdAt: 10_001 })]);
    assert.throws(() => buildNusaDevelopmentHealthSlo({ ...base, queue }), /SLO_WORK_CREATED_AT_INVALID:future/);
  });

  it("rejects duplicate canonical event identities", () => {
    const base = fullInput();
    assert.throws(() => buildNusaDevelopmentHealthSlo({
      ...base,
      eventHistory: [base.eventHistory[0]!, base.eventHistory[0]!],
    }), /SLO_EVENT_ID_DUPLICATE:merge-1/);
  });
});
