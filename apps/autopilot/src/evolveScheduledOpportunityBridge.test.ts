import assert from "node:assert/strict";
import test from "node:test";
import { coordinateScheduledEvolution } from "./evolveScheduledOpportunityBridge";
import type { EvolutionLearningMemoryRepository, EvolutionLearningRecord } from "./evolveLearningMemory";

const HEAD = "1111111111111111111111111111111111111111";
const OPPORTUNITY_ID = `gha:ci:${HEAD}:failure`;

function memory(): EvolutionLearningMemoryRepository {
  const records: EvolutionLearningRecord[] = [];
  return {
    append(record) { records.push(record); },
    list() { return records; },
  };
}

function baseInput() {
  return {
    evidence: {
      observedAt: "2026-08-29T04:10:00.000Z",
      maxAgeSeconds: 3600,
      observations: [{
        workflowName: "CI",
        runId: 33232627531,
        headSha: HEAD,
        conclusion: "failure" as const,
        completedAt: "2026-08-29T04:05:00.000Z",
      }],
    },
    level7: {
      learningMemory: memory(),
      lifecycle: {
        execution: {
          executionId: "exec:scheduled:1",
          dedupeKey: "dedupe:scheduled:1",
          repository: "cinamoncandy/NUSA",
          headSha: HEAD,
          authority: "ZERO_AUTHORITY" as const,
        },
        validation: {
          opportunityId: OPPORTUNITY_ID,
          status: "PASS" as const,
          exactHeadSha: HEAD,
          evidence: [{ check: "ci", reference: "ci:scheduled", passed: true }],
          reason: "exact-head-pass",
        },
        targetBranch: "main",
        observation: { revision: HEAD, health: true, errors: 0, latencyMs: 10 },
        outcome: {
          expectedMetric: 100,
          actualMetric: 100,
          evidence: ["health:exact-revision"],
          observedAt: "2026-08-29T04:10:00.000Z",
        },
        changeReference: "pr:scheduled",
        rollbackReference: "revert:scheduled",
        recovery: { failureClass: "UNKNOWN" as const, attempts: 0, rollbackEvidence: false },
        circuit: {
          state: { state: "CLOSED" as const, consecutiveFailures: 0 },
          policy: { maxFailures: 2, cooldownSeconds: 60 },
          now: "2026-08-29T04:10:00.000Z",
        },
        schedule: {
          policy: { mode: "AUTONOMOUS" as const, minIntervalSeconds: 60, maxConcurrent: 1 },
          activeExecutions: 0,
          elapsedSecondsSinceLastRun: 120,
          queuedOpportunities: 1,
          generatedAt: "2026-08-29T04:10:00.000Z",
        },
      },
    },
  };
}

test("feeds fresh workflow failure evidence into the existing Level 7 lifecycle", () => {
  const result = coordinateScheduledEvolution(baseInput());
  assert.equal(result.discovered, 1);
  assert.equal(result.level7.status, "COORDINATED");
  assert.equal(result.level7.selection.selectedOpportunity?.id, OPPORTUNITY_ID);
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
});

test("stale evidence produces no selection and no invented work", () => {
  const input = baseInput();
  const result = coordinateScheduledEvolution({
    ...input,
    evidence: { ...input.evidence, maxAgeSeconds: 60 },
  });
  assert.equal(result.discovered, 0);
  assert.equal(result.level7.status, "NO_SELECTION");
  assert.equal(result.level7.reason, "no-eligible-opportunity");
});
