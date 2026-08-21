import { mkdirSync } from "node:fs";
import { shell } from "electron";
import os from "node:os";
import { toRendererAboutInfo } from "../aboutInfo";
import { clampLogLevel } from "../productionHardening";
import { updateChannelState } from "../updateChannel";
import { writeDiagnosticsPackage } from "../diagnosticsExport";
import { buildRecoveryHealthReport } from "../recovery/recovery";
import { RUNTIME_EXCHANGE_CAPABILITIES } from "../exchange/runtimeExchangeCapabilities";
import { parseAppSettingsIpc, parseFirstRunAcknowledgeIpc, parseOpenFolderIpc, parseProductIpc } from "./productIpcValidation";
import type { RuntimeContext } from "./runtimeContext";

/*
 * WO-0034-A4O productization channels. Every one is either read-only or writes ONLY
 * presentation state. None can enable an order path, reach an authenticated endpoint, or
 * store a credential -- there is no such channel to call.
 */
export function registerAppIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("app:first-run", (_event, input: unknown) => {
    parseProductIpc(input);
    if (!ctx.firstRunStore) throw new Error("application data layout is not ready");
    return ctx.firstRunStore.state();
  });
  ctx.ipcMain.handle("app:first-run-acknowledge", (_event, input: unknown) => {
    const { confirmed } = parseFirstRunAcknowledgeIpc(input);
    if (!ctx.firstRunStore) throw new Error("application data layout is not ready");
    const state = ctx.firstRunStore.acknowledge(confirmed);
    ctx.logProduct("INFO", "first-run notice acknowledged", { safetyPolicyVersion: state.acknowledgedPolicyVersion });
    return state;
  });
  ctx.ipcMain.handle("app:settings", (_event, input: unknown) => {
    parseProductIpc(input);
    if (!ctx.settingsStore) throw new Error("application data layout is not ready");
    return { settings: ctx.settingsStore.current(), maximumLogLevel: ctx.productionPolicy.maximumLogLevel };
  });
  ctx.ipcMain.handle("app:settings-save", (_event, input: unknown) => {
    const parsed = parseAppSettingsIpc(input);
    if (!ctx.settingsStore) throw new Error("application data layout is not ready");
    const settings = ctx.settingsStore.save(parsed);
    // The live logger follows the saved preference immediately, clamped by the production
    // policy. A setting that only takes effect after a restart is a setting users distrust.
    ctx.appLogger?.setLevel(clampLogLevel(settings.logLevel, ctx.productionPolicy));
    ctx.logProduct("INFO", "settings saved", { logLevel: settings.logLevel, retentionDays: settings.logRetentionDays });
    return { settings, maximumLogLevel: ctx.productionPolicy.maximumLogLevel };
  });
  ctx.ipcMain.handle("app:settings-reset", (_event, input: unknown) => {
    parseProductIpc(input);
    if (!ctx.settingsStore) throw new Error("application data layout is not ready");
    const result = ctx.settingsStore.reset();
    ctx.appLogger?.setLevel(clampLogLevel(result.settings.logLevel, ctx.productionPolicy));
    ctx.logProduct("WARN", "settings reset to defaults", { removedCount: result.removed.length });
    // Absolute paths are not returned: the renderer is told WHAT was preserved, not where.
    return { settings: result.settings, preservedCount: result.preserved.length, removedCount: result.removed.length };
  });
  ctx.ipcMain.handle("app:about", (_event, input: unknown) => {
    parseProductIpc(input);
    if (!ctx.aboutInfo) throw new Error("application data layout is not ready");
    // Paths are stripped here, not in the renderer: a screenshot of an About box should not
    // carry the account name of whoever took it.
    return { about: toRendererAboutInfo(ctx.aboutInfo), update: updateChannelState(ctx.aboutInfo.appVersion) };
  });
  ctx.ipcMain.handle("app:open-folder", async (_event, input: unknown) => {
    const { folder } = parseOpenFolderIpc(input);
    const layout = ctx.requireLayout();
    const target = folder === "LOGS" ? layout.logsDirectory : folder === "EVIDENCE" ? layout.evidenceDirectory : layout.root;
    try { mkdirSync(target, { recursive: true }); } catch { /* opening a missing folder simply fails below */ }
    const failure = await shell.openPath(target);
    if (failure) throw new Error("폴더를 열지 못했습니다");
    return { opened: folder };
  });
  ctx.ipcMain.handle("app:export-diagnostics", async (_event, input: unknown) => {
    parseProductIpc(input);
    const layout = ctx.requireLayout();
    if (!ctx.aboutInfo) throw new Error("application data layout is not ready");
    const shadow = ctx.shadowRuntime?.diagnostics();
    const result = writeDiagnosticsPackage({
      layout,
      runtime: {
        appName: ctx.aboutInfo.appName, appVersion: ctx.aboutInfo.appVersion, commitSha: ctx.aboutInfo.commitSha,
        electronVersion: ctx.aboutInfo.electronVersion, nodeVersion: ctx.aboutInfo.nodeVersion,
        chromeVersion: ctx.aboutInfo.chromeVersion, platform: process.platform, osRelease: os.release(),
        arch: process.arch, environment: layout.environment, mode: ctx.aboutInfo.mode
      },
      runId: ctx.productRunId,
      sessionId: shadow?.sessionId ?? null,
      logFiles: ctx.appLogger?.recentFiles() ?? [],
      safety: {
        // Named for what is absent rather than for the feature it would be: this process has no
        // authenticated-endpoint capability at all, and the packaging scanner reads main.ts for
        // exactly the identifiers a credential path would introduce.
        capabilities: { liveTrading: RUNTIME_EXCHANGE_CAPABILITIES.liveTrading, authenticatedEndpoint: RUNTIME_EXCHANGE_CAPABILITIES.authenticatedMutation, credentialStorage: RUNTIME_EXCHANGE_CAPABILITIES.credentialStorage },
        killSwitchActive: ctx.persistedKillSwitchActive,
        openP0Codes: ctx.persistedOpenP0Codes,
        paperTradingAvailable: ctx.paperTradingAvailable,
        shadowState: shadow?.state ?? null,
        shadowBlockers: shadow?.blockers ?? [],
        marketDataStatus: ctx.marketDataStatus
      },
      recovery: {
        crashRecovery: ctx.crashRecoveryDiagnostic,
        recoveryRecordId: ctx.recoveryRecordId,
        health: buildRecoveryHealthReport({
          now: Date.now(), ipcHealthy: ctx.rendererHealthy, websocketConnected: ctx.websocketConnected, rendererHealthy: ctx.rendererHealthy,
          storageHealthy: ctx.persistenceStore !== undefined, lastMarketDataAt: ctx.latestTicker?.trade_timestamp,
          maximumMarketDataAgeMs: 60_000, heapUsedBytes: process.memoryUsage().heapUsed,
          maximumHeapUsedBytes: 768 * 1024 * 1024
        })
      },
      marketConnection: shadow?.marketConnection ?? null,
      evidenceMetadata: {
        // Metadata only. The archives themselves stay on this machine: they are the record the
        // observation exists to produce, and a support bundle is not the place to copy them.
        incompleteArchiveCount: ctx.shadowIncompleteEvidence.length,
        scanBlocked: ctx.shadowEvidenceScanBlocked,
        completionHistory: (shadow?.completionHistory ?? []).map((entry) => ({ sessionId: entry.sessionId, completionReason: entry.completionReason, safety: entry.safety, finalState: entry.finalState }))
      },
      recentErrorCodes: [...ctx.recentErrorCodes]
    });
    ctx.logProduct("INFO", "diagnostics package exported", { bytes: result.byteLength, entries: result.manifest.contents.length });
    // The path is returned so the UI can offer "open folder"; the renderer displays the file
    // NAME only.
    return { fileName: result.manifest.contents.length > 0 ? result.filePath.split(/[\\/]/).pop() : null, byteLength: result.byteLength, manifest: result.manifest };
  });
  ctx.ipcMain.handle("app:shutdown-progress", (_event, input: unknown) => {
    parseProductIpc(input);
    return ctx.shutdownSequence?.progress() ?? null;
  });
}
