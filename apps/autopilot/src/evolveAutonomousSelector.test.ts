import assert from "node:assert/strict";
import test from "node:test";
import { selectNextEvolutionOpportunity } from "./evolveAutonomousSelector";
import type { EvolutionOpportunity } from "./evolveOpportunity";

const opportunity = (id: string, overrides: Partial<EvolutionOpportunity> = {}): EvolutionOpportunity => ({
  id,
  source: "control-room",
  problem: `Improve ${id}`,
  evidence: [{ source: "ci", reference: `ci:${id}`, quality: 0.9 }],
  impact: 0.7,
  confidence: 0.8,
  risk: 0.2,
  reversibility: 0.9,
  status: "READY",
  createdAt: "2026-08-29T00:00:00.000Z",
  ...overrides,
});

const baseInput = () => ({
  opportunities: [
    opportunity("lower", { impact: 0.4 }),
    opportunity("higher", { impact: 0.9 }),
  ],
  circuit: { state: "CLOSED" as const, consecutiveFailures: 0 },
  schedulePolicy: { mode: "AUTONOMOUS" as const, minIntervalSeconds: 60, maxConcurrent: 1 },
  activeExecutions: 0,
  elapsedSecondsSinceLastRun: 120,
});

test("selects the highest eligible ranked opportunity without granting authority", () => {
  const result = selectNextEvolutionOpportunity(baseInput());
  assert.equal(result.selectedOpportunity?.id, "higher");
  assert.equal(result.priority?.opportunityId, "higher");
  assert.equal(result.reason, "bounded-autonomous-selection");
  assert.deepEqual(result.authority, {
    liveAuthority: "NONE",
    productionMutationAllowed: false,
    aiAuthority: "ZERO_AUTHORITY",
  });
  assert.equal(Object.isFrozen(result), true);
});

test("fails closed when the circuit is open", () => {
  const input = baseInput();
  const result = selectNextEvolutionOpportunity({
    ...input,
    circuit: { state: "OPEN", consecutiveFailures: 2, openedAt: "2026-08-29T00:00:00.000Z" },
  });
  assert.equal(result.selectedOpportunity, null);
  assert.equal(result.reason, "circuit-open");
});

test("fails closed when autonomous scheduling is denied", () => {
  const input = baseInput();
  const result = selectNextEvolutionOpportunity({ ...input, elapsedSecondsSinceLastRun: 10 });
  assert.equal(result.selectedOpportunity, null);
  assert.equal(result.reason, "minimum-interval-not-reached");
});

test("never selects rejected or otherwise ineligible opportunities", () => {
  const input = baseInput();
  const result = selectNextEvolutionOpportunity({
    ...input,
    opportunities: [opportunity("rejected", { status: "REJECTED", impact: 1, risk: 0.05 })],
  });
  assert.equal(result.selectedOpportunity, null);
  assert.equal(result.reason, "no-eligible-opportunity");
});

test("uses deterministic opportunity id ordering to break equal scores", () => {
  const input = baseInput();
  const result = selectNextEvolutionOpportunity({
    ...input,
    opportunities: [opportunity("b"), opportunity("a")],
  });
  assert.equal(result.selectedOpportunity?.id, "a");
});
