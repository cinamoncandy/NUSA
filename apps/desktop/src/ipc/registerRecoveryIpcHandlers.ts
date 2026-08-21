import { approveRecoveryReview, completeRecovery } from "../recovery/recoveryReconciliation";
import { parseRecoveryCompleteIpc, parseRecoveryOwnerReviewIpc, parseRecoveryReconcileIpc, parseRecoveryStatusIpc } from "./recoveryIpcValidation";
import type { RuntimeContext } from "./runtimeContext";

export function registerRecoveryIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("recovery:status", (_event, input: unknown) => {
    parseRecoveryStatusIpc(input);
    return ctx.recoveryReview.status();
  });

  /** Read-only. Runs the comparison and records it; it cannot approve or clear anything. */
  ctx.ipcMain.handle("recovery:reconcile", (_event, input: unknown) => {
    parseRecoveryReconcileIpc(input);
    const comparison = ctx.buildRecoveryComparison();
    ctx.recoveryReview.recordComparison(comparison);
    ctx.control.record("SYSTEM", `Recovery reconciliation: ${comparison.outcome}${comparison.mismatchCodes.length > 0 ? ` (${comparison.mismatchCodes.join(",")})` : ""}${comparison.errorCodes.length > 0 ? ` (${comparison.errorCodes.join(",")})` : ""}`);
    return ctx.recoveryReview.status();
  });

  /**
   * Records the owner's decision. Refuses unless a comparison has actually been run and
   * MATCHED -- the renderer cannot approve a comparison that never happened, and re-running
   * the comparison here rather than reusing a stale one would defeat the fingerprint binding.
   */
  ctx.ipcMain.handle("recovery:owner-review", (_event, input: unknown) => {
    parseRecoveryOwnerReviewIpc(input);
    const comparison = ctx.recoveryReview.latestComparison();
    if (comparison === null) throw new Error("recovery reconciliation has not been run");
    const result = approveRecoveryReview({ comparison, explicitOwnerAction: true, reviewedAt: Date.now() });
    if (!result.approved || result.approval === null) throw new Error(`owner review refused: ${result.refusal}`);
    ctx.recoveryReview.recordApproval(result.approval);
    ctx.control.record("SYSTEM", `Recovery owner review approved by ${result.approval.reviewer} for record ${result.approval.recoveryRecordId}`);
    return ctx.recoveryReview.status();
  });

  ctx.ipcMain.handle("recovery:complete", (_event, input: unknown) => {
    parseRecoveryCompleteIpc(input);
    const comparison = ctx.recoveryReview.latestComparison();
    if (comparison === null) throw new Error("recovery reconciliation has not been run");
    const result = completeRecovery({ comparison, approval: ctx.recoveryReview.latestApproval(), completedAt: Date.now() });
    ctx.control.record("SYSTEM", `${result.auditEvent.kind}: ${result.auditEvent.detail}`);
    if (result.refusal !== null) throw new Error(`recovery completion refused: ${result.refusal}`);
    ctx.recoveryReview.markCompleted();
    // The record is marked COMPLETED, never removed: what was recovered and who approved it is
    // the audit trail, and deleting it would destroy the only account of this decision.
    return ctx.recoveryReview.status();
  });
}
