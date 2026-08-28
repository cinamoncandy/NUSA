import assert from "node:assert/strict";
import { test } from "node:test";
import { createExecutionState } from "./autonomousExecutionState";
import { runEvolutionLifecycle } from "./evolveLifecycle";
import { validateEvolutionOpportunity } from "./evolveOpportunity";

const headSha = "a".repeat(40);
const opportunity = validateEvolutionOpportunity({
  id: "opp:lifecycle:1",
  source: "control-room",
  problem: "A bounded lifecycle needs evidence-driven coordination.",
  evidence: [{ source: "ci", reference: "run:1", quality: 0.9 }],
  impact: 0.8,
  confidence: 0.9,
  risk: 0.2,
  reversibility: 0.9,
  status: "READY",
  createdAt: "2026-08-29T00:00:00.000Z",
});

const handlers = (overrides: Partial<Parameters<typeof runEvolutionLifecycle>[0]["handlers"]> = {}) => ({
  execute: () => ({ status: "COMPLETED" as const, exactHeadSha: headSha, evidence: ["handoff:verified"], reason: "canonical-handoff" }),
  validate: () => ({ opportunityId: opportunity.id, status: "PASS" as const, exactHeadSha: headSha, evidence: [{ check: "ci", reference: "run:1", passed: true }], reason: "all-required-checks-pass" }),
  observe: () => ({ revision: headSha, health: true, errors: 0, latencyMs: 10 }),
  evaluate: () => ({ opportunityId: opportunity.id, expectedMetric: 1, actualMetric: 1, evidence: ["observation:healthy"], observedAt: "2026-08-29T00:00:00.000Z" }),
  learn: () => ({ opportunityId: opportunity.id, problem: opportunity.problem, evidenceReferences: ["run:1"], hypothesis: "Lifecycle remains bounded.", changeReference: "pr:lifecycle", validationStatus: "PASS", outcome: "SUCCESS" as const, failureReason: null, rollbackReference: "revert:lifecycle", reusable: true, recordedAt: "2026-08-29T00:00:00.000Z" }),
  ...overrides,
});

const base = (overrides: Partial<Parameters<typeof runEvolutionLifecycle>[0]> = {}) => ({
  opportunity,
  repository: "cinamoncandy/NUSA",
  headSha,
  targetBranch: "main",
  executionId: "exec:lifecycle:1",
  dedupeKey: "dedupe:lifecycle:1",
  authority: "ZERO_AUTHORITY" as const,
  now: "2026-08-29T00:00:00.000Z",
  handlers: handlers(),
  ...overrides,
});

test("runs the complete lifecycle through learning without mutation authority", async () => {
  const result = await runEvolutionLifecycle(base());
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(result.events.map((event) => event.phase), ["DISCOVERED", "ANALYZING", "PLANNED", "READY", "EXECUTING", "VALIDATING", "PROMOTING", "OBSERVING", "EVALUATING", "LEARNING", "COMPLETED"]);
  assert.equal(result.envelope?.liveAuthority, "NONE");
  assert.equal(result.envelope?.productionMutationAllowed, false);
  assert.equal(result.envelope?.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.learning?.outcome, "SUCCESS");
});

test("fails closed on stale validation and never promotes", async () => {
  const result = await runEvolutionLifecycle(base({ handlers: handlers({ validate: () => ({ opportunityId: opportunity.id, status: "PASS" as const, exactHeadSha: "b".repeat(40), evidence: [{ check: "ci", reference: "run:1", passed: true }], reason: "stale" }) }) }));
  assert.equal(result.status, "FAILED");
  assert.equal(result.reason, "stale-exact-head");
  assert.equal(result.promotion, null);
});

test("abstains when validation is insufficient", async () => {
  const result = await runEvolutionLifecycle(base({ handlers: handlers({ validate: () => ({ opportunityId: opportunity.id, status: "INSUFFICIENT" as const, exactHeadSha: headSha, evidence: [{ check: "evidence", reference: "none", passed: false }], reason: "insufficient-evidence" }) }) }));
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.promotion?.eligible, false);
  assert.equal(result.observation, null);
});

test("suppresses a duplicate active execution before calling the handoff", async () => {
  let calls = 0;
  const active = createExecutionState({ cycleId: `evolve:${opportunity.id}`, workItemId: `evolve:${opportunity.id}:${headSha}`, executionId: "exec:lifecycle:1", dedupeKey: "dedupe:lifecycle:1" });
  const result = await runEvolutionLifecycle(base({ activeExecutions: [active], handlers: handlers({ execute: () => { calls += 1; return { status: "COMPLETED", exactHeadSha: headSha, evidence: ["unexpected"], reason: "unexpected-handoff" }; } }) }));
  assert.equal(result.status, "ABSTAINED");
  assert.equal(result.reason, "duplicate-execution-suppressed");
  assert.equal(calls, 0);
});

test("bounds transient execution recovery", async () => {
  let calls = 0;
  const result = await runEvolutionLifecycle(base({ handlers: handlers({ execute: () => { calls += 1; return { status: "FAILED" as const, exactHeadSha: headSha, evidence: ["transient"], reason: "network", failureClass: "KNOWN_TRANSIENT" as const }; } }) }));
  assert.equal(result.status, "FAILED");
  assert.equal(calls, 3);
  assert.equal(result.events.filter((event) => event.phase === "RECOVERING").length, 3);
});

test("stays fail-closed while a circuit is open", async () => {
  let calls = 0;
  const result = await runEvolutionLifecycle(base({
    circuit: { policy: { maxFailures: 2, cooldownSeconds: 60 }, state: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" } },
    handlers: handlers({ execute: () => { calls += 1; return { status: "COMPLETED", exactHeadSha: headSha, evidence: ["unexpected"], reason: "unexpected-handoff" }; } }),
  }));
  assert.equal(result.status, "CIRCUIT_OPEN");
  assert.equal(calls, 0);
});

test("rejects an authority mismatch at the existing execution boundary", async () => {
  await assert.rejects(() => runEvolutionLifecycle(base({ authority: "LIVE" as "ZERO_AUTHORITY" })), /EVOLVE_EXECUTION_AUTHORITY_INVALID/);
});

test("marks a post-change regression as failed without changing the envelope", async () => {
  const result = await runEvolutionLifecycle(base({ handlers: handlers({ observe: () => ({ revision: headSha, health: false, errors: 1, latencyMs: null }) }) }));
  assert.equal(result.status, "FAILED");
  assert.equal(result.reason, "post-change-observation-failed");
  assert.equal(result.envelope?.productionMutationAllowed, false);
});
