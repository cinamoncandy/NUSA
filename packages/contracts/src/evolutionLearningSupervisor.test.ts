import test from "node:test";
import assert from "node:assert/strict";
import { validateEvolutionLearningSupervisorSnapshot } from "./evolutionLearningSupervisor";

const learningRecord = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const snapshot = () => ({
  schemaVersion: 1,
  scope: "EVOLUTION_LEARNING_EVIDENCE_ONLY",
  authority: "READ_ONLY",
  aiAuthority: "ZERO_AUTHORITY",
  liveAuthority: "NONE",
  productionMutationAllowed: false,
  eventCount: 1,
  headHash: "a".repeat(64),
  latest: learningRecord(),
});

test("accepts evidence-only zero-authority supervisor learning snapshot", () => {
  const result = validateEvolutionLearningSupervisorSnapshot(snapshot());
  assert.equal(result.authority, "READ_ONLY");
  assert.equal(result.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(result.liveAuthority, "NONE");
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.latest?.outcome, "PARTIAL_SUCCESS");
  assert.deepEqual(result.recent, [result.latest]);
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
  assert.deepEqual(empty.recent, []);
});

test("accepts at most five recent records newest first and requires latest identity first", () => {
  const latest = learningRecord();
  const prior = learningRecord({
    opportunityId: "op-0",
    changeReference: "commit:prior",
    recordedAt: "2026-08-29T11:00:00.000Z",
    outcome: "SUCCESS",
  });
  const result = validateEvolutionLearningSupervisorSnapshot({
    ...snapshot(),
    eventCount: 2,
    latest,
    recent: [latest, prior],
  });
  assert.equal(result.recent?.length, 2);
  assert.equal(result.recent?.[1]?.opportunityId, "op-0");

  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({
    ...snapshot(),
    eventCount: 2,
    latest,
    recent: [prior, latest],
  }), /start with latest/);

  assert.throws(() => validateEvolutionLearningSupervisorSnapshot({
    ...snapshot(),
    eventCount: 6,
    latest,
    recent: Array.from({ length: 6 }, (_, index) => learningRecord({
      opportunityId: `op-${index}`,
      changeReference: `commit:${index}`,
      recordedAt: new Date(Date.parse("2026-08-29T12:00:00.000Z") - index * 1000).toISOString(),
    })),
  }), /bounded history/);
});
