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

const historicalRecord = (index: number) => Object.freeze({
  ...record,
  opportunityId: `op-${index}`,
  changeReference: `commit:${index}`,
  recordedAt: new Date(Date.parse(record.recordedAt) - index * 60_000).toISOString(),
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
  assert.deepEqual(snapshot.recent, [record]);
  assert.equal(snapshot.authority, "READ_ONLY");
  assert.equal(snapshot.aiAuthority, "ZERO_AUTHORITY");
  assert.equal(snapshot.liveAuthority, "NONE");
  assert.equal(snapshot.productionMutationAllowed, false);
});

test("projects only the five most recent verified records newest first", () => {
  const records = Object.freeze(Array.from({ length: 7 }, (_, index) => historicalRecord(6 - index)));
  const snapshot = buildEvolutionLearningSupervisorSnapshot(Object.freeze({
    schemaVersion: 1 as const,
    records,
    eventCount: records.length,
    headHash: "b".repeat(64),
  }));
  assert.equal(snapshot.recent?.length, 5);
  assert.equal(snapshot.recent?.[0]?.opportunityId, "op-0");
  assert.equal(snapshot.recent?.[4]?.opportunityId, "op-4");
  assert.deepEqual(snapshot.latest, records.at(-1));
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
  assert.deepEqual(snapshot.recent, []);
});

test("fails closed when replay metadata is inconsistent", () => {
  assert.throws(() => buildEvolutionLearningSupervisorSnapshot(Object.freeze({
    schemaVersion: 1 as const,
    records: Object.freeze([]),
    eventCount: 1,
    headHash: "0".repeat(64),
  })));
});
