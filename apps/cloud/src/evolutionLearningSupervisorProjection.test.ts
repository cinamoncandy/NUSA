import assert from "node:assert/strict";
import test from "node:test";
import { buildEvolutionLearningSupervisorSnapshot } from "./evolutionLearningSupervisorProjection";

const record = Object.freeze({
  opportunityId: "op-1",
  problem: "Observed regression",
  evidenceReferences: Object.freeze(["evidence:1"]),
  hypothesis: "Bound the change",
  changeReference: "commit:abc",
  validationStatus: "VERIFIED",
  outcome: "SUCCESS" as const,
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt: "2026-08-29T12:00:00.000Z",
});

test("preserves verified ledger provenance without recomputing evidence", () => {
  const snapshot = buildEvolutionLearningSupervisorSnapshot(Object.freeze({
    schemaVersion: 1 as const,
    records: Object.freeze([record]),
    eventCount: 1,
    headHash: "a".repeat(64),
  }));
  assert.equal(snapshot.eventCount, 1);
  assert.equal(snapshot.headHash, "a".repeat(64));
  assert.deepEqual(snapshot.latest, record);
  assert.equal(snapshot.authority, "READ_ONLY");
  assert.equal(snapshot.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(snapshot.liveAuthority, "NONE");
  assert.equal(snapshot.productionMutationAllowed, false);
});

test("projects an empty verified ledger truthfully", () => {
  const snapshot = buildEvolutionLearningSupervisorSnapshot(Object.freeze({
    schemaVersion: 1 as const,
    records: Object.freeze([]),
    eventCount: 0,
    headHash: "0".repeat(64),
  }));
  assert.equal(snapshot.eventCount, 0);
  assert.equal(snapshot.latest, null);
});

test("fails closed when replay metadata is inconsistent", () => {
  assert.throws(() => buildEvolutionLearningSupervisorSnapshot(Object.freeze({
    schemaVersion: 1 as const,
    records: Object.freeze([]),
    eventCount: 1,
    headHash: "0".repeat(64),
  })));
});
