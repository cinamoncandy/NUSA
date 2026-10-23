import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createEvolutionLearningRecord, type EvolutionLearningRecord } from "../../../apps/autopilot/src/evolveLearningMemory";
import { canonicalResearchJson } from "../../contracts/src/researchRuntime";
import { SqliteDatabase } from "./index";
import { EvolutionLearningLedgerError, SqliteEvolutionLearningLedger } from "./evolutionLearningLedger";

const record = (opportunityId: string, recordedAt: string, overrides: Partial<EvolutionLearningRecord> = {}): EvolutionLearningRecord => createEvolutionLearningRecord({
  opportunityId,
  problem: "Repeated bounded validation latency",
  evidenceReferences: ["ci:validation", "runtime:healthy"],
  hypothesis: "A bounded change reduces the observed latency without weakening safety.",
  changeReference: "pr:evolution-ledger",
  validationStatus: "VERIFIED_IMPROVEMENT",
  outcome: "SUCCESS",
  failureReason: null,
  rollbackReference: null,
  reusable: true,
  recordedAt,
  ...overrides,
});

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function inputSetRecord(recordedAt: string, paperId: string, researchId = "trial-1"): { readonly fingerprint: string; readonly inputSet: Readonly<Record<string, unknown>>; readonly record: EvolutionLearningRecord } {
  const inputSet = {
    schemaVersion: 1,
    cutoffTimestamp: 10_000,
    researchEvidenceRecordIds: [researchId],
    researchEvidenceObservedAt: [1],
    paperEvidenceRecordIds: [paperId],
    paperEvidenceObservedAt: [2],
    researchLaneDigest: sha256(canonicalResearchJson({ lane: "research", recordIds: [researchId], observedAt: [1] })),
    performanceLaneDigest: sha256(canonicalResearchJson({ lane: "performance", recordIds: [paperId], observedAt: [2] })),
    learningPolicyVersion: "learn-v1",
    researchPolicyVersion: "research-v1",
    riskPolicyVersion: "risk-v1",
    governancePolicyVersion: "gov-v1",
    canonicalOrderingVersion: "learning-input-set-canonical-order-v2",
  };
  const fingerprint = sha256(canonicalResearchJson(inputSet));
  const opportunityId = `learning-input-set:${fingerprint}`;
  return {
    fingerprint,
    inputSet,
    record: record(opportunityId, recordedAt, {
      problem: "NUSA learning input set: the exact evidence a Learning Decision was built from",
      evidenceReferences: [opportunityId, `paper-period:${paperId}`],
      hypothesis: canonicalResearchJson(inputSet),
      changeReference: "learn-v1",
      validationStatus: "LEARNING_INPUT_SET",
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
    }),
  };
}

function decisionRecord(fingerprint: string, recordedAt: string, inputSet: Readonly<Record<string, unknown>>, extraEvidence: readonly string[] = []): EvolutionLearningRecord {
  const learningCycleId = `learning-cycle:${fingerprint}`;
  const opportunityId = `learning-decision-cycle-v1:${sha256(learningCycleId)}`;
  const payload = {
    schemaVersion: 1,
    learningCycleId,
    learningInputSet: inputSet,
    learningInputSetFingerprint: fingerprint,
    previousResearchSpecFingerprint: "c".repeat(64),
    learningPolicyVersion: "learn-v1",
    objectiveVersion: "objective-v1",
    proposedChanges: [],
    admissibleChanges: [],
    rejectedChanges: [],
    reasonEvidence: [],
    changeMagnitude: 0,
    allowedSurfaceVersion: "learning-allowed-surface-v1",
    immutableSurfaceVersion: "learning-immutable-surface-v1",
    decisionOutcome: "INSUFFICIENT",
    createdAt: "2026-08-29T00:02:30.000Z",
    sourceCommit: "source-1",
    runtimeIdentity: "paper-runtime-1",
  };
  return record(opportunityId, recordedAt, {
    problem: "NUSA learning decision: the bounded conclusion drawn from one learning input set",
    evidenceReferences: [opportunityId, fingerprint, ...extraEvidence],
    hypothesis: canonicalResearchJson(payload),
    changeReference: "learn-v1",
    validationStatus: "LEARNING_DECISION",
    outcome: "SUCCESS",
    failureReason: null,
    rollbackReference: null,
    reusable: true,
  });
}

function databasePath(): string {
  return join(mkdtempSync(join(process.cwd(), ".nusa-evolution-learning-")), "learning.db");
}

function removeDatabasePath(filename: string): void {
  rmSync(dirname(filename), { recursive: true, force: true });
}

test("evolution learning ledger survives restart and replays the same records", () => {
  const filename = databasePath();
  const firstDb = new SqliteDatabase(filename);
  const first = new SqliteEvolutionLearningLedger(firstDb);
  const a = first.append(record("opp:one", "2026-08-29T00:00:00.000Z"));
  const b = first.append(record("opp:two", "2026-08-29T00:01:00.000Z", { outcome: "PARTIAL_SUCCESS" }));
  const expectedHead = first.headHash();
  firstDb.close();

  const restartedDb = new SqliteDatabase(filename);
  try {
    const restarted = new SqliteEvolutionLearningLedger(restartedDb);
    assert.deepEqual(restarted.list(), [a, b]);
    assert.equal(restarted.headHash(), expectedHead);
    assert.equal(restarted.size(), 2);
  } finally {
    restartedDb.close();
    removeDatabasePath(filename);
  }
});

test("same opportunity and normalized payload is idempotent, but a different payload fails closed", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const original = record("opp:idempotent", "2026-08-29T00:00:00.000Z");
    const stored = ledger.append(original);
    const reordered = ledger.append({ ...original, evidenceReferences: [...original.evidenceReferences].reverse() });
    assert.deepEqual(reordered, stored);
    assert.equal(ledger.size(), 1);
    assert.throws(() => ledger.append({ ...original, problem: "A different observed problem" }), (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "IDENTITY_CONFLICT");
    assert.equal(ledger.size(), 1);
  } finally {
    db.close();
  }
});

test("canonical normalization gives equivalent input order the same chain hash", () => {
  const leftDb = new SqliteDatabase(":memory:");
  const rightDb = new SqliteDatabase(":memory:");
  try {
    const left = new SqliteEvolutionLearningLedger(leftDb);
    const right = new SqliteEvolutionLearningLedger(rightDb);
    const a = record("opp:stable", "2026-08-29T00:00:00.000Z");
    left.append(a);
    right.append({ ...a, evidenceReferences: [...a.evidenceReferences].reverse() });
    assert.equal(left.headHash(), right.headHash());
    assert.deepEqual(left.list(), right.list());
  } finally {
    leftDb.close();
    rightDb.close();
  }
});

test("chronology regression and bounded capacity fail closed without pruning history", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db, 1);
    ledger.append(record("opp:first", "2026-08-29T00:01:00.000Z"));
    assert.throws(() => ledger.append(record("opp:second", "2026-08-29T00:02:00.000Z")), /CAPACITY_EXCEEDED/);
    assert.equal(ledger.size(), 1);
  } finally {
    db.close();
  }

  const chronologyDb = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(chronologyDb);
    ledger.append(record("opp:later", "2026-08-29T00:02:00.000Z"));
    assert.throws(() => ledger.append(record("opp:earlier", "2026-08-29T00:01:00.000Z")), /CHRONOLOGY_REGRESSION/);
    assert.equal(ledger.size(), 1);
  } finally {
    chronologyDb.close();
  }
});

test("an unrelated writer cannot consume the capacity reserved for an A2 input set's A1 decision", () => {
  const filename = databasePath();
  let db = new SqliteDatabase(filename);
  try {
    let ledger = new SqliteEvolutionLearningLedger(db, 3);
    ledger.append(record("opp:existing", "2026-08-29T00:00:00.000Z"));
    const inputSet = inputSetRecord("2026-08-29T00:01:00.000Z", "p1");
    ledger.append(inputSet.record);

    db.close();
    db = new SqliteDatabase(filename);
    ledger = new SqliteEvolutionLearningLedger(db, 3);

    assert.throws(
      () => ledger.append(record(`closed-learning-failure:${"c".repeat(64)}`, "2026-08-29T00:02:00.000Z", {
        problem: "NUSA closed learning cycle failure: durable recovery evidence",
        validationStatus: "CYCLE_FAILURE",
      })),
      (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "CAPACITY_EXCEEDED",
    );
    assert.equal(ledger.size(), 2, "a closed-learning failure append leaves the reserved A1 slot untouched");

    ledger.append(decisionRecord(inputSet.fingerprint, "2026-08-29T00:02:00.000Z", inputSet.inputSet));
    assert.equal(ledger.size(), 3, "the matching A1 decision can consume the reserved slot");
  } finally {
    db.close();
    removeDatabasePath(filename);
  }
});

test("a malformed namespace-shaped A2 record cannot reserve capacity after restart", () => {
  const filename = databasePath();
  let db = new SqliteDatabase(filename);
  try {
    let ledger = new SqliteEvolutionLearningLedger(db, 2);
    const malformedA2 = inputSetRecord("2026-08-29T00:00:00.000Z", "p1");
    ledger.append({ ...malformedA2.record, hypothesis: "{}" });
    db.close();

    db = new SqliteDatabase(filename);
    ledger = new SqliteEvolutionLearningLedger(db, 2);
    ledger.append(record("opp:unrelated", "2026-08-29T00:01:00.000Z"));
    assert.equal(ledger.size(), 2, "only a complete canonical A2 receipt consumes A1 capacity");
  } finally {
    db.close();
    removeDatabasePath(filename);
  }
});

test("a whitespace Research ID cannot reserve A1 capacity after restart", () => {
  const filename = databasePath();
  let db = new SqliteDatabase(filename);
  try {
    let ledger = new SqliteEvolutionLearningLedger(db, 2);
    const malformedA2 = inputSetRecord("2026-08-29T00:00:00.000Z", "p1", " ");
    ledger.append(malformedA2.record);
    db.close();

    db = new SqliteDatabase(filename);
    ledger = new SqliteEvolutionLearningLedger(db, 2);
    ledger.append(record("opp:unrelated", "2026-08-29T00:01:00.000Z"));
    assert.equal(ledger.size(), 2, "a whitespace Research ID does not reserve capacity for an A1 decision");
  } finally {
    db.close();
    removeDatabasePath(filename);
  }
});

test("only a canonical A1 receipt can release one matching A2 reservation", () => {
  const filename = databasePath();
  let db = new SqliteDatabase(filename);
  try {
    let ledger = new SqliteEvolutionLearningLedger(db, 4);
    const first = inputSetRecord("2026-08-29T00:00:00.000Z", "p1");
    const second = inputSetRecord("2026-08-29T00:01:00.000Z", "p2");
    ledger.append(first.record);
    ledger.append(second.record);
    assert.throws(
      () => ledger.append({ ...decisionRecord(first.fingerprint, "2026-08-29T00:02:00.000Z", first.inputSet), hypothesis: "{}" }),
      (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "INVALID_LEARNING_DECISION_RECEIPT",
      "a generic writer cannot release A2 capacity with only A1-shaped status and identity metadata",
    );
    const forged = decisionRecord(first.fingerprint, "2026-08-29T00:02:00.000Z", first.inputSet, [second.fingerprint]);
    assert.throws(
      () => ledger.append(forged),
      (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "INVALID_LEARNING_DECISION_RECEIPT",
      "an A1-shaped record that cites two pending A2 fingerprints must not be persisted",
    );

    db.close();
    db = new SqliteDatabase(filename);
    ledger = new SqliteEvolutionLearningLedger(db, 4);

    assert.throws(
      () => ledger.append(record(`closed-learning-failure:${"f".repeat(64)}`, "2026-08-29T00:03:00.000Z", {
        problem: "NUSA closed learning cycle failure: durable recovery evidence",
        validationStatus: "CYCLE_FAILURE",
      })),
      (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "CAPACITY_EXCEEDED",
      "an ambiguous A1 receipt must not release either durable reservation during replay",
    );

    ledger.append(decisionRecord(first.fingerprint, "2026-08-29T00:03:00.000Z", first.inputSet));
    ledger.append(decisionRecord(second.fingerprint, "2026-08-29T00:04:00.000Z", second.inputSet));
    assert.equal(ledger.size(), 4, "each one-to-one A1 receipt releases exactly one reserved slot");
  } finally {
    db.close();
    removeDatabasePath(filename);
  }
});

test("replay does not resurrect an A2 reservation for the immediately preceding canonical A1 receipt format", () => {
  const filename = databasePath();
  let db = new SqliteDatabase(filename);
  try {
    let ledger = new SqliteEvolutionLearningLedger(db, 3);
    const inputSet = inputSetRecord("2026-08-29T00:00:00.000Z", "legacy-paper-period");
    ledger.append(inputSet.record);
    const currentDecision = ledger.append(decisionRecord(inputSet.fingerprint, "2026-08-29T00:01:00.000Z", inputSet.inputSet));

    // Seed the exact canonical shape written by the preceding A1 payload serializer, which omitted
    // the embedded A2 object but retained its durable fingerprint. Recompute the fixture's existing
    // hash-chain row so reopen exercises real ledger replay rather than a parser-only shortcut.
    const stored = JSON.parse(currentDecision.hypothesis) as Record<string, unknown>;
    const { learningInputSet: _omittedHistoricalField, ...legacyPayload } = stored;
    const legacyDecision = { ...currentDecision, hypothesis: canonicalResearchJson(legacyPayload) };
    const row = db.connection.prepare(
      "SELECT sequence, previous_hash FROM evolution_learning_ledger_events WHERE opportunity_id = ?",
    ).get(currentDecision.opportunityId) as { sequence: number; previous_hash: string };
    const contentHash = sha256(canonicalResearchJson(legacyDecision));
    const eventHash = sha256(canonicalResearchJson({
      schemaVersion: 1,
      sequence: row.sequence,
      opportunityId: legacyDecision.opportunityId,
      contentHash,
      payload: legacyDecision,
      recordedAt: legacyDecision.recordedAt,
      previousHash: row.previous_hash,
    }));
    db.connection.prepare(
      "UPDATE evolution_learning_ledger_events SET content_hash = ?, payload_json = ?, event_hash = ? WHERE opportunity_id = ?",
    ).run(contentHash, canonicalResearchJson(legacyDecision), eventHash, currentDecision.opportunityId);
    db.connection.prepare("UPDATE evolution_learning_ledger_meta SET ledger_hash = ? WHERE id = 1").run(eventHash);

    db.close();
    db = new SqliteDatabase(filename);
    ledger = new SqliteEvolutionLearningLedger(db, 3);
    assert.equal(ledger.list().length, 2);
    ledger.append(record("opp:after-legacy-a1", "2026-08-29T00:02:00.000Z"));
    assert.equal(ledger.size(), 3, "a durable legacy A1 receipt releases its already-consumed A2 capacity reservation");
  } finally {
    db.close();
    removeDatabasePath(filename);
  }
});

test("forbidden fields are rejected before they can be persisted", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const unsafe = { ...record("opp:secret", "2026-08-29T00:00:00.000Z") } as Record<string, unknown>;
    unsafe[["to", "ken"].join("")] = "redacted";
    assert.throws(() => ledger.append(unsafe as unknown as EvolutionLearningRecord), /FORBIDDEN_FIELD/);
    const count = db.connection.prepare("SELECT COUNT(*) AS count FROM evolution_learning_ledger_events").get() as { count: number };
    assert.equal(Number(count.count), 0);
    assert.equal(JSON.stringify(ledger.list()).includes("redacted"), false);
  } finally {
    db.close();
  }
});

test("hypothesis payload is bounded at 16 KiB of UTF-8 while allowing canonical Governance/PAPER receipts", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    const canonicalReceipt = { ...record("opp:canonical-receipt", "2026-08-29T00:00:00.000Z"), hypothesis: "x".repeat(2_001) };
    assert.equal(ledger.append(canonicalReceipt).hypothesis.length, 2_001);

    const asciiBelow = "a".repeat(16_383);
    const asciiAt = "a".repeat(16_384);
    const asciiAbove = "a".repeat(16_385);
    const multibyteBelow = "가".repeat(5_461);
    const multibyteAt = `${multibyteBelow}a`;
    const multibyteAbove = `${multibyteBelow}ab`;
    for (const [label, hypothesis, expectedBytes] of [
      ["ascii-below", asciiBelow, 16_383],
      ["ascii-at", asciiAt, 16_384],
      ["multibyte-below", multibyteBelow, 16_383],
      ["multibyte-at", multibyteAt, 16_384],
    ] as const) {
      const stored = ledger.append({ ...record(`opp:${label}`, `2026-08-29T00:${String(2 + ledger.size()).padStart(2, "0")}:00.000Z`), hypothesis });
      assert.equal(Buffer.byteLength(stored.hypothesis, "utf8"), expectedBytes);
    }
    for (const [label, hypothesis] of [["ascii-above", asciiAbove], ["multibyte-above", multibyteAbove]] as const) {
      assert.equal(Buffer.byteLength(hypothesis, "utf8"), 16_385);
      assert.throws(
        () => ledger.append({ ...record(`opp:${label}`, `2026-08-29T00:${String(2 + ledger.size()).padStart(2, "0")}:00.000Z`), hypothesis }),
        (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "INVALID_RECORD",
      );
    }
    assert.equal(ledger.size(), 5);
  } finally {
    db.close();
  }
});

test("malformed persisted payload is rejected during startup replay", () => {
  const filename = databasePath();
  const db = new SqliteDatabase(filename);
  const ledger = new SqliteEvolutionLearningLedger(db);
  ledger.append(record("opp:corrupt", "2026-08-29T00:00:00.000Z"));
  db.connection.prepare("UPDATE evolution_learning_ledger_events SET payload_json = ? WHERE opportunity_id = ?").run("{}", "opp:corrupt");
  db.close();

  const reopenedDb = new SqliteDatabase(filename);
  try {
    assert.throws(() => new SqliteEvolutionLearningLedger(reopenedDb), (error: unknown) => error instanceof EvolutionLearningLedgerError && error.code === "CORRUPTED_LEDGER");
  } finally {
    reopenedDb.close();
    removeDatabasePath(filename);
  }
});

test("ledger exposes evidence persistence only and preserves zero authority", () => {
  const db = new SqliteDatabase(":memory:");
  try {
    const ledger = new SqliteEvolutionLearningLedger(db);
    assert.equal("submitOrder" in ledger, false);
    assert.equal("cancelOrder" in ledger, false);
    assert.equal("activateLive" in ledger, false);
    assert.equal("productionMutationAllowed" in ledger, false);
  } finally {
    db.close();
  }
});
