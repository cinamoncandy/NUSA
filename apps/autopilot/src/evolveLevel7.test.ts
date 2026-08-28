import assert from "node:assert/strict";
import test from "node:test";
import { coordinateLevel7Evolution, type EvolutionLevel7Input } from "./evolveLevel7";
import type { EvolutionLearningMemoryRepository, EvolutionLearningRecord } from "./evolveLearningMemory";
import type { EvolutionOpportunity } from "./evolveOpportunity";

const HEAD = "3333333333333333333333333333333333333333";

const opportunity = (id: string, impact: number): EvolutionOpportunity => ({
  id,
  source: "control-room",
  problem: `Improve ${id}`,
  evidence: [{ source: "ci", reference: `ci:${id}`, quality: 1 }],
  impact,
  confidence: 0.9,
  risk: 0.2,
  reversibility: 0.9,
  status: "DISCOVERED",
  createdAt: "2026-08-29T00:00:00.000Z",
});

function baseInput(): EvolutionLevel7Input {
  return {
    opportunities: [opportunity("opp:lower", 0.4), opportunity("opp:higher", 0.9)],
    lifecycle: {
      execution: {
        executionId: "exec:level7:1",
        dedupeKey: "dedupe:level7:1",
        repository: "cinamoncandy/NUSA",
        headSha: HEAD,
        authority: "ZERO_AUTHORITY",
      },
      validation: {
        opportunityId: "opp:higher",
        status: "PASS",
        exactHeadSha: HEAD,
        evidence: [{ check: "ci", reference: "ci:level7", passed: true }],
        reason: "exact-head-pass",
      },
      targetBranch: "main",
      observation: { revision: HEAD, health: true, errors: 0, latencyMs: 10 },
      outcome: {
        expectedMetric: 100,
        actualMetric: 100,
        evidence: ["health:exact-revision"],
        observedAt: "2026-08-29T00:05:00.000Z",
      },
      changeReference: "pr:level7",
      rollbackReference: "revert:level7",
      recovery: { failureClass: "UNKNOWN", attempts: 0, rollbackEvidence: false },
      circuit: {
        state: { state: "CLOSED", consecutiveFailures: 0 },
        policy: { maxFailures: 2, cooldownSeconds: 60 },
        now: "2026-08-29T00:05:00.000Z",
      },
      schedule: {
        policy: { mode: "AUTONOMOUS", minIntervalSeconds: 60, maxConcurrent: 1 },
        activeExecutions: 0,
        elapsedSecondsSinceLastRun: 120,
        queuedOpportunities: 2,
        generatedAt: "2026-08-29T00:05:00.000Z",
      },
    },
  };
}

test("Level 7 selects the highest bounded candidate and feeds the existing lifecycle", () => {
  const result = coordinateLevel7Evolution(baseInput());
  assert.equal(result.status, "COORDINATED");
  assert.equal(result.selection.selectedOpportunity?.id, "opp:higher");
  assert.equal(result.lifecycle?.status, "COMPLETED");
  assert.equal(result.lifecycle?.execution.executionId, "exec:level7:1");
  assert.equal(result.lifecycle?.execution.dedupeKey, "dedupe:level7:1");
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  assert.equal(Object.isFrozen(result), true);
});

test("Level 7 does not enter the lifecycle while the circuit is open", () => {
  const input = baseInput();
  const result = coordinateLevel7Evolution({
    ...input,
    lifecycle: {
      ...input.lifecycle,
      circuit: {
        ...input.lifecycle.circuit,
        state: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" },
      },
    },
  });
  assert.equal(result.status, "NO_SELECTION");
  assert.equal(result.lifecycle, null);
  assert.equal(result.reason, "circuit-open");
});

test("Level 7 does not enter the lifecycle when autonomous scheduling is denied", () => {
  const input = baseInput();
  const result = coordinateLevel7Evolution({
    ...input,
    lifecycle: {
      ...input.lifecycle,
      schedule: { ...input.lifecycle.schedule, elapsedSecondsSinceLastRun: 10 },
    },
  });
  assert.equal(result.status, "NO_SELECTION");
  assert.equal(result.lifecycle, null);
  assert.equal(result.reason, "minimum-interval-not-reached");
});

test("Level 7 preserves stale exact-head fail-closed behavior", () => {
  const input = baseInput();
  const result = coordinateLevel7Evolution({
    ...input,
    lifecycle: {
      ...input.lifecycle,
      validation: {
        ...input.lifecycle.validation,
        exactHeadSha: "4444444444444444444444444444444444444444",
      },
    },
  });
  assert.equal(result.status, "COORDINATED");
  assert.equal(result.lifecycle?.status, "ABSTAINED");
  assert.equal(result.lifecycle?.reason, "stale-exact-head");
  assert.equal(result.lifecycle?.promotion.eligible, false);
});

test("Level 7 fails closed if validation evidence belongs to a different selected opportunity", () => {
  const input = baseInput();
  const result = coordinateLevel7Evolution({
    ...input,
    lifecycle: {
      ...input.lifecycle,
      validation: { ...input.lifecycle.validation, opportunityId: "opp:lower" },
    },
  });
  assert.equal(result.status, "COORDINATED");
  assert.equal(result.lifecycle?.status, "ABSTAINED");
  assert.equal(result.lifecycle?.reason, "validation-opportunity-mismatch");
});

test("Level 7 persists only the existing lifecycle learning record through an injected evidence sink", () => {
  const input = baseInput();
  const persistedRecords: EvolutionLearningRecord[] = [];
  const learningMemory: EvolutionLearningMemoryRepository = {
    append(record) { persistedRecords.push(record); },
    list() { return persistedRecords; },
  };
  const result = coordinateLevel7Evolution({ ...input, learningMemory });
  assert.equal(result.lifecycle?.status, "COMPLETED");
  assert.equal(persistedRecords.length, 1);
  assert.equal(persistedRecords[0]?.opportunityId, "opp:higher");
});

test("Level 7 does not report a cycle when injected learning persistence fails", () => {
  const input = baseInput();
  const learningMemory = {
    append() { throw new Error("storage unavailable"); },
    list() { return []; },
  } satisfies NonNullable<EvolutionLevel7Input["learningMemory"]>;
  assert.throws(() => coordinateLevel7Evolution({ ...input, learningMemory }), /EVOLVE_LEARNING_PERSISTENCE_FAILED/);
});
