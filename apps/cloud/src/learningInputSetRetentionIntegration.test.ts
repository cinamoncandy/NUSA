import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SqliteDatabase } from "../../../packages/storage/src/index";
import { SqlitePersistedPaperPeriodStore } from "../../../packages/storage/src/persistedPaperPeriodStore";
import { MAX_EVOLUTION_LEARNING_LEDGER_RECORDS, SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import { evolutionLedgerRetentionGuard } from "./closedLearningEvolutionLedgerRepository";
import { LearningInputSetLedger } from "./learningInputSetLedger";
import { LearningInputSetLedgerError } from "./learningInputSetLedger";
import { buildLearningInputSet, MAX_LEARNING_INPUT_SET_RECEIPT_BYTES } from "./learningInputSet";
import { learningInputSetFingerprint } from "./learningInputSet";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { SqliteResearchFactoryDecisionHistoryRepository } from "../../../packages/storage/src/researchFactoryDecisionHistoryRepository";
import { createLearningEvidenceAuthorityFromReaders } from "./learningEvidenceAuthority";
import type { ResearchFactoryDecisionHistoryRecord } from "../../../packages/contracts/src/researchFactoryDecisionHistory";
import type { PersistedPaperPeriodEnvelope } from "../../../packages/contracts/src/persistedPaperPeriod";

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

function paperPeriod(recordId: string): PersistedPaperPeriodEnvelope {
  const suffix = Number(recordId.slice(1));
  const periodIndex = suffix - 1;
  const periodStartAt = 1_000 + suffix * 100;
  return {
    record: {
      recordId, periodIndex, periodStartAt, periodEndAt: periodStartAt + 10,
      advisory: { schemaVersion: 1, generatedAt: "1970-01-01T00:00:00.000Z", policy: { maximumCandidateWeight: 1, minimumEvidenceBreadth: 1, maximumCandidateCount: 1, maximumFamilyWeight: 1 }, entries: [], excludedCandidateIds: [], reasons: [], provenance: { sourceDatasetIds: ["dataset-a"] } },
      realizedReturns: {}, benchmarkReturn: 0, turnoverCostRate: 0,
      costEvidence: { evidenceId: `cost-${recordId}`, source: "PAPER_EXECUTION_RECEIPT", evidenceKind: "OBSERVED", evidenceFingerprintSha256: "a".repeat(64), observedAt: periodStartAt + 10, feeRate: 0, spreadRate: 0, slippageRate: 0 },
      status: "COMPLETED",
    },
    candidateProvenance: [],
  };
}

/** Seed through the canonical checksum-valid realized-period store. */
function seedPeriods(periodStore: SqlitePersistedPaperPeriodStore, recordIds: readonly string[]): void {
  for (const recordId of recordIds) periodStore.append(paperPeriod(recordId));
}

function researchRecord(): ResearchFactoryDecisionHistoryRecord {
  return { candidateId: "candidate-a", evaluationId: "trial-a", outcome: "REJECTED", reasons: [], observedAt: 100, authority: "PAPER_ONLY", liveAuthority: "NONE", productionMutationAllowed: false, aiAuthority: "ZERO_AUTHORITY" };
}

function evidenceAuthority(researchHistory: SqliteResearchFactoryDecisionHistoryRepository, periodStore: SqlitePersistedPaperPeriodStore) {
  const researchSnapshot = () => researchHistory.list().map((record) => ({ recordId: record.evaluationId, recordedAt: record.observedAt }));
  const paperSnapshot = () => periodStore.listRecords().map((record) => ({ recordId: record.recordId, recordedAt: record.periodEndAt }));
  return createLearningEvidenceAuthorityFromReaders({
    readResearch: (recordId) => researchSnapshot().find((record) => record.recordId === recordId),
    readPaper: (recordId) => paperSnapshot().find((record) => record.recordId === recordId),
    readResearchSnapshot: researchSnapshot,
    readPaperSnapshot: paperSnapshot,
  });
}

function retained(db: SqliteDatabase): string[] {
  return (db.connection.prepare("SELECT record_id FROM research_paper_forward_periods ORDER BY record_id ASC").all() as Array<{ record_id: string }>).map((row) => row.record_id);
}

function fixture() {
  const db = new SqliteDatabase(":memory:");
  const periodStore = new SqlitePersistedPaperPeriodStore(db);
  const learningLedger = new SqliteEvolutionLearningLedger(db);
  const researchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
  researchHistory.append(researchRecord());
  const authority = evidenceAuthority(researchHistory, periodStore);
  return {
    db,
    periodStore,
    learningLedger,
    inputSets: new LearningInputSetLedger(learningLedger, authority),
    // The production guard, derived from the production ledger, over the production database.
    guard: () => evolutionLedgerRetentionGuard(learningLedger),
    close: () => db.close(),
  };
}

const inputSetCiting = (...paperRecordIds: string[]) => buildLearningInputSet({
  cutoffTimestamp: 100_000,
  researchEvidence: [{ recordId: "trial-a", recordedAt: 100 }],
  paperEvidence: paperRecordIds.map((recordId) => ({ recordId, recordedAt: 1_010 + Number(recordId.slice(1)) * 100 })),
  policies: POLICIES,
});

describe("A2 -> A7 integration over the production retention path", () => {
  it("reserves the final shared-ledger slot for the matching A1 decision", () => {
    let appended = false;
    const fullExceptDecision = {
      list: () => Array.from({ length: MAX_EVOLUTION_LEARNING_LEDGER_RECORDS - 1 }, (_, index) => ({ opportunityId: `existing-${index}` })),
      append: () => { appended = true; throw new Error("append must not run when the A1 reservation is reached"); },
    } as unknown as ConstructorParameters<typeof LearningInputSetLedger>[0];
    const inputSets = new LearningInputSetLedger(fullExceptDecision, { readResearch: () => ({ recordId: "trial-a", recordedAt: 100 }), readPaper: (recordId) => ({ recordId, recordedAt: 1_110 }) });
    assert.throws(
      () => inputSets.append(inputSetCiting("p1")),
      (error: unknown) => error instanceof LearningInputSetLedgerError && error.code === "CAPACITY_EXCEEDED",
    );
    assert.equal(appended, false, "A2 refuses before consuming the slot reserved for A1");
  });

  it("rejects a matching A2 identity with conflicting durable status or retention metadata", () => {
    for (const invalid of [
      { validationStatus: "UNKNOWN_STATUS" },
      { changeReference: "different-policy" },
      { evidenceReferences: ["learning-input-set:placeholder"] },
    ]) {
      const { learningLedger, inputSets, periodStore, close } = fixture();
      try {
        // The malformed receipt is written directly; its claimed basis must still exist so the
        // test reaches receipt-metadata validation rather than evidence-resolution validation.
        seedPeriods(periodStore, ["p1"]);
        const inputSet = inputSetCiting("p1");
        const fingerprint = learningInputSetFingerprint(inputSet);
        const opportunityId = `learning-input-set:${fingerprint}`;
        const references = [opportunityId, "paper-period:p1"];
        const record = learningLedger.append({
          opportunityId,
          problem: "NUSA learning input set: the exact evidence a Learning Decision was built from",
          evidenceReferences: references,
          hypothesis: canonicalResearchJson(inputSet),
          changeReference: inputSet.learningPolicyVersion,
          validationStatus: "LEARNING_INPUT_SET",
          outcome: "SUCCESS",
          failureReason: null,
          rollbackReference: null,
          reusable: true,
          recordedAt: "2026-10-20T00:00:00.000Z",
          ...invalid,
        });
        assert.equal(record.opportunityId, opportunityId);
        assert.throws(() => inputSets.append(inputSet), (error: unknown) => error instanceof LearningInputSetLedgerError && error.code === "MALFORMED_RECEIPT");
        assert.throws(() => inputSets.getByFingerprint(fingerprint), (error: unknown) => error instanceof LearningInputSetLedgerError && error.code === "MALFORMED_RECEIPT");
        assert.throws(() => inputSets.protectedPeriodReferences(), /metadata does not match/);
      } finally {
        close();
      }
    }
  });

  it("stores and replays a near-limit input set using the ledger's exact serialized byte count", () => {
    const { learningLedger, close } = fixture();
    try {
      const paperEvidence = Array.from({ length: 120 }, (_, index) => ({
        recordId: `period-${"x".repeat(96)}-${index.toString().padStart(3, "0")}`,
        recordedAt: 100 + index,
      }));
      const inputSet = buildLearningInputSet({
        cutoffTimestamp: 1_000,
        researchEvidence: [],
        paperEvidence,
        policies: POLICIES,
      });
      const serializedBytes = Buffer.byteLength(canonicalResearchJson(inputSet), "utf8");
      assert.ok(serializedBytes > 14_000, "fixture exercises the upper receipt boundary");
      assert.ok(serializedBytes <= MAX_LEARNING_INPUT_SET_RECEIPT_BYTES);

      const verifiedInputSets = new LearningInputSetLedger(learningLedger, createLearningEvidenceAuthorityFromReaders({
        readResearch: () => ({ recordId: "unused", recordedAt: 0 }),
        readPaper: (recordId) => {
          const index = Number(recordId.slice(-3));
          return Number.isSafeInteger(index) && index >= 0 && index < paperEvidence.length ? { recordId, recordedAt: 100 + index } : undefined;
        },
      }));
      const first = verifiedInputSets.append(inputSet);
      assert.equal(first.replayed, false);
      assert.deepEqual(verifiedInputSets.getByFingerprint(first.fingerprint)?.inputSet, inputSet, "downstream A1 reader returns the exact validated durable A2 receipt");
      const stored = learningLedger.list().find((record) => record.opportunityId === `learning-input-set:${first.fingerprint}`);
      assert.ok(stored);
      assert.equal(Buffer.byteLength(stored.hypothesis, "utf8"), serializedBytes, "the admitted size equals the exact stored hypothesis size");
      assert.equal(verifiedInputSets.append(inputSet).replayed, true, "the exact durable receipt survives canonical read-back and replay");
    } finally {
      close();
    }
  });

  it("a recorded input set pins the realized periods it cites against retention", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(periodStore, ["p1", "p2", "p3", "p4", "p5"]);

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
      seedPeriods(periodStore, ["p1", "p2", "p3"]);
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
      seedPeriods(periodStore, ["p1", "p2", "p3"]);
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

  it("refuses to persist an A2 receipt when any cited realized period is absent", () => {
    const { db, periodStore, learningLedger, inputSets, guard, close } = fixture();
    try {
      seedPeriods(periodStore, ["p1"]);
      // A2 refuses to claim a successful identity unless every cited row resolves durably.
      assert.throws(() => inputSets.append(inputSetCiting("p1", "p99")), (error: unknown) => error instanceof LearningInputSetLedgerError && error.code === "EVIDENCE_UNRESOLVED");
      assert.equal(learningLedger.size(), 0, "unresolved evidence never produces a durable A2 success receipt");
      const result = periodStore.prune(10, guard());
      assert.deepEqual([...result.danglingReferences], []);
      assert.equal(result.protectedRecordIds.length, 0);
      assert.equal(retained(db).length, 1, "no synthetic period is invented to satisfy a citation");
    } finally {
      close();
    }
  });

  it("rejects evidence whose canonical timestamp differs from the claimed A2 identity", () => {
    const { learningLedger, inputSets, close } = fixture();
    try {
      assert.throws(
        () => inputSets.append(buildLearningInputSet({ cutoffTimestamp: 100_000, researchEvidence: [{ recordId: "trial-a", recordedAt: 101 }], paperEvidence: [{ recordId: "p1", recordedAt: 1_110 }], policies: POLICIES })),
        (error: unknown) => error instanceof LearningInputSetLedgerError && error.code === "EVIDENCE_IDENTITY_MISMATCH",
      );
      assert.equal(learningLedger.size(), 0);
    } finally { close(); }
  });

  it("re-appending the same input set adds no second citation and no second record", () => {
    const { db, periodStore, inputSets, guard, close } = fixture();
    try {
      seedPeriods(periodStore, ["p1", "p2"]);
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

  it("restores A2 receipts and retention pins after a file-backed SQLite restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "nusa-a2-restart-"));
    const databasePath = join(directory, "learning.sqlite");
    let db = new SqliteDatabase(databasePath);
    try {
      const periodStore = new SqlitePersistedPaperPeriodStore(db);
      seedPeriods(periodStore, ["p1", "p2", "p3"]);
      const researchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
      researchHistory.append(researchRecord());
      let learningLedger = new SqliteEvolutionLearningLedger(db);
      let inputSets = new LearningInputSetLedger(learningLedger, evidenceAuthority(researchHistory, periodStore));
      const inputSet = inputSetCiting("p1", "p2");
      assert.equal(inputSets.append(inputSet).replayed, false);

      db.close();
      db = new SqliteDatabase(databasePath);
      const restartedPeriodStore = new SqlitePersistedPaperPeriodStore(db);
      const restartedResearchHistory = new SqliteResearchFactoryDecisionHistoryRepository(db);
      learningLedger = new SqliteEvolutionLearningLedger(db);
      inputSets = new LearningInputSetLedger(learningLedger, evidenceAuthority(restartedResearchHistory, restartedPeriodStore));

      assert.equal(inputSets.append(inputSet).replayed, true, "restart replay returns the original A2 identity");
      assert.deepEqual([...inputSets.protectedPeriodReferences()], ["paper-period:p1", "paper-period:p2"]);
      const result = restartedPeriodStore.prune(1, evolutionLedgerRetentionGuard(learningLedger));
      assert.equal(result.deleted, 0, "the only older records cited by A2 survive retention after restart");
      assert.deepEqual(retained(db), ["p1", "p2", "p3"]);
    } finally {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
