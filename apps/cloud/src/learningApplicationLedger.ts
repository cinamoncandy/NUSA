import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import {
  assertLearningApplicationReceipt,
  applicationFingerprint,
  type ApplicationRegistry,
  type LearningApplicationReceipt,
} from "./learningApplication";

/**
 * Durable adapter for A4 over the existing append-only, hash-chained Evolution Learning ledger.
 *
 * Same reuse-first rule as A2 and A1: the canonical ledger already provides append-only storage,
 * content-hash identity conflict detection, chronology checks, and capacity bounds, so application
 * receipts are appended beside the input sets and decisions that produced them. No new table and no
 * second evidence store. The three record kinds are told apart by the `validationStatus`
 * discriminator and by their identity prefix, `learning-application:<fingerprint>`.
 *
 * Receipts are immutable. Nothing here updates or replaces one; a later attempt on the same surface
 * under a different decision is a separate record. Appending the same application identity with
 * different content is an identity conflict, not a version bump.
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const HASH = /^[a-f0-9]{64}$/;
const APPLICATION_RECORD = /^learning-application:[a-f0-9]{64}$/;
const MAX_RECORDS = 10_000;

export class LearningApplicationLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "LearningApplicationLedgerError";
  }
}

export interface LearningApplicationDurableReceipt {
  readonly receipt: LearningApplicationReceipt;
  readonly fingerprint: string;
  readonly recordedAt: string;
  /** True when this identity was already durable and nothing new was appended. */
  readonly replayed: boolean;
}

function parseReceipt(record: { readonly hypothesis: string }): LearningApplicationReceipt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new LearningApplicationLedgerError("MALFORMED_RECEIPT", "recorded application receipt is not readable JSON");
  }
  try {
    assertLearningApplicationReceipt(parsed);
  } catch (error) {
    throw new LearningApplicationLedgerError("MALFORMED_RECEIPT", error instanceof Error ? error.message : "recorded application receipt is malformed");
  }
  return parsed;
}

export class LearningApplicationLedger {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  /**
   * Records a receipt idempotently, returning the durable receipt.
   *
   * A replay of the same application identity yields the stored receipt rather than a second record,
   * which is what makes the side effect exactly-once across a restart and not merely across a
   * function call.
   */
  public append(receipt: LearningApplicationReceipt): LearningApplicationDurableReceipt {
    assertLearningApplicationReceipt(receipt);
    const fingerprint = receipt.applicationFingerprint;
    if (!HASH.test(fingerprint)) throw new LearningApplicationLedgerError("IDENTITY_DERIVATION_FAILED", "application fingerprint is not a SHA-256 digest");
    const opportunityId = `learning-application:${fingerprint}`;

    const existing = this.ledger.list().find((record) => record.opportunityId === opportunityId);
    if (existing != null) {
      const replayed = parseReceipt(existing);
      if (replayed.applicationFingerprint !== fingerprint) throw new LearningApplicationLedgerError("IDENTITY_CONFLICT", "application identity was reused with different content");
      return Object.freeze({ receipt: replayed, fingerprint, recordedAt: existing.recordedAt, replayed: true });
    }

    const recorded = this.ledger.list().length;
    if (recorded >= MAX_RECORDS) throw new LearningApplicationLedgerError("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");

    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new LearningApplicationLedgerError("INVALID_CLOCK", "durable clock is invalid");

    const record = this.ledger.append({
      opportunityId,
      problem: "NUSA learning application: one admitted decision change bounded and applied exactly once",
      evidenceReferences: Object.freeze([opportunityId, receipt.learningDecisionFingerprint, receipt.learningCycleId]),
      hypothesis: canonicalResearchJson(receipt),
      changeReference: receipt.surface,
      validationStatus: "LEARNING_APPLICATION",
      // As in A2 and A1, `outcome` records only that the record was formed correctly. The real
      // conclusion lives in `applicationOutcome`, which may be REJECTED or FAILED.
      outcome: "SUCCESS",
      failureReason: receipt.fallbackReason ?? null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    });

    const replayedReceipt = parseReceipt(record);
    if (replayedReceipt.applicationFingerprint !== fingerprint) throw new LearningApplicationLedgerError("IDENTITY_CONFLICT", "recorded application did not survive canonical replay identically");
    return Object.freeze({ receipt: replayedReceipt, fingerprint, recordedAt: record.recordedAt, replayed: false });
  }

  /**
   * Strict replay of every durable application receipt.
   *
   * Any malformed or tampered receipt throws rather than silently dropping out, so a chain that has
   * been edited in place cannot pass as history.
   */
  public summary(): { readonly applicationsRecorded: number; readonly applied: number; readonly refused: number; readonly failed: number } {
    let applicationsRecorded = 0;
    let applied = 0;
    let refused = 0;
    let failed = 0;
    for (const record of this.ledger.list()) {
      if (!APPLICATION_RECORD.test(record.opportunityId)) continue;
      applicationsRecorded += 1;
      const receipt = parseReceipt(record);
      if (record.opportunityId !== `learning-application:${receipt.applicationFingerprint}`) throw new LearningApplicationLedgerError("IDENTITY_CONFLICT", "recorded application does not match its ledger identity");
      if (receipt.applicationOutcome === "APPLIED") applied += 1;
      else if (receipt.applicationOutcome === "FAILED") failed += 1;
      else refused += 1;
    }
    return Object.freeze({ applicationsRecorded, applied, refused, failed });
  }

  /** Every durable receipt, in ledger order, for rehydrating exactly-once after a restart. */
  public hydrate(registry: ApplicationRegistry): number {
    let restored = 0;
    for (const record of this.ledger.list()) {
      if (!APPLICATION_RECORD.test(record.opportunityId)) continue;
      const receipt = parseReceipt(record);
      if (record.opportunityId !== `learning-application:${receipt.applicationFingerprint}`) throw new LearningApplicationLedgerError("IDENTITY_CONFLICT", "recorded application does not match its ledger identity");
      registry.record(receipt);
      restored += 1;
    }
    return restored;
  }

  /**
   * The most recent application that actually took effect.
   *
   * v2 section 8's learning side: this is the application a later research request names as its
   * causal parent, so a restarted process rehydrates it from durable history rather than from
   * whatever the previous process happened to hold in memory.
   */
  public latestApplied(): LearningApplicationDurableReceipt | undefined {
    let latest: LearningApplicationDurableReceipt | undefined;
    for (const record of this.ledger.list()) {
      if (!APPLICATION_RECORD.test(record.opportunityId)) continue;
      const receipt = parseReceipt(record);
      if (record.opportunityId !== `learning-application:${receipt.applicationFingerprint}`) throw new LearningApplicationLedgerError("IDENTITY_CONFLICT", "recorded application does not match its ledger identity");
      if (receipt.applicationOutcome !== "APPLIED") continue;
      const durable = Object.freeze({ receipt, fingerprint: receipt.applicationFingerprint, recordedAt: record.recordedAt, replayed: false });
      if (latest == null || durable.recordedAt >= latest.recordedAt) latest = durable;
    }
    return latest;
  }

  /** Receipts already durable for a given decision, used to prove a replay adds nothing. */
  public forDecision(decisionFingerprint: string): readonly LearningApplicationDurableReceipt[] {
    const receipts: LearningApplicationDurableReceipt[] = [];
    for (const record of this.ledger.list()) {
      if (!APPLICATION_RECORD.test(record.opportunityId)) continue;
      const receipt = parseReceipt(record);
      if (receipt.learningDecisionFingerprint !== decisionFingerprint) continue;
      receipts.push(Object.freeze({ receipt, fingerprint: receipt.applicationFingerprint, recordedAt: record.recordedAt, replayed: false }));
    }
    return Object.freeze(receipts);
  }
}

/** Re-exported so callers rehydrating after a restart need only one import. */
export { applicationFingerprint };
