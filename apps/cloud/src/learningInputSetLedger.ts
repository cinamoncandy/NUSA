import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import { MAX_EVOLUTION_LEARNING_LEDGER_RECORDS, type SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { LearningEvidenceAuthority, LearningEvidenceRecord } from "./learningEvidenceAuthority";
import {
  learningCycleId,
  learningInputSetFingerprint,
  learningInputSetPeriodReferences,
  assertLearningInputSet,
  type LearningInputSet,
} from "./learningInputSet";

/**
 * Durable adapter for A2 over the existing append-only, hash-chained Evolution Learning ledger.
 *
 * No new table and no second evidence store: the v2 work order forbids a duplicate scheduler,
 * learning engine, evidence store, or control plane, and the canonical ledger already provides
 * append-only storage, content-hash identity conflict detection, chronology checks, and capacity
 * bounds. Recording the input set there gives exactly-once for free as a property of the ledger's
 * identity rather than of an application-level counter.
 *
 * Every PAPER record an input set cites is written into `evidenceReferences` as
 * `paper-period:<recordId>`. That is deliberate and load-bearing: the reference-aware retention
 * guard derives its protected set from exactly these references, so an input set that has been
 * recorded pins the realized periods its decision was built from against pruning (v2 M1/A7,
 * section 22). The Learning Decision can never wake up to a missing basis.
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;
type EvolutionLedgerRecord = ReturnType<EvolutionLedgerPort["list"]>[number];

const HASH = /^[a-f0-9]{64}$/;
const INPUT_SET_RECORD = /^learning-input-set:[a-f0-9]{64}$/;
// Keep one shared-ledger slot available for the A1 decision belonging to this A2 input set.
const MAX_RECORDS = MAX_EVOLUTION_LEARNING_LEDGER_RECORDS - 1;
const INPUT_SET_PROBLEM = "NUSA learning input set: the exact evidence a Learning Decision was built from";
const INPUT_SET_STATUS = "LEARNING_INPUT_SET";

function assertStoredMetadata(record: EvolutionLedgerRecord, inputSet: LearningInputSet, fingerprint: string): void {
  const opportunityId = `learning-input-set:${fingerprint}`;
  const expectedReferences = [opportunityId, ...learningInputSetPeriodReferences(inputSet)];
  const actualReferences = record.evidenceReferences;
  const expectedSet = new Set(expectedReferences);
  const actualSet = new Set(actualReferences);
  if (
    record.opportunityId !== opportunityId
    || record.problem !== INPUT_SET_PROBLEM
    || record.changeReference !== inputSet.learningPolicyVersion
    || record.validationStatus !== INPUT_SET_STATUS
    || record.outcome !== "SUCCESS"
    || record.failureReason !== null
    || record.rollbackReference !== null
    || record.reusable !== true
    || actualReferences.length !== expectedReferences.length
    || actualSet.size !== actualReferences.length
    || expectedSet.size !== expectedReferences.length
    || expectedReferences.some((reference) => !actualSet.has(reference))
  ) {
    throw new LearningInputSetLedgerError("MALFORMED_RECEIPT", "durable learning input set metadata does not match its canonical identity and retention references");
  }
}

function assertEvidenceResolves(inputSet: LearningInputSet, authority: LearningEvidenceAuthority): void {
  const resolve = (
    lane: "research" | "paper",
    ids: readonly string[],
    observedAt: readonly number[],
    read: (recordId: string) => LearningEvidenceRecord | undefined,
    snapshot?: () => readonly LearningEvidenceRecord[],
  ): void => {
    let indexed: Map<string, LearningEvidenceRecord> | undefined;
    if (snapshot != null) {
      indexed = new Map();
      for (const record of snapshot()) {
        if (record == null || typeof record.recordId !== "string" || !Number.isSafeInteger(record.recordedAt) || record.recordedAt < 0 || indexed.has(record.recordId)) {
          throw new LearningInputSetLedgerError("EVIDENCE_AUTHORITY_INVALID", `${lane} evidence snapshot is malformed or ambiguous`);
        }
        indexed.set(record.recordId, record);
      }
    }
    for (let index = 0; index < ids.length; index += 1) {
      if (!Object.hasOwn(ids, index) || !Object.hasOwn(observedAt, index)) {
        throw new LearningInputSetLedgerError("MALFORMED_RECEIPT", `${lane} evidence references contain sparse entries`);
      }
      const recordId = ids[index];
      const expectedObservedAt = observedAt[index];
      const resolved = indexed == null ? read(recordId) : indexed.get(recordId);
      if (resolved == null) throw new LearningInputSetLedgerError("EVIDENCE_UNRESOLVED", `${lane} evidence ${recordId} does not resolve in its canonical durable reader`);
      if (resolved.recordId !== recordId || resolved.recordedAt !== expectedObservedAt) {
        throw new LearningInputSetLedgerError("EVIDENCE_IDENTITY_MISMATCH", `${lane} evidence ${recordId} does not match its canonical identity and observation time`);
      }
    }
  };

  resolve("research", inputSet.researchEvidenceRecordIds, inputSet.researchEvidenceObservedAt, authority.readResearch, authority.readResearchSnapshot);
  resolve("paper", inputSet.paperEvidenceRecordIds, inputSet.paperEvidenceObservedAt, authority.readPaper, authority.readPaperSnapshot);
}

export class LearningInputSetLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningInputSetLedgerError";
  }
}

export interface LearningInputSetReceipt {
  readonly inputSet: LearningInputSet;
  readonly fingerprint: string;
  readonly learningCycleId: string;
  readonly recordedAt: string;
  /** True when this identity was already durable and nothing new was appended. */
  readonly replayed: boolean;
}

function parseReceipt(record: { readonly hypothesis: string; readonly recordedAt: string }): LearningInputSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new LearningInputSetLedgerError("MALFORMED_RECEIPT", "recorded learning input set is not readable JSON");
  }
  try {
    assertLearningInputSet(parsed);
  } catch (error) {
    throw new LearningInputSetLedgerError("MALFORMED_RECEIPT", error instanceof Error ? error.message : "recorded learning input set is malformed");
  }
  const inputSet = parsed as LearningInputSet;
  Object.freeze(inputSet.researchEvidenceRecordIds);
  Object.freeze(inputSet.researchEvidenceObservedAt);
  Object.freeze(inputSet.paperEvidenceRecordIds);
  Object.freeze(inputSet.paperEvidenceObservedAt);
  return Object.freeze(inputSet);
}

export class LearningInputSetLedger {
  public constructor(
    private readonly ledger: EvolutionLedgerPort,
    private readonly evidenceAuthority: LearningEvidenceAuthority,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records an input set idempotently. Replaying the same canonical input produces the same
   * fingerprint, the same ledger identity, and therefore no second record, no second cycle, and no
   * second decision downstream (v2 sections 30-31).
   */
  public append(inputSet: LearningInputSet): LearningInputSetReceipt {
    assertLearningInputSet(inputSet);
    assertEvidenceResolves(inputSet, this.evidenceAuthority);
    const fingerprint = learningInputSetFingerprint(inputSet);
    if (!HASH.test(fingerprint)) throw new LearningInputSetLedgerError("IDENTITY_DERIVATION_FAILED", "learning input set fingerprint is not a SHA-256 digest");
    const opportunityId = `learning-input-set:${fingerprint}`;

    const records = this.ledger.list();
    const existing = records.find((record) => record.opportunityId === opportunityId);
    if (existing != null) {
      const replayed = parseReceipt(existing);
      if (learningInputSetFingerprint(replayed) !== fingerprint) throw new LearningInputSetLedgerError("IDENTITY_CONFLICT", "learning input set identity was reused with different evidence");
      assertStoredMetadata(existing, replayed, fingerprint);
      return Object.freeze({ inputSet: replayed, fingerprint, learningCycleId: learningCycleId(replayed), recordedAt: existing.recordedAt, replayed: true });
    }

    const recorded = records.length;
    if (recorded >= MAX_RECORDS) throw new LearningInputSetLedgerError("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");

    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningInputSetLedgerError("INVALID_CLOCK", "durable clock is invalid");

    const periodReferences = learningInputSetPeriodReferences(inputSet);
    const record = this.ledger.append({
      opportunityId,
      problem: INPUT_SET_PROBLEM,
      evidenceReferences: Object.freeze([opportunityId, ...periodReferences]),
      hypothesis: canonicalResearchJson(inputSet),
      changeReference: inputSet.learningPolicyVersion,
      validationStatus: "LEARNING_INPUT_SET",
      // `outcome` is a closed enum shared with cycle records. Here it denotes only that the record
      // was formed correctly; it is never a performance claim. The discriminative field is
      // `validationStatus`, and PERFORMANCE_IMPROVEMENT stays UNPROVEN regardless.
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    });

    const replayedSet = parseReceipt(record);
    if (learningInputSetFingerprint(replayedSet) !== fingerprint) throw new LearningInputSetLedgerError("IDENTITY_CONFLICT", "recorded learning input set did not survive canonical replay identically");
    assertStoredMetadata(record, replayedSet, fingerprint);
    return Object.freeze({ inputSet: replayedSet, fingerprint, learningCycleId: learningCycleId(replayedSet), recordedAt: record.recordedAt, replayed: false });
  }

  /** Exact canonical reader used by downstream A1; validates the full durable metadata contract. */
  public getByFingerprint(fingerprint: string, snapshot: readonly EvolutionLedgerRecord[] = this.ledger.list()): LearningInputSetReceipt | undefined {
    if (!HASH.test(fingerprint)) throw new LearningInputSetLedgerError("IDENTITY_DERIVATION_FAILED", "learning input set fingerprint is not a SHA-256 digest");
    const opportunityId = `learning-input-set:${fingerprint}`;
    const record = snapshot.find((candidate) => candidate.opportunityId === opportunityId);
    if (record == null) return undefined;
    const inputSet = parseReceipt(record);
    if (learningInputSetFingerprint(inputSet) !== fingerprint) throw new LearningInputSetLedgerError("IDENTITY_CONFLICT", "recorded learning input set does not match its fingerprint");
    assertEvidenceResolves(inputSet, this.evidenceAuthority);
    assertStoredMetadata(record, inputSet, fingerprint);
    return Object.freeze({ inputSet, fingerprint, learningCycleId: learningCycleId(inputSet), recordedAt: record.recordedAt, replayed: true });
  }

  /** Strict replay: any malformed or tampered receipt throws rather than silently dropping out. */
  public summary(): { readonly setsRecorded: number; readonly latest?: LearningInputSetReceipt } {
    const records = this.ledger.list().filter((record) => INPUT_SET_RECORD.test(record.opportunityId));
    let latest: LearningInputSetReceipt | undefined;
    for (const record of records) {
      const inputSet = parseReceipt(record);
      const fingerprint = learningInputSetFingerprint(inputSet);
      if (record.opportunityId !== `learning-input-set:${fingerprint}`) throw new LearningInputSetLedgerError("IDENTITY_CONFLICT", "recorded learning input set does not match its ledger identity");
      assertEvidenceResolves(inputSet, this.evidenceAuthority);
      assertStoredMetadata(record, inputSet, fingerprint);
      const receipt = Object.freeze({ inputSet, fingerprint, learningCycleId: learningCycleId(inputSet), recordedAt: record.recordedAt, replayed: false });
      if (latest == null || receipt.recordedAt >= latest.recordedAt) latest = receipt;
    }
    return Object.freeze({ setsRecorded: records.length, ...(latest == null ? {} : { latest }) });
  }

  /** Realized PAPER periods pinned against retention by the recorded input sets. */
  public protectedPeriodReferences(): readonly string[] {
    const references = new Set<string>();
    for (const record of this.ledger.list()) {
      if (!INPUT_SET_RECORD.test(record.opportunityId)) continue;
      const inputSet = parseReceipt(record);
      const fingerprint = learningInputSetFingerprint(inputSet);
      assertStoredMetadata(record, inputSet, fingerprint);
      assertEvidenceResolves(inputSet, this.evidenceAuthority);
      for (const reference of learningInputSetPeriodReferences(inputSet)) references.add(reference);
    }
    return Object.freeze([...references].sort());
  }
}
