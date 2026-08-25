import { PERSISTENCE_REPAIR_MESSAGE } from "../control/runtimeCommandService";
import type { RuntimeContext } from "./runtimeContext";

/**
 * WO-0019. "Explicit user starts the strategy" is exactly the control:start call -- there is no
 * other path that reaches runtime.start(). A fresh STRATEGY approval is minted every time it
 * fires, and any approval left over from a previous start is revoked first, so at most one is
 * ever live. Nothing here re-issues automatically: a process restart calls neither this handler
 * nor issueStrategyApproval, so automaticSignal stays blocked with APPROVAL_MISSING until an
 * operator clicks start again.
 */
export function registerControlIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("control:snapshot", () => ctx.control.snapshot());
  ctx.ipcMain.handle("control:start", () => {
    if (!ctx.paperApprovalService) throw new Error(PERSISTENCE_REPAIR_MESSAGE);
    if (ctx.currentStrategyApprovalId !== undefined) {
      try { ctx.paperApprovalService.revoke(ctx.currentStrategyApprovalId, "STRATEGY_RESTARTED"); } catch { /* best-effort: an already-expired/missing id is not an error */ }
    }
    const approval = ctx.paperApprovalService.issueStrategyApproval({ symbol: ctx.MARKET, strategyId: ctx.smaStrategy.id, policyFingerprint: ctx.PAPER_SAFETY_FINGERPRINTS.riskPolicy, nowMs: Date.now() });
    ctx.currentStrategyApprovalId = approval.approvalId;
    return ctx.runControlCommand(() => ctx.runtime.start());
  });
  ctx.ipcMain.handle("control:stop", () => {
    if (ctx.currentStrategyApprovalId !== undefined && ctx.paperApprovalService) {
      try { ctx.paperApprovalService.revoke(ctx.currentStrategyApprovalId, "STRATEGY_STOPPED"); } catch { /* best-effort */ }
      ctx.currentStrategyApprovalId = undefined;
    }
    return ctx.runControlCommand(() => ctx.runtime.stop());
  });
  ctx.ipcMain.handle("control:auto", (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("invalid auto-trade input");
    if (enabled) ctx.assertFreshMarketData();
    return ctx.runControlCommand(() => ctx.runtime.setAutoTrade(enabled));
  });
  ctx.ipcMain.handle("control:quantity", (_event, quantity: unknown) => {
    if (typeof quantity !== "number" || !Number.isFinite(quantity)) throw new Error("invalid quantity input");
    return ctx.runControlCommand(() => ctx.runtime.setOrderQuantity(quantity));
  });
}
