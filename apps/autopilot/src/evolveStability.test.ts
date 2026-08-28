import assert from "node:assert/strict";
import test from "node:test";
import { selectNextEvolutionOpportunity } from "./evolveAutonomousSelector";
import { createEvolutionExecutionEnvelope } from "./evolveExecutionAdapter";
import { coordinateEvolutionLifecycle, type EvolutionLifecycleInput } from "./evolveLifecycle";
import type { EvolutionOpportunity } from "./evolveOpportunity";
import { decideEvolutionRecovery } from "./evolveRecovery";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function lifecycleInput(): EvolutionLifecycleInput {
  return {
    opportunity: {
      id: "opp:stability",
      source: "control-room",
      problem: "Bounded stability validation",
      evidence: [{ source: "ci", reference: "ci:stability", quality: 1 }],
      impact: 0.8,
      confidence: 0.9,
      risk: 0.2,
      reversibility: 0.9,
      status: "DISCOVERED",
      createdAt: "2026-08-29T00:00:00.000Z",
    },
    execution: {
      executionId: "exec:stability",
      dedupeKey: "dedupe:stability",
      repository: "cinamoncandy/NUSA",
      headSha: HEAD,
      authority: "ZERO_AUTHORITY",
    },
    validation: {
      opportunityId: "opp:stability",
      status: "PASS",
      exactHeadSha: HEAD,
      evidence: [{ check: "ci", reference: "ci:stability", passed: true }],
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
    changeReference: "pr:stability",
    rollbackReference: "revert:stability",
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
      queuedOpportunities: 1,
      generatedAt: "2026-08-29T00:05:00.000Z",
    },
  };
}

test("repeated successful cycles remain deterministic and zero-authority", () => {
  const input = lifecycleInput();
  const fingerprints = new Set<string>();
  for (let i = 0; i < 100; i += 1) {
    const result = coordinateEvolutionLifecycle(input);
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.control.authority.liveAuthority, "NONE");
    assert.equal(result.control.authority.productionMutationAllowed, false);
    assert.equal(result.control.authority.aiAuthority, "ZERO_AUTHORITY");
    fingerprints.add(JSON.stringify({
      status: result.status,
      reason: result.reason,
      promotion: result.promotion,
      schedule: result.schedule,
      outcome: result.outcome?.outcome,
    }));
  }
  assert.equal(fingerprints.size, 1);
});

test("execution identity and dedupe key are preserved across repeated envelope construction", () => {
  const request = lifecycleInput().execution;
  const first = createEvolutionExecutionEnvelope(request);
  const second = createEvolutionExecutionEnvelope(request);
  assert.deepEqual(second, first);
  assert.equal(second.executionId, "exec:stability");
  assert.equal(second.dedupeKey, "dedupe:stability");
  assert.equal(second.liveAuthority, "NONE");
  assert.equal(second.productionMutationAllowed, false);
});

test("transient recovery exhausts after two bounded retries", () => {
  const first = decideEvolutionRecovery({ failureClass: "KNOWN_TRANSIENT", attempts: 0, rollbackEvidence: false });
  const second = decideEvolutionRecovery({ failureClass: "KNOWN_TRANSIENT", attempts: first.attempts, rollbackEvidence: false });
  const exhausted = decideEvolutionRecovery({ failureClass: "KNOWN_TRANSIENT", attempts: second.attempts, rollbackEvidence: false });
  assert.equal(first.action, "RETRY");
  assert.equal(second.action, "RETRY");
  assert.equal(exhausted.action, "ABSTAIN");
  assert.equal(exhausted.attempts, 2);
});

test("unknown recovery never retries without safe evidence", () => {
  for (const attempts of [0, 1, 2, 100]) {
    const decision = decideEvolutionRecovery({ failureClass: "UNKNOWN", attempts, rollbackEvidence: false });
    assert.equal(decision.action, "ABSTAIN");
    assert.equal(decision.attempts, attempts);
  }
});

test("open circuit remains fail-closed even after the scheduler window elapses", () => {
  const input = lifecycleInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    circuit: {
      ...input.circuit,
      state: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" },
      now: "2026-08-29T12:00:00.000Z",
    },
    schedule: { ...input.schedule, elapsedSecondsSinceLastRun: 43_200 },
  });
  assert.equal(result.status, "CIRCUIT_OPEN");
  assert.equal(result.reason, "circuit-open");
  assert.equal(result.schedule.allowed, true);
  assert.equal(result.promotion.eligible, false);
});

test("autonomous selection never bypasses an open circuit under repeated calls", () => {
  const opportunity = lifecycleInput().opportunity as EvolutionOpportunity;
  for (let i = 0; i < 100; i += 1) {
    const result = selectNextEvolutionOpportunity({
      opportunities: [opportunity],
      circuit: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" },
      schedulePolicy: { mode: "AUTONOMOUS", minIntervalSeconds: 1, maxConcurrent: 1 },
      activeExecutions: 0,
      elapsedSecondsSinceLastRun: 86_400,
    });
    assert.equal(result.selectedOpportunity, null);
    assert.equal(result.reason, "circuit-open");
    assert.equal(result.authority.liveAuthority, "NONE");
  }
});

test("stale exact head remains blocked across repeated lifecycle attempts", () => {
  const input = lifecycleInput();
  for (let i = 0; i < 25; i += 1) {
    const result = coordinateEvolutionLifecycle({
      ...input,
      validation: { ...input.validation, exactHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });
    assert.equal(result.status, "ABSTAINED");
    assert.equal(result.reason, "stale-exact-head");
    assert.equal(result.promotion.eligible, false);
    assert.equal(result.learning, undefined);
  }
});
