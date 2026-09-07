import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { evaluateOperationalReadiness } from "../../cloud/src/operationalReadinessGate";
import { InMemoryAiCioEnvelopeSource, registerAiCioReadOnlyIpc } from "./ai/aiCioIpcBridge";
import { AiCioSnapshotPublisher } from "./ai/aiCioSnapshotPublisher";
import { ControlPlane } from "./control/controlPlane";
import { ControlSessionStore } from "./control/controlSessionStore";
import { DesktopPersistenceStore, type OperationsAlertRecord, type OperationsAuditRecord } from "./persistence/desktopPersistenceStore";
import { LiveMarketRegimeObserver } from "./strategy/liveMarketRegimeObserver";
import { PaperBroker } from "./paper/paperBroker";
import { buildPaperDashboardSections } from "./paper/paperDashboardProjection";
import { buildPersistedResearchDashboardSection } from "./cloud/researchDashboardProjection";
import { buildPersistedCommitteeDashboardSection } from "./cloud/committeeDashboardProjection";
import { buildStrategyAnalytics } from "./strategy/strategyAnalytics";
import { resolveRendererIndexPath } from "./rendererPath";
import {
  createPreloadErrorDiagnostic,
  createRendererConsoleErrorDiagnostic,
  createRendererLoadFailedDiagnostic,
  createRendererLoadFinishedDiagnostic,
  createRendererNavigationBlockedDiagnostic,
  createRendererProcessGoneDiagnostic,
  createRendererResponsiveDiagnostic,
  createRendererUnresponsiveDiagnostic,
  formatDesktopStartupDiagnostic
} from "./desktopStartupDiagnostics";
import { PERSISTENCE_FAULT_MESSAGE, RuntimeCommandService, type PaperCommandRiskGate } from "./control/runtimeCommandService";
import { formatRuntimeMutationDiagnostic } from "./risk/runtimeMutationDiagnostics";
import { PaperSessionStore } from "./paper/paperSessionStore";
import { PaperScenarioEvidenceRecorder } from "./paper/paperScenarioEvidenceRecorder";
import { PaperRuntimeEvidenceState } from "./paper/paperRuntimeEvidenceState";
import { SmaCrossoverStrategy, StrategyEngine, type StrategySignal } from "./strategy/strategyEngine";
import { UpbitWebSocketClient, type UpbitTicker } from "./exchange/upbitWebSocket";
import type { MarketConnectionDiagnostics } from "./exchange/marketConnectionSupervisor";
import { buildRecoveryHealthReport, RecoveryLedger, type RecoveryComponent, type RecoveryHealth } from "./recovery/recovery";
import { createHash } from "node:crypto";
import { deriveRuntimeFingerprint } from "./runtimeFingerprint";
import { createPaperSafetySnapshot, recoverPaperSafetySnapshot } from "./paper/paperSafetySnapshot";
import { ShadowOperationalRuntime } from "./shadow/shadowOperationalRuntime";
import { findIncompleteShadowArchivesSync } from "./shadow/shadowEvidenceArchive";
import { SHADOW_OBSERVATION_PROFILE } from "./shadow/shadowObservationProfile";
import { createShadowEvidenceBusFactory } from "./shadow/shadowEvidenceComposition";
import { parseShadowSessionIpc } from "./ipc/shadowIpcValidation";
import { UpbitMinuteCandleSource } from "./exchange/upbitMinuteCandleSource";
import { createCanonicalOperationalPaperRiskGate, verifyRuntimeDeployment, verifyRuntimePaperReconciliation, type OperationalPreflightState } from "./paper/paperOperationalPreflight";
import { computeConsecutiveLossCount, createSessionPeakEquityTracker, type SessionPeakEquityTracker } from "./paper/paperRiskState";
import { createAnthropicSignalExplainerClient, type AiSignalExplainerClient, type SignalExplanationRequest } from "./ai/aiSignalExplainer";
import { AiChallengerObserver, createAnthropicChallengerClient, type AiChallengerClient } from "./ai/aiChallengerObserver";
import { createAnthropicDisagreementExplainerClient, type AiDisagreementExplainerClient } from "./ai/aiChallengerDisagreementExplainer";
import { createAnthropicSessionSummaryClient, type AiSessionSummaryClient } from "./ai/aiSessionSummary";
import { createAnthropicRegimeExplainerClient, type AiRegimeExplainerClient } from "./ai/aiRegimeExplainer";
import { createAnthropicRiskCommentaryClient, type AiRiskCommentaryClient } from "./ai/aiRiskCommentary";
import { ResearchAssistantGovernor, type ResearchAssistantId } from "./ai/aiResearchAssistantGovernor";
import { aiSha256 } from "../../../packages/contracts/src/aiInference";
import type { CanonicalRiskDecision } from "../../../packages/contracts/src/risk-safety-integration";
import { compareRecoveryState, RecoveryReviewState } from "./recovery/recoveryReconciliation";
import { CrashRecoveryMarkerStore, type CrashRecoveryDiagnostic, type CrashRecoveryStartup } from "./crashRecoveryMarker";
import { resolveUserDataLayout, writableDirectories, type UserDataLayout } from "./userDataLayout";
import { AppSettingsStore, type AppSettings, type LogLevel } from "./appSettingsStore";
import { FirstRunNoticeStore } from "./firstRunNotice";
import { AppLogger } from "./appLogger";
import { buildAboutInfo, type AboutInfo } from "./aboutInfo";
import { applyRendererNavigationPolicy, browserWindowSecurityOptions, clampLogLevel, resolveProductionPolicy, type ProductionPolicy } from "./productionHardening";
import { ShutdownSequence, type ShutdownProgress } from "./shutdownSequence";
import { mkdirSync } from "node:fs";
import os from "node:os";
import { startMobileBridge, type MobileBridgeHandle, type MobileCandleDto, type MobileMarketDto } from "./mobileBridge";
import { SqliteDurableExecutionRepository } from "../../../packages/storage/src/durable-execution";
import { SqliteRiskEvidenceRepository } from "../../../packages/storage/src/risk-evidence";
import { CanonicalRiskSafetyGate } from "../../../packages/contracts/src/risk-safety-integration";
import { PaperApprovalService } from "./paper/paperApprovalService";
import { randomUUID } from "node:crypto";
import type { RuntimeContext } from "./ipc/runtimeContext";
import { registerPaperIpcHandlers } from "./ipc/registerPaperIpcHandlers";
import { registerAiIpcHandlers } from "./ipc/registerAiIpcHandlers";
import { registerControlIpcHandlers } from "./ipc/registerControlIpcHandlers";
import { registerSafetyIpcHandlers } from "./ipc/registerSafetyIpcHandlers";
import { registerShadowIpcHandlers } from "./ipc/registerShadowIpcHandlers";
import { registerRecoveryIpcHandlers } from "./ipc/registerRecoveryIpcHandlers";
import { registerAppIpcHandlers } from "./ipc/registerAppIpcHandlers";
import { registerDiagnosticsIpcHandlers } from "./ipc/registerDiagnosticsIpcHandlers";

const MARKET = "KRW-BTC";
const INITIAL_CASH = 10_000_000;
const FEE_RATE = 0.0005;
const MAXIMUM_MARKET_DATA_AGE_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 5_000;
const REQUIRED_WARMUP_SAMPLES = 20;
const SHADOW_STRATEGY_VERSION = "sma-crossover:closed-candle-1m-v1";
const SHADOW_STRATEGY_FINGERPRINT = createHash("sha256").update(JSON.stringify({ strategyId: "sma-crossover", strategyVersion: SHADOW_STRATEGY_VERSION, inputType: "CLOSED_CANDLE", interval: "1m", sourceType: "UPBIT_PUBLIC_CANDLE", shortWindow: 5, longWindow: 20 })).digest("hex");
// minOrderNotional matches Upbit's documented 5,000 KRW minimum order value for KRW markets.
// priceTick is intentionally left unset: Upbit's KRW tick size is tiered by price range, and an
// incorrect single-tier constant would incorrectly reject valid Paper orders.
const RISK_POLICY = { maxOrderNotional: 2_000_000, maxPositionQuantity: 0.1, maxRealizedLoss: 1_000_000, minOrderNotional: 5_000 };
// Conservative Paper fill assumptions: adverse slippage against the trader and a cap on
// how much of a requested quantity fills against one quote. Both bias results pessimistically
// rather than assuming unrealistic perfect execution. Simulated fills only; no real exchange order is placed.
const FILL_MODEL = { slippageBps: 5, spreadBps: 5, maxFillRatio: 0.9 };
const PAPER_SAFETY_SOURCE_COMMIT = process.env.GITHUB_SHA ?? "local-paper-build";
// The runtime fingerprint exists to catch a persisted snapshot from a DIFFERENT build being
// recovered by this one -- a schema migration, a platform change, a version bump. A fixed
// string here (as this used to be) can never change, so `recoverPaperSafetySnapshot`'s
// `FINGERPRINT_RUNTIME_MISMATCH` check could never fire regardless of what actually changed
// between the crash and this restart. `deriveRuntimeFingerprint` is the module this project
// already built to solve exactly this problem (see runtimeFingerprint.ts); it was defined but
// never called from here. `sourceCommitSha` is passed through PAPER_SAFETY_SOURCE_COMMIT
// itself as a second signal, so this fingerprint only needs to be internally consistent with
// that value, not the sole detector of a commit change.
const PAPER_SAFETY_FINGERPRINTS = Object.freeze({
  strategy: createHash("sha256").update("sma-crossover:5:20").digest("hex"),
  config: createHash("sha256").update(JSON.stringify({ MARKET, INITIAL_CASH, FEE_RATE })).digest("hex"),
  runtime: deriveRuntimeFingerprint({
    appVersion: app.getVersion(),
    sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
    persistenceSchemaVersion: 1,
    platform: process.platform,
    nodeMajorVersion: Number(process.versions.node.split(".")[0])
  }),
  riskPolicy: createHash("sha256").update(JSON.stringify(RISK_POLICY)).digest("hex")
});
// One gate instance is shared by RuntimeCommandService and Shadow. It is assigned only after
// deployment and reconciliation have been measured; an uninitialised gate remains HALT.
let paperCommandRiskGate: PaperCommandRiskGate = { evaluate: () => Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze(["RISK_GATE_NOT_CONFIGURED"]) }) };
let operationalPreflight: OperationalPreflightState = Object.freeze({
  deployment: Object.freeze({ status: "BLOCKED", method: "NOT_INITIALIZED", evidence: Object.freeze([]), blockers: Object.freeze(["PREFLIGHT_NOT_INITIALIZED"]) }),
  reconciliation: Object.freeze({ status: "BLOCKED", method: "NOT_INITIALIZED", evidence: Object.freeze([]), blockers: Object.freeze(["PREFLIGHT_NOT_INITIALIZED"]) }),
  riskGate: Object.freeze({ status: "BLOCKED", method: "NOT_INITIALIZED", evidence: Object.freeze([]), blockers: Object.freeze(["RISK_GATE_NOT_CONFIGURED"]) })
});
let marketDataStatus: "HEALTHY" | "STALE" | "RECONNECTING" | "WARMING_UP" | "GAP_DETECTED" | "OUT_OF_ORDER" | "INVALID" = "WARMING_UP";
let window: BrowserWindow | undefined;
let latestTicker: UpbitTicker | undefined;
let broker: PaperBroker;
let sessionStore: PaperSessionStore;
let controlStore: ControlSessionStore;
let persistenceStore: DesktopPersistenceStore | undefined;
let executionRepository: SqliteDurableExecutionRepository | undefined;
let operationsAudit: readonly OperationsAuditRecord[] = Object.freeze([]);
let operationsAlerts: readonly OperationsAlertRecord[] = Object.freeze([]);
let stream: UpbitWebSocketClient;
let paperTradingAvailable = false;
// Kill Switch/P0 are persisted safety facts. A generic FAULTED control status is not
// itself evidence that either safety condition is active.
let persistedKillSwitchActive = true;
let persistedKillSwitchReason: string | null = null;
let persistedKillSwitchActivatedAt: number | null = null;
let persistedOpenP0Codes: readonly string[] = Object.freeze([]);
// Tracks the highest equity observed this run, restored from the last persisted
// safety snapshot when available, so SESSION_DRAWDOWN_LIMIT compares against a real
// peak instead of the current equity (which always yields a drawdown of zero).
const sessionPeakEquityTracker: SessionPeakEquityTracker = createSessionPeakEquityTracker(INITIAL_CASH);
// Read-only research assistant: explains strategy signals in plain language,
// on demand only. There is no UI to enter or store a credential -- an operator
// who wants this feature sets ANTHROPIC_API_KEY in the process environment
// before launch. Feature stays dark (NOT_CONFIGURED) when unset.
const aiSignalExplainerClient: AiSignalExplainerClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicSignalExplainerClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
// Holds the context+text of the last explanation shown to the user, so a follow-up
// question can be answered without the renderer having to round-trip that state back.
let lastAiSignalExplanation: Readonly<{ request: SignalExplanationRequest; explanation: string }> | undefined;
// Risk Budget usage for UI display (11 categories, read-only)
let lastRiskBudgetUsage: any | undefined;
// AI "challenger" observer: on every champion signal transition, asks what an LLM would have
// signaled and records the comparison. It has no reference to PaperBroker, the risk gate, or
// runtime -- there is no path from here to a real or hypothetical order.
const aiChallengerClient: AiChallengerClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicChallengerClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
const aiChallengerObserver = new AiChallengerObserver(aiChallengerClient);
// On-demand explanation for why the AI challenger's latest signal diverged from the champion's.
const aiDisagreementExplainerClient: AiDisagreementExplainerClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicDisagreementExplainerClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
// On-demand session summary: same dark-by-default pattern as the other AI features.
const aiSessionSummaryClient: AiSessionSummaryClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicSessionSummaryClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
// On-demand regime explanation: same dark-by-default pattern as the other AI features.
const aiRegimeExplainerClient: AiRegimeExplainerClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicRegimeExplainerClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
// On-demand risk commentary: explains the AI CIO risk dashboard section in plain Korean.
const aiRiskCommentaryClient: AiRiskCommentaryClient | undefined =
  process.env.ANTHROPIC_API_KEY ? createAnthropicRiskCommentaryClient({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined;
// Caps and caches calls to the five research-assistant IPC handlers below (signal explainer
// covers two handlers: explain + follow-up) so a chatty operator or a renderer bug cannot run
// up unbounded AI inference cost in a single session. Governed at the IPC boundary only --
// none of the five assistant modules themselves are aware of this.
const aiResearchAssistantGovernor = new ResearchAssistantGovernor();
const aiResearchAssistantResponseCache = new Map<string, unknown>();
async function governedAiAssistantCall<TResponse>(
  assistantId: ResearchAssistantId,
  requestForHash: unknown,
  fallback: (reason: "RATE_LIMITED") => TResponse,
  invoke: () => Promise<TResponse>
): Promise<TResponse> {
  const now = Date.now();
  const inputHash = aiSha256(requestForHash);
  const cacheKey = `${assistantId}:${inputHash}`;
  const decision = aiResearchAssistantGovernor.check(assistantId, inputHash, now);
  if (decision === "CACHE_HIT") {
    const cached = aiResearchAssistantResponseCache.get(cacheKey);
    if (cached !== undefined) return cached as TResponse;
    // Cache entry expired between check() and here (or was never populated); fall through to a fresh call.
  } else if (decision === "BLOCKED") {
    return fallback("RATE_LIMITED");
  }
  const response = await invoke();
  aiResearchAssistantGovernor.recordCall(assistantId, inputHash, now);
  aiResearchAssistantResponseCache.set(cacheKey, response);
  return response;
}
const smaStrategy = new SmaCrossoverStrategy(5, 20);
const strategy = new StrategyEngine(smaStrategy);
const aiCioEnvelopeSource = new InMemoryAiCioEnvelopeSource();
const aiCioSnapshotPublisher = new AiCioSnapshotPublisher(aiCioEnvelopeSource, {
  mode: "PAPER",
  maximumSectionAgeMs: 60_000,
  maximumEnvelopeAgeMs: 30_000
});
let control: ControlPlane;
let runtime: RuntimeCommandService;
let shadowRuntime: ShadowOperationalRuntime;
let diagnosticsEvidenceRoot = "";
let shadowIncompleteEvidence: readonly string[] = [];
let shadowEvidenceScanBlocked = false;
let evidenceRecorder: PaperScenarioEvidenceRecorder | undefined;
let runtimeEvidenceState: PaperRuntimeEvidenceState;
let liveMarketRegimeObserver: LiveMarketRegimeObserver;
let websocketConnected = false;
let disconnectedAt: number | undefined;
let reconnectedAt: number | undefined;
let rendererHealthy = true;
let healthTimer: NodeJS.Timeout | undefined;
let officialCandleTimer: NodeJS.Timeout | undefined;
const officialCandleSource = new UpbitMinuteCandleSource(MARKET);
const recoveryLedger = new RecoveryLedger();
/**
 * WO-0034-A4H. Held in memory for the life of the process: an owner approval that survived a
 * restart would be an approval of state nobody re-checked after the restart.
 */
const recoveryReview = new RecoveryReviewState();
/** Set when a persisted snapshot actually produced a recovery that needs reconciling. */
let recoveryRecordId: string | null = null;
let crashRecoveryStore: CrashRecoveryMarkerStore | undefined;
let mobileBridge: MobileBridgeHandle | undefined;
let paperRiskEvidenceRepository: SqliteRiskEvidenceRepository | undefined;
let paperApprovalService: PaperApprovalService | undefined;
/**
 * WO-0019. The STRATEGY-boundary approval currently in force, if any. Reset to undefined on
 * every process start (see initializeRuntime) -- a restart never revives or reissues one, and
 * automaticSignal is passed exactly this value, so the strategy stays blocked with
 * APPROVAL_MISSING until an operator explicitly starts it again.
 */
let currentStrategyApprovalId: string | undefined;
let lastCanonicalRiskDecision: CanonicalRiskDecision = Object.freeze({
  status: "BLOCKED",
  reasonCodes: Object.freeze(["RISK_GATE_NOT_CONFIGURED"]),
  reason: "risk gate not configured",
  evaluatedAtMs: 0,
  decisionId: "UNINITIALIZED",
  productionMutationAllowed: false,
  dashboard: Object.freeze({ status: "BLOCKED", reasonCodes: Object.freeze(["RISK_GATE_NOT_CONFIGURED"]) })
});
/**
 * WO-0034-A4O productization state. Resolved once, at app-ready, because every path below
 * depends on `app.getPath("userData")` and `app.isPackaged`, neither of which is meaningful
 * before then.
 */
let userDataLayout: UserDataLayout | undefined;
let settingsStore: AppSettingsStore | undefined;
let firstRunStore: FirstRunNoticeStore | undefined;
let appLogger: AppLogger | undefined;
let productionPolicy: ProductionPolicy = resolveProductionPolicy(false);
let shutdownSequence: ShutdownSequence | undefined;
let aboutInfo: AboutInfo | undefined;
const productRunId = `run-${process.pid}-${Date.now()}`;
const recentErrorCodes: string[] = [];
let crashRecoveryStartup: CrashRecoveryStartup | undefined;
let crashRecoveryRequired = false;
let lastEvidenceId: string | null = null;
let crashRecoveryDiagnostic: CrashRecoveryDiagnostic = Object.freeze({
  runId: null,
  recoveryRequired: false,
  previousRunId: null,
  previousSessionId: null,
  previousSessionState: null,
  lastEvidenceId: null,
  detectedAt: null,
  cleanShutdown: false,
  reasonCodes: Object.freeze([]),
  recoveryState: null,
  failClosed: false
});

function recordRecovery(component: RecoveryComponent, status: RecoveryHealth, message: string): void {
  recoveryLedger.record({ id: `${component}:${Date.now()}:${recoveryLedger.list().length}`, timestamp: Date.now(), component, status, message });
}

function currentCrashContext(): Readonly<{
  sessionId: string | null;
  sessionState: string | null;
  evidenceId: string | null;
  marketConnectionState: string;
}> {
  const diagnostics = shadowRuntime?.diagnostics();
  return {
    sessionId: diagnostics?.sessionId ?? null,
    sessionState: diagnostics?.state ?? "IDLE",
    evidenceId: lastEvidenceId,
    marketConnectionState: marketDataStatus
  };
}

function updateCrashMarker(): void {
  if (!crashRecoveryStore) return;
  try {
    const context = currentCrashContext();
    crashRecoveryStore.update({
      lastKnownSessionId: context.sessionId,
      lastKnownSessionState: context.sessionState,
      lastEvidenceId: context.evidenceId,
      lastMarketConnectionState: context.marketConnectionState
    });
  } catch (error) {
    crashRecoveryRequired = true;
    recordRecovery("STORAGE", "CRITICAL", `Crash marker update failed: ${error instanceof Error ? error.message : String(error)}`);
    if (control) control.fault(PERSISTENCE_FAULT_MESSAGE);
  }
}

/**
 * Resolves the writable layout and everything that hangs off it. Called once from app-ready,
 * before any other subsystem asks for a path, so no code can construct one of its own.
 */
function initializeProductLayer(): UserDataLayout {
  const layout = resolveUserDataLayout({ userDataPath: app.getPath("userData"), packaged: app.isPackaged });
  for (const directory of writableDirectories(layout)) {
    try { mkdirSync(directory, { recursive: true }); } catch { /* reported by the startup diagnostics */ }
  }
  productionPolicy = resolveProductionPolicy(app.isPackaged);
  settingsStore = new AppSettingsStore(layout);
  const settings = settingsStore.load();
  firstRunStore = new FirstRunNoticeStore(layout, "PAPER");
  appLogger = new AppLogger({
    directory: layout.logsDirectory,
    runId: productRunId,
    // The user's choice, clamped by what a packaged build is allowed to write. Asking for
    // DEBUG in production yields INFO rather than an error: it is a preference, not a command.
    level: clampLogLevel(settings.logLevel, productionPolicy),
    policy: { ...DEFAULT_LOG_ROTATION_FROM_SETTINGS(settings) }
  });
  aboutInfo = buildAboutInfo({
    appName: app.getName(),
    appVersion: app.getVersion(),
    buildNumber: process.env.NUSA_BUILD_NUMBER ?? null,
    commitSha: PAPER_SAFETY_SOURCE_COMMIT,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome ?? null,
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    mode: "PAPER",
    layout
  });
  userDataLayout = layout;
  logProduct("INFO", "application started", { environment: layout.environment, packaged: app.isPackaged });
  return layout;
}

/** Log-rotation policy derived from the user's retention preference. */
function DEFAULT_LOG_ROTATION_FROM_SETTINGS(settings: AppSettings) {
  return { maxFileBytes: 2 * 1024 * 1024, maxFiles: 10, maxAgeDays: settings.logRetentionDays, maxTotalBytes: 20 * 1024 * 1024 };
}

function logProduct(level: LogLevel, message: string, detail?: Readonly<Record<string, unknown>>, errorCode?: string): void {
  if (errorCode) {
    recentErrorCodes.push(errorCode);
    // Bounded: this list rides along in a diagnostics bundle, and an unbounded one would
    // grow for the whole life of the process.
    while (recentErrorCodes.length > 50) recentErrorCodes.shift();
  }
  appLogger?.log({
    channel: "MAIN",
    level,
    message,
    detail,
    errorCode,
    runId: productRunId,
    sessionId: shadowRuntime?.diagnostics().sessionId ?? null
  });
}

function requireLayout(): UserDataLayout {
  if (!userDataLayout) throw new Error("application data layout is not ready");
  return userDataLayout;
}

function beginCrashShutdown(): void {
  if (!crashRecoveryStore) return;
  const context = currentCrashContext();
  try {
    crashRecoveryStore.beginShutdown({ at: Date.now(), ...context });
  } catch (error) {
    // A shutdown is only clean when this durable marker can be written.
    crashRecoveryRequired = true;
    recordRecovery("STORAGE", "CRITICAL", `Crash marker shutdown write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function completeCrashShutdown(): boolean {
  if (!crashRecoveryStore) return true;
  const context = currentCrashContext();
  try {
    crashRecoveryStore.completeShutdown({ at: Date.now(), ...context, sessionState: context.sessionState ?? "IDLE" });
    return true;
  } catch (error) {
    recordRecovery("STORAGE", "CRITICAL", `Crash marker completion write failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

registerAiCioReadOnlyIpc(ipcMain, aiCioEnvelopeSource);

function publishControl(): void { window?.webContents.send("control:snapshot", control.snapshot()); }
function publishPaper(): void {
  if (latestTicker) window?.webContents.send("paper:snapshot", broker.snapshot(latestTicker.trade_price));
}

function publishAiCioDashboard(): void {
  if (!latestTicker) {
    aiCioSnapshotPublisher.clear();
    return;
  }
  const generatedAt = Date.now();
  try {
    const account = broker.snapshot(latestTicker.trade_price);
    const strategyAnalytics = buildStrategyAnalytics({
      orders: account.orders,
      strategyId: smaStrategy.id,
      market: MARKET,
      markPrice: latestTicker.trade_price
    });
    aiCioSnapshotPublisher.publishIfComplete(buildPaperDashboardSections({
      account,
      control: control.snapshot(),
      markPrice: latestTicker.trade_price,
      referenceEquity: INITIAL_CASH,
      runtimeAvailable: paperTradingAvailable,
      generatedAt,
      research: persistenceStore == null ? undefined : buildPersistedResearchDashboardSection({
        manifests: persistenceStore.loadResearchRunManifests(),
        reports: persistenceStore.loadResearchValidationReports(),
        generatedAt
      }),
      strategyWarmup: { current: strategy.getHistory().length, required: REQUIRED_WARMUP_SAMPLES },
      strategyAnalytics: strategyAnalytics ?? undefined,
      canonicalRiskDecision: lastCanonicalRiskDecision,
      killSwitchActive: persistedKillSwitchActive,
      opportunitySchedule: persistenceStore?.loadLatestOpportunitySchedule()?.schedule,
      executionCostBps: FILL_MODEL.slippageBps + FILL_MODEL.spreadBps / 2,
      committee: persistenceStore == null ? undefined : buildPersistedCommitteeDashboardSection({
        ...persistenceStore.loadCommitteeDashboardSource(),
        generatedAt,
        maximumAgeMs: 60_000
      })
    }), generatedAt);
  } catch {
    aiCioSnapshotPublisher.clear();
  }
}

function failClosedEvidenceWrite(): void {
  paperTradingAvailable = false;
  control.fault(PERSISTENCE_FAULT_MESSAGE);
  runtime.markUnavailable();
  publishControl();
  publishAiCioDashboard();
}

function marketDataIsFresh(now = Date.now()): boolean {
  return websocketConnected && latestTicker !== undefined && latestTicker.trade_timestamp <= now && now - latestTicker.trade_timestamp <= MAXIMUM_MARKET_DATA_AGE_MS;
}

function assertFreshMarketData(): UpbitTicker {
  if (!latestTicker) throw new Error("market price is not available yet");
  if (!websocketConnected) throw new Error("market data connection is unavailable");
  const age = Date.now() - latestTicker.trade_timestamp;
  if (!Number.isSafeInteger(latestTicker.trade_timestamp) || age < 0 || age > MAXIMUM_MARKET_DATA_AGE_MS) {
    throw new Error("market price is stale; wait for a fresh ticker");
  }
  return latestTicker;
}

function disableAutomaticTradingForMarketFault(status: string): void {
  if (!control.snapshot().autoTradeEnabled) return;
  try {
    runtime.setAutoTrade(false);
  } finally {
    paperTradingAvailable = runtime.isAvailable();
    publishControl();
    publishAiCioDashboard();
  }
  recordRecovery("WEBSOCKET", "WARNING", `Automatic Paper trading disabled: ${status}`);
}

function recordLiveMarketRegime(ticker: UpbitTicker): boolean {
  const regime = liveMarketRegimeObserver.observe(ticker);
  if (!regime || !paperTradingAvailable || !evidenceRecorder) return true;
  try {
    evidenceRecorder.regimeObserved(`regime:${regime}:${ticker.trade_timestamp}`, ticker.trade_timestamp, regime);
    return true;
  } catch {
    failClosedEvidenceWrite();
    return false;
  }
}

/**
 * The strategy is driven ONLY from a closed 1-minute candle, never from this raw ticker
 * directly (WO-0034-A2) -- shadowRuntime.onTicker aggregates candles internally and calls
 * strategy.onTick exactly once per closed candle, via onProductionSignal below.
 */
function handleTicker(ticker: UpbitTicker): void {
  latestTicker = ticker;
  window?.webContents.send("market:ticker", ticker);
  window?.webContents.send("chart:point", { time: ticker.trade_timestamp, value: ticker.trade_price });
  shadowRuntime?.onTicker({ ...ticker, trade_volume: ticker.acc_trade_volume });
  if (!recordLiveMarketRegime(ticker)) return;
}

/** Fires once per closed candle, for BOTH real Automatic Paper trading and (separately) Shadow. */
function handleProductionSignal(input: { market: string; price: number; positionQuantity: number; signal: StrategySignal }): void {
  if (persistenceStore) {
    try { persistenceStore.saveStrategyPriceHistory(strategy.getHistory()); } catch {
      // Best-effort continuity only; never affects paperTradingAvailable or the account/control write path.
    }
  }
  runtime.automaticSignal(input.market, input.price, input.positionQuantity, input.signal, { approvalId: currentStrategyApprovalId });
  paperTradingAvailable = runtime.isAvailable();
  publishPaper();
  publishControl();
  publishAiCioDashboard();
  // Fire-and-forget: never awaited, never allowed to affect the signal/order path above.
  void aiChallengerObserver.observe({
    market: input.market,
    championSignal: { type: input.signal.type, reason: input.signal.reason },
    recentPrices: strategy.getHistory(),
    regime: input.signal.regime
  });
}

/**
 * Structured public-feed connection state (WO-0034-A4L). Emitted by the transport BEFORE the
 * human-readable status string, so the Shadow runtime records the specific reason a session
 * ended (MARKET_RECONNECT_TIMEOUT) rather than the generic string that follows it.
 */
function handleMarketConnectionState(connection: MarketConnectionDiagnostics): void {
  shadowRuntime.onMarketConnectionState(connection);
  window?.webContents.send("market:connection", connection);
}

function handleMarketStatus(status: string): void {
  const now = Date.now();
  websocketConnected = status === "connected" || status === "recovered";
  marketDataStatus = status === "connected" ? "HEALTHY" : status === "recovered" ? "HEALTHY" : status === "disconnected" || status.startsWith("reconnecting") ? "RECONNECTING" : status.startsWith("stale") ? "STALE" : "INVALID";
  window?.webContents.send("market:status", status);
  shadowRuntime.onWebSocketStatus(status);

  if (status === "connected" || status === "recovered") {
    reconnectedAt = now;
  } else {
    disconnectedAt ??= now;
    disableAutomaticTradingForMarketFault(status);
  }

  if (status === "reconnect-exhausted") {
    recordRecovery("WEBSOCKET", "CRITICAL", "Market WebSocket recovery exhausted");
    paperTradingAvailable = false;
    control.fault("Market WebSocket recovery exhausted");
    runtime.markUnavailable();
    publishControl();
    publishAiCioDashboard();
    return;
  }
  if (status.startsWith("reconnecting") || status.startsWith("error") || status.startsWith("decode-error") || status.startsWith("stale")) {
    recordRecovery("WEBSOCKET", "WARNING", status);
  }
  const evidence = runtimeEvidenceState.observeMarketStatus(status);
  if (evidence !== "WEBSOCKET_DISCONNECT_RECOVERED" || !paperTradingAvailable || !evidenceRecorder) return;
  const observedAt = Date.now();
  try {
    evidenceRecorder.faultScenarioPassed(`fault:websocket-disconnect:${observedAt}`, observedAt, "WEBSOCKET_DISCONNECT");
  } catch {
    failClosedEvidenceWrite();
  }
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: "NUSA Paper Trader",
    icon: path.join(app.getAppPath(), "apps/desktop/renderer/assets/nusa-a4p-symbol.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Spread first, then restated. The policy is the single source of truth (and is what
      // the tests assert), but the three isolation guarantees stay written out at the call
      // site: someone auditing this window should not have to follow an indirection to find
      // out whether the renderer is sandboxed.
      ...browserWindowSecurityOptions(productionPolicy),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // DevTools is the one value that genuinely varies, and it varies on `app.isPackaged`
      // alone (WO-0034-A4O req 10) -- not on NODE_ENV and not on a flag, because a hardening
      // policy the person running the app can switch off is decoration.
      devTools: productionPolicy.devToolsEnabled
    }
  });
  window.loadFile(resolveRendererIndexPath(__dirname));
  if (productionPolicy.devToolsEnabled) {
    // Chromium's disk cache keys renderer assets by URL, not by the app's build state, so a
    // plain reload of a file:// window can still serve a stale copy of edited CSS/JS -- the
    // single most common "I changed the design but the window still shows the old one" report
    // in dev. Dev-only (gated on the same flag DevTools itself uses): bind F5/Ctrl+R/Cmd+R to
    // reloadIgnoringCache() instead of leaving Electron's default (uncached-reload-less) behavior.
    window.webContents.on("before-input-event", (_event, input) => {
      if (input.type !== "keyDown") return;
      const isReloadKey = input.key === "F5" || ((input.control || input.meta) && input.key.toLowerCase() === "r");
      if (isReloadKey) window?.webContents.reloadIgnoringCache();
    });
  }
  window.webContents.on("did-finish-load", () => {
    console.info(formatDesktopStartupDiagnostic(createRendererLoadFinishedDiagnostic()));
    rendererHealthy = true;
    publishControl();
    publishPaper();
    publishAiCioDashboard();
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(formatDesktopStartupDiagnostic(createRendererLoadFailedDiagnostic({ errorCode, errorDescription, validatedUrl: validatedURL, isMainFrame })));
    if (isMainFrame) {
      rendererHealthy = false;
      recordRecovery("RENDERER", "CRITICAL", `Renderer main-frame load failed: ${errorDescription}`);
    }
  });
  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(formatDesktopStartupDiagnostic(createPreloadErrorDiagnostic({ preloadPath, errorMessage: error instanceof Error ? error.message : String(error) })));
  });
  window.webContents.on("console-message", (details) => {
    if (details.level !== "error") return;
    console.warn(formatDesktopStartupDiagnostic(createRendererConsoleErrorDiagnostic({ message: details.message, line: details.lineNumber, sourceId: details.sourceId })));
  });
  window.webContents.on("unresponsive", () => {
    console.warn(formatDesktopStartupDiagnostic(createRendererUnresponsiveDiagnostic()));
  });
  window.webContents.on("responsive", () => {
    console.info(formatDesktopStartupDiagnostic(createRendererResponsiveDiagnostic()));
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(formatDesktopStartupDiagnostic(createRendererProcessGoneDiagnostic({ reason: details.reason, exitCode: details.exitCode })));
    rendererHealthy = false;
    recordRecovery("RENDERER", "WARNING", "Renderer crashed; recreating the read-only view");
    const crashedWindow = window;
    window = undefined;
    crashedWindow?.destroy();
    setTimeout(() => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }, 500);
  });
  window.on("closed", () => { window = undefined; });
}

function observeHealth(): void {
  const memory = process.memoryUsage();
  const report = buildRecoveryHealthReport({
    now: Date.now(), ipcHealthy: rendererHealthy, websocketConnected, rendererHealthy,
    storageHealthy: persistenceStore !== undefined, lastMarketDataAt: latestTicker?.trade_timestamp,
    maximumMarketDataAgeMs: 60_000, heapUsedBytes: memory.heapUsed, maximumHeapUsedBytes: 768 * 1024 * 1024
  });
  if (report.status !== "HEALTHY") recordRecovery("MEMORY", report.status, report.reasons.join("; "));
  if ((report.status === "CRITICAL" || !marketDataIsFresh()) && control.snapshot().autoTradeEnabled) {
    disableAutomaticTradingForMarketFault(report.reasons.join("; ") || "market data is not fresh");
  }
}

/**
 * Hoisted out of initializeRuntime (WO-0019) so IPC handlers outside the runtime bootstrap --
 * specifically the kill-switch release/activate handlers -- can persist a safety snapshot
 * immediately after an operator action, without waiting for the next order or control command
 * to pass through RuntimeCommandService.commit(). Reads the same module-level `broker`,
 * `control`, `persistedKillSwitchActive`, etc. that initializeRuntime assigns.
 */
function createSafetySnapshot(paper: ReturnType<PaperBroker["exportState"]>) {
  if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
  const markPrice = latestTicker?.trade_price ?? 1;
  const account = broker.snapshot(markPrice);
  const sessionPeakEquity = sessionPeakEquityTracker.observe(account.equity);
  const sessionDrawdown = sessionPeakEquity > 0 ? Math.max(0, (sessionPeakEquity - account.equity) / sessionPeakEquity) : 0;
  const snapshot = createPaperSafetySnapshot({
    snapshotId: `paper-safety-${Date.now()}`, createdAt: Date.now(), tradingMode: "PAPER_MANUAL", killSwitch: { active: persistedKillSwitchActive, activatedAt: persistedKillSwitchActivatedAt, reason: persistedKillSwitchReason }, approval: null,
    fingerprints: PAPER_SAFETY_FINGERPRINTS, deploymentIntegrity: { status: operationalPreflight.deployment.status === "PASS" ? "PASS" : "UNKNOWN", checkedAt: Date.now(), reasonCodes: operationalPreflight.deployment.blockers }, reconciliation: { status: operationalPreflight.reconciliation.status === "PASS" ? "PASS" : "REQUIRED", checkedAt: Date.now(), ledgerSha256: null, reasonCodes: operationalPreflight.reconciliation.blockers },
    idempotency: { signalIds: [], commandIds: [], clientOrderIds: [], orderIds: paper.orders.map((order) => order.id), fillIds: paper.orders.map((order) => order.id) }, openAlerts: persistedOpenP0Codes.map((reasonCode, index) => ({ alertId: `persisted-p0-${index + 1}`, severity: "P0" as const, status: "OPEN" as const, reasonCode, createdAt: Date.now() })),
    lossState: { tradingDay: new Date().toISOString().slice(0, 10), dayStartEquity: INITIAL_CASH, realizedDailyPnl: account.position.realizedPnl, unrealizedDailyPnl: account.unrealizedPnl, consecutiveLossCount: computeConsecutiveLossCount(paper.ledger ?? []), sessionPeakEquity, sessionDrawdown }, marketDataRecovery: { status: "WARMING_UP", consecutiveHealthyClosedCandles: 0, reconnectCount: 0 }, sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT
  });
  return snapshot;
}
function saveSafety(paper: ReturnType<PaperBroker["exportState"]>, controlState: ReturnType<ControlPlane["exportState"]>): void {
  if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
  persistenceStore.saveWithPaperSafetySnapshot(paper, controlState, createSafetySnapshot(paper));
}

function initializeRuntime(): void {
  aiCioSnapshotPublisher.clear();
  evidenceRecorder = undefined;
  runtimeEvidenceState = new PaperRuntimeEvidenceState();
  liveMarketRegimeObserver = new LiveMarketRegimeObserver();
  disconnectedAt = undefined;
  reconnectedAt = undefined;
  const sessionStartedAt = Date.now();
  const evidenceSessionId = `paper-${process.pid}-${sessionStartedAt}`;
  // Every writable path now comes from the single layout (WO-0034-A4O req 6). In a packaged
  // build the layout root IS the userData directory, so these resolve to byte-identical paths
  // and no existing install is migrated. Only a development run lands somewhere else, which
  // is the point: a developer's experiment must not appear as the user's incomplete archive.
  const layout = userDataLayout ?? resolveUserDataLayout({ userDataPath: app.getPath("userData"), packaged: app.isPackaged });
  userDataLayout = layout;
  const shadowEvidenceRoot = layout.evidenceDirectory;
  diagnosticsEvidenceRoot = shadowEvidenceRoot;
  // Scanned once, here, and never again. The question it answers is "did a previous process
  // leave an archive unsealed", and only the state at startup can answer it. Re-scanning later
  // would sweep up this process's own open archive and block the session writing it.
  shadowIncompleteEvidence = [];
  shadowEvidenceScanBlocked = false;
  try {
    shadowIncompleteEvidence = findIncompleteShadowArchivesSync(shadowEvidenceRoot);
  } catch {
    // An unreadable archive root is uncertainty about the prior session. Shadow start will
    // expose RECOVERY_REQUIRED rather than continuing beside evidence it cannot inspect.
    shadowEvidenceScanBlocked = true;
  }
  sessionStore = new PaperSessionStore(layout.paperSessionFile);
  controlStore = new ControlSessionStore(layout.controlSessionFile);
  const paperLoad = sessionStore.loadSafe();
  const controlLoad = controlStore.loadSafe();
  let restored = paperLoad.state && controlLoad.state ? { paper: paperLoad.state, control: controlLoad.state } : undefined;
  let restoredFromSqlite = false;
  let persistenceDiagnostic: string | undefined;
  let safetyRecoveryBlocked = crashRecoveryRequired;
  try {
    persistenceStore = new DesktopPersistenceStore(layout.databaseFile);
    executionRepository = persistenceStore.executionRepository();
    const startupAudit: OperationsAuditRecord = Object.freeze({ auditId: `audit-start-${productRunId}`, actor: "SYSTEM", action: "APPLICATION_START", target: null, metadata: { mode: "PAPER", productionMutationAllowed: false }, createdAt: new Date().toISOString() });
    persistenceStore.appendOperationsAudit(startupAudit);
    operationsAudit = persistenceStore.loadOperationsAudit();
    operationsAlerts = persistenceStore.loadOperationsAlerts();
    const sqliteState = persistenceStore.load();
    if (sqliteState) {
      restored = sqliteState;
      restoredFromSqlite = true;
    } else if (restored) persistenceStore.importLegacy(restored);
  } catch (error) {
    persistenceStore = undefined;
    executionRepository = undefined;
    operationsAudit = Object.freeze([]);
    operationsAlerts = Object.freeze([]);
    persistenceDiagnostic = `SQLite recovery failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (persistenceStore) {
    try {
      const restoredHistory = persistenceStore.loadStrategyPriceHistory();
      if (restoredHistory) strategy.restoreHistory(restoredHistory);
    } catch {
      // Best-effort continuity only: fall back to warming up from empty history.
      // Must never affect persistenceDiagnostic or paperTradingAvailable.
    }
  }
  broker = new PaperBroker(INITIAL_CASH, MARKET, FEE_RATE, RISK_POLICY, restored?.paper, FILL_MODEL);
  control = new ControlPlane("sma-crossover", 200, restored?.control);
  const deployment = verifyRuntimeDeployment({
    mainDirectory: __dirname,
    rendererPath: resolveRendererIndexPath(__dirname),
    sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
    strategyId: smaStrategy.id,
    strategyVersion: SHADOW_STRATEGY_VERSION,
    symbol: MARKET,
    interval: "1m",
    fingerprints: PAPER_SAFETY_FINGERPRINTS
  });
  const reconciliation = verifyRuntimePaperReconciliation({
    broker,
    initialCash: INITIAL_CASH,
    markPrice: latestTicker?.trade_price ?? 1,
    persistenceHealthy: persistenceStore !== undefined && persistenceDiagnostic == null,
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 }
  });
  operationalPreflight = Object.freeze({
    deployment,
    reconciliation,
    riskGate: Object.freeze({ status: "PASS", method: "INDEPENDENT_RISK_GATEWAY_WITH_RUNTIME_PREFLIGHT_STATE", evidence: Object.freeze(["evaluatePreTradeRisk"]), blockers: Object.freeze([]) })
  });
  const riskSafetyPersistence = persistenceStore?.riskSafetyRepository();
  paperRiskEvidenceRepository = persistenceStore?.riskEvidenceRepository();
  paperApprovalService = riskSafetyPersistence == null ? undefined : new PaperApprovalService(new CanonicalRiskSafetyGate(riskSafetyPersistence));
  currentStrategyApprovalId = undefined;
  paperCommandRiskGate = riskSafetyPersistence == null ? { evaluate: () => Object.freeze({ status: "HALT" as const, reasonCodes: Object.freeze(["RISK_PERSISTENCE_UNAVAILABLE"]) }) } : createCanonicalOperationalPaperRiskGate({
    getState: () => operationalPreflight,
    getBroker: () => broker,
    getMarket: () => ({ symbol: MARKET, price: latestTicker?.trade_price ?? null, status: marketDataStatus }),
    getControl: () => ({ killSwitchActive: persistedKillSwitchActive, openP0: persistedOpenP0Codes.length > 0 }),
    persistence: riskSafetyPersistence,
    accountId: "desktop-paper",
    policyFingerprint: PAPER_SAFETY_FINGERPRINTS.riskPolicy,
    maxDailyLoss: RISK_POLICY.maxRealizedLoss,
    maxOpenOrders: 1,
    // WO-0019: the independent gateway's exposure/rate/drawdown/consecutive-loss/price-deviation
    // limits, restored to the live desktop path after WO-0018 had silently dropped them.
    identity: { strategyFingerprint: PAPER_SAFETY_FINGERPRINTS.strategy, configFingerprint: PAPER_SAFETY_FINGERPRINTS.config, runtimeFingerprint: PAPER_SAFETY_FINGERPRINTS.runtime, riskPolicyFingerprint: PAPER_SAFETY_FINGERPRINTS.riskPolicy, seenSignalIds: new Set(), seenCommandIds: new Set(), seenClientOrderIds: new Set() },
    limits: { maxOrderNotional: RISK_POLICY.maxOrderNotional, maxPositionNotional: RISK_POLICY.maxOrderNotional, maxOpenOrders: 1, maxOrdersPerSecond: 1, maxOrdersPerMinute: 60, maxSameSideStreak: 10, maxSymbolExposureNotional: RISK_POLICY.maxOrderNotional, maxPortfolioExposureNotional: RISK_POLICY.maxOrderNotional, maxDailyBuyNotional: RISK_POLICY.maxOrderNotional, maxDailySellNotional: RISK_POLICY.maxOrderNotional, maxDailyLoss: RISK_POLICY.maxRealizedLoss, maxConsecutiveLosses: 3, maxSessionDrawdownRatio: 0.2, maxPriceDeviationRatio: 0.05 },
    sessionPeakEquity: sessionPeakEquityTracker,
    fingerprints: PAPER_SAFETY_FINGERPRINTS,
    sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
    evidence: paperRiskEvidenceRepository,
    onDecision: (decision) => { lastCanonicalRiskDecision = decision; }
  });
  if (persistenceStore) {
    try {
      const safety = persistenceStore.loadPaperSafetySnapshot();
      if (safety) {
        persistedKillSwitchActive = safety.killSwitch.active;
        persistedKillSwitchReason = safety.killSwitch.reason;
        persistedKillSwitchActivatedAt = safety.killSwitch.activatedAt;
        persistedOpenP0Codes = Object.freeze(safety.openAlerts
          .filter((alert) => alert.severity === "P0" && alert.status !== "RESOLVED")
          .map((alert) => alert.reasonCode));
        sessionPeakEquityTracker.observe(safety.lossState.sessionPeakEquity);
        const recovery = recoverPaperSafetySnapshot(safety, { sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT, fingerprints: PAPER_SAFETY_FINGERPRINTS });
        control.record("SYSTEM", `Paper safety recovery: ${recovery.reasonCodes.join(",")}`);
        // WO-0034-A4H: identifies the recovery the reconciliation and owner review are about.
        // The snapshot's own id, so an approval can never be carried to a different recovery.
        recoveryRecordId = safety.snapshotId;
        if (recovery.blocked) {
          safetyRecoveryBlocked = true;
          control.fault("Paper safety recovery is blocked pending reconciliation and owner review");
        }
      }
    } catch (error) {
      persistenceDiagnostic = `Paper safety snapshot recovery failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (persistenceDiagnostic != null) {
    operationalPreflight = Object.freeze({
      ...operationalPreflight,
      riskGate: Object.freeze({ status: "BLOCKED", method: "PERSISTENCE_RECOVERY_FAILURE", evidence: Object.freeze([]), blockers: Object.freeze(["PERSISTENCE_UNHEALTHY"]) })
    });
  }
  if (persistenceStore) {
    evidenceRecorder = new PaperScenarioEvidenceRecorder({
      append: (event) => {
        persistenceStore!.saveWithScenarioEvent(broker.exportState(), control.exportState(), event);
        return { sequence: 0, previousHash: "", event, hash: "" };
      }
    }, evidenceSessionId);
  }
  runtime = new RuntimeCommandService(broker, control, strategy, { save: (paper, controlState) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    saveSafety(paper, controlState);
  }, saveWithScenarioEvent: (paper, controlState, event) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEventsAndPaperSafetySnapshot(paper, controlState, [event], createSafetySnapshot(paper));
  }, saveWithScenarioEvents: (paper, controlState, events) => {
    if (!persistenceStore) throw new Error("SQLite persistence is unavailable");
    persistenceStore.saveWithScenarioEventsAndPaperSafetySnapshot(paper, controlState, events, createSafetySnapshot(paper));
  } }, paperCommandRiskGate, () => {
    const now = Date.now();
    const marketDataObservedAt = latestTicker?.trade_timestamp ?? 0;
    const input = {
      now,
      mode: paperTradingAvailable ? "PAPER" as const : "FAULTED" as const,
      killSwitchActive: control.snapshot().status === "FAULTED",
      recoveryUnresolved: !paperTradingAvailable,
      strategySuspended: !strategy.isRunning(),
      dataFingerprintMatches: true,
      marketDataObservedAt,
      maximumDataAgeMs: MAXIMUM_MARKET_DATA_AGE_MS,
      warmupSamples: strategy.getHistory().length,
      requiredWarmupSamples: REQUIRED_WARMUP_SAMPLES,
      reconnectCooldownMs: RECONNECT_COOLDOWN_MS,
      ...(disconnectedAt === undefined ? {} : { disconnectedAt }),
      ...(reconnectedAt === undefined ? {} : { reconnectedAt })
    };
    return evaluateOperationalReadiness(input);
  }, evidenceRecorder, (diagnostic) => {
    const logger = diagnostic.kind === "PERSISTENCE_ROLLBACK_COMPLETED" ? console.info : console.error;
    logger(formatRuntimeMutationDiagnostic(diagnostic));
  });
  // Every process start constructs a fresh instance at IDLE. Shadow deliberately never
  // restores a previous session -- "no auto-run after restart" is true by construction. What
  // the durable archive adds is the opposite guarantee: a session that did run leaves a
  // sealed, hash-chained record behind, and an unsealed one blocks the next start.
  shadowRuntime = new ShadowOperationalRuntime({
    symbol: MARKET,
    strategyId: smaStrategy.id,
    strategyVersion: SHADOW_STRATEGY_VERSION,
    strategyFingerprint: SHADOW_STRATEGY_FINGERPRINT,
    sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
    fingerprints: PAPER_SAFETY_FINGERPRINTS,
    strategy,
    getPositionQuantity: () => broker.exportState().position.quantity,
    onProductionSignal: handleProductionSignal,
    riskGate: paperCommandRiskGate,
    getHypotheticalOrderQuantity: () => control.getOrderQuantity(),
    // WO-0034-A4: the observation boundaries the desktop actually runs under. A session that
    // reaches the ceiling stops itself and seals its archive, so an observation left running
    // by accident ends on its own rather than growing until someone notices.
    maxSessionDurationMs: SHADOW_OBSERVATION_PROFILE.maxSessionDurationMs,
    maxCandleAgeMs: SHADOW_OBSERVATION_PROFILE.maxCandleAgeMs,
    createEvidenceBus: createShadowEvidenceBusFactory({
      root: shadowEvidenceRoot,
      sourceCommitSha: PAPER_SAFETY_SOURCE_COMMIT,
      symbol: MARKET,
      strategyId: smaStrategy.id,
      strategyVersion: SHADOW_STRATEGY_VERSION,
      fingerprints: PAPER_SAFETY_FINGERPRINTS
    }),
    findIncompleteEvidence: () => shadowEvidenceScanBlocked ? ["UNREADABLE_SHADOW_EVIDENCE"] : shadowIncompleteEvidence,
    getSafetyState: () => ({
      deploymentIntegrity: operationalPreflight.deployment.status === "PASS",
      reconciliation: operationalPreflight.reconciliation.status === "PASS" && !safetyRecoveryBlocked && !crashRecoveryRequired,
      killSwitch: persistedKillSwitchActive,
      openP0: persistedOpenP0Codes.length > 0,
      automaticTrading: control.snapshot().autoTradeEnabled,
      // No Canary/Extended runtime mode is wired into this process at all yet.
      currentModeIsCanaryOrExtended: false
    }),
    // The desktop has one public market callback and one KRW-BTC subscription. These are
    // read-only topology facts for A4K diagnostics; they do not create or manage listeners.
    getMarketListenerCount: () => stream ? 1 : 0,
    getMarketSubscriptionCount: () => stream ? 1 : 0,
    // The real timers this process owns while an observation runs. Counted from the handles
    // themselves, so the number falls to zero when shutdown actually clears them rather than
    // when someone remembers to update a constant.
    getHostIntervalCount: () => (healthTimer ? 1 : 0) + (officialCandleTimer ? 1 : 0),
    // The reconnect timer is the one timeout this process can own, and it is counted from
    // the transport's own supervisor rather than assumed absent (WO-0034-A4L).
    getHostTimeoutCount: () => (stream ? stream.connectionDiagnostics().reconnectTimerCount : 0),
    longRunningDiagnosticsIntervalMs: 60_000,
    // WO-0034-A4L. A session paused ONLY because the public feed dropped returns to RUNNING,
    // with the same sessionId and archive, once real market data flows again AND the full
    // start precheck passes again. A stale feed, a clock drift, a candle gap, an owner pause
    // or any halt is outside this entirely and still needs the owner.
    autoResumeOnMarketRecovery: true
  });
  paperTradingAvailable = !crashRecoveryRequired && !safetyRecoveryBlocked && persistenceDiagnostic == null && paperLoad.diagnostic == null && controlLoad.diagnostic == null;
  if (control.snapshot().status === "RUNNING" && paperTradingAvailable) strategy.start();
  for (const diagnostic of [paperLoad.diagnostic, controlLoad.diagnostic, persistenceDiagnostic]) {
    if (diagnostic) control.fault(diagnostic);
  }
  if (!paperTradingAvailable) runtime.markUnavailable();
  if (paperTradingAvailable) {
    try {
      if (!evidenceRecorder) throw new Error("Paper evidence recorder is unavailable");
      evidenceRecorder.sessionObserved(`session-start:${evidenceSessionId}`, sessionStartedAt);
      if (restoredFromSqlite) evidenceRecorder.recoveryCompleted(`recovery:${evidenceSessionId}`, sessionStartedAt);
    } catch {
      failClosedEvidenceWrite();
    }
  }
  stream = new UpbitWebSocketClient(MARKET, handleTicker, handleMarketStatus, undefined, undefined, { onConnectionState: handleMarketConnectionState });
  updateCrashMarker();
}

function runControlCommand(command: () => void): ReturnType<ControlPlane["snapshot"]> {
  try { command(); }
  finally { paperTradingAvailable = runtime.isAvailable(); }
  publishControl();
  publishAiCioDashboard();
  return control.snapshot();
}

/**
 * WO-0019. The audit record is written BEFORE persistedKillSwitchActive changes. If the write
 * throws, this function throws too, and the caller (both IPC handlers below) never reaches the
 * state assignment -- so an audit failure leaves the kill switch exactly where it was.
 */
function recordKillSwitchAudit(action: "KILL_SWITCH_RELEASED" | "KILL_SWITCH_ACTIVATED", reason: string, previousState: boolean, newState: boolean): void {
  if (!persistenceStore) throw new Error("application data layout is not ready");
  const auditRecord: OperationsAuditRecord = Object.freeze({
    auditId: `audit-kill-switch-${Date.now()}-${randomUUID()}`,
    actor: "LOCAL_OPERATOR",
    action,
    target: null,
    metadata: Object.freeze({ reason, previousState, newState }),
    createdAt: new Date().toISOString()
  });
  persistenceStore.appendOperationsAudit(auditRecord);
  operationsAudit = persistenceStore.loadOperationsAudit();
}

function requireCurrentShadowSession(input: unknown): void {
  const { sessionId } = parseShadowSessionIpc(input);
  if (shadowRuntime.diagnostics().sessionId !== sessionId) throw new Error("shadow session mismatch");
}
/**
 * WO-0034-A4H. Gathers everything the comparison needs from state the main process already
 * holds. The renderer supplies none of it -- a renderer that could name the numbers being
 * compared could make them agree.
 */
function buildRecoveryComparison(): ReturnType<typeof compareRecoveryState> {
  return compareRecoveryState({
    recoveryRecordId,
    persistedSnapshotPresent: recoveryRecordId !== null,
    persistenceHealthy: persistenceStore !== undefined && paperTradingAvailable,
    broker: broker ?? null,
    initialCash: INITIAL_CASH,
    markPrice: latestTicker?.trade_price ?? null,
    killSwitchActive: persistedKillSwitchActive,
    openP0Codes: persistedOpenP0Codes,
    markerlessEvidence: shadowEvidenceScanBlocked ? ["UNREADABLE_SHADOW_EVIDENCE"] : shadowIncompleteEvidence,
    // No authenticated-endpoint or credential path is composed into this process. Reported
    // as measured state, not as a claim that no such path could ever exist.
    authenticatedEndpointCapabilityPresent: false,
    credentialStorageCapabilityPresent: false,
    mutationCounters: { broker: 0, orders: 0, fills: 0, cash: 0, position: 0 },
    checkedAt: Date.now()
  });
}

/**
 * A live proxy over this module's own state, so the ~45 ipcMain handlers that used to be
 * inlined here can live in per-domain files (registerPaperIpcHandlers.ts and its siblings)
 * without duplicating any of the state above. Every property is a getter/setter into the
 * bindings already declared in this file -- constructing this object introduces no new state
 * and no snapshot-staleness risk, since accessing e.g. `runtimeContext.broker` always reads
 * the current `broker` variable, exactly as the inline handler bodies this replaces did.
 */
const runtimeContext: RuntimeContext = {
  ipcMain,
  MARKET,
  PAPER_SAFETY_FINGERPRINTS,
  PAPER_SAFETY_SOURCE_COMMIT,
  productRunId,
  get broker() { return broker; },
  get control() { return control; },
  get runtime() { return runtime; },
  get strategy() { return strategy; },
  get smaStrategy() { return smaStrategy; },
  get stream() { return stream; },
  get latestTicker() { return latestTicker; },
  get paperTradingAvailable() { return paperTradingAvailable; },
  set paperTradingAvailable(value) { paperTradingAvailable = value; },
  get operationalPreflight() { return operationalPreflight; },
  get lastRiskBudgetUsage() { return lastRiskBudgetUsage; },
  get executionRepository() { return executionRepository; },
  get paperApprovalService() { return paperApprovalService; },
  get currentStrategyApprovalId() { return currentStrategyApprovalId; },
  set currentStrategyApprovalId(value) { currentStrategyApprovalId = value; },
  get marketDataStatus() { return marketDataStatus; },
  get websocketConnected() { return websocketConnected; },
  get rendererHealthy() { return rendererHealthy; },
  get persistedKillSwitchActive() { return persistedKillSwitchActive; },
  set persistedKillSwitchActive(value) { persistedKillSwitchActive = value; },
  get persistedKillSwitchReason() { return persistedKillSwitchReason; },
  set persistedKillSwitchReason(value) { persistedKillSwitchReason = value; },
  get persistedKillSwitchActivatedAt() { return persistedKillSwitchActivatedAt; },
  set persistedKillSwitchActivatedAt(value) { persistedKillSwitchActivatedAt = value; },
  get persistedOpenP0Codes() { return persistedOpenP0Codes; },
  get lastCanonicalRiskDecision() { return lastCanonicalRiskDecision; },
  get aiSignalExplainerClient() { return aiSignalExplainerClient; },
  get lastAiSignalExplanation() { return lastAiSignalExplanation; },
  set lastAiSignalExplanation(value) { lastAiSignalExplanation = value; },
  get aiChallengerClient() { return aiChallengerClient; },
  get aiChallengerObserver() { return aiChallengerObserver; },
  get aiDisagreementExplainerClient() { return aiDisagreementExplainerClient; },
  get aiSessionSummaryClient() { return aiSessionSummaryClient; },
  get aiRegimeExplainerClient() { return aiRegimeExplainerClient; },
  get aiRiskCommentaryClient() { return aiRiskCommentaryClient; },
  get aiCioEnvelopeSource() { return aiCioEnvelopeSource; },
  governedAiAssistantCall,
  get shadowRuntime() { return shadowRuntime; },
  get lastEvidenceId() { return lastEvidenceId; },
  set lastEvidenceId(value) { lastEvidenceId = value; },
  get diagnosticsEvidenceRoot() { return diagnosticsEvidenceRoot; },
  get shadowIncompleteEvidence() { return shadowIncompleteEvidence; },
  get shadowEvidenceScanBlocked() { return shadowEvidenceScanBlocked; },
  get recoveryReview() { return recoveryReview; },
  get recoveryRecordId() { return recoveryRecordId; },
  get crashRecoveryRequired() { return crashRecoveryRequired; },
  get crashRecoveryDiagnostic() { return crashRecoveryDiagnostic; },
  buildRecoveryComparison,
  get persistenceStore() { return persistenceStore; },
  get paperRiskEvidenceRepository() { return paperRiskEvidenceRepository; },
  get operationsAudit() { return operationsAudit; },
  get operationsAlerts() { return operationsAlerts; },
  get userDataLayout() { return userDataLayout; },
  get settingsStore() { return settingsStore; },
  get firstRunStore() { return firstRunStore; },
  get appLogger() { return appLogger; },
  get aboutInfo() { return aboutInfo; },
  get productionPolicy() { return productionPolicy; },
  get shutdownSequence() { return shutdownSequence; },
  get recentErrorCodes() { return recentErrorCodes; },
  publishControl,
  publishPaper,
  publishAiCioDashboard,
  runControlCommand,
  assertFreshMarketData,
  requireLayout,
  logProduct,
  recordKillSwitchAudit,
  saveSafety,
  updateCrashMarker,
  requireCurrentShadowSession
};

// registerAiCioReadOnlyIpc(ipcMain, aiCioEnvelopeSource) is called separately, near the top of
// this file, alongside the other IPC-wiring bootstrap code.
registerPaperIpcHandlers(runtimeContext);
registerAiIpcHandlers(runtimeContext);
registerControlIpcHandlers(runtimeContext);
registerSafetyIpcHandlers(runtimeContext);
registerShadowIpcHandlers(runtimeContext);
registerRecoveryIpcHandlers(runtimeContext);
registerAppIpcHandlers(runtimeContext);
registerDiagnosticsIpcHandlers(runtimeContext);

// Registered before any window exists so it covers every webContents the app ever creates,
// including one added by a later feature. The preload bridge is re-injected on each
// navigation, so a renderer that reached remote content would hand that content the whole
// IPC surface; nothing in this app navigates away from its own document or opens a window.
app.on("web-contents-created", (_event, contents) => {
  applyRendererNavigationPolicy(contents, (reason, url) => {
    console.warn(formatDesktopStartupDiagnostic(createRendererNavigationBlockedDiagnostic({ reason, url })));
  });
});

app.whenReady().then(() => {
  // First, before any subsystem asks for a path of its own.
  try {
    initializeProductLayer();
  } catch (error) {
    console.error(`application data layout failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const userData = app.getPath("userData");
    crashRecoveryStore = new CrashRecoveryMarkerStore(
      path.join(userData, "crash-marker.json"),
      path.join(userData, "recovery-records.jsonl")
    );
    crashRecoveryStartup = crashRecoveryStore.startRun({ startedAt: Date.now(), lastMarketConnectionState: marketDataStatus });
    crashRecoveryRequired = crashRecoveryStartup.recoveryRequired;
    if (crashRecoveryRequired) recoveryRecordId = crashRecoveryStartup.recoveryRecordId;
    crashRecoveryDiagnostic = crashRecoveryStore.diagnostic(crashRecoveryStartup);
    if (crashRecoveryRequired) {
      recordRecovery("STORAGE", "CRITICAL", `Previous run requires recovery: ${crashRecoveryStartup.reasonCodes.join(",")}`);
    }
  } catch (error) {
    crashRecoveryRequired = true;
    recordRecovery("STORAGE", "CRITICAL", `Crash recovery marker initialization failed: ${error instanceof Error ? error.message : String(error)}`);
    crashRecoveryDiagnostic = Object.freeze({
      ...crashRecoveryDiagnostic,
      recoveryRequired: true,
      reasonCodes: Object.freeze(["CRASH_MARKER_INVALID" as const]),
      failClosed: true,
      detectedAt: Date.now()
    });
  }
  initializeRuntime();
  if (crashRecoveryRequired) {
    control.fault("RECOVERY_REQUIRED: previous Electron run was not cleanly shut down");
    paperTradingAvailable = false;
    runtime.markUnavailable();
  }
  createWindow();
  startConfiguredMobileBridge();
  // Public market data is safe to observe even while Paper execution is unavailable.
  // Execution remains fail-closed behind RuntimeCommandService and the risk gate.
  stream.start();
  void shadowRuntime.syncOfficialCandles(officialCandleSource);
  officialCandleTimer = setInterval(() => { void shadowRuntime.syncOfficialCandles(officialCandleSource); }, 60_000);
  healthTimer = setInterval(observeHealth, 30_000);
  process.on("uncaughtException", (error) => {
    recordRecovery("STORAGE", "CRITICAL", `Main process error: ${error.message}`);
    failClosedEvidenceWrite();
  });
  process.on("unhandledRejection", (reason) => {
    recordRecovery("IPC", "CRITICAL", `Unhandled recovery failure: ${reason instanceof Error ? reason.message : String(reason)}`);
    failClosedEvidenceWrite();
  });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let shadowEvidenceSealed = false;
let shutdownInProgress = false;

function startConfiguredMobileBridge(): void {
  if (process.env.NUSA_MOBILE_MONITOR_ENABLED !== "true") return;
  const port = Number(process.env.NUSA_MOBILE_MONITOR_PORT ?? "0");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) { logProduct("WARN", "mobile monitor remains disabled: invalid port", {}, "MOBILE_BRIDGE_INVALID_PORT"); return; }
  mobileBridge = startMobileBridge({
    port,
    getStatus: () => Object.freeze({ app: "NUSA", mode: "PAPER", marketConnectionState: marketDataStatus, warmupState: marketDataStatus === "HEALTHY" ? "READY" : marketDataStatus, stale: marketDataStatus === "STALE", observedAt: new Date().toISOString() }),
    getAccount: () => latestTicker ? broker.snapshot(latestTicker.trade_price) as unknown as Readonly<Record<string, unknown>> : Object.freeze({ available: false, reason: "MARKET_DATA_UNAVAILABLE" }),
    getOpenOrderCount: () => latestTicker ? broker.snapshot(latestTicker.trade_price).orders.length : 0,
    getMarkets: (): readonly MobileMarketDto[] => latestTicker ? [Object.freeze({ market: latestTicker.code, price: latestTicker.trade_price, changeRate: latestTicker.signed_change_rate ?? null, volume: latestTicker.acc_trade_volume ?? null, observedAt: new Date(latestTicker.trade_timestamp).toISOString(), source: "UPBIT_PUBLIC_TICKER" as const })] : Object.freeze([]),
    getCandles: (market, interval, count): readonly MobileCandleDto[] => market === MARKET && interval === "1m"
      ? shadowRuntime.recentClosedCandles(count).map((candle) => Object.freeze({ market: candle.symbol, interval: "1m" as const, openTime: candle.openTime, closeTime: candle.closeTime, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, source: "UPBIT_PUBLIC_CANDLE" as const }))
      : Object.freeze([]),
    getEvents: () => recentErrorCodes.map((code) => Object.freeze({ code }))
  });
  logProduct("INFO", "read-only mobile monitor enabled on localhost", { port }, "MOBILE_BRIDGE_STARTED");
}

/**
 * A live Shadow session owns an open, hash-chained archive. Quitting without sealing it leaves
 * a record of unknown completeness on disk, which then -- correctly -- blocks the next start
 * with EVIDENCE_RECOVERY_REQUIRED. A crash should produce that outcome. A clean quit should
 * not, so the quit is deferred exactly once while the archive is sealed.
 */
/**
 * Owner-initiated quit runs the A4O shutdown sequence (req 8).
 *
 * The quit is deferred while it runs, and the renderer is shown each step as it happens, so
 * "the app is not closing" is visibly "the app is sealing your evidence" rather than a hang.
 * There is no force-quit control: the only thing it could do is skip the seal.
 */
function buildShutdownSequence(): ShutdownSequence {
  return new ShutdownSequence({
    runId: productRunId,
    observationIsRunning: () => shadowRuntime !== undefined && ["RUNNING", "PAUSED", "HALTED"].includes(shadowRuntime.diagnostics().state),
    currentSessionId: () => shadowRuntime?.diagnostics().sessionId ?? null,
    stopSignalIntake: () => {
      if (!shadowRuntime) return;
      // Only a session that is actually open is stopped; calling stop() on an IDLE runtime
      // throws, and a shutdown must not fail because there was nothing to shut down.
      if (!["RUNNING", "PAUSED", "HALTED"].includes(shadowRuntime.diagnostics().state)) return;
      shadowRuntime.stop();
    },
    unsubscribeMarket: () => { stream?.stop(); },
    clearTimers: () => {
      aiCioSnapshotPublisher.clear();
      if (healthTimer) { clearInterval(healthTimer); healthTimer = undefined; }
      if (officialCandleTimer) { clearInterval(officialCandleTimer); officialCandleTimer = undefined; }
      persistenceStore?.close();
      void mobileBridge?.stop();
      mobileBridge = undefined;
    },
    flushEvidence: async () => { await shadowRuntime?.awaitEvidenceFinalized(); },
    recordRecovery: (clean) => {
      if (!clean) recordRecovery("STORAGE", "WARNING", "Shutdown completed with at least one failed step");
    },
    beginShutdownRecord: () => beginCrashShutdown(),
    completeShutdownRecord: () => {
      if (!completeCrashShutdown()) throw new Error("crash marker completion write failed");
    },
    onProgress: (progress: ShutdownProgress) => {
      window?.webContents.send("app:shutdown", progress);
    }
  });
}

app.on("before-quit", (event) => {
  if (shadowEvidenceSealed) return;
  if (shutdownInProgress) {
    // Already sealing. Defer this quit too rather than racing the first one to the archive.
    event.preventDefault();
    return;
  }
  shutdownInProgress = true;
  event.preventDefault();
  shutdownSequence = shutdownSequence ?? buildShutdownSequence();
  void shutdownSequence.run()
    .catch((error) => {
      logProduct("ERROR", "shutdown sequence failed", { message: error instanceof Error ? error.message : String(error) }, "SHUTDOWN_FAILED");
    })
    .finally(() => {
      shadowEvidenceSealed = true;
      app.quit();
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
