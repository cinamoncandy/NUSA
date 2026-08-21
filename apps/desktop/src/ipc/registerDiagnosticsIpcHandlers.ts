import { app } from "electron";
import { buildA4RuntimeDiagnostics } from "../diagnostics/a4RuntimeDiagnostics";
import { RISK_CAPABILITY_DESCRIPTOR } from "../../../../packages/contracts/src/global-risk-gateway";
import type { RuntimeContext } from "./runtimeContext";

export function registerDiagnosticsIpcHandlers(ctx: RuntimeContext): void {
  ctx.ipcMain.handle("diagnostics:a4", () => buildA4RuntimeDiagnostics({
    preflight: ctx.operationalPreflight,
    shadow: ctx.shadowRuntime.diagnostics(),
    evidenceRoot: ctx.diagnosticsEvidenceRoot,
    incompleteArchives: ctx.shadowEvidenceScanBlocked ? ["UNREADABLE_SHADOW_EVIDENCE"] : ctx.shadowIncompleteEvidence,
    evidenceBus: ctx.shadowRuntime.evidenceDiagnostics(),
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 },
    startPrecheckBlockers: ctx.shadowRuntime.startPrecheckBlockers(false),
    market: {
      connected: ctx.websocketConnected,
      lastHeartbeatAt: ctx.stream ? ctx.stream.connectionDiagnostics().lastMarketMessageAt : null,
      source: "UPBIT_PUBLIC_CLOSED_CANDLE"
    },
    safety: {
      killSwitchActive: ctx.persistedKillSwitchActive,
      openP0Count: ctx.persistedOpenP0Codes.length,
      reasonCode: ctx.persistedKillSwitchReason,
      activatedAt: ctx.persistedKillSwitchActivatedAt,
      activationSource: ctx.persistedKillSwitchActive ? "PERSISTED_PAPER_SAFETY_SNAPSHOT" : null,
      openP0Codes: ctx.persistedOpenP0Codes
    },
    crashRecovery: ctx.crashRecoveryDiagnostic
  }));

  // Operations is intentionally a read-only projection of facts already owned by the main
  // process. It exposes no execution, credential, or arbitrary IPC capability to the renderer.
  ctx.ipcMain.handle("operations:snapshot", () => {
    const recoveryReviewStatus = ctx.recoveryReview.status();
    return Object.freeze({
      applicationVersion: ctx.aboutInfo?.appVersion ?? app.getVersion(),
      buildVersion: ctx.PAPER_SAFETY_SOURCE_COMMIT,
      gitCommit: ctx.PAPER_SAFETY_SOURCE_COMMIT,
      mode: "PAPER",
      liveTradingDisabled: true,
      productionMutationAllowed: false,
      exchange: Object.freeze({ name: "UPBIT", status: ctx.marketDataStatus }),
      marketData: Object.freeze({
        symbol: ctx.MARKET,
        status: ctx.marketDataStatus,
        connected: ctx.websocketConnected,
        lastMessageAt: ctx.stream ? ctx.stream.connectionDiagnostics().lastMarketMessageAt : null
      }),
      warmup: Object.freeze({ ready: ctx.marketDataStatus === "HEALTHY", status: ctx.marketDataStatus }),
      shadow: ctx.shadowRuntime ? ctx.shadowRuntime.diagnostics() : null,
      preflight: ctx.operationalPreflight,
      control: ctx.control ? ctx.control.snapshot() : null,
      recovery: Object.freeze({
        required: ctx.crashRecoveryRequired,
        recordId: ctx.recoveryRecordId,
        diagnostic: ctx.crashRecoveryDiagnostic,
        review: recoveryReviewStatus
      }),
      reconciliation: Object.freeze({
        status: recoveryReviewStatus.reconciliation,
        mismatchCodes: recoveryReviewStatus.mismatchCodes,
        errorCodes: recoveryReviewStatus.errorCodes,
        checkedAt: recoveryReviewStatus.checkedAt,
        gate: recoveryReviewStatus.gate
      }),
      execution: Object.freeze({ activeCount: ctx.executionRepository?.listActive().length ?? 0 }),
      audit: ctx.persistenceStore?.loadOperationsAudit() ?? ctx.operationsAudit,
      alerts: ctx.persistenceStore?.loadOperationsAlerts() ?? ctx.operationsAlerts,
      risk: Object.freeze({ status: ctx.operationalPreflight.riskGate.status, capability: RISK_CAPABILITY_DESCRIPTOR }),
      killSwitch: Object.freeze({ active: ctx.persistedKillSwitchActive, reasonCode: ctx.persistedKillSwitchReason }),
      openP0Codes: ctx.persistedOpenP0Codes,
      // This process has no authenticated endpoint capability. The neutral counter name also
      // avoids turning a read-only diagnostics field into a capability-looking API surface.
      mutationCounters: Object.freeze({ orders: 0, fills: 0, cash: 0, position: 0, broker: 0, authenticatedEndpointCalls: 0 }),
      observedAt: new Date().toISOString()
    });
  });
}
