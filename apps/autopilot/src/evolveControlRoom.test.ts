import assert from "node:assert/strict";
import { test } from "node:test";
import { createEvolutionControlSnapshot } from "./evolveControlRoom";

const baseInput = () => ({
  generatedAt: "2026-08-29T00:00:00.000Z",
  activeExecutions: 0,
  queuedOpportunities: 1,
  circuitOpen: false,
  lastOutcome: "idle",
});

test("control snapshot preserves validated runtime state and authority", () => {
  const snapshot = createEvolutionControlSnapshot(baseInput());
  assert.equal(snapshot.circuitOpen, false);
  assert.equal(snapshot.lastOutcome, "idle");
  assert.equal(snapshot.authority.liveAuthority, "NONE");
  assert.equal(snapshot.authority.productionMutationAllowed, false);
  assert.equal(snapshot.authority.aiAuthority, "ZERO_AUTHORITY");
});

test("control snapshot rejects malformed circuit state", () => {
  assert.throws(
    () => createEvolutionControlSnapshot({ ...baseInput(), circuitOpen: "false" as never }),
    /EVOLVE_CONTROL_CIRCUIT_INVALID/,
  );
});

test("control snapshot rejects malformed outcome values", () => {
  assert.throws(
    () => createEvolutionControlSnapshot({ ...baseInput(), lastOutcome: "   " }),
    /EVOLVE_CONTROL_OUTCOME_INVALID/,
  );
  assert.throws(
    () => createEvolutionControlSnapshot({ ...baseInput(), lastOutcome: "x".repeat(81) }),
    /EVOLVE_CONTROL_OUTCOME_INVALID/,
  );
});