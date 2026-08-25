import { parseKillSwitchReleaseIpc, parseKillSwitchActivateIpc } from "./killSwitchIpcValidation";
import type { RuntimeContext } from "./runtimeContext";

export function registerSafetyIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("safety:kill-switch-release", (_event, input: unknown) => {
    const { reason } = parseKillSwitchReleaseIpc(input);
    const previousState = ctx.persistedKillSwitchActive;
    ctx.recordKillSwitchAudit("KILL_SWITCH_RELEASED", reason, previousState, false);
    ctx.persistedKillSwitchActive = false;
    ctx.persistedKillSwitchReason = null;
    ctx.persistedKillSwitchActivatedAt = null;
    // Durable immediately: a crash right after this call must still recover to "released" on
    // restart, not fall back to whatever the last order/command happened to persist.
    try { ctx.saveSafety(ctx.broker.exportState(), ctx.control.exportState()); } catch { /* best-effort continuity; the audit record above is the authoritative account of this action */ }
    ctx.publishControl();
    ctx.publishAiCioDashboard();
    return { killSwitchActive: ctx.persistedKillSwitchActive };
  });

  ctx.ipcMain.handle("safety:kill-switch-activate", (_event, input: unknown) => {
    const { reason } = parseKillSwitchActivateIpc(input);
    const previousState = ctx.persistedKillSwitchActive;
    ctx.recordKillSwitchAudit("KILL_SWITCH_ACTIVATED", reason, previousState, true);
    ctx.persistedKillSwitchActive = true;
    ctx.persistedKillSwitchReason = reason;
    ctx.persistedKillSwitchActivatedAt = Date.now();
    if (ctx.currentStrategyApprovalId !== undefined && ctx.paperApprovalService) {
      try { ctx.paperApprovalService.revoke(ctx.currentStrategyApprovalId, "KILL_SWITCH_ACTIVATED"); } catch { /* best-effort */ }
      ctx.currentStrategyApprovalId = undefined;
    }
    try { ctx.saveSafety(ctx.broker.exportState(), ctx.control.exportState()); } catch { /* best-effort continuity; the audit record above is the authoritative account of this action */ }
    ctx.publishControl();
    ctx.publishAiCioDashboard();
    return { killSwitchActive: ctx.persistedKillSwitchActive };
  });
}
