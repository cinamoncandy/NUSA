import assert from "node:assert/strict";
import test from "node:test";
import { selectNextEvolutionOpportunity, selectNonConflictingEvolutionOpportunities } from "./evolveAutonomousSelector";
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

test("rejects malformed selector envelopes before runtime property access", () => {
  assert.throws(() => selectNextEvolutionOpportunity(null as never), /EVOLVE_SELECTION_INPUT_INVALID/);
  assert.throws(() => selectNextEvolutionOpportunity({ ...baseInput(), circuit: null } as never), /EVOLVE_SELECTION_CIRCUIT_INVALID/);
  assert.throws(() => selectNextEvolutionOpportunity({ ...baseInput(), schedulePolicy: null } as never), /EVOLVE_SELECTION_SCHEDULE_POLICY_INVALID/);
  assert.throws(() => selectNextEvolutionOpportunity({ ...baseInput(), opportunities: null } as never), /EVOLVE_SELECTION_OPPORTUNITIES_INVALID/);
  assert.throws(() => selectNextEvolutionOpportunity({
    ...baseInput(),
    opportunities: [null],
  } as never), /EVOLVE_OPPORTUNITY_INVALID/);
});


test("selects multiple independent opportunities deterministically without widening authority", () => {
  const input = baseInput();
  const result = selectNonConflictingEvolutionOpportunities({
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 3 },
    maxSelections: 3,
    opportunities: [
      opportunity("b", { canonicalOwner: "development", conflictKeys: ["module:beta"] }),
      opportunity("a", { canonicalOwner: "development", conflictKeys: ["module:alpha"] }),
      opportunity("c", { canonicalOwner: "ai-platform", conflictKeys: ["module:gamma"] }),
    ],
  });
  assert.deepEqual(result.selectedOpportunities.map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(result.authority, { liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" });
});

test("never selects two opportunities sharing a conflict key", () => {
  const input = baseInput();
  const result = selectNonConflictingEvolutionOpportunities({
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 3 },
    maxSelections: 3,
    opportunities: [
      opportunity("higher", { impact: 0.9, canonicalOwner: "development", conflictKeys: ["file:shared"] }),
      opportunity("lower", { impact: 0.4, canonicalOwner: "development", conflictKeys: ["file:shared"] }),
      opportunity("independent", { impact: 0.5, canonicalOwner: "development", conflictKeys: ["file:other"] }),
    ],
  });
  assert.deepEqual(result.selectedOpportunities.map((item) => item.id), ["higher", "independent"]);
});

test("multi-selection fails closed when ownership or conflict evidence is missing", () => {
  const input = baseInput();
  const result = selectNonConflictingEvolutionOpportunities({ ...input, maxSelections: 2 });
  assert.deepEqual(result.selectedOpportunities, []);
  assert.equal(result.reason, "no-non-conflicting-opportunity");
});

test("active conflict keys block overlapping work but preserve independent capacity", () => {
  const input = baseInput();
  const result = selectNonConflictingEvolutionOpportunities({
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 2 },
    maxSelections: 2,
    activeConflictKeys: ["module:busy"],
    opportunities: [
      opportunity("blocked", { impact: 1, canonicalOwner: "development", conflictKeys: ["module:busy"] }),
      opportunity("free", { canonicalOwner: "development", conflictKeys: ["module:free"] }),
    ],
  });
  assert.deepEqual(result.selectedOpportunities.map((item) => item.id), ["free"]);
});

test("clamps bounded selection to remaining scheduler capacity", () => {
  const input = baseInput();
  const result = selectNonConflictingEvolutionOpportunities({
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 3 },
    activeExecutions: 2,
    maxSelections: 3,
    opportunities: [
      opportunity("a", { canonicalOwner: "development", conflictKeys: ["module:a"] }),
      opportunity("b", { canonicalOwner: "development", conflictKeys: ["module:b"] }),
      opportunity("c", { canonicalOwner: "development", conflictKeys: ["module:c"] }),
    ],
  });
  assert.deepEqual(result.selectedOpportunities.map((item) => item.id), ["a"]);
});

test("rejects malformed or duplicate active conflict evidence", () => {
  const input = baseInput();
  const bounded = {
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 2 },
    maxSelections: 2,
    opportunities: [opportunity("a", { canonicalOwner: "development", conflictKeys: ["module:a"] })],
  };
  assert.throws(
    () => selectNonConflictingEvolutionOpportunities({ ...bounded, activeConflictKeys: ["bad key"] }),
    /EVOLVE_SELECTION_ACTIVE_CONFLICT_KEYS_INVALID/,
  );
  assert.throws(
    () => selectNonConflictingEvolutionOpportunities({ ...bounded, activeConflictKeys: ["module:busy", "module:busy"] }),
    /EVOLVE_SELECTION_ACTIVE_CONFLICT_KEYS_INVALID/,
  );
});


test("bounded selector rejects malformed envelopes and invalid CLOSED circuit state", () => {
  const input = baseInput();
  const bounded = {
    ...input,
    schedulePolicy: { ...input.schedulePolicy, maxConcurrent: 2 },
    maxSelections: 2,
    opportunities: [opportunity("a", { canonicalOwner: "development", conflictKeys: ["module:a"] })],
  };
  assert.throws(() => selectNonConflictingEvolutionOpportunities(null as never), /EVOLVE_SELECTION_INPUT_INVALID/);
  assert.throws(() => selectNonConflictingEvolutionOpportunities({ ...bounded, circuit: null } as never), /EVOLVE_SELECTION_CIRCUIT_INVALID/);
  assert.throws(() => selectNonConflictingEvolutionOpportunities({ ...bounded, schedulePolicy: null } as never), /EVOLVE_SELECTION_SCHEDULE_POLICY_INVALID/);
  assert.throws(() => selectNonConflictingEvolutionOpportunities({ ...bounded, opportunities: null } as never), /EVOLVE_SELECTION_OPPORTUNITIES_INVALID/);
  assert.throws(
    () => selectNonConflictingEvolutionOpportunities({ ...bounded, circuit: { state: "CLOSED", consecutiveFailures: -1 } } as never),
    /EVOLVE_CIRCUIT/,
  );
  assert.throws(
    () => selectNonConflictingEvolutionOpportunities({ ...bounded, opportunities: [null] } as never),
    /EVOLVE_OPPORTUNITY_INVALID/,
  );
});
