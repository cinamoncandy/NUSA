import test from "node:test";
import assert from "node:assert/strict";
import { validateEvolutionLearningSupervisorSnapshot } from "./evolutionLearningSupervisor";

const snapshot = () => ({
  schemaVersion: 1,
  scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY",
  authority: "READ_ONLY",
  aiAuthority: "ZERO_AUTHORITY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  eventCount: 1,
  headHash: "a".repeat(64),
  latest: {
    opportunityId: "op-1",
    problem: "Observed regression",
    hypothesis: "Bound the change",
    outcome: "PARTIAL_SUCCESS",
    validationStatus: "VERIFIED",
    evidenceReferences: ["evidence:1"],
    changeReference: "commit:abc",
    failureReason: null,
    rollbackReference: null,
    reusable: true,
    recordedAt: "2026-08-29T12:00:00.000Z",
  },
});

test("accepts evidence-only zero-authority supervisor learning snapshot", () => {
  const result = validateEvolutionLearningSupervisorSnapshot(snapshot());
  assert.equal(result.authority, "READ_ONLY");
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.latest?.outcome, "PARTIAL_SUCCESS");
});

test("fails closed on authority escalation", () => {
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), authority: "WRITE" }), /READ_ONLY/);
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), aiAuthority: "EXECUTE" }), /ZERO_AUTHORITY/);
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), liveAuthority: "LIMITED" }), /NONE/);
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), productionMutationAllowed: true }), /false/);
});

test("requires evidence consistency between ledger count and latest record", () => {
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), eventCount: 0 }), /empty ledger/);
  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), latest: null }), /requires latest evidence/);
  const empty = validateEvolutionLearningSupervisorSnapshot({ ...snapshot(), eventCount: 0, latest: null });
  assert.equal(empty.latest, null);
});
