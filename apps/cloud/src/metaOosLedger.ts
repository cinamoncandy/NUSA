import { canonicalResearchJson } from "../../../packages/contracts/src/researchRuntime";
import type { SqliteEvolutionLearningLedger } from "../../../packages/storage/src/evolutionLearningLedger";
import type { MetaOosEligibility } from "./learningApplication";
import {
  assertMetaOosAssignment,
  assertMetaOosAssignmentReplay,
  assignMetaPartition,
  metaOosEligibility,
  type HoldoutClaimPort,
  type MetaOosAssignment,
  type MetaOosAssignmentInput,
  type MetaPartition,
} from "./metaOos";

/**
 * Durable adapter for A3 over the existing append-only, hash-chained Evolution Learning ledger.
 *
 * Same reuse-first rule as A2, A1, and A4: the canonical ledger already provides append-only
 * storage, content-hash identity conflict detection, chronology checks, and capacity bounds, so
 * partition assignments are appended beside the input sets, decisions, and applications that produced
 * them. No new table and no second evidence store. Assignments are told apart by record kind and by
 * the `meta-oos:<fingerprint>` identity prefix.
 *
 * The rule this adapter exists to enforce durably is that **one cycle belongs to exactly one meta
 * partition**. The identity check alone does not express it, because two *different* partitions for
 * the same cycle are two perfectly valid identities that must not both exist. So the cycle id is
 * checked independently: a first assignment records, a replay of the same assignment is idempotent,
 * and a second assignment of an already-assigned cycle to a different partition is refused as a fork
 * rather than resolved by recency.
 */

type EvolutionLedgerPort = Pick<SqliteEvolutionLearningLedger, "append" | "list">;

const ASSIGNMENT_RECORD = /^meta-oos:[a-f0-9]{64}$/;
const MAX_RECORDS = 10_000;

export class MetaOosLedgerError extends Error {
  public constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MetaOosLedgerError";
  }
}

export interface MetaOosDurableReceipt {
  readonly assignment: MetaOosAssignment;
  readonly fingerprint: string;
  readonly recordedAt: string;
  /** True when this identity was already durable and nothing new was appended. */
  readonly replayed: boolean;
}

function parseRecord(record: { readonly hypothesis: string }): MetaOosAssignment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.hypothesis);
  } catch {
    throw new MetaOosLedgerError("MALFORMED_RECEIPT", "recorded meta-OOS assignment is not readable JSON");
  }
  try {
    assertMetaOosAssignment(parsed);
  } catch (error) {
    throw new MetaOosLedgerError("MALFORMED_RECEIPT", error instanceof Error ? error.message : "recorded meta-OOS assignment is malformed");
  }
  return parsed;
}

export class MetaOosLedger {
  public constructor(private readonly ledger: EvolutionLedgerPort, private readonly now: () => number = Date.now) {}

  private records(): MetaOosAssignment[] {
    const assignments: MetaOosAssignment[] = [];
    for (const record of this.ledger.list()) {
      if (!ASSIGNMENT_RECORD.test(record.opportunityId)) continue;
      const assignment = parseRecord(record);
      if (record.opportunityId !== `meta-oos:${assignment.assignmentFingerprint}`) throw new MetaOosLedgerError("IDENTITY_CONFLICT", "recorded meta-OOS assignment does not match its ledger identity");
      assignments.push(assignment);
    }
    return assignments;
  }

  /**
   * Records a partition assignment exactly once, refusing a second partition for the same cycle.
   *
   * The holdout claim is taken before anything is written, so a contaminated holdout never leaves a
   * record behind claiming the cycle was validly observed.
   */
  public assign(input: MetaOosAssignmentInput, holdouts: HoldoutClaimPort): MetaOosDurableReceipt {
    const existing = this.records().find((assignment) => assignment.learningCycleId === input.learningCycleId);
    if (existing != null) {
      if (existing.partition !== input.partition) {
        // Two successors from the same predecessor: a fork, not a tie to break by timestamp.
        throw new MetaOosLedgerError("PARTITION_FORK", "cycle " + input.learningCycleId + " is already assigned to " + existing.partition + " and may not be re-assigned to " + input.partition);
      }
      assertMetaOosAssignmentReplay(input, existing, holdouts);
      const record = this.ledger.list().find((candidate) => candidate.opportunityId === `meta-oos:${existing.assignmentFingerprint}`);
      return Object.freeze({ assignment: existing, fingerprint: existing.assignmentFingerprint, recordedAt: record?.recordedAt ?? new Date(this.now()).toISOString(), replayed: true });
    }

    const recorded = this.ledger.list().length;
    if (recorded >= MAX_RECORDS) throw new MetaOosLedgerError("CAPACITY_EXCEEDED", "learning ledger capacity is exhausted");
    const timestamp = this.now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new MetaOosLedgerError("INVALID_CLOCK", "durable clock is invalid");

    // Validate every fallible persistence precondition before consuming a single-use holdout.
    const assignment = assignMetaPartition(input, holdouts);

    const record = this.ledger.append({
      opportunityId: `meta-oos:${assignment.assignmentFingerprint}`,
      problem: "NUSA meta-OOS partition assignment: which cross-cycle partition judged this learning cycle",
      evidenceReferences: Object.freeze([
        `meta-oos:${assignment.assignmentFingerprint}`,
        assignment.learningCycleId,
        assignment.learningDecisionFingerprint,
        ...(assignment.holdoutClaimIdentity == null ? [] : ["holdout:" + assignment.holdoutClaimIdentity]),
      ]),
      hypothesis: canonicalResearchJson(assignment),
      changeReference: assignment.policyVersion,
      validationStatus: "META_OOS_ASSIGNMENT",
      // As in A2, A1, and A4, `outcome` records only that the record was formed correctly. The real
      // conclusion lives in the eligibility the assignments collectively support.
      outcome: "SUCCESS",
      failureReason: null,
      rollbackReference: null,
      reusable: true,
      recordedAt: new Date(timestamp).toISOString(),
    });

    const replayed = parseRecord(record);
    if (replayed.assignmentFingerprint !== assignment.assignmentFingerprint) throw new MetaOosLedgerError("IDENTITY_CONFLICT", "recorded meta-OOS assignment did not survive canonical replay identically");
    return Object.freeze({ assignment: replayed, fingerprint: replayed.assignmentFingerprint, recordedAt: record.recordedAt, replayed: false });
  }

  /** Every durable assignment, in ledger order, re-verified against its own fingerprint. */
  public assignments(): readonly MetaOosAssignment[] {
    return Object.freeze(this.records());
  }

  public partitionOf(learningCycleId: string): MetaPartition | undefined {
    return this.records().find((assignment) => assignment.learningCycleId === learningCycleId)?.partition;
  }

  /**
   * The eligibility proof A4 consumes.
   *
   * Derived only from durable assignments, so a decision cannot buy eligibility by asserting a cycle
   * count of its own.
   */
  public eligibility(partition: MetaPartition, identity: Pick<MetaOosEligibility, "learningCycleId" | "learningDecisionFingerprint">): MetaOosEligibility {
    return metaOosEligibility(this.records(), partition, identity);
  }

  public summary(): { readonly assignmentsRecorded: number; readonly train: number; readonly validation: number; readonly holdout: number } {
    const records = this.records();
    return Object.freeze({
      assignmentsRecorded: records.length,
      train: records.filter((record) => record.partition === "meta-train").length,
      validation: records.filter((record) => record.partition === "meta-validation").length,
      holdout: records.filter((record) => record.partition === "meta-holdout").length,
    });
  }
}
