import { parseShadowStartIpc, parseShadowStatusIpc } from "./shadowIpcValidation";
import type { RuntimeContext } from "./runtimeContext";
import { buildShadowReadOnlyProjection } from "../shadow/shadowReadOnlyProjection";
import { replayShadowEvidenceTimeline } from "../shadow/shadowEvidenceArchive";

export function registerShadowIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("shadow:start", (_event, input: unknown) => {
    parseShadowStartIpc(input);
    const blockers = ctx.shadowRuntime.startPrecheckBlockers(false);
    if (blockers.length > 0) throw new Error(`shadow preflight blocked: ${blockers.join(",")}`);
    const result = ctx.shadowRuntime.start();
    ctx.lastEvidenceId = `session-start:${result.sessionId}`;
    ctx.updateCrashMarker();
    return result;
  });
  ctx.ipcMain.handle("shadow:preflight", () => ctx.shadowRuntime.startPrecheckBlockers(false));
  ctx.ipcMain.handle("shadow:pause", (_event, input: unknown) => {
    ctx.requireCurrentShadowSession(input);
    const result = ctx.shadowRuntime.pause();
    ctx.updateCrashMarker();
    return result;
  });
  ctx.ipcMain.handle("shadow:resume", (_event, input: unknown) => {
    ctx.requireCurrentShadowSession(input);
    const result = ctx.shadowRuntime.resume();
    ctx.updateCrashMarker();
    return result;
  });
  ctx.ipcMain.handle("shadow:stop", (_event, input: unknown) => {
    ctx.requireCurrentShadowSession(input);
    const result = ctx.shadowRuntime.stop();
    ctx.lastEvidenceId = `session-stop:${result.sessionId}`;
    ctx.updateCrashMarker();
    return result;
  });
  ctx.ipcMain.handle("shadow:status", (_event, input: unknown) => {
    parseShadowStatusIpc(input);
    return ctx.shadowRuntime.diagnostics();
  });
  ctx.ipcMain.handle("shadow:observability", async (_event, input: unknown) => {
    parseShadowStatusIpc(input);
    const replay = await replayShadowEvidenceTimeline(ctx.diagnosticsEvidenceRoot);
    return buildShadowReadOnlyProjection({ diagnostics: ctx.shadowRuntime.diagnostics(), events: [...replay.events, ...ctx.shadowRuntime.eventLog()] });
  });
}
