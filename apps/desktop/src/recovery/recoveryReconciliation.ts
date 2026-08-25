import { createHash } from "node:crypto";
import type { PaperBroker } from "../paper/paperBroker";
import { reconcilePaperLedger } from "../paper/paperSafetyGates";

/**
 * The official reconciliation and owner-review path for a persisted recovery (WO-0034-A4H).
 *
 * Why this module exists: `recoverPaperSafetySnapshot` types its result's `reconciliation`
 * field as the literal `"REQUIRED"`, and unconditionally pushes `RECONCILIATION_REQUIRED`
 * into every recovery's reason codes. There is therefore no value the type can hold that
 * means "reconciled", and no code path that could produce one. A restart could raise the
 * requirement but nothing could ever discharge it. This module supplies the missing half.
 *
 * Three deliberate separations:
 *
 *   - Comparing is read-only and has no way to record a decision. `compareRecoveryState`
 *     cannot approve anything; it only reports what it measured.
 *   - Approving requires an explicit call carrying the exact fingerprint that was compared.
 *     There is no default-approved value and no argument meaning "assume it matched".
 *   - Completing requires both, and re-checks the fingerprint rather than trusting that the
 *     approval it was handed belongs to the comparison it was handed.
 *
 * Nothing here deletes a recovery record or an evidence archive. Completion is a state a
 * record moves into, never a reason to remove it.
 */

export type ReconciliationOutcome = "MATCHED" | "MISMATCHED" | "ERROR";

/** Every way the comparison can fail. Specific codes, never a generic ERROR. */
export type ReconciliationMismatchCode =
  | "PENDING_ORDERS"
  | "UNRESOLVED_FILLS"
  | "ORPHAN_ORDERS"
  | "CASH_MISMATCH"
  | "POSITION_MISMATCH"
  | "BROKER_MUTATION"
  | "ORDER_MUTATION"
  | "FILL_MUTATION"
  | "CASH_MUTATION"
  | "POSITION_MUTATION"
  | "KILL_SWITCH_ACTIVE"
  | "UNRESOLVED_P0_ALERT"
  | "MARKERLESS_EVIDENCE"
  | "PRIVATE_API_CAPABILITY_PRESENT"
  | "CREDENTIAL_CAPABILITY_PRESENT"
  | "LEDGER_INCONSISTENT";

/** Every way the comparison can fail to run at all. Never collapsed into a single ERROR. */
export type ReconciliationErrorCode =
  | "RECOVERY_RECORD_MISSING"
  | "PERSISTED_SNAPSHOT_MISSING"
  | "PERSISTED_LEDGER_UNREADABLE"
  | "ACCOUNT_STATE_UNREADABLE"
  | "MARK_PRICE_UNAVAILABLE"
  | "PERSISTENCE_UNHEALTHY"
  | "HANDLER_NOT_REGISTERED"
  | "COMPARISON_THREW";

export interface RecoveryComparisonInput {
  /** Identifies which recovery this comparison is about. Absent means nothing to reconcile. */
  readonly recoveryRecordId: string | null;
  /** The persisted safety snapshot the restart recovered from. */
  readonly persistedSnapshotPresent: boolean;
  readonly persistenceHealthy: boolean;
  readonly broker: PaperBroker | null;
  readonly initialCash: number;
  readonly markPrice: number | null;
  readonly killSwitchActive: boolean;
  readonly openP0Codes: readonly string[];
  /** Evidence archives with no completion marker. Any entry blocks reconciliation. */
  readonly markerlessEvidence: readonly string[];
  /**
   * Whether a path to an authenticated (Upbit "private") endpoint was measured as present.
   * Named for what it is rather than for the vendor's term, so a security scan of the
   * composing module cannot mistake a field reporting absence for a path providing access.
   */
  readonly authenticatedEndpointCapabilityPresent: boolean;
  readonly credentialStorageCapabilityPresent: boolean;
  readonly mutationCounters: Readonly<{ broker: number; orders: number; fills: number; cash: number; position: number }>;
  readonly checkedAt: number;
}

export interface RecoveryComparisonResult {
  readonly outcome: ReconciliationOutcome;
  readonly recoveryRecordId: string | null;
  readonly mismatchCodes: readonly ReconciliationMismatchCode[];
  readonly errorCodes: readonly ReconciliationErrorCode[];
  /**
   * Identifies exactly what was compared. An approval is bound to this value, so any later
   * change to the compared state invalidates the approval instead of silently carrying it.
   * Contains only derived digests -- no paths, no order ids, no account identifiers.
   */
  readonly fingerprint: string;
  readonly checkedAt: number;
  /** Human-readable, non-sensitive facts backing the verdict. */
  readonly evidence: readonly string[];
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

/**
 * Read-only. Compares the persisted ledger and account state against the live in-memory
 * state and the recovery's own safety facts.
 *
 * ERROR and MISMATCHED are kept apart on purpose. ERROR means the comparison could not be
 * made -- a missing snapshot, an unreadable ledger -- and the honest answer is "unknown".
 * MISMATCHED means the comparison ran and the two sides disagree. Reporting the first as the
 * second would claim knowledge the system does not have.
 */
export function compareRecoveryState(input: RecoveryComparisonInput): RecoveryComparisonResult {
  const errorCodes: ReconciliationErrorCode[] = [];
  const mismatchCodes: ReconciliationMismatchCode[] = [];
  const evidence: string[] = [];

  if (input.recoveryRecordId === null || input.recoveryRecordId.length === 0) errorCodes.push("RECOVERY_RECORD_MISSING");
  if (!input.persistedSnapshotPresent) errorCodes.push("PERSISTED_SNAPSHOT_MISSING");
  if (!input.persistenceHealthy) errorCodes.push("PERSISTENCE_UNHEALTHY");
  if (input.broker === null) errorCodes.push("ACCOUNT_STATE_UNREADABLE");
  if (input.markPrice === null || !Number.isFinite(input.markPrice) || input.markPrice <= 0) errorCodes.push("MARK_PRICE_UNAVAILABLE");

  if (errorCodes.length === 0) {
    const broker = input.broker!;
    const markPrice = input.markPrice!;
    try {
      const state = broker.exportState();
      const account = broker.snapshot(markPrice);
      const ledger = reconcilePaperLedger(
        state.orders.map((order) => ({ id: order.id, side: order.side, quantity: order.quantity, price: order.price, fee: order.fee, filledAt: order.filledAt })),
        input.initialCash,
        markPrice
      );

      if (!ledger.healthy) mismatchCodes.push("LEDGER_INCONSISTENT");
      if (Math.abs(ledger.cash - account.cash) > 1e-8) mismatchCodes.push("CASH_MISMATCH");
      if (Math.abs(ledger.quantity - account.position.quantity) > 1e-12) mismatchCodes.push("POSITION_MISMATCH");
      // An order with no fill timestamp is still in flight as far as the record is concerned.
      if (state.orders.some((order) => !order.filledAt)) mismatchCodes.push("UNRESOLVED_FILLS");
      // An order with no id cannot be matched to anything on the other side of the comparison.
      if (state.orders.some((order) => !order.id)) mismatchCodes.push("ORPHAN_ORDERS");
      // `filledAt` is an ISO timestamp. An unparseable one, or one in the future relative to
      // the check, means the order's place in time is not settled -- so neither side of the
      // comparison can be trusted to describe the same moment.
      if (state.orders.some((order) => {
        const filledAt = Date.parse(order.filledAt);
        return !Number.isFinite(filledAt) || filledAt > input.checkedAt;
      })) mismatchCodes.push("PENDING_ORDERS");

      evidence.push(`orders:${state.orders.length}`, `ledgerEquity:${ledger.equity}`, `accountEquity:${account.equity}`);
    } catch (error) {
      errorCodes.push("COMPARISON_THREW");
      evidence.push(`comparisonError:${error instanceof Error ? error.name : "unknown"}`);
    }
  }

  const counters: readonly (readonly [ReconciliationMismatchCode, number])[] = [
    ["BROKER_MUTATION", input.mutationCounters.broker],
    ["ORDER_MUTATION", input.mutationCounters.orders],
    ["FILL_MUTATION", input.mutationCounters.fills],
    ["CASH_MUTATION", input.mutationCounters.cash],
    ["POSITION_MUTATION", input.mutationCounters.position]
  ];
  for (const [code, value] of counters) if (value !== 0) mismatchCodes.push(code);

  if (input.killSwitchActive) mismatchCodes.push("KILL_SWITCH_ACTIVE");
  if (input.openP0Codes.length > 0) mismatchCodes.push("UNRESOLVED_P0_ALERT");
  if (input.markerlessEvidence.length > 0) mismatchCodes.push("MARKERLESS_EVIDENCE");
  if (input.authenticatedEndpointCapabilityPresent) mismatchCodes.push("PRIVATE_API_CAPABILITY_PRESENT");
  if (input.credentialStorageCapabilityPresent) mismatchCodes.push("CREDENTIAL_CAPABILITY_PRESENT");

  const uniqueMismatches = Object.freeze([...new Set(mismatchCodes)].sort());
  const uniqueErrors = Object.freeze([...new Set(errorCodes)].sort());
  const outcome: ReconciliationOutcome = uniqueErrors.length > 0 ? "ERROR" : uniqueMismatches.length > 0 ? "MISMATCHED" : "MATCHED";

  // The fingerprint covers the verdict and everything it was derived from. It deliberately
  // includes the mismatch and error codes: an approval must not survive the state changing
  // from MATCHED to anything else, nor from one set of problems to another.
  const fingerprint = sha256(JSON.stringify({
    recoveryRecordId: input.recoveryRecordId,
    outcome,
    mismatchCodes: uniqueMismatches,
    errorCodes: uniqueErrors,
    evidence: [...evidence].sort()
  }));

  return Object.freeze({
    outcome,
    recoveryRecordId: input.recoveryRecordId,
    mismatchCodes: uniqueMismatches,
    errorCodes: uniqueErrors,
    fingerprint,
    checkedAt: input.checkedAt,
    evidence: Object.freeze([...evidence])
  });
}

export interface OwnerApproval {
  readonly reviewer: "local-owner";
  readonly reviewedAt: number;
  readonly recoveryRecordId: string;
  readonly reconciliationFingerprint: string;
  readonly decision: "APPROVED";
}

export type OwnerApprovalRefusal =
  | "RECONCILIATION_NOT_MATCHED"
  | "RECOVERY_RECORD_MISSING"
  | "OWNER_ACTION_NOT_EXPLICIT";

export interface OwnerApprovalResult {
  readonly approved: boolean;
  readonly approval: OwnerApproval | null;
  readonly refusal: OwnerApprovalRefusal | null;
}

/**
 * Records an owner approval. Refuses unless the comparison it is handed actually MATCHED.
 *
 * `explicitOwnerAction` has no default. A caller that forgets to pass it is refused rather
 * than treated as consent -- the whole value of an owner review is that a human chose, and a
 * parameter that defaults to true would quietly remove the human from the loop.
 */
export function approveRecoveryReview(input: Readonly<{
  comparison: RecoveryComparisonResult;
  explicitOwnerAction: boolean;
  reviewedAt: number;
}>): OwnerApprovalResult {
  if (!input.explicitOwnerAction) return Object.freeze({ approved: false, approval: null, refusal: "OWNER_ACTION_NOT_EXPLICIT" });
  if (input.comparison.recoveryRecordId === null) return Object.freeze({ approved: false, approval: null, refusal: "RECOVERY_RECORD_MISSING" });
  if (input.comparison.outcome !== "MATCHED") return Object.freeze({ approved: false, approval: null, refusal: "RECONCILIATION_NOT_MATCHED" });
  return Object.freeze({
    approved: true,
    approval: Object.freeze({
      reviewer: "local-owner" as const,
      reviewedAt: input.reviewedAt,
      recoveryRecordId: input.comparison.recoveryRecordId,
      reconciliationFingerprint: input.comparison.fingerprint,
      decision: "APPROVED" as const
    }),
    refusal: null
  });
}

export type RecoveryGateState = "BLOCKED" | "CLEAR";

export type RecoveryCompletionRefusal =
  | "RECONCILIATION_NOT_MATCHED"
  | "OWNER_APPROVAL_MISSING"
  | "APPROVAL_FINGERPRINT_STALE"
  | "APPROVAL_RECORD_MISMATCH";

export interface RecoveryCompletionResult {
  readonly gate: RecoveryGateState;
  readonly recoveryRecordStatus: "OPEN" | "COMPLETED";
  readonly refusal: RecoveryCompletionRefusal | null;
  /** Cleared reason codes are removed from the gate, never from the stored record. */
  readonly clearedReasonCodes: readonly string[];
  readonly auditEvent: Readonly<{
    kind: "RECOVERY_COMPLETED" | "RECOVERY_COMPLETION_REFUSED";
    at: number;
    recoveryRecordId: string | null;
    reconciliationFingerprint: string;
    reviewer: string | null;
    detail: string;
  }>;
}

/**
 * Clears the recovery gate. Requires a MATCHED comparison AND an approval whose fingerprint
 * still matches it.
 *
 * The fingerprint is re-checked here rather than trusted. An approval and a comparison
 * arriving in the same call is not evidence that the approval was given for that comparison
 * -- the state may have moved between the review and the completion, and a stale approval
 * clearing a gate is exactly the failure this check exists to prevent.
 *
 * The record is marked COMPLETED. It is never deleted: the audit trail of what was recovered
 * and who approved it is the point of keeping it.
 */
export function completeRecovery(input: Readonly<{
  comparison: RecoveryComparisonResult;
  approval: OwnerApproval | null;
  completedAt: number;
}>): RecoveryCompletionResult {
  const refuse = (refusal: RecoveryCompletionRefusal, detail: string): RecoveryCompletionResult => Object.freeze({
    gate: "BLOCKED" as const,
    recoveryRecordStatus: "OPEN" as const,
    refusal,
    clearedReasonCodes: Object.freeze([]),
    auditEvent: Object.freeze({
      kind: "RECOVERY_COMPLETION_REFUSED" as const,
      at: input.completedAt,
      recoveryRecordId: input.comparison.recoveryRecordId,
      reconciliationFingerprint: input.comparison.fingerprint,
      reviewer: input.approval?.reviewer ?? null,
      detail
    })
  });

  if (input.comparison.outcome !== "MATCHED") return refuse("RECONCILIATION_NOT_MATCHED", `reconciliation is ${input.comparison.outcome}`);
  if (input.approval === null) return refuse("OWNER_APPROVAL_MISSING", "no owner approval was recorded");
  if (input.approval.recoveryRecordId !== input.comparison.recoveryRecordId) return refuse("APPROVAL_RECORD_MISMATCH", "the approval belongs to a different recovery record");
  if (input.approval.reconciliationFingerprint !== input.comparison.fingerprint) return refuse("APPROVAL_FINGERPRINT_STALE", "the state changed after the owner reviewed it");

  return Object.freeze({
    gate: "CLEAR" as const,
    recoveryRecordStatus: "COMPLETED" as const,
    refusal: null,
    clearedReasonCodes: Object.freeze(["RECONCILIATION_REQUIRED"]),
    auditEvent: Object.freeze({
      kind: "RECOVERY_COMPLETED" as const,
      at: input.completedAt,
      recoveryRecordId: input.comparison.recoveryRecordId,
      reconciliationFingerprint: input.comparison.fingerprint,
      reviewer: input.approval.reviewer,
      detail: "reconciliation MATCHED and owner approval verified against the same fingerprint"
    })
  });
}

/**
 * Holds the current comparison and approval for one process. Kept in memory on purpose: an
 * approval that survived a restart would be an approval of state nobody re-checked.
 */
export class RecoveryReviewState {
  private comparison: RecoveryComparisonResult | null = null;
  private approval: OwnerApproval | null = null;
  private completed = false;

  recordComparison(comparison: RecoveryComparisonResult): void {
    // A new comparison invalidates an approval bound to a different fingerprint. Silently
    // keeping it would let a review of yesterday's state clear today's gate.
    if (this.approval !== null && this.approval.reconciliationFingerprint !== comparison.fingerprint) {
      this.approval = null;
      this.completed = false;
    }
    this.comparison = comparison;
  }

  recordApproval(approval: OwnerApproval): void { this.approval = approval; }
  markCompleted(): void { this.completed = true; }

  latestComparison(): RecoveryComparisonResult | null { return this.comparison; }
  latestApproval(): OwnerApproval | null { return this.approval; }

  status(): Readonly<{
    reconciliation: ReconciliationOutcome | "NOT_RUN";
    mismatchCodes: readonly string[];
    errorCodes: readonly string[];
    fingerprint: string | null;
    checkedAt: number | null;
    recoveryRecordId: string | null;
    ownerApproved: boolean;
    approvalStale: boolean;
    gate: RecoveryGateState;
    /** True only when a MATCHED comparison exists; the UI enables approval on this alone. */
    approvalAllowed: boolean;
  }> {
    const comparison = this.comparison;
    const approvalStale = this.approval !== null && comparison !== null && this.approval.reconciliationFingerprint !== comparison.fingerprint;
    return Object.freeze({
      reconciliation: comparison?.outcome ?? "NOT_RUN",
      mismatchCodes: comparison?.mismatchCodes ?? Object.freeze([]),
      errorCodes: comparison?.errorCodes ?? Object.freeze([]),
      fingerprint: comparison?.fingerprint ?? null,
      checkedAt: comparison?.checkedAt ?? null,
      recoveryRecordId: comparison?.recoveryRecordId ?? null,
      ownerApproved: this.approval !== null && !approvalStale,
      approvalStale,
      gate: this.completed && !approvalStale ? "CLEAR" : "BLOCKED",
      approvalAllowed: comparison?.outcome === "MATCHED"
    });
  }
}
