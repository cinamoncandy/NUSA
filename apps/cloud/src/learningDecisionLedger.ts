import { createHash } from "node:crypto";
import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import {
  assertLearningDecision,
  learningDecisionDurablePayload,
  learningDecisionContentFingerprint,
  learningDecisionFingerprint,
  type LearningDecision,
} from "./learningDecision";
import { assertLearningInputSet, learningInputSetFingerprint, type LearningInputSet } from "./learningInputSet";

/**
 * Durable adapter for A1 over the existing append-only, hash-chained Evolution Learning ledger.
 *
 * Same reuse-first rule as A2: the canonical ledger already provides append-only storage,
 * content-hash identity conflict detection, chronology checks, and capacity bounds, so a decision
 * record is appended beside its input set rather than given a table of its own. The two record kinds
 * are told apart by the `validationStatus` discriminator, exactly as A2 distinguished itself. New
 * decisions use a cycle-keyed identity so attempt metadata changes cannot append another record.
 *
 * Decisions are immutable. Nothing here updates, replaces, or rewrites a recorded decision; a later
 * decision that changes the same surface is a separate record and the supersession relation (A5) is
 * what links them. An attempt to append the same decision identity with different content is an
 * identity conflict, not a version bump.
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const HASH = /^[a-f0-9]{64}$/;
const DECISION_RECORD = /^learning-decision(?::|\-cycle-v1:)[a-f0-9]{64}$/;
const DECISION_STATUS = "LEARNING_DECISION";
const MAX_RECORDS = 10_000;

export class LearningDecisionLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningDecisionLedgerError";
  }
}

export interface LearningDecisionReceipt {
  readonly decision: LearningDecision;
  readonly fingerprint: string;
  readonly learningCycleId: string;
  readonly recordedAt: string;
  /** True when this identity was already durable and nothing new was appended. */
  readonly replayed: boolean;
}

function deepFreeze<T>(value: T): T {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cycleOpportunityId(learningCycleId: string): string {
  const cycleHash = createHash("sha256").update(learningCycleId, "utf8").digest("hex");
  return `learning-decision-cycle-v1:${cycleHash}`;
}

function assertRecordIdentity(record: { readonly opportunityId: string }, decision: LearningDecision): void {
  const fingerprint = learningDecisionFingerprint(decision);
  if (record.opportunityId !== `learning-decision:${fingerprint}` && record.opportunityId !== cycleOpportunityId(decision.learningCycleId)) {
    throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "recorded learning decision does not match its cycle identity");
  }
}

export class LearningDecisionLedger {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  private parseReceipt(record: { readonly hypothesis: string; readonly recordedAt: string }): LearningDecision {
    let parsed: unknown;
    try {
      parsed = JSON.parse(record.hypothesis);
    } catch {
      throw new LearningDecisionLedgerError("MALFORMED_RECEIPT", "recorded learning decision is not readable JSON");
    }
    if (parsed == null || typeof parsed !== "object") throw new LearningDecisionLedgerError("MALFORMED_RECEIPT", "recorded learning decision is malformed");
    const stored = parsed as Partial<LearningDecision>;
    try {
      // Older branch-local receipts embedded A2. Current receipts store its durable identity and
      // resolve the canonical A2 row from the same append-only ledger on every read.
      const learningInputSet = stored.learningInputSet ?? this.assertDurableInputSet(stored.learningInputSetFingerprint ?? "");
      const decision = { ...stored, learningInputSet };
      assertLearningDecision(decision);
      return deepFreeze(decision as LearningDecision);
    } catch (error) {
      throw new LearningDecisionLedgerError("MALFORMED_RECEIPT", error instanceof Error ? error.message : "recorded learning decision is malformed");
    }
  }

  private assertDurableInputSet(fingerprint: string): LearningInputSet {
    const identity = `learning-input-set:${fingerprint}`;
    const record = this.ledger.list().find((candidate) => candidate.opportunityId === identity);
    if (record == null || record.validationStatus !== "LEARNING_INPUT_SET" || !record.evidenceReferences.includes(identity)) {
      throw new LearningDecisionLedgerError("MISSING_INPUT_SET", "decision requires its canonical A2 input set to be durable first");
    }
    let inputSet: unknown;
    try {
      inputSet = JSON.parse(record.hypothesis);
      assertLearningInputSet(inputSet);
    } catch {
      throw new LearningDecisionLedgerError("MALFORMED_INPUT_SET", "canonical A2 input set receipt is invalid");
    }
    if (learningInputSetFingerprint(inputSet) !== fingerprint) throw new LearningDecisionLedgerError("INPUT_SET_IDENTITY_CONFLICT", "canonical A2 input set does not match the decision identity");
    return deepFreeze(inputSet as LearningInputSet);
  }

  private assertDecisionBinding(decision: LearningDecision): void {
    const inputSet = this.assertDurableInputSet(decision.learningInputSetFingerprint);
    if (canonicalResearchJson(decision.learningInputSet) !== canonicalResearchJson(inputSet)) {
      throw new LearningDecisionLedgerError("INPUT_SET_IDENTITY_CONFLICT", "embedded A2 input set does not match its durable receipt");
    }
    if (decision.learningPolicyVersion !== inputSet.learningPolicyVersion) throw new LearningDecisionLedgerError("POLICY_IDENTITY_CONFLICT", "decision learning policy does not match its durable A2 input set");
    const evidenceIds = new Set([...inputSet.researchEvidenceRecordIds, ...inputSet.paperEvidenceRecordIds]);
    if (decision.reasonEvidence.some((reference) => !evidenceIds.has(reference))) throw new LearningDecisionLedgerError("UNBOUND_REASON_EVIDENCE", "decision reason evidence is not present in its durable A2 input set");
  }

  /**
   * Records a decision idempotently. Replaying the same decision produces the same fingerprint, the
   * same ledger identity, and therefore no second record and no second downstream mutation
   * (v2 sections 30-31, 43).
   */
  public append(decision: LearningDecision): LearningDecisionReceipt {
    assertLearningDecision(decision);
    const fingerprint = learningDecisionFingerprint(decision);
    if (!HASH.test(fingerprint)) throw new LearningDecisionLedgerError("IDENTITY_DERIVATION_FAILED", "learning decision fingerprint is not a SHA-256 digest");
    this.assertDecisionBinding(decision);

    const decisions = this.ledger.list().filter((record) => record.validationStatus === DECISION_STATUS || DECISION_RECORD.test(record.opportunityId));
    const matching = decisions.filter((record) => this.parseReceipt(record).learningCycleId === decision.learningCycleId);
    if (matching.length > 1) throw new LearningDecisionLedgerError("DUPLICATE_CYCLE_DECISION", "more than one durable decision exists for a learning cycle");
    const existing = matching[0];
    if (existing != null) {
      const replayed = this.parseReceipt(existing);
      assertRecordIdentity(existing, replayed);
      this.assertDecisionBinding(replayed);
      if (learningDecisionContentFingerprint(replayed) !== learningDecisionContentFingerprint(decision)) {
        throw new LearningDecisionLedgerError("CYCLE_DECISION_CONFLICT", "learning cycle already has a different durable decision");
      }
      return Object.freeze({ decision: replayed, fingerprint: learningDecisionFingerprint(replayed), learningCycleId: replayed.learningCycleId, recordedAt: existing.recordedAt, replayed: true });
    }

    const recorded = this.ledger.list().length;
    if (recorded >= MAX_RECORDS) throw new LearningDecisionLedgerError("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");

    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningDecisionLedgerError("INVALID_CLOCK", "durable clock is invalid");

    const opportunityId = cycleOpportunityId(decision.learningCycleId);
    const recordValue: Parameters<EvolutionLedgerPort["append"]>[0] = {
      opportunityId,
      problem: "NUSA learning decision: the bounded conclusion drawn from one learning input set",
      evidenceReferences: Object.freeze([opportunityId, decision.learningInputSetFingerprint, ...decision.reasonEvidence]),
      hypothesis: canonicalResearchJson(learningDecisionDurablePayload(decision)),
      changeReference: decision.learningPolicyVersion,
      validationStatus: DECISION_STATUS,
      // As in A2, `outcome` records only that the record was formed correctly. The discriminative
      // field is `validationStatus`, and the decision's own conclusion lives in `decisionOutcome`.
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    };

    let record;
    try {
      record = this.ledger.append(recordValue);
    } catch (error) {
      // A concurrent writer may have committed the same cycle key after our initial scan.
      const raced = this.ledger.list().find((candidate) => candidate.opportunityId === opportunityId);
      if (raced == null) throw error;
      const racedDecision = this.parseReceipt(raced);
      assertRecordIdentity(raced, racedDecision);
      this.assertDecisionBinding(racedDecision);
      if (learningDecisionContentFingerprint(racedDecision) !== learningDecisionContentFingerprint(decision)) throw new LearningDecisionLedgerError("CYCLE_DECISION_CONFLICT", "concurrent writer recorded a different decision for this learning cycle");
      return Object.freeze({ decision: racedDecision, fingerprint: learningDecisionFingerprint(racedDecision), learningCycleId: racedDecision.learningCycleId, recordedAt: raced.recordedAt, replayed: true });
    }

    const replayedDecision = this.parseReceipt(record);
    if (learningDecisionFingerprint(replayedDecision) !== fingerprint) throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "recorded learning decision did not survive canonical replay identically");
    assertRecordIdentity(record, replayedDecision);
    return Object.freeze({ decision: replayedDecision, fingerprint, learningCycleId: replayedDecision.learningCycleId, recordedAt: record.recordedAt, replayed: false });
  }

  /** Strict replay: any malformed or tampered receipt throws rather than silently dropping out. */
  public summary(): { readonly decisionsRecorded: number; readonly latest?: LearningDecisionReceipt } {
    const records = this.ledger.list().filter((record) => record.validationStatus === DECISION_STATUS || DECISION_RECORD.test(record.opportunityId));
    let latest: LearningDecisionReceipt | undefined;
    const cycles = new Set<string>();
    for (const record of records) {
      const decision = this.parseReceipt(record);
      assertRecordIdentity(record, decision);
      this.assertDecisionBinding(decision);
      if (cycles.has(decision.learningCycleId)) throw new LearningDecisionLedgerError("DUPLICATE_CYCLE_DECISION", "more than one durable decision exists for a learning cycle");
      cycles.add(decision.learningCycleId);
      const fingerprint = learningDecisionFingerprint(decision);
      const receipt = Object.freeze({ decision, fingerprint, learningCycleId: decision.learningCycleId, recordedAt: record.recordedAt, replayed: false });
      if (latest == null || receipt.recordedAt >= latest.recordedAt) latest = receipt;
    }
    return Object.freeze({ decisionsRecorded: records.length, ...(latest == null ? {} : { latest }) });
  }

  /** Decisions whose outcome was a refusal, kept in the denominator rather than filtered out. */
  public rejections(): readonly LearningDecisionReceipt[] {
    const receipts: LearningDecisionReceipt[] = [];
    const cycles = new Set<string>();
    for (const record of this.ledger.list()) {
      if (record.validationStatus !== DECISION_STATUS && !DECISION_RECORD.test(record.opportunityId)) continue;
      const decision = this.parseReceipt(record);
      assertRecordIdentity(record, decision);
      this.assertDecisionBinding(decision);
      if (cycles.has(decision.learningCycleId)) throw new LearningDecisionLedgerError("DUPLICATE_CYCLE_DECISION", "more than one durable decision exists for a learning cycle");
      cycles.add(decision.learningCycleId);
      if (decision.decisionOutcome !== "REJECTED") continue;
      receipts.push(Object.freeze({ decision, fingerprint: learningDecisionFingerprint(decision), learningCycleId: decision.learningCycleId, recordedAt: record.recordedAt, replayed: false }));
    }
    return Object.freeze(receipts);
  }
}
