import assert from "node:assert/strict";
import { test } from "node:test";
import { coordinateEvolutionLifecycle, type EvolutionLifecycleInput } from "./evolveLifecycle";

const HEAD = "1111111111111111111111111111111111111111";

function baseInput(): EvolutionLifecycleInput {
  return {
    opportunity: {
      id: "opp:full-loop:1",
      source: "control-room",
      problem: "Repeated bounded validation latency",
      evidence: [{ source: "ci", reference: "ci:6096", quality: 1 }],
      impact: 0.8,
      confidence: 0.9,
      risk: 0.2,
      reversibility: 0.9,
      status: "DISCOVERED",
      createdAt: "2026-08-29T00:00:00.000Z",
    },
    execution: {
      executionId: "exec:full-loop:1",
      dedupeKey: "dedupe:full-loop:1",
      repository: "cinamoncandy/NUSA",
      headSha: HEAD,
      authority: "ZERO_AUTHORITY",
    },
    validation: {
      opportunityId: "opp:full-loop:1",
      status: "PASS",
      exactHeadSha: HEAD,
      evidence: [{ check: "ci", reference: "ci:6096", passed: true }],
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
    changeReference: "pr:full-loop",
    rollbackReference: "revert:full-loop",
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

test("evolve lifecycle composes a complete zero-authority loop", () => {
  const result = coordinateEvolutionLifecycle(baseInput());
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.promotion.eligible, true);
  assert.equal(result.observation?.status, "HEALTHY");
  assert.equal(result.outcome?.outcome, "SUCCESS");
  assert.equal(result.learning?.reusable, true);
  assert.equal(result.control.authority.liveAuthority, "NONE");
  assert.equal(result.control.authority.productionMutationAllowed, false);
  assert.equal(result.control.authority.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(Object.isFrozen(result), true);
});

test("evolve lifecycle fails closed on stale exact head", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    validation: { ...input.validation, exactHeadSha: "2222222222222222222222222222222222222222" },
  });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.promotion.eligible, false);
  assert.equal(result.reason, "stale-exact-head");
  assert.equal(result.learning, undefined);
});

test("evolve lifecycle routes validation failure into bounded recovery", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    validation: { ...input.validation, status: "FAIL", reason: "focused-regression-failed" },
    recovery: { failureClass: "KNOWN_TRANSIENT", attempts: 0, rollbackEvidence: false },
  });
  assert.equal(result.status, "RECOVERING");
  assert.equal(result.promotion.eligible, false);
  assert.equal(result.recovery?.action, "RETRY");
  assert.equal(result.circuit.consecutiveFailures, 1);
});

test("evolve lifecycle opens circuit after repeated blocked validation", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    validation: { ...input.validation, status: "FAIL", reason: "repeated-regression" },
    recovery: { failureClass: "UNKNOWN", attempts: 2, rollbackEvidence: false },
    circuit: {
      ...input.circuit,
      state: { state: "CLOSED", consecutiveFailures: 1 },
    },
  });
  assert.equal(result.status, "CIRCUIT_OPEN");
  assert.equal(result.circuit.state, "OPEN");
  assert.equal(result.control.circuitOpen, true);
});

test("evolve lifecycle refuses execution while circuit is already open", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    circuit: {
      ...input.circuit,
      state: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" },
    },
  });
  assert.equal(result.status, "CIRCUIT_OPEN");
  assert.equal(result.promotion.eligible, false);
  assert.equal(result.reason, "circuit-open");
});

test("evolve lifecycle refuses execution outside the autonomous schedule window", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    schedule: { ...input.schedule, elapsedSecondsSinceLastRun: 10 },
  });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.schedule.allowed, false);
  assert.equal(result.reason, "schedule-blocked:minimum-interval-not-reached");
});

test("evolve lifecycle fails closed when observed runtime revision differs from exact head", () => {
  const input = baseInput();
  const result = coordinateEvolutionLifecycle({
    ...input,
    observation: { ...input.observation, revision: "2222222222222222222222222222222222222222" },
  });
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, "runtime-revision-mismatch");
  assert.equal(result.learning, undefined);
});

test("evolve lifecycle rejects malformed circuit state before producing a result", () => {
  const input = baseInput();
  assert.throws(
    () => coordinateEvolutionLifecycle({
      ...input,
      circuit: {
        ...input.circuit,
        state: { state: "CLOSED", consecutiveFailures: "0" } as never,
      },
    }),
    /EVOLVE_CIRCUIT_FAILURE_COUNT_INVALID/,
  );
});
