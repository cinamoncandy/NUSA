import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqlitePersistedPaperPeriodStore } from "../../../packages/storage/src/persistedPaperPeriodStore";
import { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { evolutionLedgerRetentionGuard } from "./closedLearningEvolutionLedgerRepository";
import { LearningInputSetLedger } from "./learningInputSetLedger";
import { buildLearningInputSet } from "./learningInputSet";

// A2 <-> A7 integration. Both the Learning Input Set ledger and the realized-period store are built
// over ONE SqliteDatabase, exactly as production wires them (runtime.ts passes the same
// `durableRepository.database()` to both). The retention guard is the real
// `evolutionLedgerRetentionGuard`, not a mock, and the retention call is the real `prune`.
//
// The property under proof is load-bearing for the whole v2 redesign: an input set that has been
// recorded must pin the realized PAPER periods its decision was built from, so the Learning Decision
// can never wake up to a receipt whose basis was silently pruned away.

const POLICIES = {
  learningPolicyVersion: "learn-v1",
  researchPolicyVersion: "research-v1",
  riskPolicyVersion: "risk-v1",
  governancePolicyVersion: "gov-v1",
};

/** Raw rows: retention reads only identity and chronology, and never decodes a payload. */
function seedPeriods(db: SqliteDatabase, recordIds: readonly string[]): void {
  const insert = db.connection.prepare("INSERT INTO research_paper_forward_periods (record_id, period_index, period_start_at, period_end_at, payload_json, checksum) VALUES (?, ?, ?, ?, '{}', 'x')");
  recordIds.forEach((recordId, index) => insert.run(recordId, index, 1_000 + index, 1_001 + index));
}

function retained(db: SqliteDatabase): string[] {
  return (db.connection.prepare("SELECT record_id FROM research_paper_forward_periods ORDER BY record_id ASC").all() as Array<{ record_id: string }>).map((row) => row.record_id);
}

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const periodStore = new SqlitePersistedPaperPeriodStore(db);
  const learningLedger = new SqliteEvolutionLearningLedger(db);
  return {
    db,
    periodStore,
    inputSets: new LearningInputSetLedger(learningLedger),
    // The production guard, derived from the production ledger, over the production database.
    guard: () => evolutionLedgerRetentionGuard(learningLedger),
    close: () => db.close(),
  };
}

const inputSetCiting = (...paperRecordIds: string[]) => buildLearningInputSet({
  cutoffTimestamp: 900,
  researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
  paperEvidence: paperRecordIds.map((recordId, index) => ({ recordId, recordedAt: 200 + index })),
  policies: POLICIES,
});

describe("A2 -> A7 integration over the production retention path", () => {
  it("a recorded input set pins the realized periods it cites against retention", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(db, ["p1", "p2", "p3", "p4", "p5"]);

      const receipt = inputSets.append(inputSetCiting("p1", "p2"));
      assert.equal(receipt.replayed, false, "first append records a new input set");
      assert.equal(Object.isFrozen(receipt.inputSet), true, "read-back input set is immutable");
      assert.equal(Object.isFrozen(receipt.inputSet.paperEvidenceRecordIds), true, "nested evidence arrays are immutable");
      assert.throws(() => { (receipt.inputSet.paperEvidenceRecordIds as string[]).push("forged"); }, TypeError);

      // The citation is durable in the ledger, in the exact form the guard reads.
      const references = inputSets.protectedPeriodReferences();
      assert.deepEqual([...references], ["paper-period:p1", "paper-period:p2"]);

      // Bound 2 would normally keep only p4 and p5, deleting p1..p3. p1 and p2 are cited, so they
      // survive; p3 is not cited and must still be pruned.
      const result = periodStore.prune(2, guard());
      assert.equal(result.deleted, 1, "only the unreferenced period past the bound is deleted");
      assert.deepEqual([...result.protectedRecordIds], ["p1", "p2"], "the guard reports exactly what it protected");
      assert.equal(result.bound, 2, "the owner-set bound is reported unchanged, never relaxed");
      assert.equal(result.boundReached, false, "the report says the bound did not hold");
      assert.deepEqual(retained(db), ["p1", "p2", "p4", "p5"], "cited periods survive; the unreferenced one does not");
    } finally {
      close();
    }
  });

  it("an unreferenced period is still prunable - protection is not blanket retention", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(db, ["p1", "p2", "p3"]);
      inputSets.append(inputSetCiting("p3"));
      // Bound 1 keeps the newest, p3, on recency alone. p1 and p2 are cited by nobody and must be
      // deleted: the guard narrows retention, it does not freeze the ledger.
      const result = periodStore.prune(1, guard());
      assert.equal(result.deleted, 2, "p1 and p2 are cited by nobody");
      assert.deepEqual([...result.protectedRecordIds], [], "nothing past the bound was cited, so nothing needed protecting");
      assert.deepEqual(retained(db), ["p3"]);
    } finally {
    close();
    }
  });

  it("a reference added after a retention is honoured by the next one", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(db, ["p1", "p2", "p3"]);
      // First retention knows of no citation yet.
      const before = periodStore.prune(2, guard());
      assert.equal(before.deleted, 1);
      assert.deepEqual(retained(db), ["p2", "p3"]);

      // p2 is now cited. The guard is resolved per retention, so the next call must protect it.
      inputSets.append(inputSetCiting("p2"));
      const after = periodStore.prune(1, guard());
      assert.equal(after.deleted, 0, "p3 is within the bound, p2 is cited, so nothing is deletable");
      assert.deepEqual([...after.protectedRecordIds], ["p2"]);
      assert.deepEqual(retained(db), ["p2", "p3"]);
    } finally {
      close();
    }
  });

  it("a citation of an already-absent period is reported dangling and never reconstructed", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(db, ["p1"]);
      // Cites a period that does not exist in the realized store.
      const receipt = inputSets.append(inputSetCiting("p1", "ghost-period"));
      assert.deepEqual([...receipt.inputSet.paperEvidenceRecordIds], ["ghost-period", "p1"]);

      const result = periodStore.prune(10, guard());
      assert.deepEqual([...result.danglingReferences], ["ghost-period"], "the missing basis is reported unverifiable");
      assert.equal(result.protectedRecordIds.length, 0);
      assert.equal(retained(db).length, 1, "no synthetic period is invented to satisfy the citation");
    } finally {
      close();
    }
  });

  it("re-appending the same input set adds no second citation and no second record", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(db, ["p1", "p2"]);
      const first = inputSets.append(inputSetCiting("p1"));
      const second = inputSets.append(inputSetCiting("p1"));
      assert.equal(second.replayed, true, "the second append is recognised as a replay");
      assert.equal(second.fingerprint, first.fingerprint);
      assert.equal(Object.isFrozen(second.inputSet), true, "replayed input set is immutable");
      assert.equal(Object.isFrozen(inputSets.summary().latest?.inputSet), true, "summary read-back input set is immutable");
      assert.equal(inputSets.summary().setsRecorded, 1, "exactly one durable input set");

      const result = periodStore.prune(1, guard());
      assert.equal(result.deleted, 0);
      assert.deepEqual([...result.protectedRecordIds], ["p1"]);
      assert.deepEqual(retained(db), ["p1", "p2"]);
    } finally {
      close();
    }
  });
});
