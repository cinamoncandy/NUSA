import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import {
  assertLearningDecision,
  learningDecisionFingerprint,
  type LearningDecision,
} from "./learningDecision";
import { assertLearningInputSet, learningInputSetFingerprint } from "./learningInputSet";

/**
 * Durable adapter for A1 over the existing append-only, hash-chained Evolution Learning ledger.
 *
 * Same reuse-first rule as A2: the canonical ledger already provides append-only storage,
 * content-hash identity conflict detection, chronology checks, and capacity bounds, so a decision
 * record is appended beside its input set rather than given a table of its own. The two record kinds
 * are told apart by the `validationStatus` discriminator, exactly as A2 distinguished itself, and by
 * the `learning-decision:<fingerprint>` identity prefix.
 *
 * Decisions are immutable. Nothing here updates, replaces, or rewrites a recorded decision; a later
 * decision that changes the same surface is a separate record and the supersession relation (A5) is
 * what links them. An attempt to append the same decision identity with different content is an
 * identity conflict, not a version bump.
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const HASH = /^[a-f0-9]{64}$/;
const DECISION_RECORD = /^learning-decision:[a-f0-9]{64}$/;
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

function parseReceipt(record: { readonly hypothesis: string; readonly recordedAt: string }): LearningDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new LearningDecisionLedgerError("MALFORMED_RECEIPT", "recorded learning decision is not readable JSON");
  }
  try {
    assertLearningDecision(parsed);
  } catch (error) {
    throw new LearningDecisionLedgerError("MALFORMED_RECEIPT", error instanceof Error ? error.message : "recorded learning decision is malformed");
  }
  return parsed;
}

export class LearningDecisionLedger {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  private assertDurableInputSet(fingerprint: string): void {
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
    this.assertDurableInputSet(decision.learningInputSetFingerprint);
    const opportunityId = `learning-decision:${fingerprint}`;

    const existing = this.ledger.list().find((record) => record.opportunityId === opportunityId);
    if (existing != null) {
      const replayed = parseReceipt(existing);
      if (learningDecisionFingerprint(replayed) !== fingerprint) throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "learning decision identity was reused with different content");
      return Object.freeze({ decision: replayed, fingerprint, learningCycleId: replayed.learningCycleId, recordedAt: existing.recordedAt, replayed: true });
    }

    const recorded = this.ledger.list().length;
    if (recorded >= MAX_RECORDS) throw new LearningDecisionLedgerError("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");

    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningDecisionLedgerError("INVALID_CLOCK", "durable clock is invalid");

    const record = this.ledger.append({
      opportunityId,
      problem: "NUSA learning decision: the bounded conclusion drawn from one learning input set",
      evidenceReferences: Object.freeze([opportunityId, decision.learningInputSetFingerprint, ...decision.reasonEvidence]),
      hypothesis: canonicalResearchJson(decision),
      changeReference: decision.learningPolicyVersion,
      validationStatus: "LEARNING_DECISION",
      // As in A2, `outcome` records only that the record was formed correctly. The discriminative
      // field is `validationStatus`, and the decision's own conclusion lives in `decisionOutcome`.
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    });

    const replayedDecision = parseReceipt(record);
    if (learningDecisionFingerprint(replayedDecision) !== fingerprint) throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "recorded learning decision did not survive canonical replay identically");
    return Object.freeze({ decision: replayedDecision, fingerprint, learningCycleId: replayedDecision.learningCycleId, recordedAt: record.recordedAt, replayed: false });
  }

  /** Strict replay: any malformed or tampered receipt throws rather than silently dropping out. */
  public summary(): { readonly decisionsRecorded: number; readonly latest?: LearningDecisionReceipt } {
    const records = this.ledger.list().filter((record) => DECISION_RECORD.test(record.opportunityId));
    let latest: LearningDecisionReceipt | undefined;
    for (const record of records) {
      const decision = parseReceipt(record);
      this.assertDurableInputSet(decision.learningInputSetFingerprint);
      const fingerprint = learningDecisionFingerprint(decision);
      if (record.opportunityId !== `learning-decision:${fingerprint}`) throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "recorded learning decision does not match its ledger identity");
      const receipt = Object.freeze({ decision, fingerprint, learningCycleId: decision.learningCycleId, recordedAt: record.recordedAt, replayed: false });
      if (latest == null || receipt.recordedAt >= latest.recordedAt) latest = receipt;
    }
    return Object.freeze({ decisionsRecorded: records.length, ...(latest == null ? {} : { latest }) });
  }

  /**
   * Whether a cycle durably reached a decision.
   *
   * This is A3's completion evidence. A partition assignment says which partition a cycle belongs
   * to; it does not say the cycle resolved. Eligibility counts only cycles that also have a
   * recorded decision, and the check is answered from these records rather than from the
   * assignment, so an assignment cannot vouch for its own completion.
   */
  public hasDecisionFor(learningCycleId: string): boolean {
    if (typeof learningCycleId !== "string" || learningCycleId.length === 0) return false;
    for (const record of this.ledger.list()) {
      if (!DECISION_RECORD.test(record.opportunityId)) continue;
      if (parseReceipt(record).learningCycleId === learningCycleId) return true;
    }
    return false;
  }

  /**
   * One recorded decision by identity.
   *
   * Used to restore the research spec a decision was derived from, which is the third identity v2
   * section 8 requires a research request to name about its causal parent.
   */
  public byFingerprint(fingerprint: string): LearningDecisionReceipt | undefined {
    if (!HASH.test(fingerprint)) return undefined;
    const record = this.ledger.list().find((candidate) => candidate.opportunityId === `learning-decision:${fingerprint}`);
    if (record == null) return undefined;
    const decision = parseReceipt(record);
    if (learningDecisionFingerprint(decision) !== fingerprint) throw new LearningDecisionLedgerError("IDENTITY_CONFLICT", "recorded learning decision does not match its ledger identity");
    return Object.freeze({ decision, fingerprint, learningCycleId: decision.learningCycleId, recordedAt: record.recordedAt, replayed: false });
  }

  /** Decisions whose outcome was a refusal, kept in the denominator rather than filtered out. */
  public rejections(): readonly LearningDecisionReceipt[] {
    const receipts: LearningDecisionReceipt[] = [];
    for (const record of this.ledger.list()) {
      if (!DECISION_RECORD.test(record.opportunityId)) continue;
      const decision = parseReceipt(record);
      this.assertDurableInputSet(decision.learningInputSetFingerprint);
      if (decision.decisionOutcome !== "REJECTED") continue;
      receipts.push(Object.freeze({ decision, fingerprint: learningDecisionFingerprint(decision), learningCycleId: decision.learningCycleId, recordedAt: record.recordedAt, replayed: false }));
    }
    return Object.freeze(receipts);
  }
}
